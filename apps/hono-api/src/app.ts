import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { honoErrorHandler } from "./middleware/error";
import { httpDebugLoggerMiddleware } from "./middleware/httpDebugLogger";
import { requestTraceMiddleware } from "./middleware/requestTrace";
import { authRouter } from "./modules/auth/auth.routes";
import { projectRouter } from "./modules/project/project.routes";
import { chapterRouter } from "./modules/chapter/chapter.routes";
import { flowRouter } from "./modules/flow/flow.routes";
import { modelRouter } from "./modules/model/model.routes";
import { modelCatalogRouter } from "./modules/model-catalog/model-catalog.routes";
import { aiRouter, adminAiRouter } from "./modules/ai/ai.routes";
import { agentsRouter, adminAgentsRouter } from "./modules/agents/agents.routes";
import { draftRouter } from "./modules/draft/draft.routes";
import { assetRouter } from "./modules/asset/asset.routes";
import { taskRouter } from "./modules/task/task.routes";
import { statsRouter } from "./modules/stats/stats.routes";
import { executionRouter } from "./modules/execution/execution.routes";
import { apiKeyRouter, publicApiRouter } from "./modules/apiKey/apiKey.routes";
import { teamRouter } from "./modules/team/team.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import { userAdminRouter } from "./modules/user-admin/user-admin.routes";
import { projectAdminRouter } from "./modules/project-admin/project-admin.routes";
import { productRouter } from "./modules/product/product.routes";
import { orderRouter } from "./modules/order/order.routes";
import { wechatPayRouter } from "./modules/wechat-pay/wechat-pay.routes";
import { commerceRouter } from "./modules/commerce/commerce.routes";
import { materialRouter } from "./modules/material/material.routes";
import { memoryRouter } from "./modules/memory/memory.routes";
import { dreaminaRouter } from "./modules/dreamina/dreamina.routes";
import type { AppEnv } from "./types";
import { registerDemoTasksOpenApi } from "./openapi/demoTasks.openapi";
import {
	API_DOCS_ZH_MD,
	renderCopyableDocsHtml,
	renderEndpointExplorerHtml,
} from "./openapi/docs.zh";
import { installDomParserIfNeeded } from "./polyfills/domparser";
import { internalRouter } from "./modules/internal/internal.routes";

const API_BOOT_TIME_ISO = new Date().toISOString();

function readRuntimeBuildVersionMeta(): {
	version: string;
	gitHash: string;
	buildTime: string;
	pid: number | null;
} {
	const processRef = (globalThis as any)?.process;
	const env = processRef?.env || {};
	const version = String(env.TAP_API_VERSION || env.npm_package_version || "0.1.0");
	const gitHash = String(
		env.TAP_BUILD_GIT_SHA ||
			env.GIT_COMMIT_SHA ||
			env.VERCEL_GIT_COMMIT_SHA ||
			"unknown",
	).trim();
	const buildTime = String(
		env.TAP_BUILD_TIME ||
			env.BUILD_TIME ||
			env.VERCEL_GIT_COMMIT_TIMESTAMP ||
			"unknown",
	).trim();
	const pidRaw = Number(processRef?.pid);
	const pid = Number.isFinite(pidRaw) && pidRaw > 0 ? Math.trunc(pidRaw) : null;
	return { version, gitHash, buildTime, pid };
}

export async function createTapCanvasApp(): Promise<OpenAPIHono<AppEnv>> {
	await installDomParserIfNeeded();

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

	// Request tracing / slow-request watchdog (stdout + Prisma DB; enable via REQUEST_TRACE_* envs)
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
					"X-TapCanvas-Source",
					"x-tapcanvas-referrer-path",
					"x-tapcanvas-page-path",
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
	app.get("/health/version", (c) => {
		const meta = readRuntimeBuildVersionMeta();
		const now = Date.now();
		const bootAt = Date.parse(API_BOOT_TIME_ISO);
		const uptimeMs = Number.isFinite(bootAt) ? Math.max(0, now - bootAt) : null;
		return c.json({
			ok: true,
			service: "tapcanvas-hono-api",
			version: meta.version,
			gitHash: meta.gitHash,
			buildTime: meta.buildTime,
			bootTime: API_BOOT_TIME_ISO,
			pid: meta.pid,
			uptimeMs,
		});
	});

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
	app.route("/chapters", chapterRouter);
	app.route("/flows", flowRouter);

	// Sora routes

	// Model routes
	app.route("/models", modelRouter);

	// Model catalog (admin-configurable)
	app.route("/model-catalog", modelCatalogRouter);

	// AI helper routes (prompt samples)
	app.route("/ai", aiRouter);
	app.route("/admin/ai", adminAiRouter);

	// Agents: skills & presets
	app.route("/agents", agentsRouter);
	app.route("/admin/agents", adminAgentsRouter);

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

	// User management (admin only)
	app.route("/admin/users", userAdminRouter);

	// Project management (admin only)
	app.route("/admin/projects", projectAdminRouter);

	// Unified task routes
	app.route("/tasks", taskRouter);

	// Workflow execution routes (n8n-like)
	app.route("/executions", executionRouter);

	// Commerce routes
	app.route("/products", productRouter);
	app.route("/orders", orderRouter);
	app.route("/wechat-pay", wechatPayRouter);
	app.route("/commerce", commerceRouter);
	app.route("/materials", materialRouter);
	app.route("/memory", memoryRouter);
	app.route("/dreamina", dreaminaRouter);
	// Internal ops endpoints (token protected; not in OpenAPI docs)
	app.route("/internal", internalRouter);

	return app;
}
