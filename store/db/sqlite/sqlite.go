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

	"github.com/usememos/memos/internal/log"
	"github.com/usememos/memos/server/profile"
	"github.com/usememos/memos/store"
)

// maxOpenConns caps the connection pool. Without this, SetMaxOpenConns(0) means
// unlimited concurrent connections; each streaming resource request holds one for
// the duration of the blob read, which lets a burst of image requests occupy every
// connection and starve all other queries (no request ever completes).
const maxOpenConns = 4

// poolMonitorInterval is how often the background pool monitor samples db.Stats().
const poolMonitorInterval = 30 * time.Second

type DB struct {
	db      *sql.DB
	profile *profile.Profile
	// cancel stops the background pool monitor started by NewDB.
	cancel context.CancelFunc
}

// reclaimIncrementalSpace reclaims pages freed by previous runs.
//
// Enabling incremental auto-vacuum is handled through the DSN in NewDB, because a
// runtime PRAGMA is silently ignored once the journal mode has been established.
func reclaimIncrementalSpace(db *sql.DB) {
	if _, err := db.Exec("PRAGMA incremental_vacuum"); err != nil {
		log.Warn("failed to run incremental_vacuum", zap.Error(err))
	}
}

// logDatabaseConfig records the on-disk layout of the database. A large database
// stuck in `delete` journal mode, or one whose free page count keeps growing, is
// the signature of the space-reclamation problems this patch addresses.
func logDatabaseConfig(db *sql.DB, dsn string) {
	var (
		journalMode string
		autoVacuum  int64
		pageSize    int64
		pageCount   int64
		freelist    int64
	)
	queries := []struct {
		name   string
		pragma string
		dest   interface{}
	}{
		{"journal_mode", "PRAGMA journal_mode", &journalMode},
		{"auto_vacuum", "PRAGMA auto_vacuum", &autoVacuum},
		{"page_size", "PRAGMA page_size", &pageSize},
		{"page_count", "PRAGMA page_count", &pageCount},
		{"freelist_count", "PRAGMA freelist_count", &freelist},
	}
	for _, q := range queries {
		if err := db.QueryRow(q.pragma).Scan(q.dest); err != nil {
			log.Warn("failed to read database pragma",
				zap.String("pragma", q.name), zap.Error(err))
		}
	}

	// auto_vacuum: 0 = none, 1 = full, 2 = incremental.
	autoVacuumMode := "none"
	switch autoVacuum {
	case 1:
		autoVacuumMode = "full"
	case 2:
		autoVacuumMode = "incremental"
	}
	fields := []zap.Field{
		zap.String("dsn", dsn),
		zap.String("journal_mode", journalMode),
		zap.String("auto_vacuum", autoVacuumMode),
		zap.Int64("page_size", pageSize),
		zap.Int64("page_count", pageCount),
		zap.Int64("freelist_count", freelist),
		zap.Int64("max_open_conns", maxOpenConns),
	}
	if pageSize > 0 {
		fields = append(fields,
			zap.Int64("db_size_bytes", pageSize*pageCount),
			zap.Int64("free_bytes", pageSize*freelist),
		)
	}
	log.Info("sqlite database configured", fields...)

	// auto_vacuum can only be switched by a full VACUUM, so an existing database
	// keeps reporting "none" until it is rebuilt offline. Warn explicitly, since a
	// silent "none" means freed space is never returned to the filesystem.
	if autoVacuum != 2 {
		log.Warn("sqlite auto_vacuum is not incremental; freed space will not be "+
			"reclaimed automatically. Run an offline 'VACUUM' once to rebuild the "+
			"database in incremental mode",
			zap.Int64("auto_vacuum", autoVacuum), zap.String("dsn", dsn))
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
	// - Incremental auto-vacuum: deleting rows gradually returns space to the
	// filesystem, so no blocking, full-database VACUUM is ever needed at runtime.
	//
	// auto_vacuum MUST come before journal_mode in this DSN. SQLite can only change
	// auto_vacuum while no journal has been written yet, so a runtime
	// `PRAGMA auto_vacuum=INCREMENTAL` issued after the WAL transition is silently
	// ignored and the setting stays "none".
	//
	// Note that auto_vacuum still only takes effect on a database that has never been
	// written in another mode. An existing database must be rebuilt once with an
	// offline `VACUUM`; logDatabaseConfig warns when that has not happened yet.
	//
	// Notes:
	// - When using the `modernc.org/sqlite` driver, each pragma must be prefixed with `_pragma=`.
	//
	// References:
	// - https://pkg.go.dev/modernc.org/sqlite#Driver.Open
	// - https://www.sqlite.org/sharedcache.html
	// - https://www.sqlite.org/pragma.html
	sqliteDB, err := sql.Open("sqlite", profile.DSN+
		"?_pragma=foreign_keys(0)"+
		"&_pragma=busy_timeout(30000)"+
		"&_pragma=auto_vacuum(INCREMENTAL)"+
		"&_pragma=journal_mode(WAL)"+
		"&_pragma=synchronous(NORMAL)"+
		"&_pragma=cache_size(-65536)")
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open db with dsn: %s", profile.DSN)
	}

	// Cap the connection pool: see maxOpenConns.
	sqliteDB.SetMaxOpenConns(maxOpenConns)
	sqliteDB.SetMaxIdleConns(maxOpenConns)
	sqliteDB.SetConnMaxLifetime(time.Hour)

	driver := DB{db: sqliteDB, profile: profile}

	reclaimIncrementalSpace(sqliteDB)
	logDatabaseConfig(sqliteDB, profile.DSN)

	// Sample pool statistics for the lifetime of the process.
	monitorCtx, cancel := context.WithCancel(context.Background())
	driver.cancel = cancel
	driver.startPoolMonitor(monitorCtx)

	return &driver, nil
}

