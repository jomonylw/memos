package frontend

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

// newDistFixture builds a temporary dist directory containing an index.html that
// references the given asset paths, creating each referenced asset on disk. It
// returns the absolute path of the directory.
//
// The root is passed to the static middleware as an absolute path so the test does
// not depend on the process working directory.
func newDistFixture(t *testing.T, indexHTML string, existingAssets ...string) string {
	t.Helper()

	dist := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dist, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte(indexHTML), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, asset := range existingAssets {
		if err := os.WriteFile(filepath.Join(dist, filepath.FromSlash(asset)), []byte("// asset\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dist
}

// newEcho builds an echo instance wired exactly like production: the cache-control
// middleware wrapping the HTML5 static middleware, with assets routed explicitly.
func newEcho(dist string) *echo.Echo {
	e := echo.New()
	e.GET("/assets/*", assetHandler(dist))
	e.Use(cacheControlMiddleware)
	e.Use(staticMiddleware(dist))
	return e
}

// TestCacheControlHeaders pins the cache policy that prevents a stale index.html
// from pinning assets of a previous build.
//
// index.html must never be cached, and content-hashed assets must be immutable.
// Without the HTML rule a browser keeps a cached index.html across an upgrade and
// requests asset URLs that no longer exist on the server.
func TestCacheControlHeaders(t *testing.T) {
	const indexHTML = `<!DOCTYPE html><html><head>` +
		`<link rel="stylesheet" href="/assets/index-abc.css">` +
		`</head><body><div id="root"></div>` +
		`<script type="module" src="/assets/index-abc.js"></script></body></html>`

	dist := newDistFixture(t, indexHTML, "/assets/index-abc.css", "/assets/index-abc.js")
	e := newEcho(dist)

	testCases := []struct {
		name   string
		path   string
		expect string
	}{
		{"index.html is never cached", "/", htmlCacheControl},
		{"hashed asset is immutable", "/assets/index-abc.js", assetCacheControl},
		{"hashed stylesheet is immutable", "/assets/index-abc.css", assetCacheControl},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status for %s = %d, want 200", tc.path, rec.Code)
			}
			if got := rec.Header().Get("Cache-Control"); got != tc.expect {
				t.Errorf("Cache-Control for %s = %q, want %q", tc.path, got, tc.expect)
			}
		})
	}
}

// TestClientSideRouteFallsBackToIndexHTML guards the HTML5 fallback that makes deep
// links such as /m/123 work, and confirms the fallback is marked uncacheable.
func TestClientSideRouteFallsBackToIndexHTML(t *testing.T) {
	dist := newDistFixture(t, `<!DOCTYPE html><html><body><div id="root"></div></body></html>`)
	e := newEcho(dist)

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/m/123", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `id="root"`) {
		t.Errorf("deep link should fall back to index.html, got %q", rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != htmlCacheControl {
		t.Errorf("Cache-Control = %q, want %q", got, htmlCacheControl)
	}
}

// TestMissingAssetIsNotServedAsHTML pins the invariant behind the blank page.
//
// The observed failure after upgrading the image was a browser rendering nothing at
// all while every request in the log reported HTTP 200. The cause was a cached
// index.html from the previous build: the browser requested an asset URL that the
// new build no longer contains, and the static middleware's HTML5 fallback answered
// with index.html. The browser then received HTML where it expected JavaScript and
// failed to render.
//
// The test asserts that a missing asset must never be answered with an HTML
// document, so this failure cannot recur silently.
func TestMissingAssetIsNotServedAsHTML(t *testing.T) {
	// index.html references only index-NEW.js; index-OLD.js models the asset URL that
	// a client holding a cached index.html still requests.
	const indexHTML = `<!DOCTYPE html><html><body><div id="root"></div>` +
		`<script type="module" src="/assets/index-NEW.js"></script></body></html>`

	dist := newDistFixture(t, indexHTML, "/assets/index-NEW.js")
	e := newEcho(dist)

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/assets/index-OLD.js", nil))

	contentType := rec.Header().Get(echo.HeaderContentType)
	body := rec.Body.String()

	if strings.Contains(contentType, "text/html") {
		t.Errorf("missing asset was served as HTML (status %d, content-type %q); "+
			"this is what makes a stale cached index.html render a blank page. body=%q",
			rec.Code, contentType, body)
	}
	if strings.Contains(body, "<!DOCTYPE html>") || strings.Contains(body, `id="root"`) {
		t.Errorf("missing asset returned the index.html document instead of an error; body=%q", body)
	}
	// The request must fail loudly so the browser surfaces the error instead of
	// silently rendering nothing.
	if rec.Code != http.StatusNotFound {
		t.Errorf("missing asset status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	// A failure must not be cached, or the browser keeps requesting the missing file.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("missing asset Cache-Control = %q, want no-store", got)
	}
}

// TestFindAssetRefsAndMissingAssets covers the startup diagnostic that makes a broken
// image build obvious in the log rather than only in the browser.
func TestFindAssetRefsAndMissingAssets(t *testing.T) {
	const indexHTML = `<!DOCTYPE html><html><head>` +
		`<link rel="stylesheet" crossorigin href="/assets/index-CSS.css">` +
		`</head><body><div id="root"></div>` +
		`<script type="module" crossorigin src="/assets/index-JS.js"></script>` +
		`</body></html>`

	dist := newDistFixture(t, indexHTML, "/assets/index-CSS.css", "/assets/index-JS.js")

	// The parser must find the references in a realistic index.html.
	refs := findAssetRefs(indexHTML)
	if len(refs) != 2 {
		t.Fatalf("findAssetRefs found %d refs (%v), want 2", len(refs), refs)
	}

	// Every referenced asset is present.
	if missing := findMissingAssets(dist, refs); len(missing) != 0 {
		t.Errorf("findMissingAssets = %v, want none", missing)
	}

	// Simulate a stale reference: the asset is absent from disk.
	if missing := findMissingAssets(dist, append(refs, "/assets/index-OLD.js")); len(missing) != 1 ||
		missing[0] != "/assets/index-OLD.js" {
		t.Errorf("findMissingAssets = %v, want [/assets/index-OLD.js]", missing)
	}
}
