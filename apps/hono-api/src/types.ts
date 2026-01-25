import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import type { DurableObjectNamespace, Queue } from "@cloudflare/workers-types";

export type WorkerEnv = Env & {
	DB: D1Database;
	// Workflow engine bindings (Cloudflare)
	EXECUTION_DO?: DurableObjectNamespace;
	WORKFLOW_NODE_QUEUE?: Queue;
	JWT_SECRET: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	LOGIN_URL?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
	// Optional: Python LangGraph assistant base URL (e.g. http://127.0.0.1:9011)
	LANGGRAPH_ASSISTANT_URL?: string;
	// Sora2API 号池服务的基础地址（例如 http://localhost:8000 或内部网关域名）
	SORA2API_BASE_URL?: string;
	// Sora2API 网关级别的 API Key（可选，作为 vendor 级共享凭证）
	SORA2API_API_KEY?: string;
	// Local debug: HTTP request/response logging (stdout; use `pnpm dev:log` to tee into log.txt)
	DEBUG_HTTP_LOG?: string;
	DEBUG_HTTP_LOG_UNSAFE?: string;
	DEBUG_HTTP_LOG_BODY_LIMIT?: string;
};

export type AppEnv = {
	Bindings: WorkerEnv;
	Variables: {
		userId?: string;
		auth?: unknown;
		apiKeyId?: string;
		requestId?: string;
		// Public API routing hints (set by /public endpoints)
		routingTaskKind?: string;
		proxyVendorHint?: string;
		proxyDisabled?: boolean;
	};
};

export type AppContext = Context<AppEnv>;

export type D1Database = WorkerEnv["DB"];

export const Task = z.object({
	name: Str({ example: "lorem" }),
	slug: Str(),
	description: Str({ required: false }),
	completed: z.boolean().default(false),
	due_date: DateTime(),
});
