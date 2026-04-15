import fs from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";

import { getPrismaClient } from "./prisma";
import { NodeDurableObjectNamespace } from "./node-durable";

import { ExecutionDO } from "../../modules/execution/execution.do";
import { handleWorkflowNodeJob } from "../../modules/execution/execution.queue";

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

function firstExistingFile(candidates: string[]): string | null {
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
		} catch {
			// ignore
		}
	}
	return null;
}

function readTextFileIfExists(filePath: string | null): string | undefined {
	if (!filePath) return undefined;
	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const text = raw.trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

function resolveFromEnvOrFile(opts: {
	value?: string;
	filePath?: string;
	defaultFiles?: string[];
}): string | undefined {
	const inline = (opts.value || "").trim();
	if (inline) return inline;
	const byEnvFile = readTextFileIfExists(
		opts.filePath ? path.resolve(process.cwd(), opts.filePath) : null,
	);
	if (byEnvFile) return byEnvFile;
	const matched = firstExistingFile((opts.defaultFiles || []).map((p) => path.resolve(process.cwd(), p)));
	return readTextFileIfExists(matched);
}

function resolveWechatMerchantSerialNo(input: {
	envSerialNo?: string;
	mchCertPath?: string;
	defaultCertFiles?: string[];
}): string | undefined {
	const inline = (input.envSerialNo || "").trim();
	if (inline) return inline;
	const certByEnv = input.mchCertPath ? path.resolve(process.cwd(), input.mchCertPath) : null;
	const certPath =
		firstExistingFile([
			...(certByEnv ? [certByEnv] : []),
			...((input.defaultCertFiles || []).map((p) => path.resolve(process.cwd(), p))),
		]) || null;
	const pem = readTextFileIfExists(certPath);
	if (!pem) return undefined;
	try {
		const cert = new X509Certificate(pem);
		const serial = cert.serialNumber?.trim();
		return serial || undefined;
	} catch {
		return undefined;
	}
}

export async function createNodeWorkerEnv(): Promise<any> {
	const dbClient = await createRuntimePrismaClient();
	const defaultCertDirCandidates = [
		"cert",
		"apps/hono-api/cert",
	];
	const wechatPrivateKey = resolveFromEnvOrFile({
		value: process.env.WECHAT_PAY_PRIVATE_KEY,
		filePath: process.env.WECHAT_PAY_PRIVATE_KEY_FILE,
		defaultFiles: defaultCertDirCandidates.map((d) => `${d}/apiclient_key.pem`),
	});
	const wechatPlatformPublicKey = resolveFromEnvOrFile({
		value: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY,
		filePath: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE,
		defaultFiles: [
			...defaultCertDirCandidates.map((d) => `${d}/wechatpay_platform_public_key.pem`),
			...defaultCertDirCandidates.map((d) => `${d}/platform_public_key.pem`),
		],
	});
	const wechatSerialNo = resolveWechatMerchantSerialNo({
		envSerialNo: process.env.WECHAT_PAY_MCH_SERIAL_NO,
		mchCertPath: process.env.WECHAT_PAY_MCH_CERT_FILE,
		defaultCertFiles: defaultCertDirCandidates.map((d) => `${d}/apiclient_cert.pem`),
	});

	const env: any = {
		DB: dbClient,
		JWT_SECRET: process.env.JWT_SECRET || "dev-secret",
		INTERNAL_WORKER_TOKEN: process.env.INTERNAL_WORKER_TOKEN,
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
		LOGIN_URL: process.env.LOGIN_URL,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		RESEND_FROM: process.env.RESEND_FROM,
		EMAIL_LOGIN_DEBUG: process.env.EMAIL_LOGIN_DEBUG,
		PHONE_LOGIN_DEBUG: process.env.PHONE_LOGIN_DEBUG,
		AUTH_PHONE_OTP_TRACE: process.env.AUTH_PHONE_OTP_TRACE,
		REDIS_URL: process.env.REDIS_URL,
		PHONE_OTP_REDIS_PREFIX: process.env.PHONE_OTP_REDIS_PREFIX,
		ALIYUN_SMS_ACCESS_KEY_ID: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
		ALIYUN_SMS_ACCESS_KEY_SECRET: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
		ALIYUN_SMS_SIGN_NAME: process.env.ALIYUN_SMS_SIGN_NAME,
		ALIYUN_SMS_TEMPLATE_CODE: process.env.ALIYUN_SMS_TEMPLATE_CODE,
		ALIYUN_SMS_ENDPOINT: process.env.ALIYUN_SMS_ENDPOINT,
		SORA_UNWATERMARK_ENDPOINT: process.env.SORA_UNWATERMARK_ENDPOINT,
		SORA2API_BASE_URL: process.env.SORA2API_BASE_URL,
		SORA2API_API_KEY: process.env.SORA2API_API_KEY,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_ENDPOINT_URL: process.env.R2_ENDPOINT_URL,
		R2_REGION: process.env.R2_REGION,
		R2_BUCKET: process.env.R2_BUCKET,
		R2_BUCKET_URL: process.env.R2_BUCKET_URL,
		R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
		RUSTFS_ACCESS_KEY_ID: process.env.RUSTFS_ACCESS_KEY_ID,
		RUSTFS_SECRET_ACCESS_KEY: process.env.RUSTFS_SECRET_ACCESS_KEY,
		RUSTFS_ENDPOINT_URL: process.env.RUSTFS_ENDPOINT_URL,
		RUSTFS_REGION: process.env.RUSTFS_REGION,
		RUSTFS_BUCKET: process.env.RUSTFS_BUCKET,
		RUSTFS_PUBLIC_BASE_URL: process.env.RUSTFS_PUBLIC_BASE_URL,
		DEBUG_HTTP_LOG: process.env.DEBUG_HTTP_LOG,
		DEBUG_HTTP_LOG_UNSAFE: process.env.DEBUG_HTTP_LOG_UNSAFE,
		DEBUG_HTTP_LOG_BODY_LIMIT: process.env.DEBUG_HTTP_LOG_BODY_LIMIT,
		PUBLIC_VENDOR_ROUTING: process.env.PUBLIC_VENDOR_ROUTING,
		AGENTS_BRIDGE_BASE_URL: process.env.AGENTS_BRIDGE_BASE_URL,
		AGENTS_BRIDGE_TOKEN: process.env.AGENTS_BRIDGE_TOKEN,
		AGENTS_BRIDGE_TIMEOUT_MS: process.env.AGENTS_BRIDGE_TIMEOUT_MS,
		TAPCANVAS_API_BASE_URL: process.env.TAPCANVAS_API_BASE_URL,
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
		WECHAT_PAY_MCH_ID:
			process.env.WECHAT_PAY_MCH_ID ||
			process.env.WXPAY_MCHID ||
			process.env.WECHAT_MCH_ID,
		WECHAT_PAY_APP_ID:
			process.env.WECHAT_PAY_APP_ID || process.env.WECHAT_APP_ID,
		WECHAT_PAY_MCH_SERIAL_NO: wechatSerialNo || process.env.WECHAT_PAY_MCH_SERIAL_NO,
		WECHAT_PAY_PRIVATE_KEY: wechatPrivateKey || process.env.WECHAT_PAY_PRIVATE_KEY,
		WECHAT_PAY_PLATFORM_PUBLIC_KEY:
			wechatPlatformPublicKey || process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY,
		WECHAT_PAY_API_V3_KEY:
			process.env.WECHAT_PAY_API_V3_KEY ||
			process.env.WXPAY_API_V3_KEY ||
			process.env.WECHAT_API_V3_KEY,
		OPENCLAW_API_BASE_URL: process.env.OPENCLAW_API_BASE_URL,
		OPENCLAW_API_TOKEN: process.env.OPENCLAW_API_TOKEN,
		WECHAT_PAY_NOTIFY_URL:
			process.env.WECHAT_PAY_NOTIFY_URL || process.env.WECHAT_NOTIFY_URL,
		WECHAT_PAY_MCH_CERT_FILE: process.env.WECHAT_PAY_MCH_CERT_FILE,
		WECHAT_PAY_MCH_CERT_PEM: process.env.WECHAT_PAY_MCH_CERT_PEM,
		WECHAT_PAY_PRIVATE_KEY_FILE: process.env.WECHAT_PAY_PRIVATE_KEY_FILE,
		WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE,
		COMMERCE_PLATFORM_OWNER_ID: process.env.COMMERCE_PLATFORM_OWNER_ID,
	};

	const executionNs = new NodeDurableObjectNamespace(({ state }) => {
		const doInstance = new ExecutionDO(state as any, env as any);
		return { fetch: (req: Request) => doInstance.fetch(req) };
	});
	env.EXECUTION_DO = executionNs;

	env.WORKFLOW_NODE_QUEUE = {
		send: async (body: any) => {
			setTimeout(() => {
				void handleWorkflowNodeJob(env as any, body).catch((err) => {
					// eslint-disable-next-line no-console
					console.warn("[workflow-queue] job failed", err);
				});
			}, 0);
		},
	};

	return env;
}
