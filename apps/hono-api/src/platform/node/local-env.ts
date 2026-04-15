import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

function tryLoadEnvFile(filePath: string) {
	try {
		if (!fs.existsSync(filePath)) return;
		dotenv.config({ path: filePath });
	} catch {
		// best-effort only
	}
}

export function loadLocalEnvFiles(): void {
	const cwd = process.cwd();

	// Priority: apps/hono-api/.env -> apps/hono-api/.dev.vars
	tryLoadEnvFile(path.resolve(cwd, ".env"));
	tryLoadEnvFile(path.resolve(cwd, ".dev.vars"));

	// If started from repo root, also try nested paths.
	tryLoadEnvFile(path.resolve(cwd, "apps/hono-api/.env"));
	tryLoadEnvFile(path.resolve(cwd, "apps/hono-api/.dev.vars"));
}

