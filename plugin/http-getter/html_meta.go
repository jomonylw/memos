package getter

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type HTMLMeta struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Favicon     string `json:"favicon"`
	SiteName    string `json:"siteName"`
	Type        string `json:"type"`
}

func resolveURL(baseURL *url.URL, target string) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return target
	}
	return baseURL.ResolveReference(parsed).String()
}

func GetHTMLMeta(urlStr string) (*HTMLMeta, error) {
	parsedURL, err := url.Parse(urlStr)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return nil, errors.New("invalid url scheme, only http and https are allowed")
	}

	if cached, ok := getCachedMeta(urlStr); ok {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")

	response, err := SafeHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return nil, errors.New("website returned non-200 status code")
	}

	mediatype, err := getMediatype(response)
	if err != nil || (!strings.HasPrefix(mediatype, "text/html") && !strings.HasPrefix(mediatype, "application/xhtml+xml")) {
		return nil, errors.New("website mediatype is not html")
	}

	finalURL := response.Request.URL
	if finalURL == nil {
		finalURL = parsedURL
	}

	limitedReader := io.LimitReader(response.Body, 512*1024)
	htmlMeta := extractHTMLMeta(limitedReader, finalURL)

	setCachedMeta(urlStr, htmlMeta)
	return htmlMeta, nil
}
