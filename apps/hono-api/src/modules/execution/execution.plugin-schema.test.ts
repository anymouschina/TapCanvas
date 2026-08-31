import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const createdIndexMigrationSql = readFileSync(
	resolve(process.cwd(), "prisma/migrations/20260814123000_task_status_provider_status_created_index/migration.sql"),
	"utf8",
);
const updatedIndexMigrationSql = readFileSync(
	resolve(process.cwd(), "prisma/migrations/20260814123100_task_status_provider_status_updated_index/migration.sql"),
	"utf8",
);
const pluginCatalogMigrationSql = readFileSync(
	resolve(process.cwd(), "prisma/migrations/20260814123200_workflow_plugin_catalog/migration.sql"),
	"utf8",
);
const schemaSql = readFileSync(resolve(process.cwd(), "schema.sql"), "utf8");
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migrationDeployScript = readFileSync(resolve(process.cwd(), "scripts/migrate-deploy.mjs"), "utf8");

describe("workflow plugin catalog migration contract", () => {
	it("is additive and creates the immutable version plus independent admission tables", () => {
		expect(pluginCatalogMigrationSql).toContain('CREATE TABLE IF NOT EXISTS "workflow_plugin_versions"');
		expect(pluginCatalogMigrationSql).toContain('CREATE TABLE IF NOT EXISTS "workflow_plugin_admissions"');
		expect(pluginCatalogMigrationSql).toContain('UNIQUE INDEX IF NOT EXISTS "uq_workflow_plugin_versions_identity"');
		expect(pluginCatalogMigrationSql).toContain('UNIQUE INDEX IF NOT EXISTS "uq_workflow_plugin_admissions_version"');
		expect(pluginCatalogMigrationSql).toContain("ON DELETE RESTRICT");
		expect(pluginCatalogMigrationSql).toMatch(/CHECK \("decision_revision" > 0\)/u);
		expect(pluginCatalogMigrationSql).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/iu);
	});

	it("keeps each concurrent sweep index in a separate single-statement migration", () => {
		expect(createdIndexMigrationSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_statuses_provider_status_created"');
		expect(createdIndexMigrationSql).toContain('ON "task_statuses" ("provider", "status", "created_at")');
		expect(updatedIndexMigrationSql).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_statuses_provider_status_updated"');
		expect(updatedIndexMigrationSql).toContain('ON "task_statuses" ("provider", "status", "updated_at")');
		for (const onlineIndexMigration of [createdIndexMigrationSql, updatedIndexMigrationSql]) {
			const executableSql = onlineIndexMigration
				.split("\n")
				.filter((line) => !line.trimStart().startsWith("--"))
				.join("\n");
			expect(executableSql.match(/CREATE\s+INDEX\s+CONCURRENTLY/giu)).toHaveLength(1);
			expect(executableSql.match(/;/gu)).toHaveLength(1);
		}
	});

	it("keeps deploy SQL and Prisma models aligned with the migration identities", () => {
		for (const requiredIdentity of [
			"workflow_plugin_versions",
			"workflow_plugin_admissions",
			"idx_task_statuses_provider_status_created",
			"idx_task_statuses_provider_status_updated",
			"uq_workflow_plugin_versions_identity",
			"uq_workflow_plugin_admissions_version",
		] as const) {
			expect(schemaSql).toContain(requiredIdentity);
			expect(prismaSchema).toContain(requiredIdentity);
		}
	});

	it("physically applies every additive migration when an existing database is baselined", () => {
		for (const migrationName of [
			"20260814123000_task_status_provider_status_created_index",
			"20260814123100_task_status_provider_status_updated_index",
			"20260814123200_workflow_plugin_catalog",
		] as const) {
			expect(migrationDeployScript).toContain(`"${migrationName}"`);
		}
	});
});
