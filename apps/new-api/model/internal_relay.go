package model

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	internalRelayUsername  = "tapcanvas-relay"
	internalRelayTokenName = "tapcanvas-internal-relay"
	internalRelayRemark    = "system:tapcanvas-internal-relay"
	internalRelayQuota     = 2_000_000_000
)

func generateInternalRelaySecret(byteCount int) (string, error) {
	secret := make([]byte, byteCount)
	if _, err := rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate cryptographic service-account secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(secret), nil
}

func ensureInternalRelayPrincipal(tx *gorm.DB) (*User, error) {
	var user User
	err := tx.Unscoped().Where("username = ?", internalRelayUsername).First(&user).Error
	if err == nil {
		if user.DeletedAt.Valid {
			return nil, fmt.Errorf("reserved service account %q is soft-deleted", internalRelayUsername)
		}
		if user.Remark != internalRelayRemark {
			return nil, fmt.Errorf("reserved service account username %q is owned by a regular user", internalRelayUsername)
		}
		if user.Quota < internalRelayQuota {
			user.Quota = internalRelayQuota
		}
		user.Role = common.RoleCommonUser
		user.Status = common.UserStatusEnabled
		user.DisplayName = "TapCanvas Relay"
		user.Group = "default"
		user.PriceRatio = 1
		if err := tx.Model(&user).Select(
			"quota",
			"role",
			"status",
			"display_name",
			"group",
			"price_ratio",
		).Updates(&user).Error; err != nil {
			return nil, fmt.Errorf("reconcile internal relay service account: %w", err)
		}
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("query internal relay service account: %w", err)
	}

	password, err := generateInternalRelaySecret(32)
	if err != nil {
		return nil, err
	}
	hashedPassword, err := common.Password2Hash(password)
	if err != nil {
		return nil, fmt.Errorf("hash internal relay service-account password: %w", err)
	}
	affCode, err := generateInternalRelaySecret(12)
	if err != nil {
		return nil, err
	}

	user = User{
		Username:    internalRelayUsername,
		Password:    hashedPassword,
		DisplayName: "TapCanvas Relay",
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		Quota:       internalRelayQuota,
		Group:       "default",
		AffCode:     affCode,
		Setting:     "{}",
		Remark:      internalRelayRemark,
		PriceRatio:  1,
	}
	// Phone has a unique index. Omit the zero-value string so the database stores
	// NULL and later root/user creation is not blocked by a duplicate empty phone.
	if err := tx.Omit("Phone").Create(&user).Error; err != nil {
		return nil, fmt.Errorf("create internal relay service account: %w", err)
	}
	return &user, nil
}

func validateExistingInternalRelayToken(tx *gorm.DB, token *Token) error {
	var user User
	if err := tx.First(&user, "id = ?", token.UserId).Error; err != nil {
		return fmt.Errorf("internal relay token owner %d is unavailable: %w", token.UserId, err)
	}
	if user.Status != common.UserStatusEnabled {
		return fmt.Errorf("internal relay token owner %d is disabled", token.UserId)
	}
	updates := map[string]interface{}{
		"status":          common.TokenStatusEnabled,
		"name":            internalRelayTokenName,
		"expired_time":    int64(-1),
		"unlimited_quota": true,
	}
	if err := tx.Model(token).Updates(updates).Error; err != nil {
		return fmt.Errorf("reconcile existing internal relay token: %w", err)
	}
	return nil
}

// ensureInternalRelayToken makes the shared Hono/Agents /v1 credential usable
// before the online stack starts. A fresh installation receives a dedicated,
// non-admin service account whose randomly generated password is discarded.
// Existing valid installations keep their current token owner, but the token's
// enabled/unlimited invariants are reconciled explicitly.
func ensureInternalRelayToken() error {
	raw := strings.TrimSpace(common.GetEnvOrDefaultString("TAPCANVAS_INTERNAL_TOKEN", ""))
	required := common.GetEnvOrDefaultBool("TAPCANVAS_INTERNAL_TOKEN_REQUIRED", false)
	if raw == "" {
		if required {
			return errors.New("TAPCANVAS_INTERNAL_TOKEN is required")
		}
		return nil
	}

	key := strings.TrimPrefix(raw, "sk-")
	if len(key) != 48 {
		return fmt.Errorf("TAPCANVAS_INTERNAL_TOKEN must contain exactly 48 characters after the optional sk- prefix; got %d", len(key))
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var token Token
		err := tx.Where(&Token{Key: key}).First(&token).Error
		if err == nil {
			return validateExistingInternalRelayToken(tx, &token)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("query internal relay token: %w", err)
		}

		user, err := ensureInternalRelayPrincipal(tx)
		if err != nil {
			return err
		}
		now := time.Now().Unix()
		token = Token{
			UserId:         user.Id,
			Key:            key,
			Status:         common.TokenStatusEnabled,
			Name:           internalRelayTokenName,
			CreatedTime:    now,
			AccessedTime:   now,
			ExpiredTime:    -1,
			UnlimitedQuota: true,
			Group:          "",
		}
		if err := tx.Create(&token).Error; err != nil {
			return fmt.Errorf("create internal relay token: %w", err)
		}
		common.SysLog("ensureInternalRelayToken: created dedicated TapCanvas relay service identity")
		return nil
	})
}
