#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

const BATCH_SIZE = 200;

function findWorkspaceRoot(startDir) {
	let dir = path.resolve(startDir || process.cwd());
	for (let i = 0; i < 30; i += 1) {
		if (fs.existsSync(path.resolve(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = path.dirname(dir);
		if (!parent || parent === dir) break;
		dir = parent;
	}
	return null;
}

function resolveSqlitePath() {
	const raw =
		(process.env.TAPCANVAS_DB_PATH || "").trim() ||
		(process.env.SQLITE_DB_PATH || "").trim();
	if (raw) return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
	const workspaceRoot = findWorkspaceRoot(process.cwd());
	return path.resolve(workspaceRoot || process.cwd(), ".data", "tapcanvas.sqlite");
}

function quoteIdent(ident) {
	return `"${String(ident).replace(/"/g, "\"\"")}"`;
}

async function tableExistsInPostgres(prisma, tableName) {
	const rows = await prisma.$queryRawUnsafe(
		`SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
		tableName,
	);
	return Array.isArray(rows) && rows.length > 0;
}

async function migrateTable({ sqlite, prisma, tableName }) {
	const pragmaStmt = sqlite.prepare(`PRAGMA table_info(${tableName})`);
	const pragmaRows = pragmaStmt.all();
	const columns = Array.isArray(pragmaRows)
		? pragmaRows.map((row) => String(row.name))
		: [];
	if (columns.length === 0) {
		console.warn(`[migrate] skip table without columns: ${tableName}`);
		return;
	}

	const selectSql = `SELECT * FROM ${quoteIdent(tableName)}`;
	const rows = sqlite.prepare(selectSql).all();
	console.log(`[migrate] table=${tableName} rows=${rows.length}`);

	await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoteIdent(tableName)} RESTART IDENTITY CASCADE`);
	if (!rows.length) return;

	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const chunk = rows.slice(i, i + BATCH_SIZE);
		const values = [];
		const valuePlaceholders = [];
		for (let r = 0; r < chunk.length; r += 1) {
			const row = chunk[r];
			const placeholders = [];
			for (let c = 0; c < columns.length; c += 1) {
				values.push(row[columns[c]]);
				placeholders.push(`$${values.length}`);
			}
			valuePlaceholders.push(`(${placeholders.join(", ")})`);
		}
		const insertSql = `INSERT INTO ${quoteIdent(tableName)} (${columns
			.map(quoteIdent)
			.join(", ")}) VALUES ${valuePlaceholders.join(", ")}`;
		await prisma.$executeRawUnsafe(insertSql, ...values);
	}
}

async function main() {
	if (!String(process.env.DATABASE_URL || "").trim()) {
		throw new Error("DATABASE_URL is required for postgres migration");
	}
	const sqlitePath = resolveSqlitePath();
	if (!fs.existsSync(sqlitePath)) {
		throw new Error(`sqlite database not found: ${sqlitePath}`);
	}

	const sqlite = new DatabaseSync(sqlitePath, { readonly: true });
	const prisma = new PrismaClient();
	try {
		const tables = sqlite
			.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
			.all()
			.map((row) => String(row.name));
		for (const tableName of tables) {
			const exists = await tableExistsInPostgres(prisma, tableName);
			if (!exists) {
				console.warn(`[migrate] skip missing table in postgres: ${tableName}`);
				continue;
			}
			await migrateTable({ sqlite, prisma, tableName });
		}
		console.log(`[migrate] done, tables=${tables.length}`);
	} finally {
		await prisma.$disconnect();
		sqlite.close();
	}
}

main().catch((error) => {
	console.error("[migrate] sqlite->postgres failed:", error);
	process.exit(1);
});
