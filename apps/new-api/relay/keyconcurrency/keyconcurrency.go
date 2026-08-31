// Package keyconcurrency 提供「按渠道 key(每个 OAuth 账号)」的在飞并发计数与限流。
//
// 用于 Claude 订阅式 OAuth 多 key 渠道:每个 key 是一个独立的 Claude 订阅账号,各自有
// 一个可配置的在飞并发上限,防止多账号轮询时单个账号触发 Anthropic 的并发限制。
//
// 计数为进程内(单实例)原子式,重启清零——在飞请求本就随进程重启中断,无残留影响。
// 多实例部署需要跨实例计数时,应改用 Redis;当前部署为单实例,进程内计数精确且零依赖。
package keyconcurrency

import (
	"strconv"
	"sync"
)

var (
	mu       sync.Mutex
	inFlight = make(map[string]int)
)

func slotKey(channelID, keyIndex int) string {
	return strconv.Itoa(channelID) + ":" + strconv.Itoa(keyIndex)
}

// TryAcquire 尝试为指定渠道 key(账号)预留一个在飞槽位。
//
//   - limit <= 0 视为不限制:总是成功,返回的 release 为空操作。
//   - 成功(ok == true)时,调用方必须在上游请求结束(流式则流播完)后调用一次 release
//     归还槽位;release 是幂等的,多次调用只减一次。
//   - 失败(ok == false)表示该账号在飞数已达 limit,release 为 nil,调用方应换号或拒绝。
func TryAcquire(channelID, keyIndex, limit int) (release func(), ok bool) {
	if limit <= 0 {
		return func() {}, true
	}
	key := slotKey(channelID, keyIndex)

	mu.Lock()
	if inFlight[key] >= limit {
		mu.Unlock()
		return nil, false
	}
	inFlight[key]++
	mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			mu.Lock()
			if inFlight[key] > 0 {
				inFlight[key]--
			}
			if inFlight[key] <= 0 {
				delete(inFlight, key)
			}
			mu.Unlock()
		})
	}, true
}

// InFlight 返回指定渠道 key 当前在飞请求数,供监控与测试使用。
func InFlight(channelID, keyIndex int) int {
	mu.Lock()
	defer mu.Unlock()
	return inFlight[slotKey(channelID, keyIndex)]
}
