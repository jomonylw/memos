package sqlite

import (
	"context"
	"database/sql"
	"os"
	"time"

	"github.com/pkg/errors"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	// Import the SQLite driver.
	_ "modernc.org/sqlite"

	"github.com/usememos/memos/server/profile"
	"github.com/usememos/memos/store"
)

// log is a local logger used for best-effort maintenance failures that must not
// abort user-facing operations (e.g. WAL checkpointing after a delete).
var log = zap.NewNop().Sugar()

type DB struct {
	db      *sql.DB
	profile *profile.Profile
}

// NewDB opens a database specified by its database driver name and a
// driver-specific data source name, usually consisting of at least a
// database name and connection information.
// Enable incremental auto-vacuum so that deleting rows gradually reclaims file
// space without ever needing a blocking, full-database VACUUM at runtime.
func enableAutoVacuum(db *sql.DB) {
	if _, err := db.Exec("PRAGMA auto_vacuum=INCREMENTAL"); err != nil {
		log.Warnf("failed to enable auto_vacuum: %v", err)
	}
	// Best-effort reclaim of space already freed in previous runs.
	if _, err := db.Exec("PRAGMA incremental_vacuum"); err != nil {
		log.Warnf("failed to run incremental_vacuum: %v", err)
	}
}

func NewDB(profile *profile.Profile) (store.Driver, error) {
	// Ensure a DSN is set before attempting to open the database.
	if profile.DSN == "" {
		return nil, errors.New("dsn required")
	}

	// Connect to the database with some sane settings:
	// - No shared-cache: it's obsolete; WAL journal mode is a better solution.
	// - No foreign key constraints: it's currently disabled by default, but it's a
	// good practice to be explicit and prevent future surprises on SQLite upgrades.
	// - Journal mode set to WAL: it's the recommended journal mode for most applications
	// as it prevents locking issues.
	//
	// Notes:
	// - When using the `modernc.org/sqlite` driver, each pragma must be prefixed with `_pragma=`.
	//
	// References:
	// - https://pkg.go.dev/modernc.org/sqlite#Driver.Open
	// - https://www.sqlite.org/sharedcache.html
	// - https://www.sqlite.org/pragma.html
	sqliteDB, err := sql.Open("sqlite", profile.DSN+"?_pragma=foreign_keys(0)&_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=cache_size(-65536)")
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open db with dsn: %s", profile.DSN)
	}

	// Cap the connection pool. Without this, SetMaxOpenConns(0) means unlimited
	// concurrent connections; each streaming resource request holds one for the
	// duration of the blob read, which lets a burst of image requests occupy every
	// connection and starve all other queries (no request ever completes).
	sqliteDB.SetMaxOpenConns(4)
	sqliteDB.SetMaxIdleConns(4)
	sqliteDB.SetConnMaxLifetime(time.Hour)

	driver := DB{db: sqliteDB, profile: profile}

	enableAutoVacuum(sqliteDB)

	return &driver, nil
}

func (d *DB) GetDB() *sql.DB {
	return d.db
}

func (d *DB) Vacuum(ctx context.Context) error {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := vacuumImpl(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Do NOT run a whole-database VACUUM here.
	//
	// VACUUM rewrites the entire file, so its runtime and temporary disk usage grow
	// linearly with database size. On a multi-GB database a single VACUUM can hold
	// the exclusive write lock for minutes, which blocks every other connection
	// (busy_timeout) and, because the v2 API routes have no request timeout, leaves
	// requests hanging forever. This used to run after EVERY resource/memo/user
	// delete, so removing a single attachment from a memo with N images triggered N
	// sequential full-database rewrites.
	//
	// Freed pages are returned to the filesystem by incremental auto-vacuum, which
	// is enabled in NewDB. Reclaiming space can be done offline instead:
	//   docker stop memos && sqlite3 memos_prod.db 'VACUUM;' && docker start memos
	if _, err := d.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		// Checkpointing is best-effort: never fail a delete because of it.
		log.Warnf("failed to truncate WAL after vacuum: %v", err)
	}

	return nil
}

func vacuumImpl(ctx context.Context, tx *sql.Tx) error {
	if err := vacuumMemo(ctx, tx); err != nil {
		return err
	}
	if err := vacuumResource(ctx, tx); err != nil {
		return err
	}
	if err := vacuumUserSetting(ctx, tx); err != nil {
		return err
	}
	if err := vacuumMemoOrganizer(ctx, tx); err != nil {
		return err
	}
	if err := vacuumMemoRelations(ctx, tx); err != nil {
		return err
	}
	if err := vacuumInbox(ctx, tx); err != nil {
		return err
	}
	if err := vacuumTag(ctx, tx); err != nil {
		// Prevent revive warning.
		return err
	}

	return nil
}

func (d *DB) GetCurrentDBSize(context.Context) (int64, error) {
	fi, err := os.Stat(d.profile.DSN)
	if err != nil {
		return 0, status.Errorf(codes.Internal, "failed to get file info: %v", err)
	}

	return fi.Size(), nil
}

func (d *DB) Close() error {
	return d.db.Close()
}
