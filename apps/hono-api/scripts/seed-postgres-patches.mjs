#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function resolvePatchDir() {
	const candidates = [
		path.resolve(process.cwd(), "sql/patch"),
		path.resolve(process.cwd(), "../sql/patch"),
		path.resolve(process.cwd(), "../../sql/patch"),
		path.resolve(process.cwd(), "apps/hono-api/sql/patch"),
		path.resolve(process.cwd(), "apps/hono-api/../../sql/patch"),
	];
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) continue;
		if (!fs.statSync(candidate).isDirectory()) continue;
		return candidate;
	}
	return null;
}

function listPatchFiles(dir) {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".sql"))
		.map((entry) => path.join(dir, entry.name))
		.sort((a, b) => a.localeCompare(b));
}

function stripSqlComments(sql) {
	return sql
		.split("\n")
		.filter((line) => !line.trim().startsWith("--"))
		.join("\n");
}

function normalizePatchStatements(sql) {
	return stripSqlComments(sql)
		.split(";")
		.map((stmt) => stmt.trim())
		.filter((stmt) => stmt.length > 0)
		.filter((stmt) => !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmt));
}

function isUnsafeStatement(stmt) {
	const s = stmt.trim().toUpperCase();
	if (!s) return false;
	return (
		/\bDROP\s+(TABLE|INDEX|SCHEMA|DATABASE|COLUMN)\b/.test(s) ||
		/\bTRUNCATE\b/.test(s) ||
		/\bDELETE\s+FROM\b/.test(s) ||
		/\bUPDATE\b/.test(s) ||
		/\bALTER\s+TABLE\b/.test(s) ||
		/\bCREATE\s+(TABLE|INDEX|SCHEMA|DATABASE)\b/.test(s)
	);
}

function normalizeSqlForGuard(stmt) {
	return stmt.replace(/\s+/g, " ").trim();
}

function isUniqueViolation(error) {
	let current = error;
	for (let depth = 0; current && depth < 8; depth += 1) {
		if (current?.code === "23505" || current?.meta?.code === "23505") return true;
		current = current?.cause;
	}
	return false;
}

function isAllowedModelCatalogMetaUpdate(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^UPDATE\s+model_catalog_models\s+/i.test(normalized)) return false;
	if (!/\bSET\b/i.test(normalized)) return false;
	if (!/\bWHERE\s+model_key\s+IN\s*\(/i.test(normalized)) return false;
	return (
		/\bSET\s+meta\s*=\s*CASE\b[\s\S]*\bEND\s*,\s*updated_at\s*=/i.test(normalized) ||
		/\bSET\s+updated_at\s*=\s*[^,]+,\s*meta\s*=\s*CASE\b[\s\S]*\bEND\b/i.test(normalized)
	);
}

function isAllowedModelCatalogMappingUpsert(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^INSERT\s+INTO\s+model_catalog_mappings\s+/i.test(normalized)) return false;
	if (
		!/\bON\s+CONFLICT\s*\(\s*vendor_key\s*,\s*task_kind\s*,\s*name\s*\)\s+DO\s+UPDATE\s+SET\b/i.test(
			normalized,
		)
	) {
		return false;
	}
	return (
		/\brequest_mapping\s*=\s*EXCLUDED\.request_mapping\b/i.test(normalized) &&
		/\bresponse_mapping\s*=\s*EXCLUDED\.response_mapping\b/i.test(normalized) &&
		/\bupdated_at\s*=\s*EXCLUDED\.updated_at\b/i.test(normalized)
	);
}

function isAllowedNonOverwriteInsert(stmt) {
	const s = stmt.trim();
	return (
		/^INSERT\s+INTO\s+/i.test(s) &&
		/\bON\s+CONFLICT\b/i.test(s) &&
		/\bDO\s+NOTHING\b/i.test(s)
	);
}

function isAllowedAddColumnIfNotExists(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	return /^ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+/i.test(normalized);
}

