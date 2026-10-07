package versionchecker

import (
	"testing"
)

func TestGetLatestVersion(t *testing.T) {
	_, err := NewVersionChecker(nil, nil).GetLatestVersion()
	if err != nil {
		t.Skipf("skipping remote version check test: %v", err)
	}
}
