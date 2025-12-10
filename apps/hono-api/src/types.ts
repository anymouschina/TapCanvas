import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type WorkerEnv = Env & {
	DB: D1Database;
	JWT_SECRET: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
	// Sora2API 号池服务的基础地址（例如 http://localhost:8000 或内部网关域名）
	SORA2API_BASE_URL?: string;
	// Sora2API 网关级别的 API Key（可选，作为 vendor 级共享凭证）
	SORA2API_API_KEY?: string;
};

export type AppEnv = {
	Bindings: WorkerEnv;
	Variables: {
		userId?: string;
		auth?: unknown;
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
