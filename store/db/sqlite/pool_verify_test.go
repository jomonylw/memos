package sqlite

import (
	"context"
	"database/sql"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/usememos/memos/server/profile"
)

// newTestDB opens a database through the production NewDB path, so the test
// exercises the same connection-pool configuration that runs in the container
// rather than a hand-rolled stand-in.
func newTestDB(t *testing.T) (*sql.DB, *DB) {
	t.Helper()

	dsn := t.TempDir() + "/t.db"
	driver, err := NewDB(&profile.Profile{DSN: dsn})
	if err != nil {
		t.Fatalf("NewDB failed: %v", err)
	}
	db := driver.(*DB)
	t.Cleanup(func() { _ = db.Close() })
	return db.db, db
}

// newMigratedTestDB opens a database through NewDB and applies the real schema, so
// tests can exercise the production maintenance queries (vacuumImpl and friends)
// instead of a hand-written subset that could drift from the actual schema.
//
// applyLatestSchema is called directly because Migrate only creates the schema when
// the database file does not yet exist, and NewDB has already created it.
func newMigratedTestDB(t *testing.T) (*sql.DB, *DB) {
	t.Helper()

	db, driver := newTestDB(t)
	if err := driver.applyLatestSchema(context.Background()); err != nil {
		t.Fatalf("applyLatestSchema failed: %v", err)
	}
	return db, driver
}

// TestMigrateAppliesSchemaOnFreshDatabase guards the production first-run path.
//
// NewDB executes PRAGMA statements during setup, and journal_mode(WAL) creates the
// database file as a side effect. Migrate only applies the latest schema when the
// file is absent, so on a brand-new prod deployment the file already exists by the
// time Migrate runs. It must therefore still build the schema instead of failing on
// the missing migration_history table.
func TestMigrateAppliesSchemaOnFreshDatabase(t *testing.T) {
	ctx := context.Background()
	dsn := t.TempDir() + "/fresh.db"

	driver, err := NewDB(&profile.Profile{DSN: dsn, Mode: "prod", Data: t.TempDir()})
	if err != nil {
		t.Fatalf("NewDB failed: %v", err)
	}
	db := driver.(*DB)
	defer db.Close()

	// NewDB creates the file as a side effect of its PRAGMA setup.
	if _, err := os.Stat(dsn); err != nil {
		t.Fatalf("expected NewDB to have created the database file: %v", err)
	}

	if err := db.Migrate(ctx); err != nil {
		t.Fatalf("Migrate on a fresh prod database failed: %v", err)
	}

	var name string
	if err := db.db.QueryRowContext(ctx,
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resource'`).Scan(&name); err != nil {
		t.Fatalf("resource table missing after fresh prod Migrate: %v", err)
	}
}

// TestNewDBCapsConnectionPool pins the pool configuration applied in NewDB.
// Without the cap, SetMaxOpenConns(0) means unlimited connections: each streaming
// resource request holds one for the duration of the blob read, so a burst of
// image requests can occupy every connection and starve all other queries, leaving
// requests hanging forever with no error.
func TestNewDBCapsConnectionPool(t *testing.T) {
	db, _ := newTestDB(t)

	stats := db.Stats()
	if stats.MaxOpenConnections != maxOpenConns {
		t.Errorf("MaxOpenConnections = %d, want %d", stats.MaxOpenConnections, maxOpenConns)
	}
}

// TestNewDBEnablesIncrementalAutoVacuum verifies the pragma that lets freed pages
// return to the filesystem without a blocking, full-database VACUUM at runtime.
func TestNewDBEnablesIncrementalAutoVacuum(t *testing.T) {
	db, _ := newTestDB(t)

	// The pragma must hold on EVERY pooled connection, not just the one that
	// happened to execute it during setup.
	for i := 0; i < maxOpenConns; i++ {
		conn, err := db.Conn(context.Background())
		if err != nil {
			t.Fatalf("acquiring connection %d failed: %v", i, err)
		}

		// PRAGMA auto_vacuum: 0 = none, 1 = full, 2 = incremental.
		var autoVacuum int
		if err := conn.QueryRowContext(context.Background(), "PRAGMA auto_vacuum").Scan(&autoVacuum); err != nil {
			t.Fatalf("reading auto_vacuum on connection %d failed: %v", i, err)
		}
		if autoVacuum != 2 {
			t.Errorf("connection %d: auto_vacuum = %d, want 2 (incremental); freed "+
				"space would never be reclaimed without an offline VACUUM", i, autoVacuum)
		}
		_ = conn.Close()
	}
}

