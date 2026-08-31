package model

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// RequestTraceRetention is both the read-validity window and physical cleanup
// threshold for all AI request traces.
const RequestTraceRetention = 24 * time.Hour

func RequestTraceCutoff(now time.Time) int64 {
	return now.Add(-RequestTraceRetention).Unix()
}

func GetRequestTraceByRequestID(requestId string) (*RequestTrace, error) {
	var trace RequestTrace
	err := LOG_DB.
		Where("request_id = ? AND created_at >= ?", requestId, RequestTraceCutoff(time.Now())).
		First(&trace).Error
	if err != nil {
		return nil, err
	}
	if err := trace.hydrateAttempts(); err != nil {
		return nil, err
	}
	return &trace, nil
}

func GetUserRequestTraceByRequestID(userId int, requestId string) (*RequestTrace, error) {
	var trace RequestTrace
	err := LOG_DB.
		Where("request_id = ? AND user_id = ? AND created_at >= ?", requestId, userId, RequestTraceCutoff(time.Now())).
		First(&trace).Error
	if err != nil {
		return nil, err
	}
	if err := trace.hydrateAttempts(); err != nil {
		return nil, err
	}
	return &trace, nil
}

// DeleteExpiredRequestTraceBatch removes at most limit traces older than the
// supplied cutoff. The bounded batch is intentional: trace rows can own large
// TOAST/TEXT payloads, so an unbounded backlog purge can create excessive WAL
// and disk pressure.
func DeleteExpiredRequestTraceBatch(ctx context.Context, cutoffTimestamp int64, limit int) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if limit <= 0 {
		return 0, fmt.Errorf("request trace cleanup batch size must be positive: %d", limit)
	}

	var deleted int64
	err := LOG_DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		ids := make([]int, 0, limit)
		if err := tx.Model(&RequestTrace{}).
			Where("created_at < ?", cutoffTimestamp).
			Order("created_at ASC").
			Order("id ASC").
			Limit(limit).
			Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}

		result := tx.Where("id IN ?", ids).Delete(&RequestTrace{})
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}
