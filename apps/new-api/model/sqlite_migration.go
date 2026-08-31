package model

import (
	"fmt"

	"gorm.io/gorm"
)

type sqliteColumnMigration struct {
	tableName  string
	columnName string
	ddl        string
}

type sqliteIndexMigration struct {
	tableName string
	ddl       string
}

var sqliteMainColumnMigrations = []sqliteColumnMigration{
	{tableName: "users", columnName: "phone", ddl: "`phone` varchar(20)"},
	{tableName: "users", columnName: "price_ratio", ddl: "`price_ratio` decimal(10,4) DEFAULT 1"},
	{tableName: "logs", columnName: "display_quota", ddl: "`display_quota` integer DEFAULT 0"},
	{tableName: "logs", columnName: "conversation_id", ddl: "`conversation_id` varchar(64) DEFAULT ''"},
	{tableName: "models", columnName: "kind", ddl: "`kind` varchar(32) DEFAULT ''"},
	{tableName: "models", columnName: "capabilities", ddl: "`capabilities` text"},
	{tableName: "models", columnName: "params_def", ddl: "`params_def` text"},
	{tableName: "models", columnName: "pricing_config", ddl: "`pricing_config` text"},
}

var sqliteMainIndexMigrations = []sqliteIndexMigration{
	{tableName: "users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_users_phone` ON `users` (`phone`)"},
	{tableName: "logs", ddl: "CREATE INDEX IF NOT EXISTS `idx_logs_conversation_id` ON `logs` (`conversation_id`)"},
}

var sqliteLogColumnMigrations = []sqliteColumnMigration{
	{tableName: "logs", columnName: "display_quota", ddl: "`display_quota` integer DEFAULT 0"},
	{tableName: "logs", columnName: "conversation_id", ddl: "`conversation_id` varchar(64) DEFAULT ''"},
}

var sqliteLogIndexMigrations = []sqliteIndexMigration{
	{tableName: "logs", ddl: "CREATE INDEX IF NOT EXISTS `idx_logs_conversation_id` ON `logs` (`conversation_id`)"},
}

func prepareSQLiteMigrations() error {
	return ensureSQLiteAdditiveMigrations(DB, sqliteMainColumnMigrations, sqliteMainIndexMigrations)
}

func prepareSQLiteLogMigrations(db *gorm.DB) error {
	return ensureSQLiteAdditiveMigrations(db, sqliteLogColumnMigrations, sqliteLogIndexMigrations)
}

func autoMigrateModels(db *gorm.DB, models ...interface{}) error {
	if db == nil {
		return fmt.Errorf("auto-migration requires a database connection")
	}
	if db.Dialector.Name() != "sqlite" {
		return db.AutoMigrate(models...)
	}

	for _, migrationModel := range models {
		// GORM's SQLite migrator reparses CREATE TABLE statements in order to
		// rebuild existing tables. Valid schemas containing inline UNIQUE
		// constraints and quoted defaults can fail that parser with "unbalanced
		// brackets". Existing SQLite tables therefore use explicit additive
		// migrations; AutoMigrate is reserved for creating missing tables.
		if db.Migrator().HasTable(migrationModel) {
			continue
		}
		if err := db.AutoMigrate(migrationModel); err != nil {
			return fmt.Errorf("auto-migrate %T: %w", migrationModel, err)
		}
	}
	return nil
}

// ensureSQLiteAdditiveMigrations applies only explicitly declared additive
// changes. It never rebuilds an existing table, so historical columns and
// indexes remain untouched. SQLite DDL is transactional, keeping the set of
// column and index additions atomic when a statement fails.
func ensureSQLiteAdditiveMigrations(
	db *gorm.DB,
	columns []sqliteColumnMigration,
	indexes []sqliteIndexMigration,
) error {
	if db == nil {
		return fmt.Errorf("SQLite migration requires a database connection")
	}
	if db.Dialector.Name() != "sqlite" {
		return nil
	}

	return db.Transaction(func(tx *gorm.DB) error {
		for _, column := range columns {
			if !tx.Migrator().HasTable(column.tableName) || tx.Migrator().HasColumn(column.tableName, column.columnName) {
				continue
			}
			if err := tx.Exec("ALTER TABLE `" + column.tableName + "` ADD COLUMN " + column.ddl).Error; err != nil {
				return fmt.Errorf("add SQLite %s.%s column: %w", column.tableName, column.columnName, err)
			}
		}

		for _, index := range indexes {
			if !tx.Migrator().HasTable(index.tableName) {
				continue
			}
			if err := tx.Exec(index.ddl).Error; err != nil {
				return fmt.Errorf("create SQLite index on %s: %w", index.tableName, err)
			}
		}
		return nil
	})
}
