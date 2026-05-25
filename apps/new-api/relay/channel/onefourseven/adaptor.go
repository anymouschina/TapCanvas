package onefourseven

import (
	"github.com/QuantumNous/new-api/relay/channel/magic666"
)

// Adaptor handles 147AI (api.147ai.cn) — same API format as magic666:
//   - Gemini image models via Gemini-native format
//     POST {base}/v1beta/models/{model}:generateContent
//   - OpenAI image models (gpt-image-2) via OpenAI format
//     POST {base}/v1/images/generations
type Adaptor struct {
	magic666.Adaptor
}

func (a *Adaptor) GetModelList() []string { return ModelList }

func (a *Adaptor) GetChannelName() string { return ChannelName }
