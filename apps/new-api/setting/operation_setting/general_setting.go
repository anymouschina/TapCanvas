package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// 额度展示类型
const (
	QuotaDisplayTypeCNY       = "CNY"
	QuotaDisplayTypeTokens    = "TOKENS"
	QuotaDisplayTypeCustom    = "CUSTOM"
	quotaDisplayTypeLegacyUSD = "USD"
)

type GeneralSetting struct {
	PingIntervalEnabled bool `json:"ping_interval_enabled"`
	PingIntervalSeconds int  `json:"ping_interval_seconds"`
	// 当前站点额度展示类型：CNY / TOKENS / CUSTOM
	QuotaDisplayType string `json:"quota_display_type"`
	// 自定义货币符号，用于 CUSTOM 展示类型
	CustomCurrencySymbol string `json:"custom_currency_symbol"`
	// 自定义货币相对内部计费基准的换算系数
	CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`
}

// 默认配置
var generalSetting = GeneralSetting{
	PingIntervalEnabled:        false,
	PingIntervalSeconds:        60,
	QuotaDisplayType:           QuotaDisplayTypeCNY,
	CustomCurrencySymbol:       "¤",
	CustomCurrencyExchangeRate: 1.0,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("general_setting", &generalSetting)
}

func GetGeneralSetting() *GeneralSetting {
	return &generalSetting
}

// NormalizeQuotaDisplayType 将历史美元展示配置硬切换为人民币展示。
func NormalizeQuotaDisplayType(displayType string) string {
	if displayType == "" || displayType == quotaDisplayTypeLegacyUSD {
		return QuotaDisplayTypeCNY
	}
	return displayType
}

// IsCurrencyDisplay 是否以货币形式展示
func IsCurrencyDisplay() bool {
	return GetQuotaDisplayType() != QuotaDisplayTypeTokens
}

// IsCNYDisplay 是否以人民币展示
func IsCNYDisplay() bool {
	return GetQuotaDisplayType() == QuotaDisplayTypeCNY
}

// GetQuotaDisplayType 返回额度展示类型
func GetQuotaDisplayType() string {
	return NormalizeQuotaDisplayType(generalSetting.QuotaDisplayType)
}

// GetCurrencySymbol 返回当前展示类型对应符号
func GetCurrencySymbol() string {
	switch GetQuotaDisplayType() {
	case QuotaDisplayTypeCNY:
		return "¥"
	case QuotaDisplayTypeCustom:
		if generalSetting.CustomCurrencySymbol != "" {
			return generalSetting.CustomCurrencySymbol
		}
		return "¤"
	default:
		return ""
	}
}
