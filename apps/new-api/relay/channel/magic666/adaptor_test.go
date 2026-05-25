package magic666

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
)

func TestGetRequestURLUsesResponsesEndpoint(t *testing.T) {
	t.Parallel()

	adaptor := &Adaptor{}
	got, err := adaptor.GetRequestURL(&relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl: "http://152.53.38.70:3001",
		},
		RelayMode: relayconstant.RelayModeResponses,
	})
	if err != nil {
		t.Fatalf("GetRequestURL error: %v", err)
	}
	if got != "http://152.53.38.70:3001/v1/responses" {
		t.Fatalf("url = %q", got)
	}
}

func TestConvertOpenAIResponsesRequestPassesThroughModel(t *testing.T) {
	t.Parallel()

	adaptor := &Adaptor{}
	converted, err := adaptor.ConvertOpenAIResponsesRequest(nil, &relaycommon.RelayInfo{}, dto.OpenAIResponsesRequest{
		Model: "gpt-5.5",
	})
	if err != nil {
		t.Fatalf("ConvertOpenAIResponsesRequest error: %v", err)
	}
	req, ok := converted.(dto.OpenAIResponsesRequest)
	if !ok {
		t.Fatalf("converted type = %T", converted)
	}
	if req.Model != "gpt-5.5" {
		t.Fatalf("model = %q", req.Model)
	}
}
