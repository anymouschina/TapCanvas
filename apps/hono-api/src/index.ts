import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { errorMiddleware } from "./middleware/error";
import { httpDebugLoggerMiddleware } from "./middleware/httpDebugLogger";
import { authRouter } from "./modules/auth/auth.routes";
import { projectRouter } from "./modules/project/project.routes";
import { flowRouter } from "./modules/flow/flow.routes";
import { soraRouter } from "./modules/sora/sora.routes";
import { modelRouter } from "./modules/model/model.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { draftRouter } from "./modules/draft/draft.routes";
import { assetRouter } from "./modules/asset/asset.routes";
import { taskRouter } from "./modules/task/task.routes";
import { statsRouter } from "./modules/stats/stats.routes";
import { executionRouter } from "./modules/execution/execution.routes";
import { apiKeyRouter, publicApiRouter } from "./modules/apiKey/apiKey.routes";
import type { AppEnv } from "./types";
import type { MessageBatch } from "@cloudflare/workers-types";
import { handleWorkflowNodeJob, type WorkflowNodeJob } from "./modules/execution/execution.queue";
import { ExecutionDO } from "./modules/execution/execution.do";
import { registerDemoTasksOpenApi } from "./openapi/demoTasks.openapi";
import {
	API_DOCS_ZH_MD,
	renderCopyableDocsHtml,
	renderEndpointExplorerHtml,
} from "./openapi/docs.zh";

// Start a Hono app
const app = new OpenAPIHono<AppEnv>({
	defaultHook: (result, c) => {
		if (result.success === false) {
			return c.json(
				{
					success: false,
					error: "请求参数不合法",
					issues: result.error.issues,
				},
				400,
			);
		}
	},
});

// Global HTTP debug logger (local-only; enable via DEBUG_HTTP_LOG=1)
app.use("*", httpDebugLoggerMiddleware);

// Global CORS
app.use(
	"*",
	cors({
		origin: (origin) => origin || "*",
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		// Keep in sync with frontend requests (e.g. /assets/upload sends X-File-Name/X-File-Size).
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"Accept",
			"Range",
			"X-API-Key",
			"X-File-Name",
			"X-File-Size",
			"X-Tap-No-Retry",
		],
		credentials: true,
	}),
);

// Global error handler
// Keep it after CORS so error responses also get CORS headers.
app.use("*", errorMiddleware);

// Copyable Chinese API docs (Markdown)
app.get("/", (c) =>
	c.html(
		renderCopyableDocsHtml({
			title: "TapCanvas 接口文档（可一键复制）",
			markdown: API_DOCS_ZH_MD,
			openapiJsonUrl: "/openapi.json",
			rawMarkdownUrl: "/docs.md",
			endpointExplorerUrl: "/docs",
		}),
	),
);
app.get("/docs", (c) =>
	c.html(
		renderEndpointExplorerHtml({
			title: "单接口可视化",
			openapiJsonUrl: "/openapi.json",
			copyableDocsUrl: "/",
			rawMarkdownUrl: "/docs.md",
		}),
	),
);
app.get("/docs.md", (c) =>
	c.text(API_DOCS_ZH_MD, 200, {
		"Content-Type": "text/markdown; charset=utf-8",
	}),
);

// Demo Tasks OpenAPI endpoints
registerDemoTasksOpenApi(app);

// OpenAPI schema (only includes routes registered via `app.openapi(...)`)
app.doc31("/openapi.json", {
	openapi: "3.1.0",
	info: {
		title: "TapCanvas Hono API",
		version: "0.1.0",
	},
});

// Auth routes
app.route("/auth", authRouter);

// External API keys & public endpoints
app.route("/api-keys", apiKeyRouter);
app.route("/public", publicApiRouter);

// Project & Flow routes
app.route("/projects", projectRouter);
app.route("/flows", flowRouter);

// Sora routes
app.route("/sora", soraRouter);

// Model routes
app.route("/models", modelRouter);

// AI helper routes (prompt samples)
app.route("/ai", aiRouter);

// Draft suggestion routes
app.route("/drafts", draftRouter);

// Assets routes
app.route("/assets", assetRouter);

// Stats routes
app.route("/stats", statsRouter);

// Unified task routes (veo / sora2api for now)
app.route("/tasks", taskRouter);

// Workflow execution routes (n8n-like)
app.route("/executions", executionRouter);

export { ExecutionDO };

export default {
	fetch: app.fetch,
	queue: async (batch: MessageBatch<WorkflowNodeJob>, env: any) => {
		for (const msg of batch.messages) {
			try {
				await handleWorkflowNodeJob(env, msg.body as any);
				msg.ack();
			} catch (err) {
				console.warn("[workflow-queue] job failed", err);
				msg.retry();
			}
		}
	},
};
