package dto

// ModelParamOption is one selectable value for an enum parameter.
type ModelParamOption struct {
	Value       interface{} `json:"value"`
	Label       string      `json:"label"`
	Description string      `json:"description,omitempty"`
}

// ModelParamSource records where a parameter contract was verified. It is
// intentionally part of params_def so both /api/models/list and
// /api/models/params expose the same provenance without changing the legacy
// top-level params_def array shape.
type ModelParamSource struct {
	Name      string `json:"name,omitempty"`
	URL       string `json:"url,omitempty"`
	CheckedAt string `json:"checked_at,omitempty"`
}

// ModelParamSpec describes a single adjustable parameter for a model.
// Type is one of: "float", "integer", "boolean", "string", "enum",
// "array", or "object".
// For numeric types, Min/Max/Step apply.
// For enum type, Options applies.
// Scope "per_image" marks parameters that apply to individual image_url entries
// in a chat message, not to the top-level request (e.g. image detail level).
type ModelParamSpec struct {
	Key                 string                   `json:"key"`
	Type                string                   `json:"type"`
	Label               string                   `json:"label,omitempty"`
	Description         string                   `json:"description,omitempty"`
	Required            bool                     `json:"required,omitempty"`
	UpstreamRequired    bool                     `json:"upstream_required,omitempty"`
	GatewayDefaulted    bool                     `json:"gateway_defaulted,omitempty"`
	Default             interface{}              `json:"default,omitempty"`
	Const               interface{}              `json:"const,omitempty"`
	Min                 *float64                 `json:"min,omitempty"`
	Max                 *float64                 `json:"max,omitempty"`
	Step                *float64                 `json:"step,omitempty"`
	Options             []ModelParamOption       `json:"options,omitempty"`
	Scope               string                   `json:"scope,omitempty"`
	Aliases             []string                 `json:"aliases,omitempty"`
	Format              string                   `json:"format,omitempty"`
	Accepts             []string                 `json:"accepts,omitempty"`
	ItemType            string                   `json:"item_type,omitempty"`
	Items               map[string]interface{}   `json:"items,omitempty"`
	ItemProperties      []map[string]interface{} `json:"item_properties,omitempty"`
	MinItems            *int                     `json:"min_items,omitempty"`
	MaxItems            *int                     `json:"max_items,omitempty"`
	RecommendedMaxItems *int                     `json:"recommended_max_items,omitempty"`
	RequiredWhen        map[string]interface{}   `json:"required_when,omitempty"`
	ForbiddenWhen       map[string]interface{}   `json:"forbidden_when,omitempty"`
	AllowedValuesWhen   []map[string]interface{} `json:"allowed_values_when,omitempty"`
	Constraints         []map[string]interface{} `json:"constraints,omitempty"`
	LimitStatus         string                   `json:"limit_status,omitempty"`
	Sources             []ModelParamSource       `json:"sources,omitempty"`
}

// ModelParamsCatalogEntry is the per-model entry returned by GET /api/models/params.
type ModelParamsCatalogEntry struct {
	Kind         string             `json:"kind"`
	Capabilities []string           `json:"capabilities,omitempty"`
	Params       []ModelParamSpec   `json:"params"`
	Sources      []ModelParamSource `json:"sources,omitempty"`
}
