package model

import (
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

type modelEndpointContract struct {
	ModelName     string
	EndpointTypes []constant.EndpointType
	Overrides     map[string]common.EndpointInfo
}

// resolveEndpointObject applies an object-form model endpoint configuration as
// a partial override of the registered endpoint contract. An empty object for
// a registered endpoint therefore selects that endpoint without erasing its
// canonical path or method. A field that is present but malformed is rejected;
// only an absent field is allowed to inherit its registered default.
func resolveEndpointObject(endpointType string, override map[string]interface{}) (common.EndpointInfo, error) {
	endpointType = strings.TrimSpace(endpointType)
	if endpointType == "" {
		return common.EndpointInfo{}, fmt.Errorf("endpoint type is empty")
	}
	for field := range override {
		switch field {
		case "path", "method":
		default:
			return common.EndpointInfo{}, fmt.Errorf("unknown field %q", field)
		}
	}

	info, exists := common.GetDefaultEndpointInfo(constant.EndpointType(endpointType))
	if !exists {
		info = common.EndpointInfo{Method: "POST"}
	}
	if rawPath, present := override["path"]; present {
		path, ok := rawPath.(string)
		if !ok {
			return common.EndpointInfo{}, fmt.Errorf("path must be a string")
		}
		info.Path = strings.TrimSpace(path)
	}
	if rawMethod, present := override["method"]; present {
		method, ok := rawMethod.(string)
		if !ok {
			return common.EndpointInfo{}, fmt.Errorf("method must be a string")
		}
		info.Method = strings.ToUpper(strings.TrimSpace(method))
	}
	if info.Path == "" {
		return common.EndpointInfo{}, fmt.Errorf("path is required")
	}
	if info.Method == "" {
		return common.EndpointInfo{}, fmt.Errorf("method is required")
	}
	return info, nil
}

func isEndpointTypeName(value string) bool {
	if value == "" {
		return false
	}
	for index, character := range value {
		isLetter := (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z')
		if index == 0 {
			if !isLetter {
				return false
			}
			continue
		}
		isDigit := character >= '0' && character <= '9'
		if !isLetter && !isDigit && character != '-' && character != '_' && character != '.' {
			return false
		}
	}
	return true
}

func validateLegacyEndpointNames(values []string) error {
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		endpointType := strings.TrimSpace(value)
		if !isEndpointTypeName(endpointType) {
			return fmt.Errorf("legacy endpoint at index %d is invalid", index)
		}
		if _, exists := seen[endpointType]; exists {
			return fmt.Errorf("legacy endpoint %s is duplicated", endpointType)
		}
		seen[endpointType] = struct{}{}
	}
	return nil
}

// parseModelEndpointOverrides parses the current object-form endpoint schema.
// Legacy endpoint lists and plain endpoint names are intentionally left to the
// channel protocol catalog; they are not path/method override definitions.
func parseModelEndpointOverrides(raw string) (map[string]common.EndpointInfo, bool, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, false, nil
	}
	if !strings.HasPrefix(trimmed, "{") {
		switch trimmed[0] {
		case '[':
			var endpointTypes []string
			if err := common.Unmarshal([]byte(trimmed), &endpointTypes); err != nil {
				return nil, false, fmt.Errorf("legacy endpoint list JSON is invalid: %w", err)
			}
			if err := validateLegacyEndpointNames(endpointTypes); err != nil {
				return nil, false, err
			}
			return nil, false, nil
		case '"':
			var endpointType string
			if err := common.Unmarshal([]byte(trimmed), &endpointType); err != nil {
				return nil, false, fmt.Errorf("legacy endpoint name JSON is invalid: %w", err)
			}
			if err := validateLegacyEndpointNames([]string{endpointType}); err != nil {
				return nil, false, err
			}
			return nil, false, nil
		default:
			if trimmed == "null" || trimmed == "true" || trimmed == "false" || !isEndpointTypeName(trimmed) {
				return nil, false, fmt.Errorf("legacy endpoint name %q is invalid", trimmed)
			}
			return nil, false, nil
		}
	}

	var rawOverrides map[string]interface{}
	if err := common.Unmarshal([]byte(trimmed), &rawOverrides); err != nil {
		return nil, true, fmt.Errorf("object JSON is invalid: %w", err)
	}

	rawEndpointTypes := make([]string, 0, len(rawOverrides))
	for endpointType := range rawOverrides {
		rawEndpointTypes = append(rawEndpointTypes, endpointType)
	}
	sort.Strings(rawEndpointTypes)

	overrides := make(map[string]common.EndpointInfo, len(rawOverrides))
	for _, rawEndpointType := range rawEndpointTypes {
		endpointType := strings.TrimSpace(rawEndpointType)
		if !isEndpointTypeName(endpointType) {
			return nil, true, fmt.Errorf("endpoint type %q is invalid", endpointType)
		}
		if _, exists := overrides[endpointType]; exists {
			return nil, true, fmt.Errorf("endpoint type %s is duplicated after trimming", endpointType)
		}

		value := rawOverrides[rawEndpointType]
		var (
			info common.EndpointInfo
			err  error
		)
		switch typedValue := value.(type) {
		case string:
			path := strings.TrimSpace(typedValue)
			if path == "" {
				return nil, true, fmt.Errorf("endpoint %s path is required", endpointType)
			}
			info = common.EndpointInfo{Path: path, Method: "POST"}
		case map[string]interface{}:
			info, err = resolveEndpointObject(endpointType, typedValue)
			if err != nil {
				return nil, true, fmt.Errorf("endpoint %s is invalid: %w", endpointType, err)
			}
		default:
			return nil, true, fmt.Errorf("endpoint %s must be a path string or descriptor object", endpointType)
		}
		overrides[endpointType] = info
	}
	return overrides, true, nil
}

