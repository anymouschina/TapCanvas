package common

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// SendSMS sends a 6-digit verification code to phone via Aliyun SMS.
// The SMS template must have a ${code} variable.
func SendSMS(phone, code string) error {
	if !AliyunSMSEnabled {
		return fmt.Errorf("短信服务未配置，请设置 ALIYUN_SMS_* 环境变量")
	}

	templateParam, _ := json.Marshal(map[string]string{"code": code})
	nonce := strings.ReplaceAll(uuid.New().String(), "-", "")
	timestamp := time.Now().UTC().Format("2006-01-02T15:04:05Z")

	params := map[string]string{
		"AccessKeyId":      AliyunSMSAccessKeyId,
		"Action":           "SendSms",
		"Format":           "JSON",
		"PhoneNumbers":     phone,
		"SignName":         AliyunSMSSignName,
		"SignatureMethod":  "HMAC-SHA1",
		"SignatureNonce":   nonce,
		"SignatureVersion": "1.0",
		"TemplateCode":     AliyunSMSTemplateCode,
		"TemplateParam":    string(templateParam),
		"Timestamp":        timestamp,
		"Version":          "2017-05-25",
	}

	// Build sorted, RFC-3986-encoded query string for signature
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(params))
	for _, k := range keys {
		parts = append(parts, aliyunEncode(k)+"="+aliyunEncode(params[k]))
	}
	canonicalQuery := strings.Join(parts, "&")

	stringToSign := "POST&%2F&" + aliyunEncode(canonicalQuery)
	mac := hmac.New(sha1.New, []byte(AliyunSMSAccessKeySecret+"&"))
	_, _ = mac.Write([]byte(stringToSign))
	params["Signature"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))

	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}

	resp, err := http.PostForm("https://dysmsapi.aliyuncs.com/", form)
	if err != nil {
		return fmt.Errorf("短信请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("短信响应解析失败: %w", err)
	}

	apiCode, _ := result["Code"].(string)
	if apiCode != "OK" {
		msg, _ := result["Message"].(string)
		return fmt.Errorf("短信发送失败: %s (%s)", msg, apiCode)
	}
	return nil
}

// aliyunEncode is RFC 3986 percent-encoding as required by Aliyun POP API signing.
func aliyunEncode(s string) string {
	var buf strings.Builder
	for _, b := range []byte(s) {
		if (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') ||
			b == '-' || b == '_' || b == '.' || b == '~' {
			buf.WriteByte(b)
		} else {
			fmt.Fprintf(&buf, "%%%02X", b)
		}
	}
	return buf.String()
}
