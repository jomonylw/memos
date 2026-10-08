package getter

import (
	"html"
	"io"
	"net/url"
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var githubRepoRegex = regexp.MustCompile(`^/[^/]+/[^/]+/?$`)

func getAttr(token xhtml.Token, key string) string {
	for _, attr := range token.Attr {
		if strings.EqualFold(attr.Key, key) {
			return attr.Val
		}
	}
	return ""
}

func extractHTMLMeta(resp io.Reader, baseURL *url.URL) *HTMLMeta {
	tokenizer := xhtml.NewTokenizer(resp)
	meta := &HTMLMeta{
		URL:      baseURL.String(),
		SiteName: baseURL.Hostname(),
		Type:     "website",
	}

	if baseURL.Hostname() == "github.com" && githubRepoRegex.MatchString(baseURL.Path) {
		meta.Type = "github"
		meta.SiteName = "GitHub"
	}

	var rawTitle, ogTitle, twitterTitle string
	var rawDesc, ogDesc, twitterDesc string
	var ogImage, twitterImage string
	var favicon string
	var ogSiteName string

	for {
		tokenType := tokenizer.Next()
		if tokenType == xhtml.ErrorToken {
			break
		}
		if tokenType == xhtml.StartTagToken || tokenType == xhtml.SelfClosingTagToken {
			token := tokenizer.Token()
			if token.DataAtom == atom.Body {
				break
			}

			if token.DataAtom == atom.Title {
				tokenizer.Next()
				titleToken := tokenizer.Token()
				rawTitle = strings.TrimSpace(titleToken.Data)
			} else if token.DataAtom == atom.Meta {
				name := strings.ToLower(getAttr(token, "name"))
				prop := strings.ToLower(getAttr(token, "property"))
				content := strings.TrimSpace(getAttr(token, "content"))

				if content != "" {
					if prop == "og:title" || name == "og:title" {
						ogTitle = content
					} else if prop == "og:description" || name == "og:description" {
						ogDesc = content
					} else if prop == "og:image" || name == "og:image" {
						ogImage = content
					} else if prop == "og:site_name" || name == "og:site_name" {
						ogSiteName = content
					} else if name == "twitter:title" {
						twitterTitle = content
					} else if name == "twitter:description" {
						twitterDesc = content
					} else if name == "twitter:image" || name == "twitter:image:src" {
						twitterImage = content
					} else if name == "description" {
						rawDesc = content
					}
				}
			} else if token.DataAtom == atom.Link {
				rel := strings.ToLower(getAttr(token, "rel"))
				href := strings.TrimSpace(getAttr(token, "href"))
				if href != "" && favicon == "" {
					if strings.Contains(rel, "icon") {
						favicon = href
					}
				}
			}
		}
	}

	if ogTitle != "" {
		meta.Title = html.UnescapeString(ogTitle)
	} else if twitterTitle != "" {
		meta.Title = html.UnescapeString(twitterTitle)
	} else if rawTitle != "" {
		meta.Title = html.UnescapeString(rawTitle)
	} else {
		meta.Title = baseURL.Hostname()
	}

	if ogDesc != "" {
		meta.Description = html.UnescapeString(ogDesc)
	} else if twitterDesc != "" {
		meta.Description = html.UnescapeString(twitterDesc)
	} else if rawDesc != "" {
		meta.Description = html.UnescapeString(rawDesc)
	}

	if ogImage != "" {
		meta.Image = resolveURL(baseURL, ogImage)
	} else if twitterImage != "" {
		meta.Image = resolveURL(baseURL, twitterImage)
	}

	if favicon != "" {
		meta.Favicon = resolveURL(baseURL, favicon)
	} else {
		meta.Favicon = baseURL.Scheme + "://" + baseURL.Host + "/favicon.ico"
	}

	if ogSiteName != "" {
		meta.SiteName = html.UnescapeString(ogSiteName)
	}

	return meta
}
