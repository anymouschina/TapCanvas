package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestEnsureSQLiteAdditiveMigrationsSupportsLegacyTables(t *testing.T) {
	db := openSQLiteMigrationTestDB(t)

	legacySchemas := []string{
		`CREATE TABLE "users" (
			"id" integer,
			"username" text UNIQUE,
			"password" text NOT NULL,
			"account_kind" varchar(32) DEFAULT 'legacy',
			PRIMARY KEY ("id")
		)`,
		`CREATE TABLE "logs" (
			"id" integer,
			"content" text,
			"upstream_request_id" varchar(64),
			PRIMARY KEY ("id")
		)`,
		`CREATE TABLE "models" (
			"id" integer,
			"model_name" varchar(128),
			PRIMARY KEY ("id")
		)`,
	}
	for _, schema := range legacySchemas {
		require.NoError(t, db.Exec(schema).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO users (id, username, password) VALUES (1, 'first', 'secret'), (2, 'second', 'secret')`).Error)

	require.NoError(t, ensureSQLiteAdditiveMigrations(db, sqliteMainColumnMigrations, sqliteMainIndexMigrations))
	require.NoError(t, ensureSQLiteAdditiveMigrations(db, sqliteMainColumnMigrations, sqliteMainIndexMigrations))

	for _, migration := range sqliteMainColumnMigrations {
		require.True(t, db.Migrator().HasColumn(migration.tableName, migration.columnName), "%s.%s", migration.tableName, migration.columnName)
	}
	require.True(t, db.Migrator().HasColumn("users", "account_kind"))
	require.True(t, db.Migrator().HasColumn("logs", "upstream_request_id"))

	require.NoError(t, db.Exec(`UPDATE users SET phone = '10000000001' WHERE id = 1`).Error)
	require.Error(t, db.Exec(`UPDATE users SET phone = '10000000001' WHERE id = 2`).Error)
}

func TestEnsureSQLiteLogMigrationsSupportsSeparateLogDatabase(t *testing.T) {
	db := openSQLiteMigrationTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE "logs" ("id" integer, "content" text, PRIMARY KEY ("id"))`).Error)

	require.NoError(t, ensureSQLiteAdditiveMigrations(db, sqliteLogColumnMigrations, sqliteLogIndexMigrations))
	require.True(t, db.Migrator().HasColumn("logs", "display_quota"))
	require.True(t, db.Migrator().HasColumn("logs", "conversation_id"))
}

func TestAutoMigrateModelsCreatesOnlyMissingSQLiteTables(t *testing.T) {
	db := openSQLiteMigrationTestDB(t)
	require.NoError(t, db.Exec(`CREATE TABLE "tokens" ("id" integer, "legacy_only" text, PRIMARY KEY ("id"))`).Error)

	require.NoError(t, autoMigrateModels(db, &Token{}, &VolcArkAssetGroup{}))
	require.NoError(t, autoMigrateModels(db, &Token{}, &VolcArkAssetGroup{}))
	require.True(t, db.Migrator().HasColumn("tokens", "legacy_only"))
	require.False(t, db.Migrator().HasColumn("tokens", "name"))
	require.True(t, db.Migrator().HasTable(&VolcArkAssetGroup{}))
}

func openSQLiteMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	return db
}
