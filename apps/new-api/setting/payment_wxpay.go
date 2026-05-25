package setting

import (
	"os"
	"strings"
)

// WxPay* variables are read from environment variables at startup (same keys as hono-api).
// They are NOT stored in the DB — shared env is the source of truth.
var (
	WxPayMchId          = ""
	WxPayAppId          = ""
	WxPayPrivateKey     = ""
	WxPayPlatformPubKey = ""
	WxPayApiV3Key       = ""
	WxPayMchSerialNo    = ""
	// CNY per USD unit price for WeChat Pay. 0 = fall through to operation_setting.Price.
	WxPayUnitPrice float64 = 0
	WxPayMinTopUp  int     = 1
)

func InitWxPayFromEnv() {
	WxPayMchId = strings.TrimSpace(os.Getenv("WECHAT_PAY_MCH_ID"))
	WxPayAppId = strings.TrimSpace(os.Getenv("WECHAT_PAY_APP_ID"))
	WxPayPrivateKey = strings.TrimSpace(os.Getenv("WECHAT_PAY_PRIVATE_KEY"))
	WxPayPlatformPubKey = strings.TrimSpace(os.Getenv("WECHAT_PAY_PLATFORM_PUBLIC_KEY"))
	WxPayApiV3Key = strings.TrimSpace(os.Getenv("WECHAT_PAY_API_V3_KEY"))
	WxPayMchSerialNo = strings.TrimSpace(os.Getenv("WECHAT_PAY_MCH_SERIAL_NO"))
}

func WxPayEnabled() bool {
	return WxPayMchId != "" && WxPayAppId != "" && WxPayPrivateKey != "" &&
		WxPayPlatformPubKey != "" && WxPayApiV3Key != "" && WxPayMchSerialNo != ""
}
