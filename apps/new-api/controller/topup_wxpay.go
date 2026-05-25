package controller

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

const wxPayBaseURL = "https://api.mch.weixin.qq.com"

// ---- crypto helpers ----

func wxNormalizePem(s string) string {
	return strings.ReplaceAll(strings.TrimSpace(s), "\\n", "\n")
}

func wxBuildAuthHeader(mchId, serialNo, privateKeyPem, method, urlPath, body string) (string, error) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := common.GetRandomString(32)
	msg := method + "\n" + urlPath + "\n" + ts + "\n" + nonce + "\n" + body + "\n"

	block, _ := pem.Decode([]byte(wxNormalizePem(privateKeyPem)))
	if block == nil {
		return "", fmt.Errorf("invalid merchant private key PEM")
	}
	keyIface, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// fallback to PKCS1
		rsaKey, err2 := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err2 != nil {
			return "", fmt.Errorf("parse private key: %w", err)
		}
		keyIface = rsaKey
	}
	rsaKey, ok := keyIface.(*rsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("private key is not RSA")
	}

	h := sha256.New()
	h.Write([]byte(msg))
	sig, err := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, h.Sum(nil))
	if err != nil {
		return "", err
	}
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	return fmt.Sprintf(
		`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",signature="%s",timestamp="%s",serial_no="%s"`,
		mchId, nonce, sigB64, ts, serialNo,
	), nil
}

func wxVerifySignature(platformPubKeyPem, ts, nonce, body, sig string) bool {
	msg := ts + "\n" + nonce + "\n" + body + "\n"
	sigBytes, err := base64.StdEncoding.DecodeString(sig)
	if err != nil {
		return false
	}
	pemStr := wxNormalizePem(platformPubKeyPem)
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return false
	}
	var pubKey *rsa.PublicKey
	if strings.Contains(block.Type, "CERTIFICATE") {
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return false
		}
		var ok bool
		pubKey, ok = cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return false
		}
	} else {
		key, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return false
		}
		var ok bool
		pubKey, ok = key.(*rsa.PublicKey)
		if !ok {
			return false
		}
	}
	h := sha256.New()
	h.Write([]byte(msg))
	return rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, h.Sum(nil), sigBytes) == nil
}

func wxDecryptCallback(ciphertextB64, nonce, associated, v3Key string) (string, error) {
	key := []byte(v3Key)
	if len(key) != 32 {
		return "", fmt.Errorf("WECHAT_PAY_API_V3_KEY must be 32 bytes")
	}
	cipherBytes, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, []byte(nonce), cipherBytes, []byte(associated))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// ---- WeChat Pay API calls ----

func wxDoRequest(method, urlPath, bodyStr string) (map[string]interface{}, int, error) {
	mchId := setting.WxPayMchId
	serialNo := setting.WxPayMchSerialNo
	privateKey := setting.WxPayPrivateKey

	auth, err := wxBuildAuthHeader(mchId, serialNo, privateKey, method, urlPath, bodyStr)
	if err != nil {
		return nil, 0, err
	}

	var bodyReader io.Reader
	if bodyStr != "" {
		bodyReader = strings.NewReader(bodyStr)
	}
	req, err := http.NewRequest(method, wxPayBaseURL+urlPath, bodyReader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	if bodyStr != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("decode response: %w", err)
	}
	return result, resp.StatusCode, nil
}

func wxCreateNativeOrder(description, outTradeNo, notifyUrl string, totalFen int) (string, error) {
	payload := map[string]interface{}{
		"appid":        setting.WxPayAppId,
		"mchid":        setting.WxPayMchId,
		"description":  description,
		"out_trade_no": outTradeNo,
		"notify_url":   notifyUrl,
		"amount": map[string]interface{}{
			"total":    totalFen,
			"currency": "CNY",
		},
	}
	bodyBytes, _ := json.Marshal(payload)
	result, statusCode, err := wxDoRequest("POST", "/v3/pay/transactions/native", string(bodyBytes))
	if err != nil {
		return "", err
	}
	if statusCode < 200 || statusCode >= 300 {
		return "", fmt.Errorf("WeChat Pay API error %d: %v", statusCode, result)
	}
	codeUrl, _ := result["code_url"].(string)
	if codeUrl == "" {
		return "", fmt.Errorf("missing code_url in response: %v", result)
	}
	return codeUrl, nil
}

func wxQueryOrder(outTradeNo string) (string, error) {
	urlPath := fmt.Sprintf("/v3/pay/transactions/out-trade-no/%s?mchid=%s", outTradeNo, setting.WxPayMchId)
	result, statusCode, err := wxDoRequest("GET", urlPath, "")
	if err != nil {
		return "", err
	}
	if statusCode == 404 {
		return "NOT_FOUND", nil
	}
	if statusCode < 200 || statusCode >= 300 {
		return "", fmt.Errorf("WeChat Pay query error %d: %v", statusCode, result)
	}
	tradeState, _ := result["trade_state"].(string)
	return tradeState, nil
}

// ---- price helpers ----

func getWxPayAmountFen(quotaAmount int64, group string) (int, error) {
	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}
	unitPrice := setting.WxPayUnitPrice
	if unitPrice <= 0 {
		unitPrice = operation_setting.Price
	}
	dAmount := decimal.NewFromInt(quotaAmount)
	dUnitPrice := decimal.NewFromFloat(unitPrice)
	dRatio := decimal.NewFromFloat(topupGroupRatio)
	// yuanCNY = quotaAmount * unitPrice * ratio
	yuanCNY := dAmount.Mul(dUnitPrice).Mul(dRatio)
	// fen = yuan * 100
	fen := yuanCNY.Mul(decimal.NewFromInt(100)).IntPart()
	if fen < 1 {
		return 0, fmt.Errorf("充值金额太低（最低1分钱）")
	}
	return int(fen), nil
}

