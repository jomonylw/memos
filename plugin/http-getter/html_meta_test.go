package getter

import (
	"net"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetHTMLMeta(t *testing.T) {
	tests := []struct {
		urlStr   string
		htmlMeta HTMLMeta
	}{}
	for _, test := range tests {
		metadata, err := GetHTMLMeta(test.urlStr)
		require.NoError(t, err)
		require.Equal(t, test.htmlMeta, *metadata)
	}
}

func TestIsPrivateIP(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		{"127.0.0.1", true},
		{"127.255.255.255", true},
		{"10.0.0.1", true},
		{"172.16.0.1", true},
		{"172.31.255.255", true},
		{"192.168.1.1", true},
		{"169.254.1.1", true},
		{"100.64.0.1", true},
		{"::1", true},
		{"fc00::1", true},
		{"fe80::1", true},
		{"8.8.8.8", false},
		{"1.1.1.1", false},
		{"140.82.121.4", false},
	}

	for _, tc := range tests {
		ip := net.ParseIP(tc.ip)
		require.NotNil(t, ip)
		require.Equal(t, tc.expected, isPrivateIP(ip), "IP %s check failed", tc.ip)
	}
}

func TestExtractHTMLMeta(t *testing.T) {
	htmlContent := `
<!DOCTYPE html>
<html>
<head>
	<title>Original Title</title>
	<meta property="og:title" content="OpenGraph Title &amp; More" />
	<meta property="og:description" content="This is an awesome description &quot;quoted&quot;" />
	<meta property="og:image" content="/images/cover.png" />
	<meta property="og:site_name" content="My Demo Site" />
	<link rel="icon" href="/favicon.svg" />
</head>
<body>
	<h1>Hello world</h1>
</body>
</html>
`
	baseURL, err := url.Parse("https://example.com/blog/article-1")
	require.NoError(t, err)

	meta := extractHTMLMeta(strings.NewReader(htmlContent), baseURL)
	require.Equal(t, "OpenGraph Title & More", meta.Title)
	require.Equal(t, "This is an awesome description \"quoted\"", meta.Description)
	require.Equal(t, "https://example.com/images/cover.png", meta.Image)
	require.Equal(t, "https://example.com/favicon.svg", meta.Favicon)
	require.Equal(t, "My Demo Site", meta.SiteName)
	require.Equal(t, "website", meta.Type)
}

func TestExtractHTMLMetaGitHub(t *testing.T) {
	htmlContent := `
<!DOCTYPE html>
<html>
<head>
	<title>usememos/memos: An open source note-taking solution</title>
	<meta property="og:title" content="GitHub - usememos/memos" />
	<meta property="og:description" content="Privacy-first, lightweight note-taking solution" />
	<meta property="og:image" content="https://opengraph.githubassets.com/123/usememos/memos" />
</head>
<body>
</body>
</html>
`
	baseURL, err := url.Parse("https://github.com/usememos/memos")
	require.NoError(t, err)

	meta := extractHTMLMeta(strings.NewReader(htmlContent), baseURL)
	require.Equal(t, "GitHub - usememos/memos", meta.Title)
	require.Equal(t, "Privacy-first, lightweight note-taking solution", meta.Description)
	require.Equal(t, "github", meta.Type)
	require.Equal(t, "GitHub", meta.SiteName)
}

func TestMetaCache(t *testing.T) {
	testURL := "https://test-cache.example.com"
	sampleMeta := &HTMLMeta{
		URL:   testURL,
		Title: "Cached Title",
	}

	setCachedMeta(testURL, sampleMeta)
	cached, ok := getCachedMeta(testURL)
	require.True(t, ok)
	require.Equal(t, "Cached Title", cached.Title)
}