// startPoolMonitor periodically samples connection pool statistics in the
// background. A pool that is permanently saturated (WaitCount climbing while
// OpenConnections sits at the cap) is the signature of the connection-starvation
// deadlock this patch guards against, and is otherwise invisible from the
// request logs alone.
func (d *DB) startPoolMonitor(ctx context.Context) {
	ticker := time.NewTicker(poolMonitorInterval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				stats := d.db.Stats()
				fields := []zap.Field{
					zap.Int("open_connections", stats.OpenConnections),
					zap.Int("in_use", stats.InUse),
					zap.Int("idle", stats.Idle),
					zap.Int64("wait_count", stats.WaitCount),
					zap.Duration("wait_duration", stats.WaitDuration),
				}
				// Warn only when there is real contention, to avoid log noise.
				if stats.InUse >= maxOpenConns {
					log.Warn("sqlite connection pool saturated",
						append(fields, zap.Int("max_open_conns", maxOpenConns))...)
				} else {
					log.Info("sqlite connection pool", fields...)
				}
			}
		}
	}()
}

func (d *DB) GetDB() *sql.DB {
	return d.db
}

func (d *DB) Vacuum(ctx context.Context) error {
	// Freed pages are returned to the filesystem by incremental auto-vacuum, which
	// is enabled in NewDB. Reclaiming space can be done offline instead:
	//   docker stop memos && sqlite3 memos_prod.db 'VACUUM;' && docker start memos
	//
	// Record the space usage around the delete so a regression (or a database that
	// was never rebuilt into incremental mode) is visible in the logs.
	before := d.logPageStats(ctx, "sqlite vacuum begin")
	start := time.Now()

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
	// A checkpoint of a multi-GB WAL can still block, so treat it as best-effort.
	if _, err := d.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		// Checkpointing is best-effort: never fail a delete because of it.
		log.Warn("failed to truncate WAL after vacuum", zap.Error(err))
	}

	log.Info("sqlite vacuum done",
		zap.Duration("elapsed", time.Since(start)),
		zap.Int64("free_bytes_delta", int64(d.logPageStats(ctx, "sqlite vacuum end")-before)))
	return nil
}

// logPageStats logs the current free-page statistics and returns the free byte
// count, so callers can report a before/after delta. A negative return value
// means the statistics could not be read.
func (d *DB) logPageStats(ctx context.Context, msg string) int64 {
	var pageSize, freelist int64
	if err := d.db.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		log.Warn("failed to read page_size", zap.Error(err))
		return -1
	}
	if err := d.db.QueryRowContext(ctx, "PRAGMA freelist_count").Scan(&freelist); err != nil {
		log.Warn("failed to read freelist_count", zap.Error(err))
		return -1
	}
	freeBytes := pageSize * freelist
	log.Info(msg,
		zap.Int64("page_size", pageSize),
		zap.Int64("freelist_count", freelist),
		zap.Int64("free_bytes", freeBytes))
	return freeBytes
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
	// Stop the background pool monitor before closing the pool.
	if d.cancel != nil {
		d.cancel()
	}
	return d.db.Close()
}
