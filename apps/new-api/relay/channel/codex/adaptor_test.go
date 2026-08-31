package codex

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/dto"
)

func TestConvertOpenAIResponsesRequestRemovesUnsupportedMaxOutputTokens(t *testing.T) {
	maxOutputTokens := uint(32768)
	temperature := 0.7

	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, nil, dto.OpenAIResponsesRequest{
		MaxOutputTokens: &maxOutputTokens,
		Temperature:     &temperature,
	})
	if err != nil {
		t.Fatalf("convert error = %v", err)
	}

	request, ok := converted.(dto.OpenAIResponsesRequest)
	if !ok {
		t.Fatalf("converted type = %T", converted)
	}
	if request.MaxOutputTokens != nil {
		t.Fatalf("max_output_tokens = %#v, want nil", request.MaxOutputTokens)
	}
	if string(request.Store) != string(json.RawMessage("false")) {
		t.Fatalf("store = %s, want false", request.Store)
	}
	if request.Temperature != nil {
		t.Fatalf("temperature = %#v, want nil", request.Temperature)
	}
}
