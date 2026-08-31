#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(process.cwd());
const stateRoot = path.resolve(
	String(process.env.TAPCANVAS_STARTUP_STATE_DIR || path.join(projectRoot, ".tapcanvas-startup")),
);
const registry = String(
	process.env.NPM_REGISTRY ||
		process.env.NPM_CONFIG_REGISTRY ||
		"https://registry.npmmirror.com",
).trim();
const forceReconcile = String(
	process.env.TAPCANVAS_STARTUP_FORCE_RECONCILE || "",
).trim() === "1";

function elapsedMs(startedAt) {
	return Date.now() - startedAt;
}

function run(label, command, args) {
	const startedAt = Date.now();
	console.log(`[startup] ${label}: start`);
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		env: process.env,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
	}
	console.log(`[startup] ${label}: done in ${elapsedMs(startedAt)}ms`);
}

function collectPath(hash, targetPath) {
	const absolutePath = path.resolve(projectRoot, targetPath);
	const relativePath = path.relative(projectRoot, absolutePath) || ".";
	if (!fs.existsSync(absolutePath)) {
		hash.update(`missing\0${relativePath}\0`);
		return;
	}
	const stat = fs.lstatSync(absolutePath);
	if (stat.isSymbolicLink()) {
		hash.update(`symlink\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
		return;
	}
	if (stat.isDirectory()) {
		hash.update(`directory\0${relativePath}\0`);
		for (const entry of fs.readdirSync(absolutePath).sort()) {
			collectPath(hash, path.join(absolutePath, entry));
		}
		return;
	}
	if (!stat.isFile()) {
		hash.update(`other\0${relativePath}\0${stat.mode}\0`);
		return;
	}
	hash.update(`file\0${relativePath}\0${stat.size}\0`);
	hash.update(fs.readFileSync(absolutePath));
	hash.update("\0");
}

function fingerprint(paths, facts = {}) {
	const hash = crypto.createHash("sha256");
	hash.update("tapcanvas-hono-startup-v1\0");
	for (const targetPath of [...paths].sort()) collectPath(hash, targetPath);
	for (const [key, value] of Object.entries(facts).sort(([left], [right]) =>
		left.localeCompare(right))) {
		hash.update(`fact\0${key}\0${String(value)}\0`);
	}
	return hash.digest("hex");
}

function stampPath(name) {
	return path.join(stateRoot, `${name}.sha256`);
}

function readStamp(name) {
	try {
		return fs.readFileSync(stampPath(name), "utf8").trim() || null;
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") return null;
		throw error;
	}
}

function writeStamp(name, value) {
	fs.mkdirSync(stateRoot, { recursive: true });
	const target = stampPath(name);
	const temporary = `${target}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${value}\n`, "utf8");
	fs.renameSync(temporary, target);
}

function readPackageJson() {
	const raw = fs.readFileSync(path.join(projectRoot, "package.json"), "utf8");
	const parsed = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("package.json must contain an object");
	}
	return parsed;
}

function missingInstalledPackages(packageJson) {
	const dependencyNames = [
		...Object.keys(packageJson.dependencies || {}),
		...Object.keys(packageJson.devDependencies || {}),
	].sort();
	return dependencyNames.filter((name) =>
		!fs.existsSync(path.join(projectRoot, "node_modules", name, "package.json")));
}

function prepareDependencies() {
	const packageJson = readPackageJson();
	const dependencyFingerprint = fingerprint(
		["package.json", "pnpm-lock.yaml"],
		{ node: process.version, platform: process.platform, arch: process.arch },
	);
	const previousFingerprint = readStamp("dependencies");
	const missingBefore = missingInstalledPackages(packageJson);

	if (previousFingerprint === dependencyFingerprint && missingBefore.length === 0) {
		console.log("[startup] dependencies: unchanged");
		return false;
	}

	if (previousFingerprint === null && missingBefore.length === 0) {
		writeStamp("dependencies", dependencyFingerprint);
		console.log("[startup] dependencies: adopted existing verified installation");
		return false;
	}

	run("dependencies", "pnpm", [
		"install",
		"--child-concurrency=1",
		"--network-concurrency=1",
		"--registry",
		registry,
		"--no-frozen-lockfile",
	]);
	const missingAfter = missingInstalledPackages(packageJson);
	if (missingAfter.length > 0) {
		throw new Error(`dependencies missing after install: ${missingAfter.join(", ")}`);
	}
	writeStamp("dependencies", dependencyFingerprint);
	return true;
}

function prepareDatabaseAndCatalog() {
	const databaseFingerprint = fingerprint(
		[
			"schema.sql",
			"prisma/schema.prisma",
			"prisma/migrations",
			"sql/patch",
			"scripts/backup-postgres.mjs",
			"scripts/bootstrap-postgres-schema.mjs",
			"scripts/migrate-deploy.mjs",
			"scripts/seed-postgres-patches.mjs",
			"scripts/sync-system-skills.mjs",
			"scripts/sync-system-knowledge.mjs",
			"scripts/lib/system-knowledge-sync.mjs",
			"/apps/agents-cli/knowledge",
			"scripts/sync-skill-marketplace.mjs",
			"marketplace-skills",
			"scripts/sync-new-api-catalog.mjs",
		],
		{
			databaseUrl: process.env.DATABASE_URL || "",
			newApiSqlDsn: process.env.NEW_API_SQL_DSN || "",
		},
	);
	if (!forceReconcile && readStamp("database") === databaseFingerprint) {
		console.log("[startup] database/catalog: unchanged");
		return false;
	}

	run("Prisma client generation", "pnpm", ["prisma:generate"]);
	run("database schema bootstrap", "pnpm", ["db:pg:schema"]);
	run("database migrations", "pnpm", ["db:pg:migrate"]);
	run("database seed patches", "pnpm", ["db:pg:seed-patches"]);
	run("System Skill sync", "pnpm", ["sync:system-skills", "--apply"]);
	run("System knowledge sync", "pnpm", ["sync:system-knowledge"]);
	run("Skill marketplace sync", "pnpm", ["sync:skill-marketplace:apply"]);
	run("New API catalog sync", "pnpm", ["sync:new-api:catalog"]);
	writeStamp("database", databaseFingerprint);
	return true;
}

function prepareBuild() {
	const buildFingerprint = fingerprint([
		"src",
		"scripts/build.mjs",
		"scripts/codex-remote-builder.ts",
		"scripts/async-image-worker.ts",
		"package.json",
		"tsconfig.json",
		"tsconfig.base.json",
	]);
	const outputPaths = [
		path.join(projectRoot, "dist", "main.js"),
		path.join(projectRoot, "dist", "codex-remote-builder.js"),
		path.join(projectRoot, "dist", "async-image-worker.js"),
	];
	if (
		!forceReconcile &&
		readStamp("build") === buildFingerprint &&
		outputPaths.every((outputPath) => fs.existsSync(outputPath))
	) {
		console.log("[startup] build: unchanged");
		return false;
	}
	run("API build", "pnpm", ["build"]);
	const missingOutputs = outputPaths.filter(
		(outputPath) => !fs.existsSync(outputPath),
	);
	if (missingOutputs.length > 0) {
		throw new Error(
			`API build did not create required outputs: ${missingOutputs
				.map((outputPath) => path.relative(projectRoot, outputPath))
				.join(", ")}`,
		);
	}
	writeStamp("build", buildFingerprint);
	return true;
}

function main() {
	const startedAt = Date.now();
	fs.mkdirSync(stateRoot, { recursive: true });
	console.log(`[startup] prepare begin${forceReconcile ? " (forced reconcile)" : ""}`);
	const dependenciesChanged = prepareDependencies();
	const databaseChanged = prepareDatabaseAndCatalog();
	if (!databaseChanged) {
		run("System Skill sync", "pnpm", ["sync:system-skills", "--apply"]);
		run("System knowledge sync", "pnpm", ["sync:system-knowledge"]);
	}
	if (!databaseChanged && dependenciesChanged) {
		run("Prisma client generation", "pnpm", ["prisma:generate"]);
	}
	prepareBuild();
	console.log(`[startup] prepare complete in ${elapsedMs(startedAt)}ms`);
}

try {
	main();
} catch (error) {
	console.error("[startup] prepare failed:", error);
	process.exit(1);
}
