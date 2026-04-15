#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function ensureDatabaseUrl() {
	const url = String(process.env.DATABASE_URL || "").trim();
	if (!url) throw new Error("DATABASE_URL is required for postgres backup");
	return url;
}

function toPgDumpDatabaseUrl(databaseUrl) {
	let parsed;
	try {
		parsed = new URL(databaseUrl);
	} catch (error) {
		throw new Error(`Invalid DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`);
	}
	// Prisma may append `schema=public`, but pg_dump connection URI does not support it.
	parsed.searchParams.delete("schema");
	return parsed.toString();
}

function ensureBackupDir() {
	const dir = String(process.env.PG_BACKUP_DIR || "/app/backups").trim();
	if (!dir) throw new Error("PG_BACKUP_DIR is invalid");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function ensureRetentionCount() {
	const raw = String(process.env.PG_BACKUP_KEEP_LATEST || "1").trim();
	if (!/^\d+$/.test(raw)) {
		throw new Error("PG_BACKUP_KEEP_LATEST must be a non-negative integer");
	}
	return Number(raw);
}

function buildBackupFilePath(dir) {
	const now = new Date();
	const stamp = [
		now.getUTCFullYear(),
		String(now.getUTCMonth() + 1).padStart(2, "0"),
		String(now.getUTCDate()).padStart(2, "0"),
		"-",
		String(now.getUTCHours()).padStart(2, "0"),
		String(now.getUTCMinutes()).padStart(2, "0"),
		String(now.getUTCSeconds()).padStart(2, "0"),
	].join("");
	return path.join(dir, `predeploy-${stamp}.dump`);
}

async function runPgDump(databaseUrl, outFile) {
	await new Promise((resolve, reject) => {
		const child = spawn(
			"pg_dump",
			["--format=custom", "--no-owner", "--no-privileges", "--file", outFile, databaseUrl],
			{
				stdio: "inherit",
				env: process.env,
			},
		);
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`pg_dump exited with code ${code ?? "unknown"}`));
		});
	});
}

function listBackupFiles(dir) {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^predeploy-\d{8}-\d{6}\.dump$/.test(entry.name))
		.map((entry) => path.join(dir, entry.name))
		.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function pruneOldBackups(dir, keepLatest) {
	const backups = listBackupFiles(dir);
	const removable = backups.slice(keepLatest);
	for (const filePath of removable) {
		fs.rmSync(filePath);
		console.log(`[db] removed old backup: ${filePath}`);
	}
	console.log(`[db] backup retention: kept ${Math.min(backups.length, keepLatest)} of ${backups.length}`);
}

async function main() {
	const databaseUrl = ensureDatabaseUrl();
	const pgDumpDatabaseUrl = toPgDumpDatabaseUrl(databaseUrl);
	const backupDir = ensureBackupDir();
	const keepLatest = ensureRetentionCount();
	const outFile = buildBackupFilePath(backupDir);
	console.log(`[db] creating pre-deploy backup: ${outFile}`);
	await runPgDump(pgDumpDatabaseUrl, outFile);
	console.log(`[db] backup created: ${outFile}`);
	pruneOldBackups(backupDir, keepLatest);
}

main().catch((error) => {
	console.error("[db] backup-postgres failed:", error);
	process.exit(1);
});
