package controller

import (
	"errors"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func TestShouldSwitchAccountWithinForcedChannel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	ctx.Set("specific_channel_id", 279)
	err := types.NewErrorWithStatusCode(
		errors.New("upstream account is unavailable"),
		types.ErrorCodeBadResponse,
		http.StatusPaymentRequired,
	)

	if !shouldSwitchAccount(ctx, err) {
		t.Fatal("a forced channel must still rotate to an untried sibling account")
	}
}

func TestShouldRetryNeverLeavesForcedChannel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	ctx.Set("specific_channel_id", "401")
	err := types.NewErrorWithStatusCode(
		errors.New("forced upstream channel rejected its key"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusUnauthorized,
	)

	if shouldRetry(ctx, err, 3) {
		t.Fatal("a forced channel must not retry through another channel")
	}
}

func TestShouldRetryChannelErrorWithoutForcedChannel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	err := types.NewErrorWithStatusCode(
		errors.New("upstream channel rejected its key"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusUnauthorized,
	)

	if !shouldRetry(ctx, err, 3) {
		t.Fatal("an ordinary channel error should remain eligible for cross-channel retry")
	}
}
