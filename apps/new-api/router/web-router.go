package router

import (
	"embed"
	"fmt"
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

func SetWebRouter(router *gin.Engine, buildFS embed.FS, indexPage []byte, webDistDir string) error {
	router.Use(gzip.Gzip(gzip.DefaultCompression))
	router.Use(middleware.GlobalWebRateLimit())
	router.Use(middleware.Cache())

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
