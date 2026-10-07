package sqlite

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"
)

// Verifies the pool cap prevents connection starvation: many concurrent blob reads
// must not prevent an unrelated critical query from completing.
func TestPoolNotStarvedByConcurrentReads(t *testing.T) {
	dsn := t.TempDir() + "/t.db"
	db, err := sql.Open("sqlite", dsn+"?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(time.Hour)
	defer db.Close()

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
