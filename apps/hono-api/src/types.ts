import { DateTime, Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type WorkerEnv = Env & {
	DB: D1Database;
	JWT_SECRET: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	SORA_UNWATERMARK_ENDPOINT?: string;
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
