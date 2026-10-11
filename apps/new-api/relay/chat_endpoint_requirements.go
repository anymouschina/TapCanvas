package relay

import (
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/types"
	"net/http"
)

// Body passthrough can disable operator preferences, but cannot change the
// provider's explicitly bound wire protocol.
func shouldUseResponsesForChat(adaptor channel.Adaptor, model string, passThrough, policySelected bool) bool {
	capability, declared := adaptor.(interface{ RequiresResponsesForChat(string) bool })
	return (declared && capability.RequiresResponsesForChat(model)) || (!passThrough && policySelected)
}

// A provider can retain its original upstream status and disable resubmission
// after a generation was accepted, even when shared protocol converters parse it.
func annotateAdaptorResponseError(adaptor channel.Adaptor, response *http.Response, responseErr *types.NewAPIError) {
	capability, declared := adaptor.(interface {
		AnnotateResponseError(*http.Response, *types.NewAPIError)
	})
	if declared {
		capability.AnnotateResponseError(response, responseErr)
	}
}
