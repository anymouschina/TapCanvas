package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

func TestResolveEndpointObjectKeepsRegisteredDefaultsForEmptyOverride(t *testing.T) {
	info, err := resolveEndpointObject("openai-response", map[string]interface{}{})
	if err != nil {
		t.Fatalf("resolveEndpointObject() error = %v", err)
	}

	if info.Path != "/v1/responses" || info.Method != "POST" {
		t.Fatalf("resolved endpoint = %#v, want POST /v1/responses", info)
	}
}

func TestResolveEndpointObjectAppliesPartialOverride(t *testing.T) {
	info, err := resolveEndpointObject("openai-response", map[string]interface{}{
		"path": "/custom/responses",
	})
	if err != nil {
		t.Fatalf("resolveEndpointObject() error = %v", err)
	}

	if info.Path != "/custom/responses" || info.Method != "POST" {
		t.Fatalf("resolved endpoint = %#v, want POST /custom/responses", info)
	}
}

func TestResolveEndpointObjectRejectsPresentInvalidFields(t *testing.T) {
	tests := []struct {
		name     string
		override map[string]interface{}
	}{
		{name: "null path", override: map[string]interface{}{"path": nil}},
		{name: "non-string path", override: map[string]interface{}{"path": 7}},
		{name: "empty path", override: map[string]interface{}{"path": "  "}},
		{name: "null method", override: map[string]interface{}{"method": nil}},
		{name: "non-string method", override: map[string]interface{}{"method": 7}},
		{name: "empty method", override: map[string]interface{}{"method": "  "}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := resolveEndpointObject("openai-response", test.override); err == nil {
				t.Fatal("resolveEndpointObject() accepted an invalid present field")
			}
		})
	}
}

func TestResolveEndpointObjectRejectsUnknownFields(t *testing.T) {
	if _, err := resolveEndpointObject("openai-response", map[string]interface{}{
		"paht": "/v1/responses",
	}); err == nil {
		t.Fatal("resolveEndpointObject() accepted an unknown descriptor field")
	}
}

func TestResolveEndpointObjectRequiresPathForUnknownEndpoint(t *testing.T) {
	if _, err := resolveEndpointObject("custom-endpoint", map[string]interface{}{}); err == nil {
		t.Fatal("resolveEndpointObject() accepted an unknown endpoint without a path")
	}

	info, err := resolveEndpointObject("custom-endpoint", map[string]interface{}{
		"path": "/v1/custom",
	})
	if err != nil {
		t.Fatalf("resolveEndpointObject() error = %v", err)
	}
	if info.Path != "/v1/custom" || info.Method != "POST" {
		t.Fatalf("resolved endpoint = %#v, want POST /v1/custom", info)
	}
}

func TestParseModelEndpointOverridesRejectsMalformedObject(t *testing.T) {
	if _, objectForm, err := parseModelEndpointOverrides(`{"openai-response":`); err == nil || !objectForm {
		t.Fatalf("parseModelEndpointOverrides() = objectForm %v, error %v; want object-form error", objectForm, err)
	}
}

func TestParseModelEndpointOverridesRejectsUnsupportedDescriptorValue(t *testing.T) {
	_, objectForm, err := parseModelEndpointOverrides(`{"openai-response": 7}`)
	if err == nil || !objectForm {
		t.Fatalf("parseModelEndpointOverrides() = objectForm %v, error %v; want descriptor error", objectForm, err)
	}
}

func TestParseModelEndpointOverridesLeavesLegacyListToProtocolCatalog(t *testing.T) {
	overrides, objectForm, err := parseModelEndpointOverrides(`["openai-response"]`)
	if err != nil || objectForm || overrides != nil {
		t.Fatalf("parseModelEndpointOverrides() = %#v, %v, %v; want nil, false, nil", overrides, objectForm, err)
	}
}

func TestParseModelEndpointOverridesRejectsMalformedLegacyValues(t *testing.T) {
	values := []string{
		`["openai-response"`,
		`["openai-response", 7]`,
		`null`,
		`7`,
		`not an endpoint`,
		`openai-response?`,
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			if _, _, err := parseModelEndpointOverrides(value); err == nil {
				t.Fatal("parseModelEndpointOverrides() accepted malformed legacy data")
			}
		})
	}
}

func TestParseModelEndpointOverridesAcceptsSupportedLegacyNames(t *testing.T) {
	values := []string{
		`["openai-response", "openai"]`,
		`"openai-video"`,
		`openai-video`,
	}
	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			overrides, objectForm, err := parseModelEndpointOverrides(value)
			if err != nil || objectForm || overrides != nil {
				t.Fatalf("parseModelEndpointOverrides() = %#v, %v, %v; want nil, false, nil", overrides, objectForm, err)
			}
		})
	}
}

func TestBuildSupportedEndpointCatalogRejectsModelConflictsDeterministically(t *testing.T) {
	contracts := []modelEndpointContract{
		{
			ModelName:     "zeta-model",
			EndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
			Overrides: map[string]common.EndpointInfo{
				"openai": {Path: "/v1/custom/chat", Method: "POST"},
			},
		},
		{
			ModelName:     "alpha-model",
			EndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
		},
	}

	_, err := buildSupportedEndpointCatalog(contracts)
	if err == nil {
		t.Fatal("buildSupportedEndpointCatalog() accepted conflicting endpoint descriptors")
	}
	if !strings.Contains(err.Error(), "alpha-model") || !strings.Contains(err.Error(), "zeta-model") {
		t.Fatalf("conflict error %q does not identify both models", err)
	}
	if strings.Index(err.Error(), "alpha-model") > strings.Index(err.Error(), "zeta-model") {
		t.Fatalf("conflict error %q is not deterministic by model name", err)
	}
}

func TestBuildSupportedEndpointCatalogAllowsEquivalentContracts(t *testing.T) {
	catalog, err := buildSupportedEndpointCatalog([]modelEndpointContract{
		{ModelName: "model-b", EndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse}},
		{
			ModelName:     "model-a",
			EndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse},
			Overrides: map[string]common.EndpointInfo{
				"openai-response": {Path: " /v1/responses ", Method: " post "},
			},
		},
	})
	if err != nil {
		t.Fatalf("buildSupportedEndpointCatalog() error = %v", err)
	}
	if info := catalog["openai-response"]; info.Path != "/v1/responses" || info.Method != "POST" {
		t.Fatalf("catalog endpoint = %#v, want POST /v1/responses", info)
	}
}
