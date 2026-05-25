package gemini

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestConvertImageRequestIncludesReferenceImagesAndNormalizes1080p(t *testing.T) {
	t.Parallel()

	const imageDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQImWP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

	request := dto.ImageRequest{
		Model:  "nanobanana2",
		Prompt: "keep the detail-page layout",
		Extra: map[string]json.RawMessage{
			"image_urls": json.RawMessage(`["` + imageDataURL + `","` + imageDataURL + `"]`),
			"image_size": json.RawMessage(`"1080p"`),
		},
	}
	info := &relaycommon.RelayInfo{
		OriginModelName: "nanobanana2",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-3.1-flash-image-preview",
		},
	}

	adaptor := &Adaptor{}
	got, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	require.NoError(t, err)

	geminiRequest, ok := got.(dto.GeminiChatRequest)
	require.True(t, ok)
	require.Len(t, geminiRequest.Contents, 1)
	require.Len(t, geminiRequest.Contents[0].Parts, 3)
	require.NotNil(t, geminiRequest.Contents[0].Parts[0].InlineData)
	require.NotNil(t, geminiRequest.Contents[0].Parts[1].InlineData)
	require.Equal(t, "keep the detail-page layout", geminiRequest.Contents[0].Parts[2].Text)

	imageConfig := map[string]string{}
	require.NoError(t, common.Unmarshal(geminiRequest.GenerationConfig.ImageConfig, &imageConfig))
	require.Equal(t, "1K", imageConfig["imageSize"])
}
