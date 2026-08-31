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
	CORS_ALLOWED_ORIGINS?: string;
	RESEND_API_KEY?: string;
	RESEND_FROM?: string;
	EMAIL_LOGIN_DEBUG?: string;
	REDIS_URL?: string;
	CODEX_SOURCE_S3_ACCESS_KEY_ID?: string;
	CODEX_SOURCE_S3_SECRET_ACCESS_KEY?: string;
	CODEX_SOURCE_S3_SESSION_TOKEN?: string;
	CODEX_SOURCE_S3_ENDPOINT_URL?: string;
	CODEX_SOURCE_S3_REGION?: string;
	CODEX_SOURCE_S3_BUCKET?: string;
	CODEX_REMOTE_BUILD_ENVELOPE_KEY?: string;
	CODEX_REMOTE_BUILD_PROVIDER?: string;
	VERCEL_OIDC_TOKEN?: string;
	VERCEL_TOKEN?: string;
	VERCEL_TEAM_ID?: string;
	VERCEL_PROJECT_ID?: string;
	ALIYUN_EMAIL_ACCESS_KEY_ID?: string;
	ALIYUN_EMAIL_ACCESS_KEY_SECRET?: string;
	ALIYUN_EMAIL_FROM?: string;
	ALIYUN_EMAIL_FROM_ALIAS?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
	// Object storage. Both provider contracts may be present; this switch selects one.
	OBJECT_STORAGE_PROVIDER?: "tos" | "r2";
	VOLC_ARK_ACCESS_KEY?: string;
	VOLC_ARK_SECRET_KEY?: string;
	VOLC_ARK_REGION?: string;
	VOLC_ARK_API_HOST?: string;
	VOLC_ARK_PROJECT_NAME?: string;
	TOS_ACCESS_KEY_ID?: string;
	TOS_SECRET_ACCESS_KEY?: string;
	TOS_SESSION_TOKEN?: string;
	TOS_ENDPOINT_URL?: string;
	TOS_REGION?: string;
	TOS_BUCKET?: string;
	TOS_PUBLIC_BASE_URL?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_SESSION_TOKEN?: string;
	R2_ENDPOINT_URL?: string;
	R2_REGION?: string;
	R2_BUCKET?: string;
	R2_PUBLIC_BASE_URL?: string;
	// Browser-reachable backend proxy prefix used by background workers when
	// object storage is absent, for example http://localhost:18080/assets/local.
	LOCAL_ASSET_PUBLIC_BASE_URL?: string;
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
	WORKFLOW_LOCAL_JAVASCRIPT_ENABLED?: string;
	TAPCANVAS_WORKFLOW_WEBHOOK_SECRET?: string;
	VIDEO_SYNC_WAIT_TIMEOUT_MS?: string;
	VIDEO_SYNC_POLL_INTERVAL_MS?: string;
	VIDEO_RUN_RECOVERY?: string;
	VIDEO_RUN_RECOVERY_STALE_MS?: string;
	VIDEO_AUTHORING_DRIVE_STALE_MS?: string;
	AGENT_TRACE_CAPTURE_POLICY?: "structural" | "diagnostic" | "full";
	NEW_API_INTERNAL_BASE_URL?: string;
	NEW_API_PUBLIC_BASE_URL?: string;
	NEW_API_RECOMMENDED_PROVIDER_BASE_URL?: string;
	NEW_API_INTERNAL_TOKEN?: string;
	NEW_API_USD_EXCHANGE_RATE?: string;
	NEW_API_SQL_DSN?: string;
	TAP_CREDITS_PER_CNY?: string;
	// Optional: TapCanvas upstream config for agents bridge tools
	TAPCANVAS_API_BASE_URL?: string;
	// 内网回调地址（bridge 容器 → hono），compose 设 http://api:8788。MCP/A2A 出图工具回调优先用它。
	TAPCANVAS_API_INTERNAL_BASE?: string;
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
	/** CSV of authenticated API-owner user ids allowed to grant Tanva desktop workspace execution. */
	PUBLIC_AGENTS_PRIVILEGED_DESKTOP_USER_IDS?: string;
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
	// 公众号扫码登录。与 Tanva 共用同一个公众号，故这三个值与 Tanva 的 .env 相同；
	// 未配置时功能整体关闭（建会话返 501），不抛栈。
	WECHAT_OFFICIAL_APP_ID?: string;
	WECHAT_OFFICIAL_APP_SECRET?: string;
	/// 验签用；Tanva 转发过来的请求也用它自行验签，故与 Tanva 必须一致
	WECHAT_OFFICIAL_TOKEN?: string;
	WECHAT_OFFICIAL_QR_EXPIRE_SECONDS?: string;
	WECHAT_OFFICIAL_LOGIN_MESSAGE?: string;
	WECOM_TICKET_CORP_ID?: string;
	WECOM_TICKET_AGENT_ID?: string;
	WECOM_TICKET_AGENT_SECRET?: string;
	WECOM_TICKET_TOKEN?: string;
	WECOM_TICKET_AES_KEY?: string;
	WECOM_TICKET_FEISHU_CHAT_ID?: string;
	WECOM_TICKET_FEISHU_MENTION_MOBILES?: string;
	WECOM_TICKET_BRAND_NAME?: string;
	COMMERCE_PLATFORM_OWNER_ID?: string;
};

export type AppEnv = {
	Bindings: WorkerEnv;
	Variables: {
		userId?: string;
		authSessionId?: string;
		activeTeamId?: string | null;
		auth?: unknown;
		apiKeyId?: string;
		apiKeyOwnerId?: string;
		apiKeyScopes?: string[];
		agentsCliScopes?: string[];
		agentsCliBridgeBaseUrl?: string | null;
		// tc_sk key 上显式配置的「计费归属团队」（创建/编辑时已校验成员）。
		// 非空时 resolveBillingTeamId 直接信任并优先返回它 → 分配给谁就扣谁的积分。
		apiKeyBillingTeamId?: string | null;
		requestId?: string;
		/** Server-injected physical executor identity; never accepted from tool/model args. */
		activeAsyncContinuationId?: string;
		activeAsyncContinuationClaimToken?: string;
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
