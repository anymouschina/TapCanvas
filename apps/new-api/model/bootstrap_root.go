package model

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const bootstrapRootRemark = "system:tapcanvas-bootstrap-root"

func readBootstrapRootCredentials() (string, string, bool, error) {
	usernameValue, usernameConfigured := os.LookupEnv("TAPCANVAS_ROOT_USERNAME")
	passwordValue, passwordConfigured := os.LookupEnv("TAPCANVAS_ROOT_PASSWORD")
	if !usernameConfigured && !passwordConfigured {
		usernameValue = "admin"
		passwordValue = "123456"
	}
	username := strings.TrimSpace(usernameValue)
	password := strings.TrimSpace(passwordValue)
	if username == "" || password == "" {
		return "", "", false, errors.New("TAPCANVAS_ROOT_USERNAME and TAPCANVAS_ROOT_PASSWORD must be configured together")
	}
	if len(username) > 12 {
		return "", "", false, errors.New("TAPCANVAS_ROOT_USERNAME must contain at most 12 characters")
	}
	if username == internalRelayUsername {
		return "", "", false, fmt.Errorf("TAPCANVAS_ROOT_USERNAME %q is reserved", username)
	}
	if len(password) < 6 {
		return "", "", false, errors.New("TAPCANVAS_ROOT_PASSWORD must contain at least 6 characters")
	}
	return username, password, true, nil
}

// ensureBootstrapRoot creates the configured root only when the database has
// no root yet. A deployment without overrides uses admin / 123456. It never
// rotates or replaces an existing password during restart.
func ensureBootstrapRoot() error {
	username, password, configured, err := readBootstrapRootCredentials()
	if err != nil || !configured {
		return err
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		var root User
		err := tx.Where("role = ?", common.RoleRootUser).First(&root).Error
		if err == nil {
			if root.Username != username {
				return fmt.Errorf(
					"configured bootstrap root %q does not match existing root %q",
					username,
					root.Username,
				)
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("query bootstrap root: %w", err)
		}

		var usernameOwner User
		err = tx.Unscoped().Where("username = ?", username).First(&usernameOwner).Error
		if err == nil {
			return fmt.Errorf("bootstrap root username %q is already owned by a non-root account", username)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("query bootstrap root username: %w", err)
		}

		hashedPassword, err := common.Password2Hash(password)
		if err != nil {
			return fmt.Errorf("hash bootstrap root password: %w", err)
		}
		affCode, err := generateInternalRelaySecret(12)
		if err != nil {
			return err
		}

		root = User{
			Username:    username,
			Password:    hashedPassword,
			DisplayName: "TapCanvas Admin",
			Role:        common.RoleRootUser,
			Status:      common.UserStatusEnabled,
			Quota:       internalRelayQuota,
			Group:       "default",
			AffCode:     affCode,
			Setting:     "{}",
			Remark:      bootstrapRootRemark,
			PriceRatio:  1,
		}
		if err := tx.Omit("Phone").Create(&root).Error; err != nil {
			return fmt.Errorf("create bootstrap root: %w", err)
		}
		common.SysLog("ensureBootstrapRoot: created configured TapCanvas root identity")
		return nil
	})
}
