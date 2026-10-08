package getter

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

type Image struct {
	Blob      []byte
	Mediatype string
}

func GetImage(urlStr string) (*Image, error) {
	if _, err := url.Parse(urlStr); err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

	response, err := SafeHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	mediatype, err := getMediatype(response)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(mediatype, "image/") {
		return nil, errors.New("Wrong image mediatype")
	}

	limitedReader := io.LimitReader(response.Body, 10*1024*1024)
	bodyBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}

	bodyBytes, err = SanitizeContent(bodyBytes)
	if err != nil {
		return nil, err
	}

	image := &Image{
		Blob:      bodyBytes,
		Mediatype: mediatype,
	}
	return image, nil
}

func SanitizeContent(content []byte) ([]byte, error) {
	bodyString := string(content)

	bm := bluemonday.UGCPolicy()
	return []byte(bm.Sanitize(bodyString)), nil
}
