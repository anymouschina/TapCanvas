package logger

import (
	"context"
	"io"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func TestConcurrentRequestAndUsageRefreshLogging(t *testing.T) {
	common.LogWriterMu.Lock()
	oldOutput, oldError := gin.DefaultWriter, gin.DefaultErrorWriter
	gin.DefaultWriter, gin.DefaultErrorWriter = io.Discard, io.Discard
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter, gin.DefaultErrorWriter = oldOutput, oldError
		common.LogWriterMu.Unlock()
	})
	before := logCount.Load()
	const workers = 32
	var group sync.WaitGroup
	for index := 0; index < workers; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			LogInfo(context.Background(), "fixture request completed")
			LogWarn(context.Background(), "fixture usage refresh failed")
		}()
	}
	group.Wait()
	if got := logCount.Load() - before; got != workers*2 {
		t.Fatalf("logged %d messages, want %d", got, workers*2)
	}
}
