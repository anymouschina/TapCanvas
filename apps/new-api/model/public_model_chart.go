package model

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	publicSpecKeyStandard   = "__standard__"
	publicSpecKeyUnrecorded = "__unrecorded__"
	publicSpecKeyInvalid    = "__invalid__"
)

// PublicModelSpecStat is an observed request specification within the public
// statistics window. It contains aggregate counts only; request bodies and
// user identifiers are never exposed by the public endpoint.
type PublicModelSpecStat struct {
	SpecKey      string  `json:"spec_key"`
	SpecLabel    string  `json:"spec_label"`
	CallCount    int64   `json:"call_count"`
	SuccessCount int64   `json:"success_count"`
	SuccessRate  float64 `json:"success_rate"`
}

// PublicModelChartStat is the complete 24-hour aggregate for one observed
// model, including the same counts split by the exact request specification.
type PublicModelChartStat struct {
	ModelName    string                `json:"model_name"`
	ModelKind    string                `json:"model_kind"`
	CallCount    int64                 `json:"call_count"`
	SuccessCount int64                 `json:"success_count"`
	SuccessRate  float64               `json:"success_rate"`
	Specs        []PublicModelSpecStat `json:"specs"`
}

type publicModelChartLogRow struct {
	ModelName           string
	LogType             int
	OriginalRequestBody sql.NullString
}

type publicSpecScalar string

func (value *publicSpecScalar) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))
	if raw == "" || raw == "null" {
		*value = ""
		return nil
	}
	if strings.HasPrefix(raw, `"`) {
		var decoded string
		if err := common.Unmarshal(data, &decoded); err != nil {
			return err
		}
		*value = publicSpecScalar(strings.TrimSpace(decoded))
		return nil
	}
	if _, err := strconv.ParseFloat(raw, 64); err != nil {
		return errors.New("规格数值格式无效")
	}
	*value = publicSpecScalar(raw)
	return nil
}

type publicRequestSpecification struct {
	Size           string           `json:"size"`
	Resolution     string           `json:"resolution"`
	ImageSize      string           `json:"image_size"`
	ImageSizeCamel string           `json:"imageSize"`
	Quality        string           `json:"quality"`
	AspectRatio    string           `json:"aspect_ratio"`
	Duration       publicSpecScalar `json:"duration"`
	Seconds        publicSpecScalar `json:"seconds"`
	Mode           string           `json:"mode"`
	Metadata       struct {
		Resolution     string `json:"resolution"`
		ImageSize      string `json:"image_size"`
		ImageSizeCamel string `json:"imageSize"`
	} `json:"metadata"`
	ExtraBody struct {
		Google struct {
			ImageConfig struct {
				Resolution     string `json:"resolution"`
				ImageSize      string `json:"image_size"`
				ImageSizeCamel string `json:"imageSize"`
			} `json:"image_config"`
		} `json:"google"`
	} `json:"extra_body"`
	GenerationConfig struct {
		ImageConfig struct {
			Resolution     string `json:"resolution"`
			ImageSize      string `json:"image_size"`
			ImageSizeCamel string `json:"imageSize"`
		} `json:"imageConfig"`
	} `json:"generationConfig"`
}

type publicObservedSpec struct {
	key   string
	label string
}

type publicSpecAggregate struct {
	label        string
	callCount    int64
	successCount int64
}

type publicModelAggregate struct {
	callCount    int64
	successCount int64
	specs        map[string]*publicSpecAggregate
}

func publicSuccessRate(successCount, callCount int64) float64 {
	if callCount <= 0 {
		return 0
	}
	return float64(successCount) / float64(callCount)
}

func normalizedPublicSpecValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func publicDurationValue(spec publicRequestSpecification) string {
	if spec.Duration != "" {
		return strings.TrimSpace(string(spec.Duration))
	}
	return strings.TrimSpace(string(spec.Seconds))
}

