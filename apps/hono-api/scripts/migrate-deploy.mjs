#!/usr/bin/env node
/**
 * Idempotent Prisma migration runner.
 *
 * Handles P3005 ("database schema is not empty") by baselining historical
 * migrations and explicitly applying migrations that contain required data
 * backfills before marking them applied. Baseline target/state is persisted in
 * PostgreSQL before the first resolve so an interrupted run resumes the exact
 * historical range instead of treating the remainder as new migrations.
 * Known idempotent schema-repair migrations get their own append-only journal:
 * this repairs legacy `migrate resolve --applied` drift without replaying
 * arbitrary data migrations. This covers:
 *   - Fresh DB: migrations run normally.
 *   - Existing DB with no migration history: run required idempotent data
 *     migrations, baseline schema-only history, then deploy.
 *   - Existing DB with partial history: only pending migrations run.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prismaPackage from "@prisma/client";
import {
	parseManualOperationRecoveryContract,
	selectRecoverableManualOperationFailures,
} from "./migrate-deploy-contract.mjs";

const { PrismaClient } = prismaPackage;

const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma/migrations");
const BASELINE_STATE_TABLE = "_tapcanvas_migration_baseline";
const BASELINE_REPAIR_STATE_TABLE = "_tapcanvas_baseline_repairs";
const BASELINE_REPAIR_MIGRATIONS = [
	"20260715090000_repair_baselined_schema_drift",
];
const REQUIRED_EXISTING_DATABASE_MIGRATIONS = new Set([
	"20260723000000_credit_batches_expiry_order",
	"20260801160000_enforce_single_project_directory",
	// Runtime-owned pgvector infrastructure must be materialized before an
	// existing database can be baselined, otherwise vector knowledge retrieval sees a
	// falsely-applied migration with no vector table.
	"20260805100000_add_agent_knowledge_vectors",
	// AI execution events were previously created lazily in the request path.
	// Existing databases must execute this migration instead of baselining it,
	// otherwise the hard-cutover schema readiness check will reject chat runs.
	"20260810130000_execution_trace_event_journal",
	"20260810140000_execution_trace_payload_metadata",
	// Existing databases need both single-statement online indexes and the durable
	// plugin catalog physically applied. Baselining these additive migrations
	// would leave hot-ledger scans unindexed or Prisma models without tables.
	"20260814123000_task_status_provider_status_created_index",
	"20260814123100_task_status_provider_status_updated_index",
	"20260814123200_workflow_plugin_catalog",
	// Capability attachment storage is read on every authenticated Small T turn;
	// it must exist physically on legacy databases instead of being baselined.
	"20260815093000_agent_capability_attachments",
	// Capability preferences are the single-track routing authority; invocation
	// records and project kind are required by the Capability Bay control plane.
	"20260815143000_capability_management_control_plane",
	// The historical bootstrap schema intentionally precedes the live Prisma
	// contract. Fresh and previously baselined databases must physically execute
	// the additive alignment migration instead of only recording it.
	"20260831120000_align_current_prisma_bootstrap",
]);

function run(cmd) {
	execSync(cmd, { stdio: "inherit" });
}

function getMigrationNames() {
	if (!fs.existsSync(MIGRATIONS_DIR)) return [];
	return fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((f) => fs.statSync(path.join(MIGRATIONS_DIR, f)).isDirectory())
		.sort();
}

function loadManualOperationRecoveryContracts(migrations) {
	const contracts = new Map();
	for (const migrationName of migrations) {
		const migrationFile = path.join(MIGRATIONS_DIR, migrationName, "migration.sql");
		if (!fs.existsSync(migrationFile)) continue;
		const contract = parseManualOperationRecoveryContract(
			migrationName,
			fs.readFileSync(migrationFile, "utf8"),
		);
		if (contract) contracts.set(migrationName, contract);
	}
	return contracts;
}

function deploy() {
	// 必须 stdio:pipe 捕获输出才能判 P3005——inherit 下 err.stdout/stderr 恒为 null，
	// P3005 检测永远为假、基线分支成死代码（全新库首次部署必炸）。捕获后原样转发保留可读日志。
	try {
		const out = execSync("npx prisma migrate deploy", { stdio: "pipe", encoding: "utf8" });
		process.stdout.write(out);
		return true;
	} catch (err) {
		const stdout = String(err?.stdout ?? "");
		const stderr = String(err?.stderr ?? "");
		process.stdout.write(stdout);
		process.stderr.write(stderr);
		if ((stdout + stderr + String(err?.message ?? "")).includes("P3005")) return false;
		throw err;
	}
}

async function tableExists(prisma, tableName) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT to_regclass($1) IS NOT NULL AS "exists"`,
		`public.${tableName}`,
	);
	return rows[0]?.exists === true;
}

async function loadBaselineState(prisma) {
	if (!(await tableExists(prisma, BASELINE_STATE_TABLE))) return null;
	const rows = await prisma.$queryRawUnsafe(
		`SELECT target_migration, status
       FROM "_tapcanvas_migration_baseline"
      WHERE singleton = 1`,
	);
	const row = rows[0];
	if (!row) return null;
	return {
		targetMigration: String(row.target_migration),
		status: String(row.status),
	};
}

async function beginBaseline(prisma, targetMigration) {
	await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "_tapcanvas_migration_baseline" (
  singleton SMALLINT PRIMARY KEY CHECK (singleton = 1),
  target_migration TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
)`);
	await prisma.$executeRawUnsafe(
		`INSERT INTO "_tapcanvas_migration_baseline" (
       singleton, target_migration, status, started_at, completed_at
     )
     VALUES (1, $1, 'in_progress', NOW(), NULL)
     ON CONFLICT (singleton) DO UPDATE
       SET target_migration = EXCLUDED.target_migration,
           status = 'in_progress',
           started_at = NOW(),
           completed_at = NULL`,
		targetMigration,
	);
}

async function completeBaseline(prisma, targetMigration) {
	const changed = await prisma.$executeRawUnsafe(
		`UPDATE "_tapcanvas_migration_baseline"
        SET status = 'completed', completed_at = NOW()
      WHERE singleton = 1
        AND target_migration = $1
        AND status = 'in_progress'`,
		targetMigration,
	);
	if (changed !== 1) {
		throw new Error(`baseline state was not completed for target: ${targetMigration}`);
	}
}

async function getRecordedMigrationNames(prisma) {
	if (!(await tableExists(prisma, "_prisma_migrations"))) return new Set();
	const rows = await prisma.$queryRawUnsafe(
		`SELECT migration_name
       FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL`,
	);
	return new Set(rows.map((row) => String(row.migration_name)));
}

async function reconcileFailedManualOperationMigrations(prisma, migrations) {
	if (!(await tableExists(prisma, "_prisma_migrations"))) return;
	const failedRows = await prisma.$queryRawUnsafe(
		`SELECT migration_name, logs
       FROM "_prisma_migrations"
      WHERE finished_at IS NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at ASC`,
	);
	if (failedRows.length === 0) return;
	const contracts = loadManualOperationRecoveryContracts(migrations);
	const recoverableRows = selectRecoverableManualOperationFailures(failedRows, contracts);
	for (const row of recoverableRows) {
		const migrationName = String(row.migration_name);
		if (!/^[0-9A-Za-z_-]+$/u.test(migrationName)) {
			throw new Error(`invalid migration name in failed migration recovery: ${migrationName}`);
		}
		console.log(
			`[migrate] resolving rolled-back deployment assertion for operator-managed migration: ${migrationName}`,
		);
		run(`npx prisma migrate resolve --rolled-back ${migrationName}`);
	}
}

async function getAppliedBaselineRepairNames(prisma) {
	if (!(await tableExists(prisma, BASELINE_REPAIR_STATE_TABLE))) return new Set();
	const rows = await prisma.$queryRawUnsafe(
		`SELECT migration_name FROM "_tapcanvas_baseline_repairs"`,
	);
	return new Set(rows.map((row) => String(row.migration_name)));
}

async function reconcileBaselineRepairs(prisma, migrations, state) {
	if (!state) return;
	const targetIndex = validateBaselineTarget(migrations, state.targetMigration);
	await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "_tapcanvas_baseline_repairs" (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
	const applied = await getAppliedBaselineRepairNames(prisma);
	for (const name of BASELINE_REPAIR_MIGRATIONS) {
		const migrationIndex = migrations.indexOf(name);
		if (migrationIndex < 0) {
			throw new Error(`baseline repair migration is not present in this image: ${name}`);
		}
		if (migrationIndex > targetIndex) {
			console.log(
				`[migrate] baseline repair is outside the recorded baseline range (left for normal deploy): ${name}`,
			);
			continue;
		}
		if (applied.has(name)) {
			console.log(`[migrate] baseline repair already applied (skipped): ${name}`);
			continue;
		}
		const migrationFile = path.join(MIGRATIONS_DIR, name, "migration.sql");
		if (!fs.existsSync(migrationFile)) {
			throw new Error(`baseline repair SQL missing: ${migrationFile}`);
		}
		run(`npx prisma db execute --file "${migrationFile}" --schema prisma/schema.prisma`);
		await prisma.$executeRawUnsafe(
			`INSERT INTO "_tapcanvas_baseline_repairs" (migration_name) VALUES ($1)`,
			name,
		);
		applied.add(name);
		console.log(`[migrate] applied baseline schema repair: ${name}`);
	}
}

function validateBaselineTarget(migrations, targetMigration) {
	const targetIndex = migrations.indexOf(targetMigration);
	if (targetIndex < 0) {
		throw new Error(`baseline target is not present in this image: ${targetMigration}`);
	}
	return targetIndex;
}

async function baseline(prisma, migrations, targetMigration) {
	if (migrations.length === 0) {
		console.log("[migrate] no migrations to baseline");
		return;
	}
	const targetIndex = validateBaselineTarget(migrations, targetMigration);
	const migrationsToBaseline = migrations.slice(0, targetIndex + 1);
	const recorded = await getRecordedMigrationNames(prisma);
	console.log(
		`[migrate] baselining ${migrationsToBaseline.length} migration(s) through ${targetMigration}`,
	);
	for (const name of migrationsToBaseline) {
		if (recorded.has(name)) {
			console.log(`[migrate] already recorded (skipped): ${name}`);
			continue;
		}
		if (REQUIRED_EXISTING_DATABASE_MIGRATIONS.has(name)) {
			const migrationFile = path.join(MIGRATIONS_DIR, name, "migration.sql");
			if (!fs.existsSync(migrationFile)) {
				throw new Error(`required migration SQL missing: ${migrationFile}`);
			}
			run(`npx prisma db execute --file "${migrationFile}" --schema prisma/schema.prisma`);
			console.log(`[migrate] applied required existing-database migration: ${name}`);
		}
		run(`npx prisma migrate resolve --applied ${name}`);
		recorded.add(name);
		console.log(`[migrate] baselined: ${name}`);
	}
}

async function resumeBaseline(prisma, migrations, state) {
	if (!state || state.status !== "in_progress") return false;
	console.log(`[migrate] resuming interrupted baseline through ${state.targetMigration}`);
	await baseline(prisma, migrations, state.targetMigration);
	await completeBaseline(prisma, state.targetMigration);
	console.log(`[migrate] baseline completed through ${state.targetMigration}`);
	return true;
}

async function main() {
	const migrations = getMigrationNames();
	const prisma = new PrismaClient();
	try {
		const forcedResumeTarget = String(process.env.PRISMA_BASELINE_RESUME_TARGET || "").trim();
		if (forcedResumeTarget) {
			validateBaselineTarget(migrations, forcedResumeTarget);
			const existingState = await loadBaselineState(prisma);
			if (
				existingState &&
				existingState.status === "in_progress" &&
				existingState.targetMigration !== forcedResumeTarget
			) {
				throw new Error(
					`refusing to replace in-progress baseline target ${existingState.targetMigration} with ${forcedResumeTarget}`,
				);
			}
			if (!existingState || existingState.status !== "completed") {
				await beginBaseline(prisma, forcedResumeTarget);
				console.log(`[migrate] explicit baseline recovery target accepted: ${forcedResumeTarget}`);
			} else if (existingState.targetMigration !== forcedResumeTarget) {
				throw new Error(
					`completed baseline target ${existingState.targetMigration} conflicts with requested recovery target ${forcedResumeTarget}`,
				);
			}
		}

		let baselineState = await loadBaselineState(prisma);
		await reconcileBaselineRepairs(prisma, migrations, baselineState);
		const resumed = await resumeBaseline(prisma, migrations, baselineState);
		if (resumed) console.log("[migrate] retrying prisma migrate deploy after baseline recovery");
		await reconcileFailedManualOperationMigrations(prisma, migrations);

		console.log("[migrate] running prisma migrate deploy");
		const ok = deploy();
		if (!ok) {
			if (migrations.length === 0) {
				throw new Error("P3005 cannot be resolved because the image contains no migrations");
			}
			const targetMigration = migrations[migrations.length - 1];
			console.log(`[migrate] P3005 detected — starting durable baseline through ${targetMigration}`);
			await beginBaseline(prisma, targetMigration);
			baselineState = await loadBaselineState(prisma);
			await reconcileBaselineRepairs(prisma, migrations, baselineState);
			await baseline(prisma, migrations, targetMigration);
			await completeBaseline(prisma, targetMigration);
			console.log("[migrate] retrying prisma migrate deploy");
			if (!deploy()) throw new Error("prisma migrate deploy still reports P3005 after baseline");
		}
		console.log("[migrate] done");
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[migrate] failed:", error);
	process.exit(1);
});