// Allows: UPDATE model_credit_costs SET cost = <int>, updated_at = ... WHERE model_key = '...'
function isAllowedCreditCostUpdate(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^UPDATE\s+model_credit_costs\s+SET\s+/i.test(normalized)) return false;
	if (!/\bWHERE\s+model_key\s*=\s*'/i.test(normalized)) return false;
	const setClause = normalized.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i)?.[1] ?? "";
	return /\bcost\s*=\s*\d+/i.test(setClause) && /\bupdated_at\s*=/i.test(setClause);
}

// Allows: INSERT INTO model_credit_cost_specs ... ON CONFLICT (model_key, spec_key) DO UPDATE SET cost = EXCLUDED.cost, updated_at = EXCLUDED.updated_at
function isAllowedCreditCostSpecUpsert(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^INSERT\s+INTO\s+model_credit_cost_specs\s+/i.test(normalized)) return false;
	if (!/\bON\s+CONFLICT\s*\(\s*model_key\s*,\s*spec_key\s*\)\s+DO\s+UPDATE\s+SET\b/i.test(normalized)) return false;
	return (
		/\bcost\s*=\s*EXCLUDED\.cost\b/i.test(normalized) &&
		/\bupdated_at\s*=\s*EXCLUDED\.updated_at\b/i.test(normalized)
	);
}

// Allows: UPDATE llm_node_presets SET meta = '...', updated_at = '...' WHERE meta->>'styleId' = 'sXX' AND scope = 'base'
function isAllowedStyleReferenceCardUpdate(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^UPDATE\s+llm_node_presets\s+SET\s+/i.test(normalized)) return false;
	if (!/\bWHERE\s+\(meta::jsonb\)\s*->>\s*'styleId'\s*=\s*'s\d+'\s+AND\s+scope\s*=\s*'base'/i.test(normalized)) return false;
	const setClause = normalized.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i)?.[1] ?? "";
	return /\bmeta\s*=/i.test(setClause) && /\bupdated_at\s*=/i.test(setClause);
}