func publicImageResolutionValue(spec publicRequestSpecification) string {
	candidates := []string{
		spec.Resolution,
		spec.ImageSize,
		spec.ImageSizeCamel,
		spec.Metadata.Resolution,
		spec.Metadata.ImageSize,
		spec.Metadata.ImageSizeCamel,
		spec.ExtraBody.Google.ImageConfig.Resolution,
		spec.ExtraBody.Google.ImageConfig.ImageSize,
		spec.ExtraBody.Google.ImageConfig.ImageSizeCamel,
		spec.GenerationConfig.ImageConfig.Resolution,
		spec.GenerationConfig.ImageConfig.ImageSize,
		spec.GenerationConfig.ImageConfig.ImageSizeCamel,
	}
	for _, candidate := range candidates {
		if value := strings.TrimSpace(candidate); value != "" {
			return value
		}
	}
	return ""
}

func publicMediaObservedSpec(modelName, modelKind string, spec publicRequestSpecification) publicObservedSpec {
	resolution := normalizedPublicSpecValue(publicImageResolutionValue(spec))
	size := normalizedPublicSpecValue(spec.Size)
	quality := normalizedPublicSpecValue(spec.Quality)
	duration := normalizedPublicSpecValue(publicDurationValue(spec))
	mode := normalizedPublicSpecValue(spec.Mode)
	aspectRatio := normalizedPublicSpecValue(spec.AspectRatio)

	switch modelKind {
	case "image":
		if resolution != "" {
			if normalizedQuality, ok := NormalizeGptImage2Quality(quality); ok &&
				(CanonicalModelKey(modelName) == "gpt-image-2" || CanonicalModelKey(modelName) == "gpt-image-2-official") {
				return publicObservedSpec{
					key:   fmt.Sprintf("image:%s:%s", resolution, normalizedQuality),
					label: strings.Join([]string{strings.ToUpper(resolution), normalizedQuality}, " · "),
				}
			}
			parts := []string{strings.ToUpper(resolution)}
			keyParts := []string{"image", resolution}
			if quality != "" {
				parts = append(parts, quality)
				keyParts = append(keyParts, quality)
			}
			return publicObservedSpec{key: strings.Join(keyParts, ":"), label: strings.Join(parts, " · ")}
		}
		if size != "" {
			return publicObservedSpec{key: "image:size:" + size, label: strings.ToUpper(size)}
		}
	case "video":
		if resolution != "" {
			parts := []string{strings.ToUpper(resolution)}
			keyParts := []string{"video", resolution}
			if duration != "" {
				parts = append(parts, duration+"s")
				keyParts = append(keyParts, duration+"s")
			}
			if mode != "" && mode != resolution {
				parts = append(parts, mode)
				keyParts = append(keyParts, mode)
			}
			return publicObservedSpec{key: strings.Join(keyParts, ":"), label: strings.Join(parts, " · ")}
		}
	}

	parts := make([]string, 0, 6)
	keyParts := make([]string, 0, 7)
	appendPart := func(name, value string) {
		if value == "" {
			return
		}
		keyParts = append(keyParts, name, value)
		parts = append(parts, value)
	}
	appendPart("resolution", resolution)
	appendPart("size", size)
	appendPart("quality", quality)
	appendPart("aspect", aspectRatio)
	appendPart("duration", duration)
	appendPart("mode", mode)
	if len(parts) > 0 {
		return publicObservedSpec{key: strings.Join(keyParts, ":"), label: strings.Join(parts, " · ")}
	}
	if modelKind == "chat" || modelKind == "text" || modelKind == "audio" {
		return publicObservedSpec{key: publicSpecKeyStandard, label: "标准调用"}
	}
	return publicObservedSpec{key: publicSpecKeyUnrecorded, label: "规格未记录"}
}

func publicObservedSpecFromBody(modelName, modelKind, body string) publicObservedSpec {
	if strings.TrimSpace(body) == "" {
		return publicMediaObservedSpec(modelName, modelKind, publicRequestSpecification{})
	}
	var requestSpec publicRequestSpecification
	if err := common.Unmarshal([]byte(body), &requestSpec); err != nil {
		return publicObservedSpec{key: publicSpecKeyInvalid, label: "规格记录无效"}
	}
	return publicMediaObservedSpec(modelName, modelKind, requestSpec)
}

func publicModelKinds() (map[string]string, error) {
	rows := make([]publicModelCatalogRow, 0)
	if err := DB.Model(&Model{}).
		Select("model_name", "kind").
		Where("model_name != ''").
		Scan(&rows).Error; err != nil {
		common.SysError("failed to query public chart model kinds: " + err.Error())
		return nil, errors.New("查询模型类型失败")
	}
	kinds := make(map[string]string, len(rows))
	for _, row := range rows {
		name := strings.TrimSpace(row.ModelName)
		if name == "" {
			continue
		}
		kinds[name] = strings.ToLower(strings.TrimSpace(row.Kind))
	}
	return kinds, nil
}

