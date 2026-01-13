import { fromHono } from "chanfana";
import { Hono } from "hono";
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
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import type { AppEnv } from "./types";
import type { MessageBatch } from "@cloudflare/workers-types";
import { handleWorkflowNodeJob, type WorkflowNodeJob } from "./modules/execution/execution.queue";
import { ExecutionDO } from "./modules/execution/execution.do";

// Start a Hono app
const app = new Hono<AppEnv>();

// Global HTTP debug logger (local-only; enable via DEBUG_HTTP_LOG=1)
app.use("*", httpDebugLoggerMiddleware);

// Global error handler
app.use("*", errorMiddleware);

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
			"X-File-Name",
			"X-File-Size",
			"X-Tap-No-Retry",
		],
		credentials: true,
	}),
);

// Setup OpenAPI registry (currently only for demo tasks)
const openapi = fromHono(app, {
	docs_url: "/",
});

// Demo Tasks OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

// Auth routes
app.route("/auth", authRouter);

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
