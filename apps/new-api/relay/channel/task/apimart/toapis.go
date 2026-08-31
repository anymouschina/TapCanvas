package apimart

// toapis.go — toapis.com is APIMart-compatible on the SUBMIT side (same
// POST /v1/images/generations body), but its async task lifecycle uses an
// OpenAI-style "generation.task" envelope that differs from APIMart's
// {code,data} wrapper:
//
//	submit: {"id":"tsk_img_…","object":"generation.task","status":"queued"}
//	poll:   GET /v1/images/generations/{id}
//	        {"status":"completed","result":{"type":"image","data":[{"url":…}]}}
//	        {"status":"failed","error":{"message":"…"}}
//
// The shared SubmitResponse/DetailResponse structs carry the extra flat fields
// (see payload.go); the helpers here detect the envelope and expose a uniform
// view so the sync image adaptor can poll toapis tasks instead of failing the
// submit and retrying on another channel.

// flatPollPathPrefix is the toapis task-status GET path prefix. (APIMart uses
// pollPathPrefix = /v1/tasks/.)
const flatPollPathPrefix = "/v1/images/generations/"

// FlatPollPath returns the toapis GET status path for a task id.
func FlatPollPath(taskID string) string { return flatPollPathPrefix + taskID }

// IsFlat reports whether the submit response is the toapis flat form (task id
// at the top level, no `code`/`data` wrapper).
func (s *SubmitResponse) IsFlat() bool {
	if s == nil {
		return false
	}
	return s.Object == "generation.task" || s.Object == "image.task" ||
		(s.Code == 0 && len(s.Data) == 0 && s.TaskID() != "")
}

// Accepted reports whether the submit succeeded with a usable task id, across
// both the APIMart ({code:200,data:[…]}) and toapis (flat) envelopes.
func (s *SubmitResponse) Accepted() bool {
	if s == nil || s.TaskID() == "" {
		return false
	}
	if s.IsFlat() {
		// Some toapis deployments acknowledge an accepted asynchronous image
		// task with HTTP 503 while still returning this flat task envelope. The
		// transport status cannot decide acceptance by itself, so keep the
		// decision tied to the structured lifecycle. A failed/cancelled/unknown
		// envelope must never be converted into a polling task merely because it
		// carries an id.
		switch s.Status {
		case StatusPending, StatusQueued, StatusProcessing, StatusInProgress, StatusCompleted:
			return true
		default:
			return false
		}
	}
	return s.Code == 200
}

// isFlat reports whether a poll response is the toapis flat form.
func (d *DetailResponse) isFlat() bool {
	if d == nil {
		return false
	}
	return d.Object == "generation.task" || d.Object == "image.task" ||
		(d.Code == 0 && (d.ID != "" || d.TaskID != "" || d.Status != ""))
}

// Ready reports whether the poll response carries a parseable task payload
// (APIMart: code==200 && data!=nil; toapis: flat with a status).
func (d *DetailResponse) Ready() bool {
	if d == nil {
		return false
	}
	if d.isFlat() {
		return d.EffectiveStatus() != ""
	}
	return d.Code == 200 && d.Data != nil
}

// EffectiveStatus returns the task status across both envelopes.
func (d *DetailResponse) EffectiveStatus() string {
	if d == nil {
		return ""
	}
	if !d.isFlat() && d.Data != nil {
		return d.Data.Status
	}
	return d.Status
}

// EffectiveProgress returns the 0..100 progress across both envelopes.
func (d *DetailResponse) EffectiveProgress() int {
	if d == nil {
		return 0
	}
	if !d.isFlat() && d.Data != nil {
		return d.Data.Progress.Int()
	}
	return d.Progress.Int()
}