// GetPublicModelChartStats returns all observed models in the last 24 hours.
// The web client merges this complete aggregate with the live pricing catalog,
// so configured models with no calls remain visible as zero-sample rows.
func GetPublicModelChartStats() ([]PublicModelChartStat, error) {
	modelKinds, err := publicModelKinds()
	if err != nil {
		return nil, err
	}
	since := time.Now().Add(-24 * time.Hour).Unix()
	rows, err := LOG_DB.Table("logs AS public_logs").
		Select("public_logs.model_name, public_logs.type AS log_type, request_traces.original_request_body").
		Joins("LEFT JOIN request_traces ON request_traces.request_id = public_logs.request_id").
		Where("public_logs.created_at >= ? AND public_logs.type IN (?, ?) AND public_logs.model_name != ''", since, LogTypeConsume, LogTypeError).
		Rows()
	if err != nil {
		common.SysError("failed to stream public model chart logs: " + err.Error())
		return nil, errors.New("查询全模型统计失败")
	}
	defer rows.Close()

	aggregates := make(map[string]*publicModelAggregate)
	for rows.Next() {
		var row publicModelChartLogRow
		if err := rows.Scan(&row.ModelName, &row.LogType, &row.OriginalRequestBody); err != nil {
			common.SysError("failed to scan public model chart log: " + err.Error())
			return nil, errors.New("读取全模型统计失败")
		}
		modelName := strings.TrimSpace(row.ModelName)
		aggregate, exists := aggregates[modelName]
		if !exists {
			aggregate = &publicModelAggregate{specs: make(map[string]*publicSpecAggregate)}
			aggregates[modelName] = aggregate
		}
		aggregate.callCount++
		isSuccess := row.LogType == LogTypeConsume
		if isSuccess {
			aggregate.successCount++
		}
		body := ""
		if row.OriginalRequestBody.Valid {
			body = row.OriginalRequestBody.String
		}
		observedSpec := publicObservedSpecFromBody(modelName, modelKinds[modelName], body)
		specAggregate, exists := aggregate.specs[observedSpec.key]
		if !exists {
			specAggregate = &publicSpecAggregate{label: observedSpec.label}
			aggregate.specs[observedSpec.key] = specAggregate
		}
		specAggregate.callCount++
		if isSuccess {
			specAggregate.successCount++
		}
	}
	if err := rows.Err(); err != nil {
		common.SysError("failed while reading public model chart logs: " + err.Error())
		return nil, errors.New("读取全模型统计失败")
	}

	stats := make([]PublicModelChartStat, 0, len(aggregates))
	for modelName, aggregate := range aggregates {
		specs := make([]PublicModelSpecStat, 0, len(aggregate.specs))
		for specKey, specAggregate := range aggregate.specs {
			specs = append(specs, PublicModelSpecStat{
				SpecKey:      specKey,
				SpecLabel:    specAggregate.label,
				CallCount:    specAggregate.callCount,
				SuccessCount: specAggregate.successCount,
				SuccessRate:  publicSuccessRate(specAggregate.successCount, specAggregate.callCount),
			})
		}
		sort.Slice(specs, func(left, right int) bool {
			if specs[left].CallCount != specs[right].CallCount {
				return specs[left].CallCount > specs[right].CallCount
			}
			return specs[left].SpecKey < specs[right].SpecKey
		})
		stats = append(stats, PublicModelChartStat{
			ModelName:    modelName,
			ModelKind:    modelKinds[modelName],
			CallCount:    aggregate.callCount,
			SuccessCount: aggregate.successCount,
			SuccessRate:  publicSuccessRate(aggregate.successCount, aggregate.callCount),
			Specs:        specs,
		})
	}
	sort.Slice(stats, func(left, right int) bool {
		if stats[left].CallCount != stats[right].CallCount {
			return stats[left].CallCount > stats[right].CallCount
		}
		return stats[left].ModelName < stats[right].ModelName
	})
	return stats, nil
}
