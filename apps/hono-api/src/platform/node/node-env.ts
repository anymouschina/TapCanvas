import fs from "node:fs";
import path from "node:path";

import { getPrismaClient } from "./prisma";
import { NodeDurableObjectNamespace } from "./node-durable";

import { ExecutionDO } from "../../modules/execution/execution.do";
import type { WorkerEnv } from "../../types";
import {
	recoverInterruptedWorkflowExecutions,
	resumeQueuedWorkflowNodes,
	resumeWaitingWorkflowNodes,
} from "../../modules/execution/execution.queue";
import { createRedisWorkflowNodeQueueProducer } from "../../modules/execution/execution.redis-queue";
import { createRemoteWorkflowRuntimeNamespace } from "./workflow-runtime-remote";

function readSchemaSql(): string {
	const candidates = [
		path.resolve(process.cwd(), "schema.sql"),
		path.resolve(process.cwd(), "apps/hono-api/schema.sql"),
		path.resolve(process.cwd(), "../hono-api/schema.sql"),
	];
	for (const p of candidates) {
		try {
			if (!fs.existsSync(p)) continue;
			const txt = fs.readFileSync(p, "utf-8");
			if (txt && txt.trim()) return txt;
		} catch {
			// ignore
		}
	}
	return "";
}

function normalizeSqliteSchemaForPostgres(sql: string): string[] {
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

function isUnsafeStatement(stmt: string): boolean {
	const s = stmt.trim().toUpperCase();
	if (!s) return false;
	if (/\bDROP\s+(TABLE|INDEX|SCHEMA|DATABASE|COLUMN)\b/.test(s)) return true;
	if (/\bTRUNCATE\b/.test(s)) return true;
	if (/\bDELETE\s+FROM\b/.test(s)) return true;
	if (/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/.test(s)) return true;
	return false;
}

function isAllowedStatement(stmt: string): boolean {
	const s = stmt.trim();
	return (
		/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(s) ||
		/^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+/i.test(s) ||
		/^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN(\s+IF\s+NOT\s+EXISTS)?\s+/i.test(s)
	);
}

function validateSafeSchemaStatements(statements: string[]): void {
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

async function initPostgresSchema(): Promise<void> {
	const schemaSql = readSchemaSql();
	if (!schemaSql) return;
	const prisma = getPrismaClient();
	const statements = normalizeSqliteSchemaForPostgres(schemaSql);
	validateSafeSchemaStatements(statements);
	for (const stmt of statements) {
		try {
			await prisma.$executeRawUnsafe(stmt);
		} catch (error) {
			throw new Error(
				`Failed to apply Postgres schema statement: ${stmt.slice(0, 120)}...; cause: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
}

async function createRuntimePrismaClient() {
	const databaseUrl = String(process.env.DATABASE_URL || "").trim();
	if (!databaseUrl) {
		throw new Error("DATABASE_URL is required. SQLite runtime has been removed.");
	}
	await initPostgresSchema();
	try {
		if (process.env.NODE_ENV !== "production") {
			// eslint-disable-next-line no-console
			console.log("[db] runtime: postgres (prisma)");
		}
	} catch {
		// ignore
	}
	return getPrismaClient();
}

type NodeWorkerEnv = WorkerEnv & {
	WORKFLOW_NODE_QUEUE_CLOSE?: () => Promise<void>;
};

export async function createNodeWorkerEnv(): Promise<NodeWorkerEnv> {
	const dbClient = await createRuntimePrismaClient();
	const env = {
		DB: dbClient,
		JWT_SECRET: process.env.JWT_SECRET || "dev-secret",
		INTERNAL_WORKER_TOKEN: process.env.INTERNAL_WORKER_TOKEN,
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
		LOGIN_URL: process.env.LOGIN_URL,
		CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		RESEND_FROM: process.env.RESEND_FROM,
		EMAIL_LOGIN_DEBUG: process.env.EMAIL_LOGIN_DEBUG,
		REDIS_URL: process.env.REDIS_URL,
		CODEX_SOURCE_S3_ACCESS_KEY_ID: process.env.CODEX_SOURCE_S3_ACCESS_KEY_ID,
		CODEX_SOURCE_S3_SECRET_ACCESS_KEY:
			process.env.CODEX_SOURCE_S3_SECRET_ACCESS_KEY,
		CODEX_SOURCE_S3_SESSION_TOKEN:
			process.env.CODEX_SOURCE_S3_SESSION_TOKEN,
		CODEX_SOURCE_S3_ENDPOINT_URL: process.env.CODEX_SOURCE_S3_ENDPOINT_URL,
		CODEX_SOURCE_S3_REGION: process.env.CODEX_SOURCE_S3_REGION,
		CODEX_SOURCE_S3_BUCKET: process.env.CODEX_SOURCE_S3_BUCKET,
		CODEX_REMOTE_BUILD_ENVELOPE_KEY:
			process.env.CODEX_REMOTE_BUILD_ENVELOPE_KEY,
		CODEX_REMOTE_BUILD_PROVIDER: process.env.CODEX_REMOTE_BUILD_PROVIDER,
		VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
		VERCEL_TOKEN: process.env.VERCEL_TOKEN,
		VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
		VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
		ALIYUN_EMAIL_ACCESS_KEY_ID: process.env.ALIYUN_EMAIL_ACCESS_KEY_ID,
		ALIYUN_EMAIL_ACCESS_KEY_SECRET: process.env.ALIYUN_EMAIL_ACCESS_KEY_SECRET,
		ALIYUN_EMAIL_FROM: process.env.ALIYUN_EMAIL_FROM,
		ALIYUN_EMAIL_FROM_ALIAS: process.env.ALIYUN_EMAIL_FROM_ALIAS,
		SORA_UNWATERMARK_ENDPOINT: process.env.SORA_UNWATERMARK_ENDPOINT,
		SORA2API_BASE_URL: process.env.SORA2API_BASE_URL,
		SORA2API_API_KEY: process.env.SORA2API_API_KEY,
		OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER,
		TOS_ACCESS_KEY_ID: process.env.TOS_ACCESS_KEY_ID,
		TOS_SECRET_ACCESS_KEY: process.env.TOS_SECRET_ACCESS_KEY,
		TOS_SESSION_TOKEN: process.env.TOS_SESSION_TOKEN,
		VOLC_ARK_ACCESS_KEY: process.env.VOLC_ARK_ACCESS_KEY,
		VOLC_ARK_SECRET_KEY: process.env.VOLC_ARK_SECRET_KEY,
		VOLC_ARK_REGION: process.env.VOLC_ARK_REGION,
		VOLC_ARK_API_HOST: process.env.VOLC_ARK_API_HOST,
		VOLC_ARK_PROJECT_NAME: process.env.VOLC_ARK_PROJECT_NAME,
		TOS_ENDPOINT_URL: process.env.TOS_ENDPOINT_URL,
		TOS_REGION: process.env.TOS_REGION,
		TOS_BUCKET: process.env.TOS_BUCKET,
		TOS_PUBLIC_BASE_URL: process.env.TOS_PUBLIC_BASE_URL,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_SESSION_TOKEN: process.env.R2_SESSION_TOKEN,
		R2_ENDPOINT_URL: process.env.R2_ENDPOINT_URL,
		R2_REGION: process.env.R2_REGION,
		R2_BUCKET: process.env.R2_BUCKET,
		R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
		LOCAL_ASSET_PUBLIC_BASE_URL: process.env.LOCAL_ASSET_PUBLIC_BASE_URL,
		DEBUG_HTTP_LOG: process.env.DEBUG_HTTP_LOG,
		DEBUG_HTTP_LOG_UNSAFE: process.env.DEBUG_HTTP_LOG_UNSAFE,
		DEBUG_HTTP_LOG_BODY_LIMIT: process.env.DEBUG_HTTP_LOG_BODY_LIMIT,
		PUBLIC_VENDOR_ROUTING: process.env.PUBLIC_VENDOR_ROUTING,
		// Node/Hono does not expose arbitrary process variables through `c.env`.
		// Keep the packaged-desktop allowlist in the explicit WorkerEnv projection;
		// otherwise the request can carry a valid local_desktop manifest while the
		// public facade silently evaluates the allowlist as empty.
		PUBLIC_AGENTS_PRIVILEGED_DESKTOP_USER_IDS:
			process.env.PUBLIC_AGENTS_PRIVILEGED_DESKTOP_USER_IDS,
		AGENTS_BRIDGE_BASE_URL: process.env.AGENTS_BRIDGE_BASE_URL,
		AGENTS_BRIDGE_TOKEN: process.env.AGENTS_BRIDGE_TOKEN,
		AGENTS_BRIDGE_TIMEOUT_MS: process.env.AGENTS_BRIDGE_TIMEOUT_MS,
		WORKFLOW_LOCAL_JAVASCRIPT_ENABLED: process.env.WORKFLOW_LOCAL_JAVASCRIPT_ENABLED,
		VIDEO_SYNC_WAIT_TIMEOUT_MS: process.env.VIDEO_SYNC_WAIT_TIMEOUT_MS,
		VIDEO_SYNC_POLL_INTERVAL_MS: process.env.VIDEO_SYNC_POLL_INTERVAL_MS,
		VIDEO_RUN_RECOVERY: process.env.VIDEO_RUN_RECOVERY,
		VIDEO_RUN_RECOVERY_STALE_MS: process.env.VIDEO_RUN_RECOVERY_STALE_MS,
		VIDEO_AUTHORING_DRIVE_STALE_MS: process.env.VIDEO_AUTHORING_DRIVE_STALE_MS,
		TAPCANVAS_API_BASE_URL: process.env.TAPCANVAS_API_BASE_URL,
		// bridge 容器回调 hono 的内网地址（compose 设 http://api:8788）。MCP/A2A 出图工具
		// 回调必须用它，不能用请求 Origin（公网域，容器回调不到）。
		TAPCANVAS_API_INTERNAL_BASE: process.env.TAPCANVAS_API_INTERNAL_BASE,
		TAPCANVAS_API_KEY: process.env.TAPCANVAS_API_KEY,
		AGENTS_BRIDGE_USE_REQUEST_AUTH: process.env.AGENTS_BRIDGE_USE_REQUEST_AUTH,
		TASK_LOCAL_MODE: process.env.TASK_LOCAL_MODE,
		TASK_LOCAL_ROOT: process.env.TASK_LOCAL_ROOT,
		TASK_LOCAL_EXEC_TIMEOUT_MS: process.env.TASK_LOCAL_EXEC_TIMEOUT_MS,
		TASK_LOCAL_GENERATOR_BIN: process.env.TASK_LOCAL_GENERATOR_BIN,
		TASK_LOCAL_GENERATOR_ARGS_JSON: process.env.TASK_LOCAL_GENERATOR_ARGS_JSON,
		TASK_LOCAL_GENERATOR_TIMEOUT_MS: process.env.TASK_LOCAL_GENERATOR_TIMEOUT_MS,
		TASK_LOCAL_GENERATOR_MODE: process.env.TASK_LOCAL_GENERATOR_MODE,
		TASK_LOCAL_BUILTIN_GENERATOR_USER_ID: process.env.TASK_LOCAL_BUILTIN_GENERATOR_USER_ID,
		TASK_LOCAL_BUILTIN_GENERATOR_VENDOR: process.env.TASK_LOCAL_BUILTIN_GENERATOR_VENDOR,
		TASK_LOCAL_BUILTIN_GENERATOR_MODEL_ALIAS: process.env.TASK_LOCAL_BUILTIN_GENERATOR_MODEL_ALIAS,
		TASK_LOCAL_BUILTIN_GENERATOR_ASPECT_RATIO: process.env.TASK_LOCAL_BUILTIN_GENERATOR_ASPECT_RATIO,
		TASK_LOCAL_GENERATOR_POLL_INTERVAL_MS: process.env.TASK_LOCAL_GENERATOR_POLL_INTERVAL_MS,
		TASK_LOCAL_PROMPT_AGENT_MODEL_ALIAS: process.env.TASK_LOCAL_PROMPT_AGENT_MODEL_ALIAS,
		TASK_LOCAL_PROMPT_AGENT_USER_ID: process.env.TASK_LOCAL_PROMPT_AGENT_USER_ID,
		TAPCANVAS_DEV_PUBLIC_BYPASS: process.env.TAPCANVAS_DEV_PUBLIC_BYPASS,
		TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET: process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET,
		TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID: process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID,
		TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE: process.env.TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE,
		TASK_CREDIT_FINALIZER_DISABLED: process.env.TASK_CREDIT_FINALIZER_DISABLED,
		TASK_CREDIT_FINALIZER_LIMIT: process.env.TASK_CREDIT_FINALIZER_LIMIT,
		TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS: process.env.TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS,
		WECHAT_OFFICIAL_APP_ID: process.env.WECHAT_OFFICIAL_APP_ID,
		WECHAT_OFFICIAL_APP_SECRET: process.env.WECHAT_OFFICIAL_APP_SECRET,
		WECHAT_OFFICIAL_TOKEN: process.env.WECHAT_OFFICIAL_TOKEN,
		WECHAT_OFFICIAL_QR_EXPIRE_SECONDS: process.env.WECHAT_OFFICIAL_QR_EXPIRE_SECONDS,
		WECHAT_OFFICIAL_LOGIN_MESSAGE: process.env.WECHAT_OFFICIAL_LOGIN_MESSAGE,
		COMMERCE_PLATFORM_OWNER_ID: process.env.COMMERCE_PLATFORM_OWNER_ID,
	} as unknown as NodeWorkerEnv;

	const executionNs = new NodeDurableObjectNamespace(({ state }) => {
		const doInstance = new ExecutionDO(state as any, env as any);
		return { fetch: (req: Request) => doInstance.fetch(req) };
	});
	const remoteWorkflowRuntimeBaseUrl = String(
		process.env.WORKFLOW_RUNTIME_REMOTE_BASE_URL ?? "",
	).trim();
	env.EXECUTION_DO = remoteWorkflowRuntimeBaseUrl
		? createRemoteWorkflowRuntimeNamespace({
			baseUrl: remoteWorkflowRuntimeBaseUrl,
			token: String(process.env.INTERNAL_WORKER_TOKEN ?? ""),
		})
		: executionNs as unknown as WorkerEnv["EXECUTION_DO"];

	const workflowNodeQueue = createRedisWorkflowNodeQueueProducer(
		String(process.env.REDIS_URL ?? "").trim(),
	);
	env.WORKFLOW_NODE_QUEUE = {
		send: async (body: unknown, options?: { delaySeconds?: number }) => {
			await workflowNodeQueue.send(body, options);
		},
	} as unknown as WorkerEnv["WORKFLOW_NODE_QUEUE"];
	env.WORKFLOW_NODE_QUEUE_CLOSE = workflowNodeQueue.close;

	return env;
}

/**
 * Restore the durable workflow runtime before the API accepts new executions.
 *
 * This must have exactly one process owner. Keeping it out of
 * createNodeWorkerEnv prevents background processes that only need bindings
 * from classifying another healthy process's running node as a runtime restart.
 */
export async function restorePersistedWorkflowState(env: WorkerEnv): Promise<void> {
	const recovery = await recoverInterruptedWorkflowExecutions(env);
	const queuedNodes = await resumeQueuedWorkflowNodes(env);
	const waitingNodes = await resumeWaitingWorkflowNodes(env);
	if (recovery.executions > 0 || queuedNodes > 0 || waitingNodes > 0) {
		// eslint-disable-next-line no-console
		console.info("[workflow-queue] restored persisted workflow state", {
			...recovery,
			queuedNodes,
			waitingNodes,
		});
	}
}
