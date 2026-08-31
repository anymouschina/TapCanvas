package model

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDeleteExpiredRequestTraceBatchHonorsCutoffAndLimit(t *testing.T) {
	prepareRequestTraceTable(t)

	const cutoff int64 = 1_700_000_000
	traces := []RequestTrace{
		{RequestId: "oldest", CreatedAt: cutoff - 30, UpdatedAt: cutoff - 30},
		{RequestId: "older", CreatedAt: cutoff - 20, UpdatedAt: cutoff - 20},
		{RequestId: "old", CreatedAt: cutoff - 10, UpdatedAt: cutoff - 10},
		{RequestId: "boundary", CreatedAt: cutoff, UpdatedAt: cutoff},
		{RequestId: "fresh", CreatedAt: cutoff + 10, UpdatedAt: cutoff + 10},
	}
	require.NoError(t, LOG_DB.Create(&traces).Error)

	deleted, err := DeleteExpiredRequestTraceBatch(context.Background(), cutoff, 2)
	require.NoError(t, err)
	require.Equal(t, int64(2), deleted)
	require.Equal(t, []string{"old", "boundary", "fresh"}, remainingRequestTraceIDs(t))

	deleted, err = DeleteExpiredRequestTraceBatch(context.Background(), cutoff, 2)
	require.NoError(t, err)
	require.Equal(t, int64(1), deleted)
	require.Equal(t, []string{"boundary", "fresh"}, remainingRequestTraceIDs(t))

	deleted, err = DeleteExpiredRequestTraceBatch(context.Background(), cutoff, 2)
	require.NoError(t, err)
	require.Zero(t, deleted)
}

func TestRequestTraceReadsExpireAfterOneDay(t *testing.T) {
	prepareRequestTraceTable(t)

	now := time.Now()
	traces := []RequestTrace{
		{
			RequestId:    "expired",
			UserId:       42,
			CreatedAt:    now.Add(-RequestTraceRetention - time.Second).Unix(),
			UpdatedAt:    now.Add(-RequestTraceRetention - time.Second).Unix(),
			AttemptsJSON: "[]",
		},
		{
			RequestId:    "active",
			UserId:       42,
			CreatedAt:    now.Add(-RequestTraceRetention + time.Minute).Unix(),
			UpdatedAt:    now.Add(-RequestTraceRetention + time.Minute).Unix(),
			AttemptsJSON: "[]",
		},
	}
	require.NoError(t, LOG_DB.Create(&traces).Error)

	_, err := GetRequestTraceByRequestID("expired")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	_, err = GetUserRequestTraceByRequestID(42, "expired")
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)

	active, err := GetRequestTraceByRequestID("active")
	require.NoError(t, err)
	require.Equal(t, "active", active.RequestId)
	active, err = GetUserRequestTraceByRequestID(42, "active")
	require.NoError(t, err)
	require.Equal(t, "active", active.RequestId)
}

func TestDeleteExpiredRequestTraceBatchRejectsInvalidLimit(t *testing.T) {
	deleted, err := DeleteExpiredRequestTraceBatch(context.Background(), 1_700_000_000, 0)
	require.ErrorContains(t, err, "batch size must be positive")
	require.Zero(t, deleted)
}

func TestDeleteExpiredRequestTraceBatchHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	deleted, err := DeleteExpiredRequestTraceBatch(ctx, 1_700_000_000, 500)
	require.ErrorIs(t, err, context.Canceled)
	require.Zero(t, deleted)
}

func prepareRequestTraceTable(t *testing.T) {
	t.Helper()
	require.NoError(t, LOG_DB.AutoMigrate(&RequestTrace{}))
	require.NoError(t, LOG_DB.Exec("DELETE FROM request_traces").Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Exec("DELETE FROM request_traces").Error)
	})
}

func remainingRequestTraceIDs(t *testing.T) []string {
	t.Helper()
	var traces []RequestTrace
	require.NoError(t, LOG_DB.Order("created_at ASC").Order("id ASC").Find(&traces).Error)
	requestIDs := make([]string, 0, len(traces))
	for _, trace := range traces {
		requestIDs = append(requestIDs, trace.RequestId)
	}
	return requestIDs
}