// ValidateModelEndpoints validates every supported persisted endpoints schema
// before an admin write. Cache refresh calls the same parser again so direct
// SQL changes cannot bypass the runtime contract.
func ValidateModelEndpoints(raw string) error {
	_, _, err := parseModelEndpointOverrides(raw)
	return err
}

func normalizeEndpointInfo(endpointType string, info common.EndpointInfo) (common.EndpointInfo, error) {
	path := strings.TrimSpace(info.Path)
	if path == "" {
		return common.EndpointInfo{}, fmt.Errorf("endpoint %s path is required", endpointType)
	}
	method := strings.ToUpper(strings.TrimSpace(info.Method))
	if method == "" {
		return common.EndpointInfo{}, fmt.Errorf("endpoint %s method is required", endpointType)
	}
	return common.EndpointInfo{Path: path, Method: method}, nil
}

// buildSupportedEndpointCatalog creates the one endpoint-type catalog exposed
// by /api/pricing. Since that response cannot represent model-specific paths,
// conflicting contracts fail explicitly instead of depending on Go map order.
func buildSupportedEndpointCatalog(contracts []modelEndpointContract) (map[string]common.EndpointInfo, error) {
	sortedContracts := make([]modelEndpointContract, len(contracts))
	copy(sortedContracts, contracts)
	sort.Slice(sortedContracts, func(left, right int) bool {
		return sortedContracts[left].ModelName < sortedContracts[right].ModelName
	})

	catalog := make(map[string]common.EndpointInfo)
	owners := make(map[string]string)
	for _, contract := range sortedContracts {
		endpointTypes := make([]string, 0, len(contract.EndpointTypes))
		for _, endpointType := range contract.EndpointTypes {
			endpointTypes = append(endpointTypes, strings.TrimSpace(string(endpointType)))
		}
		sort.Strings(endpointTypes)

		for _, endpointType := range endpointTypes {
			if endpointType == "" {
				return nil, fmt.Errorf("model %s contains an empty endpoint type", contract.ModelName)
			}
			info, exists := contract.Overrides[endpointType]
			if !exists {
				info, exists = common.GetDefaultEndpointInfo(constant.EndpointType(endpointType))
				if !exists {
					return nil, fmt.Errorf("endpoint %s referenced by model %s has no descriptor", endpointType, contract.ModelName)
				}
			}
			normalized, err := normalizeEndpointInfo(endpointType, info)
			if err != nil {
				return nil, fmt.Errorf("model %s: %w", contract.ModelName, err)
			}

			if existing, alreadyPublished := catalog[endpointType]; alreadyPublished {
				if existing != normalized {
					return nil, fmt.Errorf(
						"endpoint %s conflicts between models %s (%s %s) and %s (%s %s)",
						endpointType,
						owners[endpointType],
						existing.Method,
						existing.Path,
						contract.ModelName,
						normalized.Method,
						normalized.Path,
					)
				}
				continue
			}
			catalog[endpointType] = normalized
			owners[endpointType] = contract.ModelName
		}
	}
	return catalog, nil
}
