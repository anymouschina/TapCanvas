package code0ai

import (
	"github.com/QuantumNous/new-api/relay/channel/magic666"
)

// Adaptor handles code0.ai (api.code0.ai) — same Gemini-native format as amux, Bearer auth.
// Image models: POST {base}/v1beta/models/{model}:generateContent
// Chat models:  POST {base}/v1/chat/completions
type Adaptor struct {
	magic666.Adaptor
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }
