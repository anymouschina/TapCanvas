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
	logCleanupInterval           = 1 * time.Hour
	logAndTaskRetention          = 3 * 24 * time.Hour
	logCleanupBatchSize          = 500
	requestTraceCleanupBatchSize = 500
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
			logger.LogInfo(context.Background(), fmt.Sprintf(
				"log cleanup task started: log-and-task-retention=%s, request-trace-retention=%s, request-trace-batch=%d, tick=%s",
				logAndTaskRetention,
				model.RequestTraceRetention,
				requestTraceCleanupBatchSize,
				logCleanupInterval,
			))
			ticker := time.NewTicker(logCleanupInterval)
			defer ticker.Stop()

			runLogCleanupOnce()
			for range ticker.C {
				runLogCleanupOnce()
			}
		})
	})
}

func resolveCleanupCutoffs(now time.Time) (logAndTaskCutoff int64, requestTraceCutoff int64) {
	return now.Add(-logAndTaskRetention).Unix(), model.RequestTraceCutoff(now)
}

func runLogCleanupOnce() {
	if !logCleanupRunning.CompareAndSwap(false, true) {
		return
	}
	defer logCleanupRunning.Store(false)

	ctx := context.Background()
	logAndTaskCutoff, requestTraceCutoff := resolveCleanupCutoffs(time.Now())

	deletedLogs, err := model.DeleteOldLog(ctx, logAndTaskCutoff, logCleanupBatchSize)
	if err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, fmt.Sprintf("log cleanup failed: %v", err))
	}

	deletedTasks, err := model.DeleteOldTasks(ctx, logAndTaskCutoff, logCleanupBatchSize)
	if err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, fmt.Sprintf("task cleanup failed: %v", err))
	}

	deletedRequestTraces, err := model.DeleteExpiredRequestTraceBatch(ctx, requestTraceCutoff, requestTraceCleanupBatchSize)
	if err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, fmt.Sprintf(
			"request trace cleanup failed: cutoff=%d, batch=%d, error=%v",
			requestTraceCutoff,
			requestTraceCleanupBatchSize,
			err,
		))
	}

	if deletedLogs > 0 || deletedTasks > 0 || deletedRequestTraces > 0 {
		logger.LogInfo(ctx, fmt.Sprintf(
			"log cleanup: deleted run-logs=%d, tasks=%d, request-traces=%d (log/task retention=%s; request trace retention=%s; financial logs retained)",
			deletedLogs,
			deletedTasks,
			deletedRequestTraces,
			logAndTaskRetention,
			model.RequestTraceRetention,
		))
	}

	// PostgreSQL 删行后死元组不会立即释放，需要 VACUUM ANALYZE 才能让页面重新可用。
	// MySQL/SQLite 由引擎自动处理，不需要显式触发。
	if common.UsingPostgreSQL && (deletedLogs > 0 || deletedTasks > 0) {
		model.VacuumLogTables(ctx)
	}
}
