import type { Context } from "hono";
import type {
	DurableObjectNamespace as CloudflareDurableObjectNamespace,
	Queue,
} from "@cloudflare/workers-types";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
export type { PrismaClient } from "@prisma/client";
export type DurableObjectNamespace = CloudflareDurableObjectNamespace;
export type D1Database = PrismaClientType;

export type WorkerEnv = Record<string, unknown> & {
	DB: PrismaClientType;
	// Workflow engine bindings (Cloudflare)
	EXECUTION_DO?: CloudflareDurableObjectNamespace;
	WORKFLOW_NODE_QUEUE?: Queue;
	JWT_SECRET: string;
	// Internal ops endpoints (self-host helpers)
	INTERNAL_WORKER_TOKEN?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	LOGIN_URL?: string;
	RESEND_API_KEY?: string;
	RESEND_FROM?: string;
	EMAIL_LOGIN_DEBUG?: string;
	PHONE_LOGIN_DEBUG?: string;
	AUTH_PHONE_OTP_TRACE?: string;
	REDIS_URL?: string;
	PHONE_OTP_REDIS_PREFIX?: string;
	ALIYUN_SMS_ACCESS_KEY_ID?: string;
	ALIYUN_SMS_ACCESS_KEY_SECRET?: string;
	ALIYUN_SMS_SIGN_NAME?: string;
	ALIYUN_SMS_TEMPLATE_CODE?: string;
	ALIYUN_SMS_ENDPOINT?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
	// Object storage (Cloudflare R2 / RustFS-compatible S3) credentials
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ENDPOINT_URL?: string;
	R2_REGION?: string;
	R2_BUCKET?: string;
	R2_BUCKET_URL?: string;
	R2_PUBLIC_BASE_URL?: string;
	RUSTFS_ACCESS_KEY_ID?: string;
	RUSTFS_SECRET_ACCESS_KEY?: string;
	RUSTFS_ENDPOINT_URL?: string;
	RUSTFS_REGION?: string;
	RUSTFS_BUCKET?: string;
	RUSTFS_PUBLIC_BASE_URL?: string;
	// Local debug: HTTP request/response logging (stdout; use `pnpm dev:log` to tee into log.txt)
	DEBUG_HTTP_LOG?: string;
	DEBUG_HTTP_LOG_UNSAFE?: string;
	DEBUG_HTTP_LOG_BODY_LIMIT?: string;
	// Optional: Public API vendor routing preference config (JSON string)
	PUBLIC_VENDOR_ROUTING?: string;
	// Optional: Local agents HTTP bridge (dev / sidecar)
	AGENTS_BRIDGE_BASE_URL?: string;
	AGENTS_BRIDGE_TOKEN?: string;
	AGENTS_BRIDGE_TIMEOUT_MS?: string;
	// Optional: TapCanvas upstream config for agents bridge tools
	TAPCANVAS_API_BASE_URL?: string;
	TAPCANVAS_API_KEY?: string;
	AGENTS_BRIDGE_USE_REQUEST_AUTH?: string;
	TASK_LOCAL_MODE?: string;
	TASK_LOCAL_ROOT?: string;
	TASK_LOCAL_EXEC_TIMEOUT_MS?: string;
	TASK_LOCAL_GENERATOR_BIN?: string;
	TASK_LOCAL_GENERATOR_ARGS_JSON?: string;
	TASK_LOCAL_GENERATOR_TIMEOUT_MS?: string;
	TASK_LOCAL_GENERATOR_MODE?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_USER_ID?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_VENDOR?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_MODEL_ALIAS?: string;
	TASK_LOCAL_BUILTIN_GENERATOR_ASPECT_RATIO?: string;
	TASK_LOCAL_GENERATOR_POLL_INTERVAL_MS?: string;
	TASK_LOCAL_PROMPT_AGENT_MODEL_ALIAS?: string;
	TASK_LOCAL_PROMPT_AGENT_USER_ID?: string;
	// Local dev: allow /public auth bypass on loopback with explicit secret header.
	TAPCANVAS_DEV_PUBLIC_BYPASS?: string;
	TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET?: string;
	TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID?: string;
	TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE?: string;
	// Credits finalizer tuning (scheduled or self-host)
	TASK_CREDIT_FINALIZER_DISABLED?: string;
	TASK_CREDIT_FINALIZER_LIMIT?: string;
	TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS?: string;
	// WeChat Pay (direct merchant, H5)
	WECHAT_PAY_MCH_ID?: string;
	WECHAT_PAY_APP_ID?: string;
	WECHAT_PAY_MCH_SERIAL_NO?: string;
	WECHAT_PAY_PRIVATE_KEY?: string;
	WECHAT_PAY_PLATFORM_PUBLIC_KEY?: string;
	WECHAT_PAY_API_V3_KEY?: string;
	OPENCLAW_API_BASE_URL?: string;
	OPENCLAW_API_TOKEN?: string;
	WECHAT_PAY_NOTIFY_URL?: string;
	WECHAT_PAY_MCH_CERT_FILE?: string;
	WECHAT_PAY_MCH_CERT_PEM?: string;
	WECHAT_PAY_PRIVATE_KEY_FILE?: string;
	WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE?: string;
	COMMERCE_PLATFORM_OWNER_ID?: string;
};

export type AppEnv = {
	Bindings: WorkerEnv;
	Variables: {
		userId?: string;
		auth?: unknown;
		apiKeyId?: string;
		apiKeyOwnerId?: string;
		requestId?: string;
		traceStartedAtMs?: number;
		traceStage?: string;
		traceEvents?: unknown;
		publicApi?: boolean;
		devPublicBypass?: boolean;
		// Public API routing hints (set by /public endpoints)
		routingTaskKind?: string;
		proxyVendorHint?: string;
		proxyDisabled?: boolean;
	};
};

export type AppContext = Context<AppEnv>;
