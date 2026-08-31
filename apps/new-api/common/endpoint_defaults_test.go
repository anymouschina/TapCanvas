package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
)

func TestMediaEndpointDefaultsArePublished(t *testing.T) {
	tests := []struct {
		endpointType constant.EndpointType
		path         string
	}{
		{endpointType: constant.EndpointTypeOpenAIVideo, path: "/v1/videos"},
		{endpointType: constant.EndpointTypeAudioSpeech, path: "/v1/audio/speech"},
	}

	for _, test := range tests {
		info, ok := GetDefaultEndpointInfo(test.endpointType)
		if !ok {
			t.Fatalf("missing endpoint default for %s", test.endpointType)
		}
		if info.Path != test.path || info.Method != "POST" {
			t.Fatalf("endpoint %s = %#v, want POST %s", test.endpointType, info, test.path)
		}
	}
}