// TestVacuumDoesNotRewriteWholeDatabase is the regression guard for the original
// hang: deletion must not trigger a full-database VACUUM.
//
// A whole-file VACUUM holds the exclusive write lock for as long as it takes to
// rewrite the entire file. On a multi-GB database that blocks every other
// connection, and because the v2 API routes have no request timeout, requests hang
// indefinitely. It used to run after EVERY resource/memo/user delete, so removing
// one attachment from a memo with N images triggered N sequential full rewrites.
//
// The database is grown to a size where a full rewrite is clearly measurable, then
// the maintenance path is timed. If VACUUM were reintroduced, this test would take
// orders of magnitude longer.
func TestVacuumDoesNotRewriteWholeDatabase(t *testing.T) {
	ctx := context.Background()
	db, driver := newMigratedTestDB(t)

	// ~48 MB of attachment blobs, enough that rewriting the file is unmistakably
	// slow. Blobs are what make the production database multi-gigabyte.
	const rows = 3000
	payload := make([]byte, 16*1024)

	// vacuumResource deletes resources whose creator no longer exists, so a real
	// user row is required for the rows to survive.
	if _, err := db.Exec(
		`INSERT INTO user (username, role, email, nickname, password_hash, created_ts, updated_ts)
		 VALUES ('tester', 'HOST', 't@example.com', 'tester', 'x', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	var creatorID int
	if err := db.QueryRow(`SELECT id FROM user LIMIT 1`).Scan(&creatorID); err != nil {
		t.Fatal(err)
	}

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < rows; i++ {
		if _, err := tx.Exec(
			`INSERT INTO resource (creator_id, filename, type, size, blob) VALUES (?, ?, ?, ?, ?)`,
			creatorID, "f.bin", "application/octet-stream", len(payload), payload); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	var pageCountBefore int64
	if err := db.QueryRow(`PRAGMA page_count`).Scan(&pageCountBefore); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	if err := driver.Vacuum(ctx); err != nil {
		t.Fatalf("Vacuum failed: %v", err)
	}
	elapsed := time.Since(start)

	// The row count must be untouched: VacuumImpl only removes rows orphaned by
	// deleted users, and user 1 still exists.
	var remaining int
	if err := db.QueryRow(`SELECT COUNT(*) FROM resource`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != rows {
		t.Errorf("resource count = %d, want %d; maintenance deleted live data", remaining, rows)
	}

	// The delete path must stay fast and must not scale with database size.
	if elapsed > 10*time.Second {
		t.Errorf("Vacuum took %v for a %d-page database; this suggests a "+
			"full-database rewrite is running again", elapsed, pageCountBefore)
	}
	t.Logf("Vacuum completed in %v for %d pages (auto_vacuum reclaims space incrementally)",
		elapsed, pageCountBefore)
}

// TestPoolNotStarvedByConcurrentReads verifies the pool cap prevents connection
// starvation: many concurrent blob reads must not prevent an unrelated critical
// query from completing.
func TestPoolNotStarvedByConcurrentReads(t *testing.T) {
	db, _ := newTestDB(t)

	if _, err := db.Exec(`CREATE TABLE resource (id INTEGER PRIMARY KEY, blob BLOB)`); err != nil {
		t.Fatal(err)
	}
	blob := make([]byte, 1<<20)
	for i := 0; i < 8; i++ {
		if _, err := db.Exec(`INSERT INTO resource VALUES (?, ?)`, i, blob); err != nil {
			t.Fatal(err)
		}
	}

	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			var b []byte
			_ = db.QueryRowContext(ctx, `SELECT blob FROM resource WHERE id = ?`, id%8).Scan(&b)
		}(i)
	}

	done := make(chan error, 1)
	go func() {
		var n int
		done <- db.QueryRowContext(ctx, `SELECT COUNT(*) FROM resource`).Scan(&n)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("critical query failed: %v", err)
		}
		t.Log("PASS: critical query completed while 40 blob reads were in flight")
	case <-time.After(15 * time.Second):
		t.Fatal("FAIL: critical query starved -> pool exhaustion mechanism confirmed")
	}
	wg.Wait()
}
