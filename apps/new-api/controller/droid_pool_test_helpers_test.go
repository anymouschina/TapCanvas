package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appI18n "github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
	"testing"
)

// In-memory fixtures never access an operator database or real credentials.
func droidPoolTestDB(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousSQLite, previousRedis, previousMemory := common.UsingSQLite, common.RedisEnabled, common.MemoryCacheEnabled
	previousMySQL, previousPostgreSQL := common.UsingMySQL, common.UsingPostgreSQL
	previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
	t.Setenv("SQL_DSN", "")
	common.SQLitePath, common.IsMasterNode = t.TempDir()+"/pool.db", false
	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = true, false, false
	require.NoError(t, model.InitDB())
	db := model.DB
	common.SQLitePath, common.IsMasterNode = previousPath, previousMaster
	require.NoError(t, appI18n.Init())
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB, model.LOG_DB = db, db
	common.UsingSQLite, common.RedisEnabled, common.MemoryCacheEnabled = true, false, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.UsingSQLite, common.RedisEnabled, common.MemoryCacheEnabled = previousSQLite, previousRedis, previousMemory
		common.UsingMySQL, common.UsingPostgreSQL = previousMySQL, previousPostgreSQL
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Model{}, &model.Vendor{}))
}

func insertDroidPoolFixture(t *testing.T) model.Channel {
	t.Helper()
	channel := model.Channel{Type: constant.ChannelTypeOpenAI, Key: "fixture-key", Name: "droid-pool-fixture", Models: "fixture-model", Group: "default", Status: common.ChannelStatusEnabled}
	require.NoError(t, channel.Insert())
	return channel
}
