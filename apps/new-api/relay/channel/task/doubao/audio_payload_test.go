package doubao

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestSeedanceGenerateAudioMetadataReachesArkPayload(t *testing.T) {
	adaptor := &TaskAdaptor{}
	payload, err := adaptor.convertToRequestPayload(&relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-0-260128",
		Prompt: `阿乔说：“存档了。”`,
		Metadata: map[string]interface{}{
			"generate_audio": true,
		},
	})
	if err != nil {
		t.Fatalf("convert request payload failed: %v", err)
	}
	if payload.GenerateAudio == nil || !bool(*payload.GenerateAudio) {
		t.Fatalf("generate_audio = %v, want true", payload.GenerateAudio)
	}
}

