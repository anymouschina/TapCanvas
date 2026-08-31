package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

func TestProjectSupportedEndpointsUsesOnlyEndpointsReferencedByVisiblePricing(t *testing.T) {
	pricing := []model.Pricing{
		{
			ModelName:              "visible-model",
			SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
		},
	}
	catalog := map[string]common.EndpointInfo{
		"openai":          {Path: " /v1/chat/completions ", Method: " post "},
		"openai-response": {Path: "", Method: "POST"},
	}

	projected, err := projectSupportedEndpoints(pricing, catalog)
	if err != nil {
		t.Fatalf("projectSupportedEndpoints() error = %v", err)
	}
	if len(projected) != 1 {
		t.Fatalf("projected endpoint count = %d, want 1", len(projected))
	}
	if _, exists := projected["openai-response"]; exists {
		t.Fatal("unreferenced invalid endpoint must not leak into the user-scoped catalog")
	}
	info := projected["openai"]
	if info.Path != "/v1/chat/completions" || info.Method != "POST" {
		t.Fatalf("projected openai endpoint = %#v", info)
	}
}

func TestProjectSupportedEndpointsRejectsInvalidReferencedEndpoint(t *testing.T) {
	pricing := []model.Pricing{
		{
			ModelName:              "responses-model",
			SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse},
		},
	}
	catalog := map[string]common.EndpointInfo{
		"openai-response": {Path: "", Method: "POST"},
	}

	if _, err := projectSupportedEndpoints(pricing, catalog); err == nil {
		t.Fatal("projectSupportedEndpoints() accepted a referenced endpoint with an empty path")
	}
}

func TestProjectSupportedEndpointsRejectsMissingReferencedEndpoint(t *testing.T) {
	pricing := []model.Pricing{
		{
			ModelName:              "responses-model",
			SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse},
		},
	}

	if _, err := projectSupportedEndpoints(pricing, map[string]common.EndpointInfo{}); err == nil {
		t.Fatal("projectSupportedEndpoints() accepted a missing referenced endpoint")
	}
}
