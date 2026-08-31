package constant

import (
	"slices"
	"strconv"
	"testing"
)

func TestProtocolRegistryHasUniqueResolvableDefinitions(t *testing.T) {
	definitions := ListProtocolDefinitions()
	if len(definitions) < 20 {
		t.Fatalf("expected a complete protocol catalog, got %d definitions", len(definitions))
	}

	seen := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		if _, exists := seen[definition.ID]; exists {
			t.Fatalf("duplicate protocol id %q", definition.ID)
		}
		seen[definition.ID] = struct{}{}

		resolved, ok := GetProtocolDefinition(definition.ID)
		if !ok {
			t.Fatalf("protocol %q is listed but cannot be resolved", definition.ID)
		}
		if resolved.Transport == ProtocolTransportRelay && resolved.APIType < 0 {
			t.Fatalf("relay protocol %q has invalid api type %d", definition.ID, resolved.APIType)
		}
		if resolved.Transport == ProtocolTransportTask && resolved.TaskPlatform == "" {
			t.Fatalf("task protocol %q has no task platform", definition.ID)
		}
		if resolved.Transport == ProtocolTransportTask {
			if _, err := strconv.Atoi(string(resolved.TaskPlatform)); err == nil {
				t.Fatalf(
					"task protocol %q still couples its adaptor key to numeric channel type %q",
					definition.ID,
					resolved.TaskPlatform,
				)
			}
		}
	}
}

func TestLlubanChannelUsesOpenAICompatibleProtocol(t *testing.T) {
	if got := ChannelBaseURLs[ChannelTypeLluban]; got != "https://tt-api.lluban.com" {
		t.Fatalf("unexpected lluban base URL %q", got)
	}
	definition, ok := GetProtocolDefinition(ProtocolOpenAI)
	if !ok {
		t.Fatal("openai protocol missing")
	}
	if !slices.Contains(definition.RecommendedChannelTypes, ChannelTypeLluban) {
		t.Fatal("lluban channel must bind to the OpenAI-compatible protocol")
	}
}

func TestProtocolRegistryReturnsDefensiveCopies(t *testing.T) {
	first, ok := GetProtocolDefinition(ProtocolOpenAI)
	if !ok {
		t.Fatal("openai protocol missing")
	}
	if len(first.EndpointTypes) == 0 {
		t.Fatal("openai endpoint list is empty")
	}
	first.EndpointTypes[0] = EndpointTypeGemini
	anthropic, ok := GetProtocolDefinition(ProtocolAnthropic)
	if !ok || len(anthropic.Options) == 0 {
		t.Fatal("anthropic protocol options are missing")
	}
	anthropic.Options[0].Key = "mutated"

	second, ok := GetProtocolDefinition(ProtocolOpenAI)
	if !ok {
		t.Fatal("openai protocol missing on second lookup")
	}
	if second.EndpointTypes[0] == EndpointTypeGemini {
		t.Fatal("protocol registry leaked a mutable endpoint slice")
	}
	secondAnthropic, ok := GetProtocolDefinition(ProtocolAnthropic)
	if !ok {
		t.Fatal("anthropic protocol missing on second lookup")
	}
	if secondAnthropic.Options[0].Key == "mutated" {
		t.Fatal("protocol registry leaked a mutable option slice")
	}
}

func TestTencentProtocolPublishesImplementedImageEndpoint(t *testing.T) {
	tencent, ok := GetProtocolDefinition("tencent-hunyuan")
	if !ok {
		t.Fatal("tencent-hunyuan protocol missing")
	}

	for _, endpointType := range tencent.EndpointTypes {
		if endpointType == EndpointTypeImageGeneration {
			return
		}
	}
	t.Fatal("tencent-hunyuan protocol must publish the image-generation endpoint implemented by the Tencent VOD adaptor")
}

func TestVolcengineProtocolPublishesImplementedResponsesEndpoint(t *testing.T) {
	volcengine, ok := GetProtocolDefinition(ProtocolVolcEngine)
	if !ok {
		t.Fatal("volcengine protocol missing")
	}

	for _, endpointType := range volcengine.EndpointTypes {
		if endpointType == EndpointTypeOpenAIResponse {
			return
		}
	}
	t.Fatal("volcengine protocol must publish the Responses endpoint implemented by the Volcengine Ark adaptor")
}
