package amux

import (
	"github.com/QuantumNous/new-api/relay/channel/magic666"
)

// Adaptor handles amux (api.amux.ai) — Gemini-native format with Bearer auth.
// Image models: POST {base}/v1beta/models/{model}:generateContent
// Chat models:  POST {base}/v1/chat/completions
type Adaptor struct {
	magic666.Adaptor
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }
