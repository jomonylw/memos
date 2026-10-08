package v1

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/labstack/echo/v4"

	getter "github.com/usememos/memos/plugin/http-getter"
)

func (*APIV1Service) registerGetterPublicRoutes(g *echo.Group) {
	// GET /get/image?url={url} - Get image.
	g.GET("/get/image", GetImage)
	// GET /get/html-meta?url={url} - Get html meta.
	g.GET("/get/html-meta", GetHTMLMeta)
}

func (*APIV1Service) registerGetterRoutes(g *echo.Group) {
	// GET /api/v1/get/html-meta?url={url} - Get html meta.
	g.GET("/get/html-meta", GetHTMLMeta)
}

// GetImage godoc
//
//	@Summary	Get GetImage from URL
//	@Tags		image-url
//	@Produce	GetImage/*
//	@Param		url	query		string	true	"Image url"
//	@Success	200	{object}	nil		"Image"
//	@Failure	400	{object}	nil		"Missing GetImage url | Wrong url | Failed to get GetImage url: %s"
//	@Failure	500	{object}	nil		"Failed to write GetImage blob"
//	@Router		/o/get/GetImage [GET]
func GetImage(c echo.Context) error {
	urlStr := c.QueryParam("url")
	if urlStr == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Missing image url")
	}
	if _, err := url.Parse(urlStr); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Wrong url").SetInternal(err)
	}

	image, err := getter.GetImage(urlStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("Failed to get image url: %s", urlStr)).SetInternal(err)
	}

	c.Response().Writer.WriteHeader(http.StatusOK)
	c.Response().Writer.Header().Set("Content-Type", image.Mediatype)
	c.Response().Writer.Header().Set(echo.HeaderCacheControl, "max-age=31536000, immutable")
	if _, err := c.Response().Writer.Write(image.Blob); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Failed to write image blob").SetInternal(err)
	}
	return nil
}

// GetHTMLMeta godoc
//
//	@Summary	Get HTML Meta from URL
//	@Tags		meta-url
//	@Produce	json
//	@Param		url	query		string	true	"Target website url"
//	@Success	200	{object}	getter.HTMLMeta	"HTMLMeta"
//	@Failure	400	{object}	nil		"Missing url | Wrong url | Failed to get html meta"
//	@Router		/api/v1/get/html-meta [GET]
func GetHTMLMeta(c echo.Context) error {
	urlStr := c.QueryParam("url")
	if urlStr == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "Missing url parameter")
	}
	if _, err := url.Parse(urlStr); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid url").SetInternal(err)
	}

	htmlMeta, err := getter.GetHTMLMeta(urlStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("Failed to get html meta for: %s", urlStr)).SetInternal(err)
	}

	c.Response().Header().Set(echo.HeaderCacheControl, "public, max-age=86400")
	return c.JSON(http.StatusOK, htmlMeta)
}
