package heyroute

import (
	"bytes"
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel/task/sora"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// HeyRoute uses OpenAI video task IDs, polling and content endpoints, with a
// JSON generation payload whose media and duration fields differ from Sora.
type TaskAdaptor struct{ sora.TaskAdaptor }

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	body, err := storage.Bytes()
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	payload, req, err := NormalizePayload(body)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	c.Set("task_request", req)
	c.Set("heyroute_video_payload", payload)
	info.Action = constant.TaskActionGenerate
	return nil
}

func (a *TaskAdaptor) EstimateBilling(_ *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	return nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+info.ApiKey)
	req.Header.Set("Content-Type", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, ok := c.Get("heyroute_video_payload")
	payload, valid := v.(videoPayload)
	if !ok || !valid {
		return nil, fmt.Errorf("normalized video payload missing")
	}
	payload.Model = info.UpstreamModelName
	body, err := common.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(body), nil
}

func (a *TaskAdaptor) ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error) {
	result, err := a.TaskAdaptor.ParseTaskResult(body)
	if err != nil {
		return nil, err
	}
	var response struct {
		VideoURL string `json:"video_url"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, err
	}
	result.Url = response.VideoURL
	return result, nil
}

func (a *TaskAdaptor) GetChannelName() string { return "HeyRoute Video" }
func (a *TaskAdaptor) GetModelList() []string {
	return []string{"grok-video", "grok-imagine-video", "grok-imagine-video-1.5", "minimax-h3-quantized-768p", "minimax-h3-original-768p", "minimax-h3-original-1080p", "minimax-h3-original-cf-2k", "MiniMax-H3", "seedance-2.5", "seedance-2.0", "seedance-2.0-fast"}
}
