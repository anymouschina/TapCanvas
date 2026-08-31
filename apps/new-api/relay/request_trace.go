package relay

import (
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
)

type readCloserWithSource struct {
	reader io.Reader
	source io.Closer
}

func (r *readCloserWithSource) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *readCloserWithSource) Close() error {
	if r.source == nil {
		return nil
	}
	return r.source.Close()
}

type responseTraceRecorder struct {
	data      []byte
	truncated bool
}

const maxResponseTraceBytes = 64 << 10

func (r *responseTraceRecorder) Write(p []byte) (int, error) {
	remaining := maxResponseTraceBytes - len(r.data)
	if remaining > 0 {
		writeSize := len(p)
		if writeSize > remaining {
			writeSize = remaining
		}
		r.data = append(r.data, p[:writeSize]...)
	}
	if len(p) > remaining {
		r.truncated = true
	}
	return len(p), nil
}

func (r *responseTraceRecorder) body() string {
	if r == nil {
		return ""
	}
	body := string(r.data)
	if r.truncated {
		body += "\n...[upstream response trace truncated]"
	}
	return body
}

func getOriginalRequestBody(c *gin.Context) string {
	if c == nil {
		return ""
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return ""
	}
	body, err := storage.Bytes()
	if err != nil {
		return ""
	}
	return string(body)
}

func upsertOriginalRequestTrace(c *gin.Context, info *relaycommon.RelayInfo) {
	_ = model.UpsertRequestTraceOriginal(c, info, getOriginalRequestBody(c))
}

func upsertRequestTraceAttempt(c *gin.Context, info *relaycommon.RelayInfo, patch model.RequestTraceAttemptPatch) {
	if info != nil {
		patch.RetryIndex = info.RetryIndex
		if patch.ChannelId == 0 {
			patch.ChannelId = info.ChannelId
		}
		if patch.RequestModel == "" {
			patch.RequestModel = info.OriginModelName
		}
		if patch.UpstreamModel == "" {
			patch.UpstreamModel = info.UpstreamModelName
		}
		if len(patch.RequestConversion) == 0 && len(info.RequestConversionChain) > 0 {
			conversions := make([]string, 0, len(info.RequestConversionChain))
			for _, format := range info.RequestConversionChain {
				conversions = append(conversions, string(format))
			}
			patch.RequestConversion = conversions
		}
	}
	_ = model.UpsertRequestTraceAttempt(c, info, patch)
}

func attachResponseTraceRecorder(resp *http.Response) (*http.Response, *responseTraceRecorder) {
	if resp == nil || resp.Body == nil {
		return resp, nil
	}
	recorder := &responseTraceRecorder{}
	resp.Body = &readCloserWithSource{
		reader: io.TeeReader(resp.Body, recorder),
		source: resp.Body,
	}
	return resp, recorder
}
