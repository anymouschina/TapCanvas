import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";

type DreaminaRunResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export type DreaminaRunOptions = {
	c: AppContext;
	cliPath: string | null;
	sessionRoot: string;
	args: string[];
	stdinText?: string;
	timeoutMs?: number;
};

export function sanitizePathSegment(value: string): string {
	return String(value || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function buildDreaminaSessionRoot(
	userId: string,
	accountId: string,
): string {
	return path.join(
		process.cwd(),
		"project-data",
		"users",
		sanitizePathSegment(userId),
		"integrations",
		"dreamina",
		"accounts",
		sanitizePathSegment(accountId),
	);
}

async function ensureSessionDirs(sessionRoot: string): Promise<{
	homeDir: string;
	configDir: string;
	cacheDir: string;
	tmpDir: string;
}> {
	const homeDir = path.join(sessionRoot, "home");
	const configDir = path.join(sessionRoot, "xdg-config");
	const cacheDir = path.join(sessionRoot, "xdg-cache");
	const tmpDir = path.join(sessionRoot, "tmp");
	await Promise.all([
		fs.mkdir(homeDir, { recursive: true }),
		fs.mkdir(configDir, { recursive: true }),
		fs.mkdir(cacheDir, { recursive: true }),
		fs.mkdir(tmpDir, { recursive: true }),
	]);
	return { homeDir, configDir, cacheDir, tmpDir };
}

function resolveDreaminaCliPath(inputCliPath: string | null): string {
	const explicit = String(inputCliPath || "").trim();
	if (explicit) return explicit;
	const envPath = String(process.env.DREAMINA_CLI_PATH || "").trim();
	return envPath || "dreamina";
}

export async function runDreaminaCli(
	input: DreaminaRunOptions,
): Promise<DreaminaRunResult> {
	const cliPath = resolveDreaminaCliPath(input.cliPath);
	const timeoutMs = Math.max(
		1000,
		Math.min(300_000, Number(input.timeoutMs || 60_000)),
	);
	const dirs = await ensureSessionDirs(input.sessionRoot);

	return await new Promise<DreaminaRunResult>((resolve, reject) => {
		const child = spawn(cliPath, input.args, {
			cwd: dirs.homeDir,
			env: {
				...process.env,
				HOME: dirs.homeDir,
				XDG_CONFIG_HOME: dirs.configDir,
				XDG_CACHE_HOME: dirs.cacheDir,
				TMPDIR: dirs.tmpDir,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			if (settled) return;
			settled = true;
			reject(
				new AppError("Dreamina CLI 执行超时", {
					status: 504,
					code: "dreamina_cli_timeout",
					details: { args: input.args, timeoutMs },
				}),
			);
		}, timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk || "");
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk || "");
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			reject(
				new AppError(`Dreamina CLI 启动失败：${String(error.message || error)}`, {
					status: 500,
					code: "dreamina_cli_spawn_failed",
					details: { cliPath, args: input.args },
				}),
			);
		});
		child.on("exit", (exitCode) => {
			clearTimeout(timer);
			if (settled) return;
			settled = true;
			resolve({
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				exitCode: Number(exitCode ?? -1),
			});
		});

		if (input.stdinText) child.stdin.write(input.stdinText);
		child.stdin.end();
	});
}
