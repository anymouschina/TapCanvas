package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	logCleanupInterval  = 1 * time.Hour
	logRetentionSeconds = 3 * 24 * 3600 // 3 天
	logCleanupBatchSize = 500
)

var (
	logCleanupOnce    sync.Once
	logCleanupRunning atomic.Bool
)

func StartLogCleanupTask() {
	logCleanupOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("log cleanup task started: retention=3d, tick=%s", logCleanupInterval))
			ticker := time.NewTicker(logCleanupInterval)
			defer ticker.Stop()

			runLogCleanupOnce()
			for range ticker.C {
				runLogCleanupOnce()
			}
		})
	})
}

func runLogCleanupOnce() {
	if !logCleanupRunning.CompareAndSwap(false, true) {
		return
	}
	defer logCleanupRunning.Store(false)

	ctx := context.Background()
	cutoff := time.Now().Unix() - logRetentionSeconds

	deletedLogs, err := model.DeleteOldLog(ctx, cutoff, logCleanupBatchSize)
	if err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, fmt.Sprintf("log cleanup failed: %v", err))
	}

	deletedTasks, err := model.DeleteOldTasks(ctx, cutoff, logCleanupBatchSize)
	if err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, fmt.Sprintf("task cleanup failed: %v", err))
	}

	if deletedLogs > 0 || deletedTasks > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("log cleanup: deleted run-logs=%d, tasks=%d (older than 3 days; financial logs retained)", deletedLogs, deletedTasks))
	}

	// PostgreSQL 删行后死元组不会立即释放，需要 VACUUM ANALYZE 才能让页面重新可用。
	// MySQL/SQLite 由引擎自动处理，不需要显式触发。
	if common.UsingPostgreSQL && (deletedLogs > 0 || deletedTasks > 0) {
		model.VacuumLogTables(ctx)
	}
}
