import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function isTruthyEnv(value: unknown): boolean {
	const v = String(value ?? "")
		.trim()
		.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isProductionEnv(): boolean {
	const raw = String(process.env.NODE_ENV || "")
		.trim()
		.toLowerCase();
	return raw === "production";
}

function shouldAutostartAgentsBridge(): boolean {
	const raw = typeof process.env.AGENTS_BRIDGE_AUTOSTART === "string" ? process.env.AGENTS_BRIDGE_AUTOSTART : "";
	const trimmed = raw.trim();
	if (trimmed) return isTruthyEnv(trimmed);
	// Default behavior: in non-production, autostart the bridge unless explicitly disabled.
	return !isProductionEnv();
}

function findRepoRoot(startDir: string): string | null {
	let dir = path.resolve(startDir);
	for (let i = 0; i < 12; i++) {
		if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function normalizeBaseUrl(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/\/+$/, "");
}

function readAgentsCliTapCanvasConfig(repoRoot: string): {
	tapcanvasApiKey?: string;
	tapcanvasApiBaseUrl?: string;
} {
	try {
		const p = path.join(repoRoot, "apps", "agents-cli", "agents.config.json");
		if (!fs.existsSync(p)) return {};
		const raw = fs.readFileSync(p, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const tapcanvasApiKey =
			typeof parsed.tapcanvasApiKey === "string" ? parsed.tapcanvasApiKey.trim() : "";
		const tapcanvasApiBaseUrl =
			typeof parsed.tapcanvasApiBaseUrl === "string"
				? parsed.tapcanvasApiBaseUrl.trim()
				: "";
		return {
			...(tapcanvasApiKey ? { tapcanvasApiKey } : {}),
			...(tapcanvasApiBaseUrl ? { tapcanvasApiBaseUrl } : {}),
		};
	} catch {
		return {};
	}
}

async function isHealthy(baseUrl: string): Promise<boolean> {
	try {
		const url = `${normalizeBaseUrl(baseUrl)}/health`;
		const res = await fetch(url, { method: "GET" });
		return res.ok;
	} catch {
		return false;
	}
}

async function waitForHealthy(
	baseUrl: string,
	timeoutMs: number,
	shouldAbort?: () => boolean,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (typeof shouldAbort === "function" && shouldAbort()) return false;
		if (await isHealthy(baseUrl)) return true;
		await new Promise((r) => setTimeout(r, 200));
	}
	return false;
}

export async function maybeAutostartAgentsBridge(): Promise<void> {
	if (!shouldAutostartAgentsBridge()) return;

	const existing = normalizeBaseUrl(process.env.AGENTS_BRIDGE_BASE_URL || "");
	if (existing) {
		// If a base URL is already configured, keep it only when healthy.
		// During node --watch restarts, the old bridge process may be gone while env is still present.
		if (await isHealthy(existing)) return;
		// eslint-disable-next-line no-console
		console.warn(`[api] configured agents bridge is unhealthy, restarting: ${existing}`);
		process.env.AGENTS_BRIDGE_BASE_URL = "";
	}

	const host = (process.env.AGENTS_BRIDGE_HOST || "127.0.0.1").trim() || "127.0.0.1";
	const portRaw = Number(process.env.AGENTS_BRIDGE_PORT || 8799);
	const port = Number.isFinite(portRaw) ? portRaw : 8799;
	const baseUrl = `http://${host}:${port}`;

	// If user already started `agents serve`, just bind to it.
	if (await isHealthy(baseUrl)) {
		process.env.AGENTS_BRIDGE_BASE_URL = baseUrl;
		// eslint-disable-next-line no-console
		console.log(`[api] agents bridge detected: ${baseUrl}`);
		return;
	}

	const repoRoot = findRepoRoot(process.cwd()) ?? findRepoRoot(path.resolve(__dirname, "..", "..", ".."));
	if (!repoRoot) {
		console.warn("[api] agents bridge autostart skipped: repo root not found");
		return;
	}

	const token = String(process.env.AGENTS_BRIDGE_TOKEN || "").trim();
	const bodyLimitBytesRaw = String(process.env.AGENTS_BRIDGE_BODY_LIMIT_BYTES || "").trim();
	const bodyLimitBytes = Number(bodyLimitBytesRaw);
	const cliTapConfig = readAgentsCliTapCanvasConfig(repoRoot);

	const skillsDir =
		typeof process.env.AGENTS_SKILLS_DIR === "string"
			? process.env.AGENTS_SKILLS_DIR.trim()
			: "";
	const defaultSkillsDir = path.join(repoRoot, "apps", "agents-cli", "skills");
	const childEnv = {
		...process.env,
		AGENTS_PROFILE: "code",
		...(process.env.TAPCANVAS_API_KEY
			? {}
			: cliTapConfig.tapcanvasApiKey
				? {
					TAPCANVAS_API_KEY: cliTapConfig.tapcanvasApiKey,
					tapcanvasApiKey: cliTapConfig.tapcanvasApiKey,
				}
				: {}),
		...(process.env.TAPCANVAS_API_BASE_URL
			? {}
			: cliTapConfig.tapcanvasApiBaseUrl
				? {
					TAPCANVAS_API_BASE_URL: cliTapConfig.tapcanvasApiBaseUrl,
					tapcanvasApiBaseUrl: cliTapConfig.tapcanvasApiBaseUrl,
				}
				: {}),
		...(skillsDir ? {} : { AGENTS_SKILLS_DIR: defaultSkillsDir }),
	};

	const args = [
		"--filter",
		"agents",
		"dev",
		"--",
		"serve",
		"--host",
		host,
		"--port",
		String(port),
		...(Number.isFinite(bodyLimitBytes) && bodyLimitBytes > 0
			? ["--body-limit", String(Math.trunc(bodyLimitBytes))]
			: []),
		...(token ? ["--token", token] : []),
	];

	// eslint-disable-next-line no-console
	console.log(`[api] starting agents bridge: pnpm ${args.join(" ")}`);

	const child = spawn("pnpm", args, {
		cwd: repoRoot,
		env: childEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let spawnFailed = false;
	child.once("error", (err) => {
		spawnFailed = true;
		console.warn("[api] agents bridge spawn error", err);
	});

	child.stdout?.on("data", (buf) => process.stdout.write(`[agents] ${String(buf)}`));
	child.stderr?.on("data", (buf) => process.stderr.write(`[agents] ${String(buf)}`));

	const killChild = () => {
		try {
			child.kill("SIGTERM");
		} catch {
			// ignore
		}
	};
	process.once("exit", killChild);
	process.once("SIGINT", killChild);
	process.once("SIGTERM", killChild);

	const ok = await waitForHealthy(baseUrl, 15_000, () => spawnFailed);
	if (!ok) {
		console.warn(
			`[api] agents bridge autostart failed (${spawnFailed ? "spawn_error" : "timeout"})`,
		);
		killChild();
		return;
	}

	process.env.AGENTS_BRIDGE_BASE_URL = baseUrl;
	// eslint-disable-next-line no-console
	console.log(`[api] agents bridge ready: ${baseUrl}`);
}
