package dto

// ModelParamOption is one selectable value for an enum parameter.
type ModelParamOption struct {
	Value interface{} `json:"value"`
	Label string      `json:"label"`
}

// ModelParamSpec describes a single adjustable parameter for a model.
// Type is one of: "float", "integer", "boolean", "string", "enum".
// For numeric types, Min/Max/Step apply.
// For enum type, Options applies.
// Scope "per_image" marks parameters that apply to individual image_url entries
// in a chat message, not to the top-level request (e.g. image detail level).
type ModelParamSpec struct {
	Key      string             `json:"key"`
	Type     string             `json:"type"`
	Label    string             `json:"label,omitempty"`
	Required bool               `json:"required,omitempty"`
	Default  interface{}        `json:"default,omitempty"`
	Min      *float64           `json:"min,omitempty"`
	Max      *float64           `json:"max,omitempty"`
	Step     *float64           `json:"step,omitempty"`
	Options  []ModelParamOption `json:"options,omitempty"`
	Scope    string             `json:"scope,omitempty"`
}

// ModelParamsCatalogEntry is the per-model entry returned by GET /api/models/params.
type ModelParamsCatalogEntry struct {
	Kind         string           `json:"kind"`
	Capabilities []string         `json:"capabilities,omitempty"`
	Params       []ModelParamSpec `json:"params"`
}