// ---- handlers ----

type WxPayNativeRequest struct {
	Amount int64 `json:"amount"`
}

// RequestWxNativePay creates a WeChat Pay Native order and returns the QR code URL.
func RequestWxNativePay(c *gin.Context) {
	if !setting.WxPayEnabled() {
		c.JSON(200, gin.H{"message": "error", "data": "管理员未配置微信支付"})
		return
	}
	var req WxPayNativeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "参数错误"})
		return
	}
	minTopUp := int64(setting.WxPayMinTopUp)
	if req.Amount < minTopUp {
		c.JSON(200, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", minTopUp)})
		return
	}

	userId := c.GetInt("id")
	group, err := model.GetUserGroup(userId, true)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}

	fen, err := getWxPayAmountFen(req.Amount, group)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": err.Error()})
		return
	}

	tradeNo := fmt.Sprintf("WX%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())

	callbackBase := service.GetCallbackAddress()
	notifyUrl := callbackBase + "/api/wxpay/notify"

	description := fmt.Sprintf("neoSparkMart充值 %d", req.Amount)
	codeUrl, err := wxCreateNativeOrder(description, tradeNo, notifyUrl, fen)
	if err != nil {
		common.SysError("wxpay create native failed: " + err.Error())
		c.JSON(200, gin.H{"message": "error", "data": "创建微信支付订单失败：" + err.Error()})
		return
	}

	yuanCNY := decimal.NewFromInt(int64(fen)).Div(decimal.NewFromInt(100)).InexactFloat64()

	topUp := &model.TopUp{
		UserId:        userId,
		Amount:        req.Amount,
		Money:         yuanCNY,
		TradeNo:       tradeNo,
		PaymentMethod: "wxnative",
		CreateTime:    time.Now().Unix(),
		Status:        common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		c.JSON(200, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	c.JSON(200, gin.H{
		"message":  "success",
		"code_url": codeUrl,
		"trade_no": tradeNo,
	})
}

// QueryWxPayOrder polls the payment status for a given trade_no.
func QueryWxPayOrder(c *gin.Context) {
	tradeNo := strings.TrimSpace(c.Param("trade_no"))
	if tradeNo == "" {
		c.JSON(400, gin.H{"message": "error", "data": "缺少 trade_no"})
		return
	}
	userId := c.GetInt("id")

	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil || topUp.UserId != userId {
		c.JSON(404, gin.H{"message": "error", "data": "订单不存在"})
		return
	}

	if topUp.Status == common.TopUpStatusSuccess {
		c.JSON(200, gin.H{"message": "success", "status": "success"})
		return
	}

	tradeState, err := wxQueryOrder(tradeNo)
	if err != nil {
		c.JSON(200, gin.H{"message": "error", "data": err.Error()})
		return
	}

	if tradeState == "SUCCESS" {
		callerIp := c.ClientIP()
		if err := model.RechargeWxPay(tradeNo, callerIp); err != nil {
			common.SysError("wxpay recharge failed: " + err.Error())
		}
		c.JSON(200, gin.H{"message": "success", "status": "success"})
		return
	}

	c.JSON(200, gin.H{"message": "success", "status": tradeState})
}

// WxPayNotify handles WeChat Pay payment callbacks.
func WxPayNotify(c *gin.Context) {
	ts := c.GetHeader("Wechatpay-Timestamp")
	nonce := c.GetHeader("Wechatpay-Nonce")
	sig := c.GetHeader("Wechatpay-Signature")
	if ts == "" || nonce == "" || sig == "" {
		c.JSON(400, gin.H{"code": "FAIL", "message": "missing signature headers"})
		return
	}

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"code": "FAIL", "message": "read body failed"})
		return
	}
	bodyStr := string(bodyBytes)

	platformPubKey := os.Getenv("WECHAT_PAY_PLATFORM_PUBLIC_KEY")
	if !wxVerifySignature(platformPubKey, ts, nonce, bodyStr, sig) {
		c.JSON(400, gin.H{"code": "FAIL", "message": "signature invalid"})
		return
	}

	var payload struct {
		EventType string `json:"event_type"`
		Resource  struct {
			Ciphertext     string `json:"ciphertext"`
			Nonce          string `json:"nonce"`
			AssociatedData string `json:"associated_data"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(bodyBytes, &payload); err != nil {
		c.JSON(400, gin.H{"code": "FAIL", "message": "invalid body"})
		return
	}

	decrypted, err := wxDecryptCallback(
		payload.Resource.Ciphertext,
		payload.Resource.Nonce,
		payload.Resource.AssociatedData,
		os.Getenv("WECHAT_PAY_API_V3_KEY"),
	)
	if err != nil {
		c.JSON(400, gin.H{"code": "FAIL", "message": "decrypt failed"})
		return
	}

	var tx struct {
		OutTradeNo string `json:"out_trade_no"`
		TradeState string `json:"trade_state"`
	}
	if err := json.Unmarshal([]byte(decrypted), &tx); err != nil || tx.OutTradeNo == "" {
		c.JSON(400, gin.H{"code": "FAIL", "message": "parse decrypted failed"})
		return
	}

	if tx.TradeState != "SUCCESS" {
		c.JSON(200, gin.H{"code": "SUCCESS", "message": "OK"})
		return
	}

	callerIp := c.ClientIP()
	if err := model.RechargeWxPay(tx.OutTradeNo, callerIp); err != nil {
		common.SysError("wxpay notify recharge failed: " + err.Error())
	}

	c.JSON(200, gin.H{"code": "SUCCESS", "message": "OK"})
}