// Allows: UPDATE model_catalog_vendors SET enabled = <val>[, name = '...'][, updated_at = '...'] WHERE key IN (...)
function isAllowedModelCatalogVendorUpdate(stmt) {
	const normalized = normalizeSqlForGuard(stmt);
	if (!/^UPDATE\s+model_catalog_vendors\s+SET\s+/i.test(normalized)) return false;
	if (!/\bWHERE\s+key\s+IN\s*\(/i.test(normalized)) return false;
	// Only allow setting enabled, name, updated_at columns
	const setClause = normalized.match(/\bSET\s+([\s\S]+?)\s+WHERE\b/i)?.[1] ?? "";
	if (!/\benabled\s*=/i.test(setClause)) return false;
	const allowedCols = /^(\s*(enabled|name|updated_at)\s*=\s*[^,]+\s*,?\s*)+$/i.test(setClause);
	return allowedCols;
}

function validatePatchStatements(filePath, statements) {
	for (const stmt of statements) {
		if (
			isUnsafeStatement(stmt) &&
			!isAllowedModelCatalogMetaUpdate(stmt) &&
			!isAllowedModelCatalogMappingUpsert(stmt) &&
			!isAllowedAddColumnIfNotExists(stmt) &&
			!isAllowedModelCatalogVendorUpdate(stmt) &&
			!isAllowedCreditCostUpdate(stmt) &&
			!isAllowedCreditCostSpecUpsert(stmt) &&
			!isAllowedStyleReferenceCardUpdate(stmt)
		) {
			throw new Error(`[seed] unsafe patch statement blocked in ${filePath}: ${stmt}`);
		}
		if (
			!isAllowedNonOverwriteInsert(stmt) &&
			!isAllowedModelCatalogMetaUpdate(stmt) &&
			!isAllowedModelCatalogMappingUpsert(stmt) &&
			!isAllowedAddColumnIfNotExists(stmt) &&
			!isAllowedModelCatalogVendorUpdate(stmt) &&
			!isAllowedCreditCostUpdate(stmt) &&
			!isAllowedCreditCostSpecUpsert(stmt) &&
			!isAllowedStyleReferenceCardUpdate(stmt)
		) {
			throw new Error(
				`[seed] unsupported patch statement in ${filePath}; only INSERT ... ON CONFLICT DO NOTHING, guarded UPDATE model_catalog_models(meta, updated_at) ... WHERE model_key IN (...), guarded UPSERT model_catalog_mappings(request_mapping, response_mapping, updated_at), guarded UPDATE model_catalog_vendors(enabled, name, updated_at) ... WHERE key IN (...), ALTER TABLE ... ADD COLUMN IF NOT EXISTS, guarded UPDATE model_credit_costs(cost, updated_at) ... WHERE model_key = '...', or guarded UPSERT model_credit_cost_specs(cost, updated_at) ON CONFLICT (model_key, spec_key) DO UPDATE is allowed: ${stmt}`,
			);
		}
	}
}

async function executePatchFile(prisma, filePath) {
	const raw = fs.readFileSync(filePath, "utf8");
	const patchName = path.basename(filePath);
	if (!raw.trim()) {
		console.log(`[seed] skip empty patch: ${patchName}`);
		return { file: filePath, statements: 0 };
	}
	const statements = normalizePatchStatements(raw);
	validatePatchStatements(filePath, statements);
	if (statements.length === 0) {
		console.log(`[seed] skip no-op patch: ${patchName}`);
		return { file: filePath, statements: 0 };
	}
	console.log(`[seed] apply patch: ${patchName} statements=${statements.length}`);
	try {
		await prisma.$transaction(async (tx) => {
			// Multiple deployment runners may share one PostgreSQL database. Serialize
			// each patch transaction so concurrent catalog syncs cannot race a patch.
			await tx.$executeRawUnsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended('tapcanvas:seed-postgres-patches', 0))",
			);
			for (const [index, stmt] of statements.entries()) {
				try {
					await tx.$executeRawUnsafe(stmt);
				} catch (error) {
					const statementPreview = normalizeSqlForGuard(stmt).slice(0, 240);
					throw new Error(
						`statement ${index + 1}/${statements.length} failed in ${patchName}: ${statementPreview}`,
						{ cause: error },
					);
				}
			}
		}
		);
	} catch (error) {
		if (isUniqueViolation(error)) {
			console.warn(
				`[seed] skipped conflicting patch: ${patchName} (transaction rolled back; no existing row was overwritten)`,
			);
			return { file: filePath, statements: statements.length, skippedConflict: true };
		}
		throw new Error(`patch execution failed: ${patchName}`, { cause: error });
	}
	console.log(
		`[seed] applied patch: ${patchName} statements=${statements.length}`,
	);
	return { file: filePath, statements: statements.length };
}

async function main() {
	if (!String(process.env.DATABASE_URL || "").trim()) {
		throw new Error("DATABASE_URL is required for Postgres seed patches");
	}
	const patchDir = resolvePatchDir();
	if (!patchDir) {
		console.log("[seed] sql/patch directory not found, skip");
		return;
	}
	const files = listPatchFiles(patchDir);
	if (files.length === 0) {
		console.log("[seed] no sql patch files found, skip");
		return;
	}

	const prisma = new PrismaClient();
	try {
		let totalStatements = 0;
		let skippedConflicts = 0;
		for (const filePath of files) {
			const result = await executePatchFile(prisma, filePath);
			totalStatements += result.statements;
			if (result.skippedConflict) skippedConflicts += 1;
		}
		console.log(
			`[seed] postgres seed patches ready, files=${files.length}, statements=${totalStatements}, skipped_conflicts=${skippedConflicts}`,
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[seed] seed-postgres-patches failed:", error);
	process.exit(1);
});
