package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type modelMetaAPIResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func runBatchModelStatusRequest(t *testing.T, body map[string]interface{}) modelMetaAPIResponse {
	t.Helper()

	payload, err := common.Marshal(body)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPatch, "/api/models/status", bytes.NewReader(payload))
	ctx.Request.Header.Set("Content-Type", "application/json")
	BatchUpdateModelStatus(ctx)

	var response modelMetaAPIResponse
	if err := common.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response %q: %v", recorder.Body.String(), err)
	}
	return response
}

func TestBatchUpdateModelStatusRejectsInvalidStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := runBatchModelStatusRequest(t, map[string]interface{}{
		"ids":    []int{1},
		"status": 2,
	})
	if response.Success {
		t.Fatal("expected invalid status to fail")
	}
	if response.Message != "模型状态只能是 0 或 1" {
		t.Fatalf("unexpected error message: %q", response.Message)
	}
}

func TestBatchUpdateModelStatusRejectsNonPositiveID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := runBatchModelStatusRequest(t, map[string]interface{}{
		"ids":    []int{0},
		"status": 1,
	})
	if response.Success {
		t.Fatal("expected non-positive ID to fail")
	}
	if response.Message != "模型 ID 必须是正整数" {
		t.Fatalf("unexpected error message: %q", response.Message)
	}
}
