package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestNormalizeVertexAPIKeyCredentialsSplitsLines(t *testing.T) {
	t.Parallel()

	result, err := NormalizeVertexCredentialImports(dto.VertexKeyTypeAPIKey, []string{" key-a\nkey-b ", "key-c"})
	require.NoError(t, err)
	require.Equal(t, []string{"key-a", "key-b", "key-c"}, result.Keys)
	require.Equal(t, 3, result.AccountCount)
}

func TestNormalizeVertexAPIKeyCredentialsRejectsDuplicates(t *testing.T) {
	t.Parallel()

	_, err := NormalizeVertexCredentialImports(dto.VertexKeyTypeAPIKey, []string{"key-a", "key-a"})
	require.EqualError(t, err, "vertex channel: duplicate account in import batch")
}

func TestNormalizeVertexServiceAccountsUsesStableIdentity(t *testing.T) {
	t.Parallel()

	result, err := NormalizeVertexCredentialImports(dto.VertexKeyTypeJSON, []string{`[
        {"type":"service_account","project_id":"project-a","client_email":"a@example.com","private_key":"private-a"},
        {"type":"service_account","project_id":"project-b","client_email":"b@example.com","private_key":"private-b"}
    ]`})
	require.NoError(t, err)
	require.Len(t, result.Keys, 2)
	require.JSONEq(t, `{"type":"service_account","project_id":"project-a","client_email":"a@example.com","private_key":"private-a"}`, result.Keys[0])
	require.JSONEq(t, `{"type":"service_account","project_id":"project-b","client_email":"b@example.com","private_key":"private-b"}`, result.Keys[1])
}

func TestNormalizeVertexServiceAccountRejectsMissingPrivateKey(t *testing.T) {
	t.Parallel()

	_, err := NormalizeVertexCredentialImports(dto.VertexKeyTypeJSON, []string{`{"type":"service_account","project_id":"project-a","client_email":"a@example.com"}`})
	require.EqualError(t, err, "vertex channel: credential 1 account 1: private_key is required")
}

func TestImportVertexFirstCredentialKeepsAccountSessionChannelMultiKey(t *testing.T) {
	previousDB := model.DB
	t.Cleanup(func() {
		model.DB = previousDB
	})

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}))
	model.DB = db

	channel := model.Channel{
		Type: 41,
		Name: "vertex-account-session",
		Key:  "",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey: true,
		},
		OtherSettings: `{"vertex_key_type":"api_key","vertex_egress_isolation_enabled":false,"vertex_egress_cells":[]}`,
	}
	require.NoError(t, db.Create(&channel).Error)

	result, err := ImportVertexChannelCredentials(channel.Id, []string{"vertex-api-key-a"})
	require.NoError(t, err)
	require.Equal(t, 1, result.AccountCount)

	var stored model.Channel
	require.NoError(t, db.First(&stored, channel.Id).Error)
	require.True(t, stored.ChannelInfo.IsMultiKey)
	require.Equal(t, 1, stored.ChannelInfo.MultiKeySize)
	require.Equal(t, "vertex-api-key-a", stored.Key)
}
