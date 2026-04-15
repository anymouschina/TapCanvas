#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function readSchemaSql() {
	const candidates = [
		path.resolve(process.cwd(), "schema.sql"),
		path.resolve(process.cwd(), "apps/hono-api/schema.sql"),
		path.resolve(process.cwd(), "../hono-api/schema.sql"),
	];
	for (const p of candidates) {
		if (!fs.existsSync(p)) continue;
		const raw = fs.readFileSync(p, "utf8");
		if (raw.trim()) return raw;
	}
	throw new Error("schema.sql not found");
}

function normalizeSqliteSchemaForPostgres(sql) {
	const noComment = sql
		.split("\n")
		.filter((line) => !line.trim().startsWith("--"))
		.join("\n");
	const normalized = noComment
		.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, "BIGSERIAL PRIMARY KEY")
		.replace(/AUTOINCREMENT/gi, "")
		.replace(/\bPRAGMA\b[^;]*;/gi, "");
	return normalized
		.split(";")
		.map((stmt) => stmt.trim())
		.filter((stmt) => stmt.length > 0);
}

function isUnsafeStatement(stmt) {
	const s = stmt.trim().toUpperCase();
	if (!s) return false;
	if (/\bDROP\s+(TABLE|INDEX|SCHEMA|DATABASE|COLUMN)\b/.test(s)) return true;
	if (/\bTRUNCATE\b/.test(s)) return true;
	if (/\bDELETE\s+FROM\b/.test(s)) return true;
	if (/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/.test(s)) return true;
	return false;
}

function isAllowedStatement(stmt) {
	const s = stmt.trim();
	return (
		/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(s) ||
		/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+/i.test(s) ||
		/^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN(\s+IF\s+NOT\s+EXISTS)?\s+/i.test(s)
	);
}

function validateStatements(statements) {
	for (const stmt of statements) {
		if (isUnsafeStatement(stmt)) {
			throw new Error(`Unsafe schema statement detected and blocked: ${stmt}`);
		}
		if (!isAllowedStatement(stmt)) {
			throw new Error(
				`Unsupported schema statement for safe deploy (only CREATE/ADD COLUMN allowed): ${stmt}`,
			);
		}
	}
}

async function main() {
	if (!String(process.env.DATABASE_URL || "").trim()) {
		throw new Error("DATABASE_URL is required for Postgres schema bootstrap");
	}
	const prisma = new PrismaClient();
	const statements = normalizeSqliteSchemaForPostgres(readSchemaSql());
	validateStatements(statements);
	try {
		await prisma.$transaction(async (tx) => {
			for (const stmt of statements) {
				await tx.$executeRawUnsafe(stmt);
			}
		});
		console.log(`[db] postgres schema ready, statements=${statements.length}`);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error("[db] bootstrap-postgres-schema failed:", error);
	process.exit(1);
});
