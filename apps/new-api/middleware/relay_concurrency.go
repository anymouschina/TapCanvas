package middleware

import (
	"net/http"
	"sync/atomic"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
)

var (
	relaySem     chan struct{}
	relayInFlight int64 // 当前在飞请求数（原子计数器，用于监控）
)

// InitRelayConcurrencyLimiter 在 main 启动时调用一次，建立信号量。
// max <= 0 时不限制（不创建信号量）。
func InitRelayConcurrencyLimiter(max int) {
	if max <= 0 {
		return
	}
	relaySem = make(chan struct{}, max)
}

// RelayConcurrencyLimit 限制 relay 接口的全局并发数。
// 当槽位耗尽时立即返回 429，不做等待，避免请求堆积放大内存压力。
func RelayConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if relaySem == nil {
			c.Next()
			return
		}
		select {
		case relaySem <- struct{}{}:
			atomic.AddInt64(&relayInFlight, 1)
			defer func() {
				<-relaySem
				atomic.AddInt64(&relayInFlight, -1)
			}()
			c.Next()
		default:
			// 槽位已满，立即拒绝
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": gin.H{
					"message": "Server is overloaded, please retry after a moment",
					"type":    "server_overload",
					"code":    "server_overload",
				},
			})
			c.Abort()
		}
	}
}

// GetRelayInFlight 返回当前 relay 在飞请求数，供监控使用。
func GetRelayInFlight() int64 {
	return atomic.LoadInt64(&relayInFlight)
}

// GetRelayCapacity 返回 relay 并发容量，0 表示无限制。
func GetRelayCapacity() int {
	if relaySem == nil {
		return 0
	}
	return cap(relaySem)
}

// initRelayConcurrencyFromEnv 由 main 调用，从环境变量读取配置并初始化。
func initRelayConcurrencyFromEnv() {
	InitRelayConcurrencyLimiter(constant.MaxRelayConcurrency)
}
