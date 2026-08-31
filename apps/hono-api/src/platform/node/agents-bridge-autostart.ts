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
		// This checkout uses a pnpm lockfile without a root workspace manifest.
		// The bridge autostart only needs the repository root to locate the
		// agents package; requiring the optional workspace manifest made local
		// API startup silently skip the bridge and fall through to an occupied
		// SSH-forwarded port.
		if (
			fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
			(
				fs.existsSync(path.join(dir, "pnpm-lock.yaml")) &&
				fs.existsSync(path.join(dir, "apps", "agents-cli", "package.json"))
			)
		) return dir;
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

const DEEPSEEK_HARNESS_RUNTIME = "deepseek-harness";
const DEEPSEEK_HARNESS_PROFILE = "sdk";
const DEEPSEEK_HARNESS_UPSTREAM_VERSION = "0.1.2-alpha.2";

export function isDeepSeekHarnessHealthPayload(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const payload = value as Record<string, unknown>;
	return payload.ok === true
		&& payload.runtime === DEEPSEEK_HARNESS_RUNTIME
		&& payload.profile === DEEPSEEK_HARNESS_PROFILE
		&& payload.upstreamVersion === DEEPSEEK_HARNESS_UPSTREAM_VERSION;
}

export type LocalAgentsBridgeEndpoint = Readonly<{
	host: string;
	port: number;
	baseUrl: string;
}>;

/**
 * A configured bridge may be restarted by this process only when it is an
 * explicit loopback HTTP endpoint. Remote bridge ownership is external, and
 * silently replacing it with a local default port would change execution
 * identity and authorization semantics.
 */
export function parseLocalAgentsBridgeEndpoint(raw: string): LocalAgentsBridgeEndpoint | null {
	const normalized = normalizeBaseUrl(raw);
	if (!normalized) return null;
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:") return null;
	const loopback = parsed.hostname === "127.0.0.1"
		|| parsed.hostname === "localhost"
		|| parsed.hostname === "[::1]";
	if (!loopback || parsed.username || parsed.password || parsed.pathname !== "/"
		|| parsed.search || parsed.hash) return null;
	const port = parsed.port ? Number(parsed.port) : 80;
	if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
	return {
		host: parsed.hostname === "[::1]" ? "::1" : parsed.hostname,
		port,
		baseUrl: `http://${parsed.hostname}:${port}`,
	};
}

async function isHealthy(baseUrl: string): Promise<boolean> {
	try {
		const url = `${normalizeBaseUrl(baseUrl)}/health`;
		const res = await fetch(url, { method: "GET" });
		if (!res.ok) return false;
		const payload: unknown = await res.json();
		return isDeepSeekHarnessHealthPayload(payload);
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

export async function maybeAutostartAgentsBridge(
	options: Readonly<{ stabilityWindowMs?: number }> = {},
): Promise<void> {
	if (!shouldAutostartAgentsBridge()) return;

	const existing = normalizeBaseUrl(process.env.AGENTS_BRIDGE_BASE_URL || "");
	let configuredLocalEndpoint: LocalAgentsBridgeEndpoint | null = null;
	if (existing) {
		// If a base URL is already configured, keep it only when healthy.
		// During node --watch restarts, the old bridge process may be gone while env is still present.
		if (await isHealthy(existing)) {
			const stabilityWindowMs = Math.max(0, Math.floor(options.stabilityWindowMs ?? 0));
			if (stabilityWindowMs === 0) return;
			await new Promise((resolve) => setTimeout(resolve, stabilityWindowMs));
			if (await isHealthy(existing)) return;
		}
		configuredLocalEndpoint = parseLocalAgentsBridgeEndpoint(existing);
		if (!configuredLocalEndpoint) {
			throw new Error(`Configured remote agents bridge is unhealthy and cannot be locally restarted: ${existing}`);
		}
		// eslint-disable-next-line no-console
		console.warn(`[api] configured agents bridge is unhealthy, restarting: ${existing}`);
		process.env.AGENTS_BRIDGE_BASE_URL = "";
	}

	const configuredHost = String(process.env.AGENTS_BRIDGE_HOST || "").trim();
	const configuredPort = String(process.env.AGENTS_BRIDGE_PORT || "").trim();
	const host = configuredHost || configuredLocalEndpoint?.host || "127.0.0.1";
	const portRaw = Number(configuredPort || configuredLocalEndpoint?.port || 8799);
	const port = Number.isFinite(portRaw) ? portRaw : 8799;
	const baseUrl = `http://${host}:${port}`;

	// If the user already started the DeepSeek Harness bridge, bind to it.
	if (await isHealthy(baseUrl)) {
		process.env.AGENTS_BRIDGE_BASE_URL = baseUrl;
		// eslint-disable-next-line no-console
		console.log(`[api] DeepSeek Harness bridge detected: ${baseUrl}`);
		return;
	}

	const repoRoot = findRepoRoot(process.cwd()) ?? findRepoRoot(path.resolve(__dirname, "..", "..", ".."));
	if (!repoRoot) {
		throw new Error("Agents bridge autostart failed: repository root was not found");
	}

	const token = String(process.env.AGENTS_BRIDGE_TOKEN || "").trim();
	const bodyLimitBytesRaw = String(process.env.AGENTS_BRIDGE_BODY_LIMIT_BYTES || "").trim();
	const bodyLimitBytes = Number(bodyLimitBytesRaw);
	const skillsDir =
		typeof process.env.AGENTS_SKILLS_DIR === "string"
			? process.env.AGENTS_SKILLS_DIR.trim()
			: "";
	const defaultSkillsDir = path.join(repoRoot, "apps", "agents-cli", "skills");
	const childEnv = {
		...process.env,
		...(skillsDir ? {} : { AGENTS_SKILLS_DIR: defaultSkillsDir }),
	};

	const agentsCliDir = path.join(repoRoot, "apps", "agents-cli");
	const useBuiltBridge = fs.existsSync(path.join(agentsCliDir, "dist", "cli", "index.js"));
	const bridgeCommand = useBuiltBridge ? process.execPath : "pnpm";
	const bridgeCwd = useBuiltBridge ? agentsCliDir : repoRoot;
	const args = useBuiltBridge
		? [path.join(agentsCliDir, "dist", "cli", "index.js")]
		: ["--filter", "agents", "dev"];
	args.push(
		"serve",
		"--host",
		host,
		"--port",
		String(port),
		...(Number.isFinite(bodyLimitBytes) && bodyLimitBytes > 0
			? ["--body-limit", String(Math.trunc(bodyLimitBytes))]
			: []),
		...(token ? ["--token", token] : []),
	);

	// eslint-disable-next-line no-console
	console.log(`[api] starting DeepSeek Harness bridge: ${bridgeCommand} ${args.join(" ")}`);

	const child = spawn(bridgeCommand, args, {
		cwd: bridgeCwd,
		env: childEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let spawnFailed = false;
	child.once("error", (err) => {
		spawnFailed = true;
		console.warn("[api] agents bridge spawn error", err);
	});

	child.stdout?.on("data", (buf) => process.stdout.write(`[deepseek-harness] ${String(buf)}`));
	child.stderr?.on("data", (buf) => process.stderr.write(`[deepseek-harness] ${String(buf)}`));

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
		killChild();
		throw new Error(`Agents bridge autostart failed (${spawnFailed ? "spawn_error" : "timeout"}) at ${baseUrl}`);
	}

	process.env.AGENTS_BRIDGE_BASE_URL = baseUrl;
	// eslint-disable-next-line no-console
	console.log(`[api] DeepSeek Harness bridge ready: ${baseUrl}`);
}
