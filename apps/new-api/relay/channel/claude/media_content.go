package claude

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func convertClaudeMediaContent(
	c *gin.Context,
	media dto.MediaContent,
	passThroughImageURL bool,
) (dto.ClaudeMediaMessage, error) {
	switch media.Type {
	case dto.ContentTypeImageURL:
		return convertClaudeImageContent(c, media, passThroughImageURL)
	case dto.ContentTypeFile:
		return convertClaudeFileContent(c, media)
	default:
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 不支持媒体内容类型 %q",
			media.Type,
		)
	}
}

func convertClaudeImageContent(
	c *gin.Context,
	media dto.MediaContent,
	passThroughImageURL bool,
) (dto.ClaudeMediaMessage, error) {
	source := media.ToFileSource()
	if source == nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf("Claude 图片内容缺少有效数据")
	}
	if passThroughImageURL && source.IsURL() {
		return dto.ClaudeMediaMessage{
			Type: "image",
			Source: &dto.ClaudeMessageSource{
				Type: "url",
				Url:  source.GetRawData(),
			},
		}, nil
	}

	base64Data, mediaType, err := service.GetBase64Data(
		c,
		source,
		"formatting image for Claude",
	)
	if err != nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf("读取 Claude 图片数据失败: %w", err)
	}
	if !isClaudeImageMediaType(mediaType) {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 图片内容的媒体类型 %q 不受支持",
			mediaType,
		)
	}
	return newClaudeBase64MediaMessage("image", mediaType, base64Data), nil
}

func convertClaudeFileContent(
	c *gin.Context,
	media dto.MediaContent,
) (dto.ClaudeMediaMessage, error) {
	file := media.GetFile()
	if file == nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf("Claude 文件内容缺少 file 对象")
	}
	if strings.TrimSpace(file.FileData) == "" {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 文件 %q 缺少 file_data",
			file.FileName,
		)
	}

	declaredMediaType := messageFileMediaType(file.FileName)
	if declaredMediaType == "application/octet-stream" {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 不支持文件 %q 的扩展名",
			file.FileName,
		)
	}
	source := types.NewFileSourceFromData(file.FileData, declaredMediaType)
	base64Data, mediaType, err := service.GetBase64Data(
		c,
		source,
		"formatting file for Claude",
	)
	if err != nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"读取 Claude 文件 %q 失败: %w",
			file.FileName,
			err,
		)
	}
	decoded, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"解码 Claude 文件 %q 失败: %w",
			file.FileName,
			err,
		)
	}
	if err := validateClaudeFileMediaType(declaredMediaType, decoded); err != nil {
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 文件 %q 校验失败: %w",
			file.FileName,
			err,
		)
	}

	switch {
	case mediaType == "application/pdf":
		return newClaudeBase64MediaMessage(
			"document",
			mediaType,
			base64Data,
		), nil
	case strings.HasPrefix(mediaType, "text/"):
		text := string(decoded)
		return dto.ClaudeMediaMessage{
			Type: "text",
			Text: &text,
		}, nil
	case isClaudeImageMediaType(mediaType):
		return newClaudeBase64MediaMessage("image", mediaType, base64Data), nil
	default:
		return dto.ClaudeMediaMessage{}, fmt.Errorf(
			"Claude 不支持文件媒体类型 %q",
			mediaType,
		)
	}
}

func messageFileMediaType(fileName string) string {
	trimmed := strings.TrimSpace(fileName)
	dotIndex := strings.LastIndex(trimmed, ".")
	if dotIndex < 0 || dotIndex == len(trimmed)-1 {
		return "application/octet-stream"
	}
	return service.GetMimeTypeByExtension(trimmed[dotIndex+1:])
}

func validateClaudeFileMediaType(declaredMediaType string, decoded []byte) error {
	detectedMediaType := http.DetectContentType(decoded)
	if separator := strings.Index(detectedMediaType, ";"); separator >= 0 {
		detectedMediaType = strings.TrimSpace(detectedMediaType[:separator])
	}
	switch {
	case declaredMediaType == "application/pdf":
		if detectedMediaType != declaredMediaType {
			return fmt.Errorf(
				"扩展名声明 %q，但内容检测为 %q",
				declaredMediaType,
				detectedMediaType,
			)
		}
	case strings.HasPrefix(declaredMediaType, "text/"):
		if !strings.HasPrefix(detectedMediaType, "text/") {
			return fmt.Errorf(
				"扩展名声明 %q，但内容检测为 %q",
				declaredMediaType,
				detectedMediaType,
			)
		}
	case isClaudeImageMediaType(declaredMediaType):
		if detectedMediaType != declaredMediaType {
			return fmt.Errorf(
				"扩展名声明 %q，但内容检测为 %q",
				declaredMediaType,
				detectedMediaType,
			)
		}
	default:
		return fmt.Errorf("媒体类型 %q 不受支持", declaredMediaType)
	}
	return nil
}

func isClaudeImageMediaType(mediaType string) bool {
	switch mediaType {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return true
	default:
		return false
	}
}

func newClaudeBase64MediaMessage(
	blockType string,
	mediaType string,
	base64Data string,
) dto.ClaudeMediaMessage {
	return dto.ClaudeMediaMessage{
		Type: blockType,
		Source: &dto.ClaudeMessageSource{
			Type:      "base64",
			MediaType: mediaType,
			Data:      base64Data,
		},
	}
}
