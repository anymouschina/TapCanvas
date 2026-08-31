package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetSpecialProxyRouter registers transparent pass-through routes for upstream
// APIs whose shapes have no OpenAI-compatible relay equivalent.
//
// Route layout:
//   /v1/music_generation → minimax-music channel  (MiniMax music, fixed path)
//   /minimaxi/v1/*path   → kapon-speech channel   (MiniMax native speech:
//                          t2a_v2 / t2a_async_v2 / query / files; falls back
//                          to the minimax-official channel)
//   /proxy/remove-bg/*path → remove-bg channel    (remove.bg pixel-level cutout:
//                          X-Api-Key auth + multipart, binary PNG response;
//                          falls back to REMOVE_BG_API_KEY env)
func SetSpecialProxyRouter(router *gin.Engine) {
	musicGroup := router.Group("/v1")
	musicGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		musicGroup.POST("/music_generation", controller.ProxyMinimaxMusic)
	}

	speechGroup := router.Group("/minimaxi/v1")
	speechGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		speechGroup.Any("/*path", controller.ProxyMinimaxSpeech)
	}

	removeBgGroup := router.Group("/proxy/remove-bg")
	removeBgGroup.Use(middleware.RouteTag("relay"), middleware.TokenAuth())
	{
		removeBgGroup.Any("/*path", controller.ProxyRemoveBg)
	}
}
