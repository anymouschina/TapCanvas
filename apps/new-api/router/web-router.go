package router

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

func readOpenAPIDocument(documentFS fs.FS, document string) ([]byte, error) {
	switch document {
	case "relay.json", "api.json":
		return fs.ReadFile(documentFS, "docs/openapi/"+document)
	default:
		return nil, fs.ErrNotExist
	}
}

func SetWebRouter(router *gin.Engine, buildFS embed.FS, indexPage []byte, webDistDir string) error {
	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())

	// Serve the OpenAPI documents from their authoritative source. The web build
	// may contain historical public/ copies, so this route must be registered
	// before the static middleware to prevent documentation drift at runtime.
	router.GET("/openapi/:document", func(c *gin.Context) {
		document, err := readOpenAPIDocument(buildFS, c.Param("document"))
		if err != nil {
			controller.RelayNotFound(c)
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "application/json; charset=utf-8", document)
	})

	if webDistDir == "" {
		router.Use(static.Serve("/", common.EmbedFolder(buildFS, "web/dist")))
	} else {
		indexPath := filepath.Join(webDistDir, "index.html")
		indexInfo, err := os.Stat(indexPath)
		if err != nil {
			return fmt.Errorf("WEB_DIST_DIR index not accessible at %s: %w", indexPath, err)
		}
		if indexInfo.IsDir() {
			return fmt.Errorf("WEB_DIST_DIR index path is a directory: %s", indexPath)
		}
		router.Use(static.Serve("/", static.LocalFile(webDistDir, false)))
	}

	router.NoRoute(func(c *gin.Context) {
		c.Set(middleware.RouteTagKey, "web")
		if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
			controller.RelayNotFound(c)
			return
		}
		c.Header("Cache-Control", "no-cache")
		if webDistDir != "" {
			c.File(filepath.Join(webDistDir, "index.html"))
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexPage)
	})
	return nil
}
