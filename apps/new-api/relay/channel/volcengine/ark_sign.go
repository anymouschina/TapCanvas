package volcengine

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// 火山引擎 OpenAPI 签名（HMAC-SHA256 / "Volc" signature v4）。
// 移植自 hono-api src/modules/asset/volc-sign.ts，用于调用 ARK 素材审核接口。

type arkSignInput struct {
	accessKey string
	secretKey string
	region    string // "cn-beijing"
	service   string // "ark"
	host      string // "open.volcengineapi.com"
	method    string // "POST"
	action    string // "CreateAsset"
	version   string // "2024-01-01"
	body      string // JSON 字符串
	date      time.Time
}

type arkSignOutput struct {
	url     string
	headers map[string]string
}

func arkSha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func arkHmacSha256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func signArkRequest(in arkSignInput) arkSignOutput {
	d := in.date.UTC()
	iso := d.Format("20060102T150405Z")
	short := d.Format("20060102")

	canonicalQuery := fmt.Sprintf("Action=%s&Version=%s",
		url.QueryEscape(in.action), url.QueryEscape(in.version))
	bodyHash := arkSha256Hex(in.body)
	contentType := "application/json; charset=utf-8"

	canonicalHeaders := "content-type:" + contentType + "\n" +
		"host:" + in.host + "\n" +
		"x-content-sha256:" + bodyHash + "\n" +
		"x-date:" + iso + "\n"
	signedHeaders := "content-type;host;x-content-sha256;x-date"

	canonicalRequest := strings.Join([]string{
		in.method, "/", canonicalQuery, canonicalHeaders, signedHeaders, bodyHash,
	}, "\n")

	credentialScope := short + "/" + in.region + "/" + in.service + "/request"
	stringToSign := strings.Join([]string{
		"HMAC-SHA256", iso, credentialScope, arkSha256Hex(canonicalRequest),
	}, "\n")

	kDate := arkHmacSha256([]byte(in.secretKey), short)
	kRegion := arkHmacSha256(kDate, in.region)
	kService := arkHmacSha256(kRegion, in.service)
	kSigning := arkHmacSha256(kService, "request")
	signature := hex.EncodeToString(arkHmacSha256(kSigning, stringToSign))

	authorization := fmt.Sprintf(
		"HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		in.accessKey, credentialScope, signedHeaders, signature)

	return arkSignOutput{
		url: fmt.Sprintf("https://%s/?%s", in.host, canonicalQuery),
		headers: map[string]string{
			"Content-Type":     contentType,
			"Host":             in.host,
			"X-Date":           iso,
			"X-Content-Sha256": bodyHash,
			"Authorization":    authorization,
		},
	}
}
