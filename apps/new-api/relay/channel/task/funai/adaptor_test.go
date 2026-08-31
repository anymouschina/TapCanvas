package funai

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
)

func TestParseTaskResultCompleted(t *testing.T) {
	adaptor := &TaskAdaptor{}
	info, err := adaptor.ParseTaskResult([]byte(`{
		"id":"task_123","status":"completed","model":"seedance-2.0",
		"progress":100,"content_url":"https://api.funai.works/v1/videos/task_123/content"
	}`))
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if info.Status != model.TaskStatusSuccess || info.Progress != "100%" || info.Url == "" {
		t.Fatalf("unexpected task info: %+v", info)
	}
}

func TestParseTaskResultProcessing(t *testing.T) {
	adaptor := &TaskAdaptor{}
	info, err := adaptor.ParseTaskResult([]byte(`{"id":"task_123","status":"processing","progress":47}`))
	if err != nil {
		t.Fatalf("ParseTaskResult: %v", err)
	}
	if info.Status != model.TaskStatusInProgress || info.Progress != "47%" {
		t.Fatalf("unexpected task info: %+v", info)
	}
}

func TestParseTaskResultCompletedRequiresURL(t *testing.T) {
	adaptor := &TaskAdaptor{}
	if _, err := adaptor.ParseTaskResult([]byte(`{"id":"task_123","status":"completed","progress":100}`)); err == nil {
		t.Fatal("expected missing URL error")
	}
}

func TestParseTaskResultRejectsUnknownStatus(t *testing.T) {
	adaptor := &TaskAdaptor{}
	if _, err := adaptor.ParseTaskResult([]byte(`{"id":"task_123","status":"mystery"}`)); err == nil {
		t.Fatal("expected unknown status error")
	}
}
