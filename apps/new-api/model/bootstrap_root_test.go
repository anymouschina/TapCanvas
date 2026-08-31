package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func unsetBootstrapRootEnv(t *testing.T, key string) {
	t.Helper()
	value, existed := os.LookupEnv(key)
	require.NoError(t, os.Unsetenv(key))
	t.Cleanup(func() {
		if existed {
			require.NoError(t, os.Setenv(key, value))
			return
		}
		require.NoError(t, os.Unsetenv(key))
	})
}

func TestEnsureBootstrapRootUsesDocumentedDefaults(t *testing.T) {
	db := useInternalRelayTestDB(t)
	unsetBootstrapRootEnv(t, "TAPCANVAS_ROOT_USERNAME")
	unsetBootstrapRootEnv(t, "TAPCANVAS_ROOT_PASSWORD")

	require.NoError(t, ensureBootstrapRoot())

	var root User
	require.NoError(t, db.Where("role = ?", common.RoleRootUser).First(&root).Error)
	require.Equal(t, "admin", root.Username)
	require.True(t, common.ValidatePasswordAndHash("123456", root.Password))
}

func TestEnsureBootstrapRootCreatesConfiguredAdminOnce(t *testing.T) {
	db := useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_ROOT_USERNAME", "admin")
	t.Setenv("TAPCANVAS_ROOT_PASSWORD", "123456")

	require.NoError(t, ensureBootstrapRoot())
	require.NoError(t, ensureBootstrapRoot())

	var roots []User
	require.NoError(t, db.Where("role = ?", common.RoleRootUser).Find(&roots).Error)
	require.Len(t, roots, 1)
	require.Equal(t, "admin", roots[0].Username)
	require.Equal(t, bootstrapRootRemark, roots[0].Remark)
	require.True(t, common.ValidatePasswordAndHash("123456", roots[0].Password))
}

func TestEnsureBootstrapRootRejectsPartialCredentials(t *testing.T) {
	useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_ROOT_USERNAME", "tapadmin")
	t.Setenv("TAPCANVAS_ROOT_PASSWORD", "")

	err := ensureBootstrapRoot()
	require.ErrorContains(t, err, "must be configured together")
}

func TestEnsureBootstrapRootNeverRotatesExistingPassword(t *testing.T) {
	db := useInternalRelayTestDB(t)
	t.Setenv("TAPCANVAS_ROOT_USERNAME", "tapadmin")
	t.Setenv("TAPCANVAS_ROOT_PASSWORD", "initial-local-password-123")
	require.NoError(t, ensureBootstrapRoot())

	t.Setenv("TAPCANVAS_ROOT_PASSWORD", "changed-local-password-456")
	require.NoError(t, ensureBootstrapRoot())

	var root User
	require.NoError(t, db.Where("role = ?", common.RoleRootUser).First(&root).Error)
	require.True(t, common.ValidatePasswordAndHash("initial-local-password-123", root.Password))
	require.False(t, common.ValidatePasswordAndHash("changed-local-password-456", root.Password))
}

func TestEnsureBootstrapRootRejectsDifferentExistingRoot(t *testing.T) {
	db := useInternalRelayTestDB(t)
	existing := User{
		Username: "existing",
		Password: "already-hashed-for-test",
		Role:     common.RoleRootUser,
		Status:   common.UserStatusEnabled,
		AffCode:  "existing-root-code",
	}
	require.NoError(t, db.Omit("Phone").Create(&existing).Error)
	t.Setenv("TAPCANVAS_ROOT_USERNAME", "tapadmin")
	t.Setenv("TAPCANVAS_ROOT_PASSWORD", "fresh-local-password-123")

	err := ensureBootstrapRoot()
	require.ErrorContains(t, err, "does not match existing root")
}
