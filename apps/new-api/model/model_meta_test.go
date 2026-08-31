package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func prepareModelMetaTestTable(t *testing.T) {
	t.Helper()
	if err := DB.AutoMigrate(&Model{}); err != nil {
		t.Fatalf("failed to migrate model table: %v", err)
	}
	t.Cleanup(func() {
		DB.Unscoped().Where("model_name IN ?", []string{
			"batch-status-a",
			"batch-status-b",
			"batch-status-c",
		}).Delete(&Model{})
	})
}

func TestBatchUpdateModelStatusUpdatesOnlyRequestedModels(t *testing.T) {
	prepareModelMetaTestTable(t)
	models := []Model{
		{ModelName: "batch-status-a", Status: 1},
		{ModelName: "batch-status-b", Status: 1},
		{ModelName: "batch-status-c", Status: 1},
	}
	if err := DB.Create(&models).Error; err != nil {
		t.Fatalf("failed to seed models: %v", err)
	}
	if err := DB.Model(&Model{}).Where("id IN ?", []int{models[0].Id, models[1].Id, models[2].Id}).Updates(map[string]interface{}{"status": 0, "updated_time": 0}).Error; err != nil {
		t.Fatalf("failed to initialize model statuses: %v", err)
	}

	updatedCount, err := BatchUpdateModelStatus([]int{models[0].Id, models[2].Id}, 1)
	if err != nil {
		t.Fatalf("batch update failed: %v", err)
	}
	if updatedCount != 2 {
		t.Fatalf("expected 2 updated models, got %d", updatedCount)
	}

	var stored []Model
	if err := DB.Where("id IN ?", []int{models[0].Id, models[1].Id, models[2].Id}).Order("id ASC").Find(&stored).Error; err != nil {
		t.Fatalf("failed to reload models: %v", err)
	}
	statuses := []int{stored[0].Status, stored[1].Status, stored[2].Status}
	expected := []int{1, 0, 1}
	for index := range expected {
		if statuses[index] != expected[index] {
			t.Fatalf("model %d: expected status %d, got %d", index, expected[index], statuses[index])
		}
	}
	if stored[0].UpdatedTime <= 0 || stored[2].UpdatedTime <= 0 {
		t.Fatal("expected updated models to receive updated_time")
	}
	if stored[1].UpdatedTime != 0 {
		t.Fatalf("expected untouched model updated_time to remain 0, got %d", stored[1].UpdatedTime)
	}
	if stored[0].UpdatedTime > common.GetTimestamp() {
		t.Fatalf("updated_time is unexpectedly in the future: %d", stored[0].UpdatedTime)
	}
}
