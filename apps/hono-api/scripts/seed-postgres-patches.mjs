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

function isAllowedNonOverwriteInsert(stmt) {
	const s = stmt.trim();
	return (
		/^INSERT\s+INTO\s+/i.test(s) &&
		/\bON\s+CONFLICT\b/i.test(s) &&
		/\bDO\s+NOTHING\b/i.test(s)
	);
}

function validatePatchStatements(filePath, statements) {
	for (const stmt of statements) {
		if (isUnsafeStatement(stmt) && !isAllowedModelCatalogMetaUpdate(stmt)) {
			throw new Error(`[seed] unsafe patch statement blocked in ${filePath}: ${stmt}`);
		}
		if (!isAllowedNonOverwriteInsert(stmt) && !isAllowedModelCatalogMetaUpdate(stmt)) {
			throw new Error(
				`[seed] unsupported patch statement in ${filePath}; only INSERT ... ON CONFLICT DO NOTHING or guarded UPDATE model_catalog_models(meta, updated_at) ... WHERE model_key IN (...) is allowed: ${stmt}`,
			);
		}
	}
}

async function executePatchFile(prisma, filePath) {
	const raw = fs.readFileSync(filePath, "utf8");
	if (!raw.trim()) {
		console.log(`[seed] skip empty patch: ${path.basename(filePath)}`);
		return { file: filePath, statements: 0 };
	}
	const statements = normalizePatchStatements(raw);
	validatePatchStatements(filePath, statements);
	if (statements.length === 0) {
		console.log(`[seed] skip no-op patch: ${path.basename(filePath)}`);
		return { file: filePath, statements: 0 };
	}
	await prisma.$transaction(async (tx) => {
		for (const stmt of statements) {
			await tx.$executeRawUnsafe(stmt);
		}
	});
	console.log(
		`[seed] applied patch: ${path.basename(filePath)} statements=${statements.length}`,
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
		for (const filePath of files) {
			const result = await executePatchFile(prisma, filePath);
			totalStatements += result.statements;
		}
		console.log(
			`[seed] postgres seed patches ready, files=${files.length}, statements=${totalStatements}`,
		);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[seed] seed-postgres-patches failed:", error);
	process.exit(1);
});
