import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { honoErrorHandler } from "./middleware/error";
import { httpDebugLoggerMiddleware } from "./middleware/httpDebugLogger";
import { requestTraceMiddleware } from "./middleware/requestTrace";
import { authRouter } from "./modules/auth/auth.routes";
import { projectRouter } from "./modules/project/project.routes";
import { flowRouter } from "./modules/flow/flow.routes";
import { soraRouter } from "./modules/sora/sora.routes";
import { modelRouter } from "./modules/model/model.routes";
import { modelCatalogRouter } from "./modules/model-catalog/model-catalog.routes";
import { aiRouter } from "./modules/ai/ai.routes";
import { draftRouter } from "./modules/draft/draft.routes";
import { assetRouter } from "./modules/asset/asset.routes";
import { taskRouter } from "./modules/task/task.routes";
import { statsRouter } from "./modules/stats/stats.routes";
import { executionRouter } from "./modules/execution/execution.routes";
import { apiKeyRouter, publicApiRouter } from "./modules/apiKey/apiKey.routes";
import { teamRouter } from "./modules/team/team.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import type { AppEnv } from "./types";
import type { ExecutionContext, MessageBatch, ScheduledEvent } from "@cloudflare/workers-types";
import { handleWorkflowNodeJob, type WorkflowNodeJob } from "./modules/execution/execution.queue";
import { ExecutionDO } from "./modules/execution/execution.do";
import { registerDemoTasksOpenApi } from "./openapi/demoTasks.openapi";
import {
	API_DOCS_ZH_MD,
	renderCopyableDocsHtml,
	renderEndpointExplorerHtml,
} from "./openapi/docs.zh";
import { runCreditTaskFinalizer } from "./modules/task/task.credit-finalizer";
import { installDomParserIfNeeded } from "./polyfills/domparser";

await installDomParserIfNeeded();

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

// Request tracing / slow-request watchdog (stdout + D1; enable via REQUEST_TRACE_* envs)
app.use("*", requestTraceMiddleware);

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
			"tenant-id",
			"terminal",
			"X-File-Name",
			"X-File-Size",
			"X-Tap-No-Retry",
		],
		credentials: true,
	}),
);

// Global error handler (AppError -> JSON with proper status/code)
// NOTE: Hono routes throw into `onError` (middleware try/catch won't see them).
app.onError(honoErrorHandler);

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

// OpenAPI schema
// NOTE: `doc31()` only includes routes registered on this `app` instance via `app.openapi(...)`.
// We also expose Public API routes under `/public/*` via a sub-router, so we merge its OpenAPI doc here.
app.get("/openapi.json", (c) => {
	const config = {
		openapi: "3.1.0",
		info: {
			title: "TapCanvas Hono API",
			version: "0.1.0",
		},
	};

	const rootDoc = app.getOpenAPI31Document(config);
	const publicDoc = publicApiRouter.getOpenAPI31Document(config);

	const publicPaths = Object.fromEntries(
		Object.entries(publicDoc.paths ?? {}).map(([path, item]) => [
			`/public${path}`,
			item,
		]),
	);

	const mergedTags = (() => {
		const out: any[] = [];
		const seen = new Set<string>();
		for (const tag of [...(rootDoc.tags ?? []), ...(publicDoc.tags ?? [])]) {
			const name = typeof (tag as any)?.name === "string" ? (tag as any).name : "";
			if (!name || seen.has(name)) continue;
			seen.add(name);
			out.push(tag as any);
		}
		return out.length ? out : undefined;
	})();

	const mergedComponents = (() => {
		const a = (rootDoc as any).components ?? {};
		const b = (publicDoc as any).components ?? {};
		const mergeRecord = (key: string) => ({
			...(a?.[key] ?? {}),
			...(b?.[key] ?? {}),
		});

		const merged = { ...a, ...b };
		merged.schemas = mergeRecord("schemas");
		merged.parameters = mergeRecord("parameters");
		merged.responses = mergeRecord("responses");
		merged.requestBodies = mergeRecord("requestBodies");
		merged.headers = mergeRecord("headers");
		merged.securitySchemes = mergeRecord("securitySchemes");
		merged.examples = mergeRecord("examples");
		merged.links = mergeRecord("links");
		merged.callbacks = mergeRecord("callbacks");

		// Drop empty components to keep the output clean.
		const hasAny = Object.keys(merged).some(
			(k) => merged[k] && Object.keys(merged[k]).length > 0,
		);
		return hasAny ? merged : undefined;
	})();

	return c.json(
		{
			...rootDoc,
			paths: {
				...(rootDoc.paths ?? {}),
				...publicPaths,
			},
			...(mergedTags ? { tags: mergedTags } : {}),
			...(mergedComponents ? { components: mergedComponents } : {}),
		},
		200,
	);
});

// Public API only (handy for external consumers)
app.get("/openapi.public.json", (c) => {
	const config = {
		openapi: "3.1.0",
		info: {
			title: "TapCanvas Public API",
			version: "0.1.0",
		},
	};
	const doc = publicApiRouter.getOpenAPI31Document(config);
	const publicPaths = Object.fromEntries(
		Object.entries(doc.paths ?? {}).map(([path, item]) => [`/public${path}`, item]),
	);
	return c.json(
		{
			...doc,
			paths: publicPaths,
		},
		200,
	);
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

// Model catalog (admin-configurable)
app.route("/model-catalog", modelCatalogRouter);

// AI helper routes (prompt samples)
app.route("/ai", aiRouter);

// Draft suggestion routes
app.route("/drafts", draftRouter);

// Assets routes
app.route("/assets", assetRouter);

// Stats routes
app.route("/stats", statsRouter);

// Team / enterprise routes
app.route("/teams", teamRouter);

// Billing / plans (admin only)
app.route("/billing", billingRouter);

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
	scheduled: async (_event: ScheduledEvent, env: any, ctx: ExecutionContext) => {
		const disabledFlag = String(env?.TASK_CREDIT_FINALIZER_DISABLED ?? "")
			.trim()
			.toLowerCase();
		const disabled =
			disabledFlag === "1" ||
			disabledFlag === "true" ||
			disabledFlag === "yes" ||
			disabledFlag === "on";
		if (disabled) return;

		const work = async () => {
			const limit = Number(env?.TASK_CREDIT_FINALIZER_LIMIT);
			const orphanReleaseMs = Number(env?.TASK_CREDIT_FINALIZER_ORPHAN_RELEASE_MS);
			const result = await runCreditTaskFinalizer(env as any, {
				...(Number.isFinite(limit) ? { limit } : {}),
				...(Number.isFinite(orphanReleaseMs) ? { orphanReleaseMs } : {}),
			});
			console.log("[credit-finalizer] done", result);
		};

		try {
			ctx.waitUntil(work());
		} catch {
			await work();
		}
	},
};
