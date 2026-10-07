package test

import (
	"fmt"
	"net"
	"os"
	"sync"
	"testing"

	"github.com/joho/godotenv"

	"github.com/usememos/memos/server/profile"
	"github.com/usememos/memos/server/version"
)

var testPortMu sync.Mutex

func getUnusedPort() int {
	testPortMu.Lock()
	defer testPortMu.Unlock()

	for {
		l1, err := net.Listen("tcp", "localhost:0")
		if err != nil {
			panic(err)
		}
		port := l1.Addr().(*net.TCPAddr).Port
		l2, err := net.Listen("tcp", fmt.Sprintf("localhost:%d", port+1))
		if err == nil {
			l1.Close()
			l2.Close()
			return port
		}
		l1.Close()
	}
}

func GetTestingProfile(t *testing.T) *profile.Profile {
	if err := godotenv.Load(".env"); err != nil {
		t.Log("failed to load .env file, but it's ok")
	}

	// Get a temporary directory for the test data.
	dir := t.TempDir()
	mode := "dev"
	port := getUnusedPort()
	driver := getDriverFromEnv()
	dsn := os.Getenv("DSN")
	if driver == "sqlite" {
		dsn = fmt.Sprintf("%s/memos_%s.db", dir, mode)
	}
	return &profile.Profile{
		Mode:    mode,
		Port:    port,
		Data:    dir,
		DSN:     dsn,
		Driver:  driver,
		Version: version.GetCurrentVersion(mode),
	}
}

func getDriverFromEnv() string {
	driver := os.Getenv("DRIVER")
	if driver == "" {
		driver = "sqlite"
	}
	return driver
}
