package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useInternalRelayTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}))
	previousDB := DB
	DB = db
	t.Cleanup(func() {
		DB = previousDB
	})
	return db
}

func TestEnsureInternalRelayTokenBootstrapsDedicatedPrincipal(t *testing.T) {
	db := useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN", strings.Repeat("a", 48))
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN_REQUIRED", "true")

	require.NoError(t, ensureInternalRelayToken())
	require.NoError(t, ensureInternalRelayToken())

	var users []User
	require.NoError(t, db.Find(&users).Error)
	require.Len(t, users, 1)
	serviceUser := users[0]
	require.Equal(t, internalRelayUsername, serviceUser.Username)
	require.Equal(t, internalRelayRemark, serviceUser.Remark)
	require.Equal(t, common.RoleCommonUser, serviceUser.Role)
	require.Equal(t, common.UserStatusEnabled, serviceUser.Status)
	require.Equal(t, internalRelayQuota, serviceUser.Quota)
	require.NotEmpty(t, serviceUser.Password)
	require.NotEmpty(t, serviceUser.AffCode)

	var tokens []Token
	require.NoError(t, db.Find(&tokens).Error)
	require.Len(t, tokens, 1)
	require.Equal(t, serviceUser.Id, tokens[0].UserId)
	require.Equal(t, internalRelayTokenName, tokens[0].Name)
	require.Equal(t, common.TokenStatusEnabled, tokens[0].Status)
	require.True(t, tokens[0].UnlimitedQuota)
	require.Equal(t, int64(-1), tokens[0].ExpiredTime)

	root := User{
		Username:    "root",
		Password:    "already-hashed-for-test",
		DisplayName: "Root",
		Role:        common.RoleRootUser,
		Status:      common.UserStatusEnabled,
	}
	require.NoError(t, db.Create(&root).Error)
}

func TestEnsureInternalRelayTokenRejectsMissingRequiredToken(t *testing.T) {
	useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN", "")
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN_REQUIRED", "true")

	err := ensureInternalRelayToken()
	require.ErrorContains(t, err, "TAPCANVAS_INTERNAL_TOKEN is required")
}

func TestEnsureInternalRelayTokenRejectsInvalidLength(t *testing.T) {
	useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN", "short")
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN_REQUIRED", "true")

	err := ensureInternalRelayToken()
	require.ErrorContains(t, err, "exactly 48 characters")
}

func TestEnsureInternalRelayTokenKeepsValidExistingOwner(t *testing.T) {
	db := useInternalRelayTestDB(t)
	key := strings.Repeat("b", 48)
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN", key)
	t.Setenv("TAPCANVAS_INTERNAL_TOKEN_REQUIRED", "true")

	owner := User{
		Username: "existing-owner",
		Password: "already-hashed-for-test",
		Role:     common.RoleRootUser,
		Status:   common.UserStatusEnabled,
		AffCode:  "existing-owner-code",
	}
	require.NoError(t, db.Omit("Phone").Create(&owner).Error)
	token := Token{
		UserId:      owner.Id,
		Key:         key,
		Status:      common.TokenStatusExhausted,
		Name:        "old-name",
		ExpiredTime: 0,
	}
	require.NoError(t, db.Create(&token).Error)

	require.NoError(t, ensureInternalRelayToken())

	var stored Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	require.Equal(t, owner.Id, stored.UserId)
	require.Equal(t, internalRelayTokenName, stored.Name)
	require.Equal(t, common.TokenStatusEnabled, stored.Status)
	require.True(t, stored.UnlimitedQuota)
	require.Equal(t, int64(-1), stored.ExpiredTime)

	var servicePrincipalCount int64
	require.NoError(t, db.Model(&User{}).Where("username = ?", internalRelayUsername).Count(&servicePrincipalCount).Error)
	require.Zero(t, servicePrincipalCount)
}
