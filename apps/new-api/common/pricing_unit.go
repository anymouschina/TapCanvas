package common

// QuotaToCNYAmount converts internal quota into the site's monetary base.
// Model prices are already denominated in CNY, so this conversion must never
// apply a foreign-exchange multiplier.
func QuotaToCNYAmount(quota int) float64 {
	return float64(quota) / QuotaPerUnit
}
