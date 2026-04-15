import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { AppError, errorMiddleware } from "../../middleware/error";
import type { AppContext, AppEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { authMiddleware } from "../../middleware/auth";
import { apiKeyAuthMiddleware } from "./apiKey.middleware";
import {
} from "../../middleware/devPublicBypass";
import { isHttpDebugLogEnabled } from "../../httpDebugLog";
import {
	ApiKeySchema,
	AgentsChatRequestSchema,
	type AgentsChatRequestDto,
	AgentsChatResponseSchema,
	CreateApiKeyRequestSchema,
	CreateApiKeyResponseSchema,
	UpdateApiKeyRequestSchema,
	PublicVisionRequestSchema,
	type PublicVisionRequestDto,
	PublicVisionResponseSchema,
	PublicRunTaskRequestSchema,
	PublicRunTaskResponseSchema,
	PublicFetchTaskResultRequestSchema,
	PublicFetchTaskResultResponseSchema,
	PublicDrawRequestSchema,
	PublicVideoRequestSchema,
	PublicOssUploadRequestSchema,
	PublicOssUploadResponseSchema,
	PublicVideoUnderstandRequestSchema,
	PublicVideoUnderstandResponseSchema,
} from "./apiKey.schemas";
import { registerPublicFlowRoutes } from "../flow/flow.public.routes";
import { registerPublicAgentsToolBridgeRoutes } from "../task/agents-tool-bridge.routes";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "./apiKey.service";
import {
	runApimartTextTask,
	runApimartImageTask,
	runApimartImageToPromptTask,
	runApimartVideoTask,
	runGenericTaskForVendor,
	enqueueStoredTaskForVendor,
	enqueueStoredTaskForVendorAttempts,
	resolveVendorContext,
} from "../task/task.service";
import { isAgentsBridgeEnabled, runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import { handlePublicAgentsChatRoute } from "../task/public-agents-chat";
import {
	ensureModelCatalogSchema,
	listCatalogModelsByModelAlias,
	listCatalogModelsByModelKey,
} from "../model-catalog/model-catalog.repo";
import { upsertTaskResult } from "../task/task-result.repo";
import { upsertVendorTaskRef } from "../task/vendor-task-refs.repo";
import {
	ensureVendorCallLogsSchema,
	upsertVendorCallLogFinal,
	upsertVendorCallLogPayloads,
} from "../task/vendor-call-logs.repo";
import { fetchTaskResultForPolling } from "../task/task.polling";
import { normalizeDispatchVendor } from "../task/task.vendor";
import { maybeWrapSyncImageResultAsStoredTask } from "../task/task.task-store-wrap";
import { setTraceStage } from "../../trace";
import { createAssetRow } from "../asset/asset.repo";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import { createRustfsClient, resolveRustfsConfig } from "../asset/rustfs.client";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
	PublicChatAssetInputNormalizer,
	type NormalizedPublicChatAssetInput,
} from "./public-chat-asset-input";
import {
	appendPublicChatTurnRun,
	type PublicChatRunOutcome,
} from "./public-chat-session.repo";
import { persistUserConversationTurn } from "../memory/memory.service";
import { loadGenerationContractModule } from "../../platform/node/shared-schema-loader";

const generationContractModule = loadGenerationContractModule();
const { parseGenerationContract } = generationContractModule;

export const apiKeyRouter = new Hono<AppEnv>();
export const publicApiRouter = new OpenAPIHono<AppEnv>({
	defaultHook: (result, c) => {
		if (result.success === false) {
			return c.json(
				{
					error: "Invalid request body",
					issues: result.error.issues,
				},
				400,
			);
		}
	},
});

const PublicValidationErrorSchema = z.object({
	error: z.string(),
	issues: z.array(z.any()).optional(),
});

const PublicAppErrorSchema = z.object({
	message: z.string(),
	error: z.string(),
	code: z.string(),
	details: z.any().optional(),
});

const PublicTaskKindErrorSchema = z.object({
	error: z.string(),
	code: z.string(),
	details: z.any().optional(),
});

const PUBLIC_TAG = "Public API";
const PUBLIC_OSS_MAX_BYTES = 30 * 1024 * 1024;
const AUTO_IMAGE_RESULT_LIMIT = 15;
const AUTO_BRIDGE_TIMEOUT_MS = 1_800_000;
type PublicChatTraceDto = NonNullable<z.infer<typeof AgentsChatResponseSchema>["trace"]>;
type PublicChatAgentDecisionDto = NonNullable<
	z.infer<typeof AgentsChatResponseSchema>["agentDecision"]
>;
type StructuredAgentsMetadata = {
	agentDecision?: PublicChatAgentDecisionDto;
	trace?: PublicChatTraceDto;
};
export type PublicChatAutoModeBehavior = "chat" | "agents_auto";
type PublicChatLedgerScope = {
	projectId: string | null;
	bookId: string | null;
	chapterId: string | null;
	label: string | null;
};
export type PublicChatForwardedStreamEvent =
	| { event: "content"; data: { delta: string } }
	| { event: "tool"; data: Record<string, unknown> }
	| { event: "todo_list"; data: Record<string, unknown> };

export function resolvePublicChatStreamSessionId(input: {
	sessionKey?: string;
	canvasProjectId?: string;
	canvasFlowId?: string;
}): string {
	const sessionKey = typeof input.sessionKey === "string" ? input.sessionKey.trim() : "";
	if (sessionKey) return sessionKey;
	const canvasProjectId =
		typeof input.canvasProjectId === "string" ? input.canvasProjectId.trim() : "";
	if (!canvasProjectId) return "";
	const canvasFlowId =
		typeof input.canvasFlowId === "string" && input.canvasFlowId.trim()
			? input.canvasFlowId.trim()
			: "default";
	return `project:${canvasProjectId}:flow:${canvasFlowId}`;
}

export function normalizePublicChatAgentStreamEvent(input: {
	event?: string;
	data?: Record<string, unknown>;
}): PublicChatForwardedStreamEvent | null {
	if (input.event === "content") {
		const delta =
			input.data && typeof input.data.delta === "string" ? input.data.delta : "";
		return delta ? { event: "content", data: { delta } } : null;
	}
	if (input.event === "tool") {
		return {
			event: "tool",
			data:
				input.data && typeof input.data === "object" && !Array.isArray(input.data)
					? input.data
					: {},
		};
	}
	if (input.event === "todo_list") {
		return {
			event: "todo_list",
			data:
				input.data && typeof input.data === "object" && !Array.isArray(input.data)
					? input.data
					: {},
		};
	}
	return null;
}

function isAbortSignalLike(value: unknown): value is AbortSignal {
	if (!value || typeof value !== "object") return false;
	const candidate = value as {
		aborted?: unknown;
		addEventListener?: unknown;
		removeEventListener?: unknown;
	};
	return (
		typeof candidate.aborted === "boolean" &&
		typeof candidate.addEventListener === "function" &&
		typeof candidate.removeEventListener === "function"
	);
}

function throwIfAbortSignalAborted(signal?: AbortSignal | null): void {
	if (!signal?.aborted) return;
	const reason = signal.reason;
	if (reason instanceof Error) throw reason;
	const text = typeof reason === "string" ? reason.trim() : "";
	throw new Error(text || "public_request_aborted");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractStructuredAgentsMetadata(result: unknown): {
	agentDecision?: PublicChatAgentDecisionDto;
	trace?: PublicChatTraceDto;
} {
	if (!isPlainRecord(result)) return {};
	const raw = isPlainRecord(result.raw) ? result.raw : null;
	const meta = raw && isPlainRecord(raw.meta) ? raw.meta : null;
	if (!meta) return {};

	const candidate = {
		agentDecision: meta.agentDecision,
		trace: {
			requestId:
				typeof meta.requestId === "string" && meta.requestId.trim()
					? meta.requestId.trim()
					: undefined,
			sessionId:
				typeof meta.sessionId === "string" && meta.sessionId.trim()
					? meta.sessionId.trim()
					: undefined,
			outputMode: meta.outputMode,
			toolEvidence: meta.toolEvidence,
			toolStatusSummary: meta.toolStatusSummary,
			canvasMutation: meta.canvasMutation,
			diagnosticFlags: meta.diagnosticFlags,
			canvasPlan: meta.canvasPlan,
			todoList: meta.todoList,
			turnVerdict: meta.turnVerdict,
		},
	};
	const parsed = AgentsChatResponseSchema.pick({
		agentDecision: true,
		trace: true,
	}).safeParse(candidate);
	if (!parsed.success) return {};
	return parsed.data;
}

function extractAgentsRawMeta(result: unknown): Record<string, unknown> | null {
	if (!isPlainRecord(result)) return null;
	const raw = isPlainRecord(result.raw) ? result.raw : null;
	return raw && isPlainRecord(raw.meta) ? raw.meta : null;
}

function normalizeOptionalTrimmedString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function stringifyOptionalJson(value: unknown): string | null {
	if (typeof value === "undefined") return null;
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}

export function derivePublicChatWorkflowKey(input: {
	mode?: AgentsChatRequestDto["mode"];
	planOnly?: boolean;
	forceAssetGeneration?: boolean;
}): string {
	if (input.forceAssetGeneration === true) return "public_chat.asset_forced";
	if (input.planOnly === true) return "public_chat.plan_only";
	if (input.mode === "auto") return "public_chat.auto";
	return "public_chat.chat";
}

export function resolvePublicChatAutoModeBehavior(input: {
	mode?: AgentsChatRequestDto["mode"];
	vendor?: string;
	tools?: unknown[];
	canvasProjectId?: string;
	canvasFlowId?: string;
	canvasNodeId?: string;
	chatContext?: AgentsChatRequestDto["chatContext"];
	bookId?: string;
	chapterId?: string;
}): PublicChatAutoModeBehavior {
	void input.vendor;
	void input.tools;
	void input.canvasProjectId;
	void input.canvasFlowId;
	void input.canvasNodeId;
	void input.chatContext;
	void input.bookId;
	void input.chapterId;
	return input.mode === "auto" ? "agents_auto" : "chat";
}

function derivePublicChatLedgerScope(input: {
	requestInput: AgentsChatRequestDto;
	rawMeta: Record<string, unknown> | null;
}): PublicChatLedgerScope {
	const selectedReference = input.requestInput.chatContext?.selectedReference;
	return {
		projectId:
			normalizeOptionalTrimmedString(input.rawMeta?.projectId) ??
			normalizeOptionalTrimmedString(input.requestInput.canvasProjectId),
		bookId:
			normalizeOptionalTrimmedString(input.rawMeta?.bookId) ??
			normalizeOptionalTrimmedString(input.requestInput.bookId) ??
			normalizeOptionalTrimmedString(selectedReference?.bookId),
		chapterId:
			normalizeOptionalTrimmedString(input.rawMeta?.chapterId) ??
			normalizeOptionalTrimmedString(input.requestInput.chapterId) ??
			normalizeOptionalTrimmedString(selectedReference?.chapterId),
		label: normalizeOptionalTrimmedString(input.rawMeta?.label),
	};
}

export function derivePublicChatRunOutcome(input: {
	turnVerdict: PublicChatTraceDto["turnVerdict"]["status"];
	assetCount: number;
	canvasWrite: boolean;
}): PublicChatRunOutcome {
	if (input.turnVerdict === "failed") return "discard";
	if (input.turnVerdict === "partial") return "hold";
	return input.canvasWrite || input.assetCount > 0 ? "promote" : "hold";
}

async function persistStructuredPublicChatTurn(input: {
	c: AppContext;
	userId: string;
	requestInput: AgentsChatRequestDto;
	conversationUserText: string;
	assistantText: string;
	assistantAssets: unknown[];
	structuredMetadata: StructuredAgentsMetadata;
	rawMeta: Record<string, unknown> | null;
}): Promise<void> {
	const sessionKey =
		typeof input.requestInput.sessionKey === "string" ? input.requestInput.sessionKey.trim() : "";
	if (!sessionKey) return;

	const persisted = await persistUserConversationTurn(input.c, {
		userId: input.userId,
		sessionKey,
		userText: input.conversationUserText,
		assistantText: input.assistantText,
		assistantAssets: input.assistantAssets,
	});
	const trace = input.structuredMetadata.trace;
	if (!persisted || !trace?.turnVerdict) return;

	const assetCount = Array.isArray(input.assistantAssets) ? input.assistantAssets.length : 0;
	const canvasWrite = trace.toolEvidence.wroteCanvas === true;
	const ledgerScope = derivePublicChatLedgerScope({
		requestInput: input.requestInput,
		rawMeta: input.rawMeta,
	});
	await appendPublicChatTurnRun(input.c.env.DB, {
		id: randomUUID(),
		userId: input.userId,
		sessionId: persisted.sessionId,
		requestId: trace.requestId ?? null,
		sessionKey,
		projectId: ledgerScope.projectId,
		bookId: ledgerScope.bookId,
		chapterId: ledgerScope.chapterId,
		label: ledgerScope.label,
		workflowKey: derivePublicChatWorkflowKey({
			mode: input.requestInput.mode,
			planOnly: input.requestInput.planOnly === true,
			forceAssetGeneration: input.requestInput.forceAssetGeneration === true,
		}),
		requestKind: "chat",
		userMessageId: persisted.userMessageId,
		assistantMessageId: persisted.assistantMessageId,
		outputMode: trace.outputMode,
		turnVerdict: trace.turnVerdict.status,
		turnVerdictReasonsJson: JSON.stringify(trace.turnVerdict.reasons),
		runOutcome: derivePublicChatRunOutcome({
			turnVerdict: trace.turnVerdict.status,
			assetCount,
			canvasWrite,
		}),
		agentDecisionJson: stringifyOptionalJson(input.structuredMetadata.agentDecision),
		toolStatusSummaryJson: stringifyOptionalJson(trace.toolStatusSummary),
		diagnosticFlagsJson: stringifyOptionalJson(trace.diagnosticFlags),
		canvasPlanJson: stringifyOptionalJson(trace.canvasPlan),
		assetCount,
		canvasWrite,
		runMs: trace.toolStatusSummary.runMs,
		nowIso: new Date().toISOString(),
	});
}

const publicChatAssetNormalizer = new PublicChatAssetInputNormalizer();

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

async function normalizeTaskAssetBackedVideoRequest(
	c: AppContext,
	userId: string,
	request: unknown,
): Promise<unknown> {
	if (!isPlainRecord(request)) return request;
	const kind =
		typeof request.kind === "string" ? request.kind.trim() : "";
	if (kind !== "text_to_video" && kind !== "image_to_video") return request;

	const extras = isPlainRecord(request.extras)
		? { ...request.extras }
		: {};
	const origin = new URL(c.req.url).origin;
	const normalizeSingleAssetId = async (
		assetId: unknown,
		role: "target" | "reference",
	): Promise<string> => {
		if (typeof assetId !== "string" || !assetId.trim()) return "";
		const resolved = await publicChatAssetNormalizer.normalizeAssetInputs(
			[{ assetId: assetId.trim(), role }],
			{ origin, userId, db: c.env.DB },
		);
		return resolved[0]?.url || "";
	};

	const normalizedAssetInputs = await publicChatAssetNormalizer.normalizeAssetInputs(
		extras.assetInputs,
		{ origin, userId, db: c.env.DB },
	);
	const firstFrameUrlFromAsset = await normalizeSingleAssetId(
		extras.firstFrameAssetId,
		"target",
	);
	const lastFrameUrlFromAsset = await normalizeSingleAssetId(
		extras.lastFrameAssetId,
		"reference",
	);
	const referenceUrlsFromAssetIds = (
		await Promise.all(
			normalizeStringArray(extras.referenceAssetIds).map((assetId) =>
				normalizeSingleAssetId(assetId, "reference"),
			),
		)
	).filter(Boolean);

	const currentFirstFrameUrl =
		typeof extras.firstFrameUrl === "string" && extras.firstFrameUrl.trim()
			? extras.firstFrameUrl.trim()
			: "";
	const currentLastFrameUrl =
		typeof extras.lastFrameUrl === "string" && extras.lastFrameUrl.trim()
			? extras.lastFrameUrl.trim()
			: "";
	const currentReferenceImages = normalizeStringArray(extras.referenceImages);

	const targetAssetUrl =
		normalizedAssetInputs.find((item) => item.role === "target")?.url ||
		normalizedAssetInputs[0]?.url ||
		"";
	const referenceUrlsFromAssetInputs = normalizedAssetInputs
		.filter((item) => item.role !== "target")
		.map((item) => item.url)
		.filter(Boolean);

	if (!currentFirstFrameUrl) {
		const nextFirstFrameUrl = firstFrameUrlFromAsset || targetAssetUrl;
		if (nextFirstFrameUrl) extras.firstFrameUrl = nextFirstFrameUrl;
	}
	if (!currentLastFrameUrl && lastFrameUrlFromAsset) {
		extras.lastFrameUrl = lastFrameUrlFromAsset;
	}
	if (!currentReferenceImages.length) {
		const mergedReferenceImages = Array.from(
			new Set([
				...referenceUrlsFromAssetIds,
				...referenceUrlsFromAssetInputs,
			]),
		);
		if (mergedReferenceImages.length) {
			extras.referenceImages = mergedReferenceImages;
		}
	}

	return {
		...request,
		extras,
	};
}

function normalizeContentType(raw: unknown): string {
	const value = typeof raw === "string" ? raw.trim() : "";
	const ct = (value.split(";")[0] || "").trim().toLowerCase();
	return ct || "application/octet-stream";
}

function sanitizeUploadName(raw: unknown): string {
	if (typeof raw !== "string") return "";
	return raw
		.trim()
		.slice(0, 160)
		.replace(/[\u0000-\u001F\u007F]/g, "")
		.replace(/[\\/]/g, "_");
}

function detectUploadExtension(options: { contentType: string; fileName?: string }): string {
	const name = options.fileName || "";
	const contentType = normalizeContentType(options.contentType);
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (name) {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) return match[1].toLowerCase();
	}
	if (contentType.startsWith("image/")) return contentType.slice("image/".length) || "png";
	if (contentType.startsWith("video/")) return contentType.slice("video/".length) || "mp4";
	return "bin";
}

function inferAssetType(contentType: string): "image" | "video" | "file" {
	const ct = normalizeContentType(contentType);
	if (ct.startsWith("image/")) return "image";
	if (ct.startsWith("video/")) return "video";
	return "file";
}

function buildPublicUploadKey(userId: string, ext: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const now = new Date();
	const datePrefix = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(
		2,
		"0",
	)}${String(now.getUTCDate()).padStart(2, "0")}`;
	return `uploads/user/${safeUser}/${datePrefix}/${crypto.randomUUID()}.${ext || "bin"}`;
}

function decodeDataUrl(input: string): { contentType: string; bytes: Uint8Array } | null {
	const raw = String(input || "").trim();
	const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
	if (!match) return null;
	const contentType = normalizeContentType(match[1]);
	const base64 = String(match[2] || "").replace(/\s+/g, "");
	if (!base64) return null;
	try {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return { contentType, bytes };
	} catch {
		return null;
	}
}

async function readBodyFromSourceUrl(
	sourceUrl: string,
): Promise<{ contentType: string; bytes: Uint8Array }> {
	const url = String(sourceUrl || "").trim();
	if (!/^https?:\/\//i.test(url)) {
		throw new AppError("sourceUrl 只支持 http/https", {
			status: 400,
			code: "invalid_source_url",
		});
	}
	const res = await fetch(url);
	if (!res.ok) {
		throw new AppError(`sourceUrl 下载失败: ${res.status}`, {
			status: 400,
			code: "source_fetch_failed",
			details: { status: res.status, url: url.slice(0, 300) },
		});
	}
	const contentType = normalizeContentType(res.headers.get("content-type"));
	const lenHeader = res.headers.get("content-length");
	const declaredLen =
		typeof lenHeader === "string" && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;
	if (typeof declaredLen === "number" && Number.isFinite(declaredLen) && declaredLen > PUBLIC_OSS_MAX_BYTES) {
		throw new AppError("文件过大（最大 30MB）", {
			status: 413,
			code: "file_too_large",
			details: { contentLength: declaredLen, maxBytes: PUBLIC_OSS_MAX_BYTES },
		});
	}
	const buf = new Uint8Array(await res.arrayBuffer());
	if (buf.byteLength > PUBLIC_OSS_MAX_BYTES) {
		throw new AppError("文件过大（最大 30MB）", {
			status: 413,
			code: "file_too_large",
			details: { contentLength: buf.byteLength, maxBytes: PUBLIC_OSS_MAX_BYTES },
		});
	}
	return { contentType, bytes: buf };
}

type PublicVendorAuth = {
	authType: "none" | "bearer" | "x-api-key" | "query";
	authHeader: string | null;
	authQueryParam: string | null;
};

async function resolvePublicVendorAuth(
	c: any,
	vendorKey: string,
): Promise<PublicVendorAuth | null> {
	const vk = String(vendorKey || "").trim().toLowerCase();
	if (!vk) return null;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await getPrismaClient().model_catalog_vendors.findFirst({
			where: {
				key: {
					equals: vk,
					mode: "insensitive",
				},
			},
			select: {
				auth_type: true,
				auth_header: true,
				auth_query_param: true,
			},
		});
		if (!row) return null;
		const authTypeRaw =
			typeof row?.auth_type === "string" ? row.auth_type.trim().toLowerCase() : "";
		const authType =
			authTypeRaw === "none" ||
			authTypeRaw === "bearer" ||
			authTypeRaw === "x-api-key" ||
			authTypeRaw === "query"
				? (authTypeRaw as PublicVendorAuth["authType"])
				: "bearer";
		const authHeader =
			typeof row?.auth_header === "string" && row.auth_header.trim()
				? row.auth_header.trim()
				: null;
		const authQueryParam =
			typeof row?.auth_query_param === "string" && row.auth_query_param.trim()
				? row.auth_query_param.trim()
				: null;
		return { authType, authHeader, authQueryParam };
	} catch {
		return null;
	}
}

function normalizeGeminiPublicBaseUrl(raw: string): string {
	const normalized = (raw || "").trim().replace(/\/+$/, "");
	if (!normalized) return "https://generativelanguage.beqlee.icu";
	try {
		const url = new URL(normalized);
		if (url.hostname.toLowerCase() !== "generativelanguage.googleapis.com") {
			return normalized;
		}
		const target = new URL("https://generativelanguage.beqlee.icu");
		url.protocol = target.protocol;
		url.hostname = target.hostname;
		url.port = target.port;
		return url.toString().replace(/\/+$/, "");
	} catch {
		return normalized;
	}
}

function normalizeGeminiCompatibleBaseForUpload(raw: string): string {
	const trimmed = normalizeGeminiPublicBaseUrl(raw).trim().replace(/\/+$/, "");
	if (!trimmed) return trimmed;
	return trimmed
		.replace(/\/openai\/v\d+(?:beta)?$/i, "")
		.replace(/\/v\d+(?:beta)?\/openai$/i, "")
		.replace(/\/openai$/i, "")
		.replace(/\/v\d+(?:beta)?$/i, "");
}

function applyPublicVendorAuth(options: {
	url: string;
	headers: Record<string, string>;
	apiKey: string;
	auth: PublicVendorAuth | null;
}): string {
	let url = options.url;
	const headers = options.headers;
	const apiKey = options.apiKey;
	const auth = options.auth;
	if (auth?.authType === "none") return url;
	if (auth?.authType === "query") {
		const param = auth.authQueryParam || "key";
		const u = new URL(url);
		u.searchParams.set(param, apiKey);
		return u.toString();
	}
	if (auth?.authType === "x-api-key") {
		const header = auth.authHeader || "X-API-Key";
		headers[header] = apiKey;
		if (!auth.authHeader) headers["x-goog-api-key"] = apiKey;
		return url;
	}
	const header = auth?.authHeader || "Authorization";
	headers[header] = `Bearer ${apiKey}`;
	return url;
}

async function uploadVideoToGeminiAndGetFileUri(options: {
	c: any;
	userId: string;
	bytes: Uint8Array;
	contentType: string;
	displayName?: string;
}): Promise<string> {
	const { c, userId, bytes } = options;
	const contentType = normalizeContentType(options.contentType || "video/mp4");
	if (!/^video\//i.test(contentType)) {
		throw new AppError("视频理解只支持 video/* MIME", {
			status: 400,
			code: "invalid_video_content_type",
			details: { contentType },
		});
	}
	if (!bytes.byteLength) {
		throw new AppError("视频文件为空", {
			status: 400,
			code: "empty_video_file",
		});
	}
	if (bytes.byteLength > PUBLIC_OSS_MAX_BYTES) {
		throw new AppError("视频文件过大（最大 30MB）", {
			status: 413,
			code: "file_too_large",
			details: { contentLength: bytes.byteLength, maxBytes: PUBLIC_OSS_MAX_BYTES },
		});
	}

	const ctx = await resolveVendorContext(c, userId, "gemini");
	const apiKey = String(ctx.apiKey || "").trim();
	if (!apiKey) {
		throw new AppError("未配置 Gemini API Key", {
			status: 400,
			code: "gemini_api_key_missing",
		});
	}

	const auth = await resolvePublicVendorAuth(c, "gemini");
	const base = normalizeGeminiCompatibleBaseForUpload(String(ctx.baseUrl || ""));
	const uploadHeaders: Record<string, string> = {
		Accept: "application/json",
	};
	let uploadUrl = `${base}/upload/v1beta/files`;
	uploadUrl = applyPublicVendorAuth({
		url: uploadUrl,
		headers: uploadHeaders,
		apiKey,
		auth,
	});

	const form = new FormData();
	const displayName = sanitizeUploadName(options.displayName || "") || `video-${Date.now()}`;
	form.append(
		"metadata",
		new Blob([JSON.stringify({ file: { display_name: displayName } })], {
			type: "application/json",
		}),
	);
	form.append("file", new Blob([Buffer.from(bytes)], { type: contentType }), `${displayName}.mp4`);

	const uploadRes = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			...uploadHeaders,
			"X-Goog-Upload-Protocol": "multipart",
		},
		body: form,
	});
	const uploadJson = await uploadRes.json().catch(() => null);
	if (!uploadRes.ok) {
		throw new AppError(`Gemini 文件上传失败: ${uploadRes.status}`, {
			status: 502,
			code: "gemini_file_upload_failed",
			details: { upstreamStatus: uploadRes.status, upstreamData: uploadJson },
		});
	}

	const directUri =
		(typeof uploadJson?.file?.uri === "string" && uploadJson.file.uri.trim()) ||
		(typeof uploadJson?.uri === "string" && uploadJson.uri.trim()) ||
		"";
	if (directUri) return directUri;

	const fileName =
		(typeof uploadJson?.file?.name === "string" && uploadJson.file.name.trim()) ||
		(typeof uploadJson?.name === "string" && uploadJson.name.trim()) ||
		"";
	if (!fileName) {
		throw new AppError("Gemini 上传成功但未返回 file uri/name", {
			status: 502,
			code: "gemini_file_uri_missing",
			details: { upstreamData: uploadJson },
		});
	}

	const getHeaders: Record<string, string> = { Accept: "application/json" };
	let getUrl = `${base}/v1beta/${fileName.replace(/^\/+/, "")}`;
	getUrl = applyPublicVendorAuth({ url: getUrl, headers: getHeaders, apiKey, auth });

	const getRes = await fetch(getUrl, { method: "GET", headers: getHeaders });
	const getJson = await getRes.json().catch(() => null);
	if (!getRes.ok) {
		throw new AppError(`Gemini 文件查询失败: ${getRes.status}`, {
			status: 502,
			code: "gemini_file_get_failed",
			details: { upstreamStatus: getRes.status, upstreamData: getJson },
		});
	}
	const uri =
		(typeof getJson?.uri === "string" && getJson.uri.trim()) ||
		(typeof getJson?.file?.uri === "string" && getJson.file.uri.trim()) ||
		"";
	if (!uri) {
		throw new AppError("Gemini 文件查询未返回 uri", {
			status: 502,
			code: "gemini_file_uri_missing",
			details: { upstreamData: getJson },
		});
	}
	return uri;
}

function requirePublicUserId(c: any): string {
	const userId = c.get("userId");
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}
	return userId;
}

// ---- Management (dashboard) ----

apiKeyRouter.use("*", authMiddleware);

apiKeyRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const keys = await listApiKeys(c, userId);
	return c.json(ApiKeySchema.array().parse(keys));
});

apiKeyRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createApiKey(c, userId, parsed.data);
	return c.json(CreateApiKeyResponseSchema.parse(result));
});

apiKeyRouter.patch("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpdateApiKeyRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await updateApiKey(c, userId, id, parsed.data);
	return c.json(ApiKeySchema.parse(result));
});

apiKeyRouter.delete("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	await deleteApiKey(c, userId, id);
	return c.body(null, 204);
});

// ---- Public (API key + Origin allowlist) ----

// Ensure public endpoints always return structured JSON errors (instead of a plain 500).
publicApiRouter.use("*", errorMiddleware);
// Mark /public routes so downstream vendor routing can apply public heuristics even without an API key.
publicApiRouter.use("*", async (c, next) => {
	c.set("publicApi", true);
	return next();
});
publicApiRouter.use("*", apiKeyAuthMiddleware);
registerPublicFlowRoutes(publicApiRouter);
registerPublicAgentsToolBridgeRoutes(publicApiRouter);

const PublicAgentsChatOpenApiRoute = createRoute({
	method: "post",
	path: "/agents/chat",
	tags: [PUBLIC_TAG],
	summary: "Agents 对话 /public/agents/chat",
	description:
		"新的 agents 专用对话链路。该入口不再经过旧的多 vendor 公共聊天编排，只负责把用户/项目/画布工具事实透传给 agents-cli。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: AgentsChatRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: AgentsChatResponseSchema,
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: { "application/json": { schema: PublicValidationErrorSchema } },
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});


function normalizePublicChatReferenceImages(
	value: unknown,
	origin: string,
): string[] {
	return publicChatAssetNormalizer.normalizeReferenceImages(value, origin);
}

function isResponsesStylePublicChatInput(input: Record<string, unknown>): boolean {
	return (
		typeof input.model === "string" ||
		typeof input.instructions === "string" ||
		typeof input.input === "string" ||
		Array.isArray(input.input)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type TraceEventLite = {
	stage: string;
	meta?: Record<string, unknown>;
};

function coerceTraceEvents(value: unknown): TraceEventLite[] {
	if (!Array.isArray(value)) return [];
	const out: TraceEventLite[] = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		const stageRaw = typeof item.stage === "string" ? item.stage.trim() : "";
		if (!stageRaw) continue;
		const meta = isRecord(item.meta) ? item.meta : undefined;
		out.push({ stage: stageRaw, ...(meta ? { meta } : {}) });
	}
	return out;
}

// Public stream must not fabricate progress. Emit only observable server-side stages.
function formatPublicChatThinkingFromTraceEvent(ev: TraceEventLite): string | null {
	if (!ev.stage.startsWith("public:")) return null;

	if (ev.stage === "public:run:begin") return "已接收请求，开始执行";

	if (ev.stage === "public:vendors:resolved") {
		const candidatesRaw = ev.meta?.vendorCandidates;
		const candidates = Array.isArray(candidatesRaw)
			? candidatesRaw
					.map((x) => (typeof x === "string" ? x.trim() : ""))
					.filter(Boolean)
					.slice(0, 6)
			: [];
		return candidates.length ? `已解析候选通道：${candidates.join(", ")}` : "已解析候选通道";
	}

	if (ev.stage === "public:vendor:attempt") {
		const vendor =
			typeof ev.meta?.dispatchVendor === "string"
				? ev.meta.dispatchVendor.trim()
				: typeof ev.meta?.vendorCandidate === "string"
					? ev.meta.vendorCandidate.trim()
					: "";
		return vendor ? `正在调用通道：${vendor}` : "正在调用通道";
	}

	if (ev.stage === "public:vendor:task_failed") {
		const vendor = typeof ev.meta?.vendor === "string" ? ev.meta.vendor.trim() : "";
		return vendor ? `通道返回 failed：${vendor}` : "通道返回 failed";
	}

	if (ev.stage === "public:vendor:error") {
		const vendor =
			typeof ev.meta?.dispatchVendor === "string" ? ev.meta.dispatchVendor.trim() : "";
		const code = typeof ev.meta?.code === "string" ? ev.meta.code.trim() : "";
		const status = typeof ev.meta?.status === "number" ? String(ev.meta.status) : "";
		const bits = [vendor && `通道=${vendor}`, code && `code=${code}`, status && `status=${status}`]
			.filter(Boolean)
			.join(", ");
		return bits ? `通道调用出错（${bits}）` : "通道调用出错";
	}

	if (ev.stage === "public:agent:todo_write") {
		const text = typeof ev.meta?.text === "string" ? ev.meta.text.trim() : "";
		return text ? `Todo\n${text}` : "Todo 已更新";
	}

	return `执行阶段：${ev.stage}`;
}

function normalizeResponsesInputToPromptAndImages(
	inputValue: unknown,
	origin: string,
): { prompt: string; referenceImages: string[]; toolOutputs: string[] } {
	if (typeof inputValue === "string") {
		return { prompt: inputValue.trim(), referenceImages: [], toolOutputs: [] };
	}
	if (!Array.isArray(inputValue)) {
		return { prompt: "", referenceImages: [], toolOutputs: [] };
	}

	const textChunks: string[] = [];
	const imageCandidates: string[] = [];
	const toolOutputs: string[] = [];
	const latestUserTexts: string[] = [];

	for (const item of inputValue) {
		if (!item || typeof item !== "object") continue;
		const entry = item as Record<string, unknown>;
		const entryType = typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
		if (entryType === "function_call_output") {
			const output =
				typeof entry.output === "string"
					? entry.output.trim()
					: typeof entry.content === "string"
						? entry.content.trim()
						: "";
			if (output) toolOutputs.push(output);
			continue;
		}
		if (entryType === "tool_result") {
			if (typeof entry.content === "string" && entry.content.trim()) {
				toolOutputs.push(entry.content.trim());
				continue;
			}
			if (Array.isArray(entry.content)) {
				const merged = entry.content
					.map((part: any) =>
						typeof part?.text === "string"
							? part.text
							: typeof part?.output_text === "string"
								? part.output_text
								: "",
					)
					.join("")
					.trim();
				if (merged) toolOutputs.push(merged);
			}
			continue;
		}

		const message = item as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role.trim().toLowerCase() : "";
		if (role !== "user" && role !== "assistant") continue;

		const content = message.content;
		if (typeof content === "string") {
			const text = content.trim();
			if (text) {
				textChunks.push(text);
				if (role === "user") latestUserTexts.push(text);
			}
			continue;
		}
		if (!Array.isArray(content)) continue;

		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const partObj = part as Record<string, unknown>;
			const type = typeof partObj.type === "string" ? partObj.type.trim().toLowerCase() : "";
			if (type === "input_text" || type === "text") {
				const text = typeof partObj.text === "string" ? partObj.text.trim() : "";
				if (text) {
					textChunks.push(text);
					if (role === "user") latestUserTexts.push(text);
				}
				continue;
			}
			if (type === "input_image" || type === "image_url") {
				const imageUrl =
					typeof partObj.image_url === "string"
						? partObj.image_url.trim()
						: partObj.image_url &&
							  typeof partObj.image_url === "object" &&
							  typeof (partObj.image_url as Record<string, unknown>).url === "string"
							? String((partObj.image_url as Record<string, unknown>).url).trim()
							: "";
				if (imageUrl) imageCandidates.push(imageUrl);
			}
		}
	}

	const latestUserText = latestUserTexts.length
		? latestUserTexts[latestUserTexts.length - 1] || ""
		: "";
	const basePrompt =
		latestUserText ||
		(textChunks.length ? textChunks[textChunks.length - 1] || "" : "");
	const toolContext =
		toolOutputs.length > 0
			? `\n\n[Tool Outputs]\n${toolOutputs.map((t, i) => `#${i + 1}\n${t}`).join("\n\n")}`
			: "";
	return {
		prompt: `${basePrompt}${toolContext}`.trim(),
		referenceImages: normalizePublicChatReferenceImages(imageCandidates, origin),
		toolOutputs,
	};
}

function stripMarkdownCodeFence(raw: string): string {
	const text = String(raw || "").trim();
	const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match && match[1] ? match[1].trim() : text;
}

function parseToolCallsFromText(raw: string): Array<{ id: string; name: string; arguments: string }> {
	const text = stripMarkdownCodeFence(raw);
	if (!text) return [];

	const candidates: unknown[] = [];
	try {
		candidates.push(JSON.parse(text));
	} catch {
		// ignore
	}

	const jsonBlockMatch = text.match(/(\[\s*\{[\s\S]*\}\s*\]|\{\s*"tool_calls"[\s\S]*\})/);
	if (jsonBlockMatch && jsonBlockMatch[1]) {
		try {
			candidates.push(JSON.parse(jsonBlockMatch[1]));
		} catch {
			// ignore
		}
	}

	const normalizeToolCall = (
		item: unknown,
	): { id: string; name: string; arguments: string } | null => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as Record<string, unknown>;
		const explicitToolName =
			typeof record.tool_name === "string" ? record.tool_name.trim() : "";
		const functionRecord =
			record.function && typeof record.function === "object" && !Array.isArray(record.function)
				? (record.function as Record<string, unknown>)
				: null;
		const functionName =
			typeof functionRecord?.name === "string" ? functionRecord.name.trim() : "";
		const typedFunctionCall =
			typeof record.type === "string" && record.type.trim().toLowerCase() === "function_call";
		const typedFunctionName = typedFunctionCall && typeof record.name === "string"
			? record.name.trim()
			: "";
		const name = explicitToolName || functionName || typedFunctionName;
		if (!name) return null;
		const argsRaw =
			typeof record.tool_args !== "undefined"
				? record.tool_args
				: typeof record.arguments !== "undefined"
					? record.arguments
					: functionRecord?.arguments;
		const args =
			typeof argsRaw === "string"
				? argsRaw
				: argsRaw && typeof argsRaw === "object"
					? JSON.stringify(argsRaw)
					: "{}";
		return {
			id:
				typeof record.id === "string" && record.id.trim()
					? record.id.trim()
					: typeof record.call_id === "string" && record.call_id.trim()
						? record.call_id.trim()
						: `call_${randomUUID()}`,
			name,
			arguments: args,
		};
	};

	for (const parsed of candidates) {
		const maybeCalls = (() => {
			if (Array.isArray(parsed)) return parsed;
			if (!parsed || typeof parsed !== "object") return [] as unknown[];
			const record = parsed as Record<string, unknown>;
			if (Array.isArray(record.tool_calls)) return record.tool_calls;
			if (typeof record.tool_name === "string") return [record];
			const functionRecord =
				record.function && typeof record.function === "object" && !Array.isArray(record.function)
					? (record.function as Record<string, unknown>)
					: null;
			if (functionRecord && typeof functionRecord.name === "string") return [record];
			if (
				typeof record.type === "string" &&
				record.type.trim().toLowerCase() === "function_call" &&
				typeof record.name === "string"
			) {
				return [record];
			}
			return [] as unknown[];
		})();

		const calls = maybeCalls
			.map((item) => normalizeToolCall(item))
			.filter(
				(item): item is { id: string; name: string; arguments: string } => item !== null,
			);
		if (calls.length > 0) return calls;
	}

	return [];
}

function hasImageEditSourceInExtras(extras: Record<string, any>): boolean {
	const referenceImages = Array.isArray(extras?.referenceImages)
		? extras.referenceImages.filter((u: any) => typeof u === "string" && u.trim())
		: [];
	if (referenceImages.length > 0) return true;
	if (typeof extras?.imageUrl === "string" && extras.imageUrl.trim()) return true;
	if (typeof extras?.imageData === "string" && extras.imageData.trim()) return true;
	if (typeof extras?.inline_data === "string" && extras.inline_data.trim()) return true;
	if (typeof extras?.inlineData === "string" && extras.inlineData.trim()) return true;
	return false;
}

function normalizeImageEditRequestKind(rawRequest: any): any {
	if (!rawRequest || typeof rawRequest !== "object") return rawRequest;
	if (rawRequest.kind !== "image_edit") return rawRequest;
	const extras = { ...((rawRequest.extras || {}) as Record<string, any>) };
	if (hasImageEditSourceInExtras(extras)) return rawRequest;
	return {
		...rawRequest,
		kind: "text_to_image",
		extras,
	};
}

function stripInlineBase64DataUrls(text: string): string {
	const value = String(text || "");
	if (!value) return value;
	return value.replace(
		/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
		"[stripped-base64-data-url]",
	);
}

function looksLikeBareBase64Payload(text: string): boolean {
	const compact = String(text || "").replace(/\s+/g, "");
	if (!compact || compact.length < 1024) return false;
	if (compact.length % 4 !== 0) return false;
	return /^[a-z0-9+/=]+$/i.test(compact);
}

function shouldStripBinaryFieldByName(fieldName: string): boolean {
	const key = String(fieldName || "").trim().toLowerCase();
	if (!key) return false;
	return (
		key.includes("base64") ||
		key.includes("b64") ||
		key.includes("dataurl") ||
		key.includes("data_url") ||
		key.includes("imagedata") ||
		key.includes("image_data") ||
		key.includes("videodata") ||
		key.includes("video_data") ||
		key === "data"
	);
}

function sanitizePublicTaskPayload(value: unknown, fieldName = "", depth = 0): unknown {
	if (depth > 10) return "[stripped-deep-payload]";

	if (typeof value === "string") {
		if (shouldStripBinaryFieldByName(fieldName) && looksLikeBareBase64Payload(value)) {
			return "[stripped-base64]";
		}
		const stripped = stripInlineBase64DataUrls(value);
		if (stripped !== value) return stripped;
		if (shouldStripBinaryFieldByName(fieldName) && looksLikeBareBase64Payload(value)) {
			return "[stripped-base64]";
		}
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) =>
			sanitizePublicTaskPayload(item, fieldName, depth + 1),
		);
	}

	if (!value || typeof value !== "object") return value;

	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (typeof child === "string" && shouldStripBinaryFieldByName(key)) {
			const stripped = stripInlineBase64DataUrls(child);
			out[key] = stripped !== child || looksLikeBareBase64Payload(child)
				? "[stripped-base64]"
				: child;
			continue;
		}
		out[key] = sanitizePublicTaskPayload(child, key, depth + 1);
	}
	return out;
}

function sanitizePublicTaskResult(result: unknown): unknown {
	if (!result || typeof result !== "object") return result;
	const src = result as Record<string, unknown>;
	const out: Record<string, unknown> = { ...src };

	if (Array.isArray(src.assets)) {
		const sanitizedAssets: Array<Record<string, unknown>> = [];
		for (const item of src.assets) {
			if (!item || typeof item !== "object") continue;
			const rawAsset = item as Record<string, unknown>;
			const url = typeof rawAsset.url === "string" ? rawAsset.url.trim() : "";
			if (!url) continue;
			if (/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(url)) continue;
			sanitizedAssets.push({ ...rawAsset, url });
		}
		out.assets = sanitizedAssets;
	}

	if (Object.prototype.hasOwnProperty.call(src, "raw")) {
		out.raw = sanitizePublicTaskPayload(src.raw, "raw", 0);
	}

	return out;
}

export function detectPublicTaskAssetHostingGap(input: {
	originalResult: unknown;
	sanitizedResult: unknown;
}):
	| {
			originalAssetCount: number;
			inlineAssetCount: number;
			hosting: unknown;
	  }
	| null {
	const original =
		input.originalResult && typeof input.originalResult === "object"
			? (input.originalResult as Record<string, unknown>)
			: null;
	const sanitized =
		input.sanitizedResult && typeof input.sanitizedResult === "object"
			? (input.sanitizedResult as Record<string, unknown>)
			: null;
	if (!original || !sanitized) return null;
	if (original.status !== "succeeded") return null;

	const originalAssets = Array.isArray(original.assets)
		? original.assets.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === "object",
			)
		: [];
	if (!originalAssets.length) return null;

	const inlineAssetCount = originalAssets.filter((asset) => {
		const url = typeof asset.url === "string" ? asset.url.trim() : "";
		return /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(url);
	}).length;
	if (inlineAssetCount === 0) return null;

	const sanitizedAssetCount = Array.isArray(sanitized.assets) ? sanitized.assets.length : 0;
	if (sanitizedAssetCount > 0) return null;

	const raw =
		original.raw && typeof original.raw === "object"
			? (original.raw as Record<string, unknown>)
			: null;

	return {
		originalAssetCount: originalAssets.length,
		inlineAssetCount,
		hosting: raw?.hosting ?? null,
	};
}

function isPublicChatDebugEnabled(c: any, input: any): boolean {
	if (input?.debug === true) return true;
	const queryDebug = (c.req.query("debug") || "").trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(queryDebug)) return true;
	const headerDebug = (c.req.header("x-public-chat-debug") || "").trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(headerDebug)) return true;
	return false;
}

function pickPublicChatErrorMessageFromResult(result: any): string | null {
	const raw: any = result?.raw;
	const candidates = [
		raw?.failureReason,
		raw?.message,
		raw?.error,
		raw?.response?.failureReason,
		raw?.response?.failure_reason,
		raw?.response?.error?.message,
		raw?.response?.error_message,
		raw?.response?.error,
		raw?.response?.message,
	];
	for (const value of candidates) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

async function recordPublicChatLogBestEffort(input: {
	c: any;
	userId: string;
	vendor: string;
	taskId: string;
	taskKind: "chat" | "prompt_refine";
	status: "queued" | "running" | "succeeded" | "failed";
	durationMs: number;
	requestPayload: unknown;
	upstreamResponse: unknown;
	errorMessage?: string | null;
}): Promise<void> {
	const nowIso = new Date().toISOString();
	const { c, userId, vendor, taskId } = input;
	if (!userId || !vendor || !taskId) return;
	try {
		await upsertVendorCallLogPayloads(c.env.DB, {
			userId,
			vendor,
			taskId,
			taskKind: input.taskKind,
			request: input.requestPayload,
			upstreamResponse: input.upstreamResponse,
			nowIso,
		});
	} catch (err: any) {
		console.warn(
			"[public-chat] upsert payload log failed",
			err?.message || err,
		);
	}
	try {
		const statusForLog =
			input.status === "failed"
				? "failed"
				: input.status === "running"
					? "running"
					: "succeeded";
		await upsertVendorCallLogFinal(c.env.DB, {
			userId,
			vendor,
			taskId,
			taskKind: input.taskKind,
			status: statusForLog,
			errorMessage: input.errorMessage ?? null,
			durationMs:
				typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
					? Math.max(0, Math.round(input.durationMs))
					: null,
			nowIso,
		});
	} catch (err: any) {
		console.warn(
			"[public-chat] upsert final log failed",
			err?.message || err,
		);
	}
}

function mergeUniqueUrls(urls: string[], limit: number): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of urls) {
		const url = String(raw || "").trim();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
		if (out.length >= limit) break;
	}
	return out;
}

function mergeAssetInputs(
	primary: NormalizedPublicChatAssetInput[],
	fallback: NormalizedPublicChatAssetInput[],
): NormalizedPublicChatAssetInput[] {
	const out: NormalizedPublicChatAssetInput[] = [];
	const seen = new Set<string>();
	for (const item of [...primary, ...fallback]) {
		const key = `${item.role}|${item.url}`;
		if (!item.url || seen.has(key)) continue;
		seen.add(key);
		out.push(item);
		if (out.length >= PublicChatAssetInputNormalizer.MAX_ASSET_INPUTS) break;
	}
	return out;
}

const handlePublicAgentsChat = async (c: AppContext) => {
	return handlePublicAgentsChatRoute(c);
};

publicApiRouter.openapi(PublicAgentsChatOpenApiRoute, handlePublicAgentsChat);

const DEFAULT_PUBLIC_VISION_PROMPT =
	"请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。";

const DEFAULT_PUBLIC_VISION_MODEL_ALIAS = "gemini-3.1-flash-image-preview";

type PublicVisionTaskExtras = {
	imageUrl?: string;
	imageData?: string;
	modelAlias?: string;
	modelKey?: string;
	systemPrompt?: string;
	temperature?: number;
};

type PublicVisionTaskRequest = {
	kind: "image_to_prompt";
	prompt: string;
	extras: PublicVisionTaskExtras;
};

export function buildPublicVisionTaskRequest(
	input: PublicVisionRequestDto,
	params: {
		imageUrl: string | null;
		imageData: string | null;
		prompt: string;
	},
): PublicVisionTaskRequest {
	const modelAlias =
		typeof input.modelAlias === "string" && input.modelAlias.trim()
			? input.modelAlias.trim()
			: "";
	const modelKey =
		typeof input.modelKey === "string" && input.modelKey.trim()
			? input.modelKey.trim()
			: "";
	const extras: PublicVisionTaskExtras = {
		...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
		...(params.imageData ? { imageData: params.imageData } : {}),
		...(modelAlias ? { modelAlias } : {}),
		...(modelKey ? { modelKey } : {}),
		...(typeof input.systemPrompt === "string" && input.systemPrompt.trim()
			? { systemPrompt: input.systemPrompt.trim() }
			: {}),
		...(typeof input.temperature === "number"
			? { temperature: input.temperature }
			: {}),
	};

	if (!modelAlias && !modelKey) {
		extras.modelAlias = DEFAULT_PUBLIC_VISION_MODEL_ALIAS;
	}

	return {
		kind: "image_to_prompt",
		prompt: params.prompt,
		extras,
	};
}

function normalizePublicImageUrl(value: unknown, origin: string): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const base = (origin || "").trim().replace(/\/+$/, "");
	if (base && trimmed.startsWith("/")) return `${base}${trimmed}`;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	return null;
}

const PublicVisionOpenApiRoute = createRoute({
	method: "post",
	path: "/vision",
	tags: [PUBLIC_TAG],
	summary: "图像理解 /public/vision",
	description:
		"便捷图像理解接口：创建 image_to_prompt 任务并直接返回文本（常见用法：根据图片反推可复现的英文提示词）。默认使用 gemini-3.1-flash-image-preview；支持外部 prompt 透传；图片输入支持 imageUrl 或 imageData（二选一）。失败会显式返回错误，不做 draw 降级。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicVisionRequestSchema,
					example: {
						vendor: "auto",
						imageUrl:
							"https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png",
						prompt: DEFAULT_PUBLIC_VISION_PROMPT,
						modelAlias: DEFAULT_PUBLIC_VISION_MODEL_ALIAS,
						temperature: 0.2,
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicVisionResponseSchema,
					example: {
						id: "task_01HXYZ...",
						vendor: "openai",
						text: "A clean minimal logo of a cat...",
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicVisionOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");

	const origin = (() => {
		try {
			return new URL(c.req.url).origin;
		} catch {
			return "";
		}
	})();

	const imageUrl = normalizePublicImageUrl(input.imageUrl, origin);
	const imageData =
		typeof input.imageData === "string" && input.imageData.trim()
			? input.imageData.trim()
			: null;

	if (!imageUrl && !imageData) {
		throw new AppError("imageUrl 或 imageData 必须提供一个", {
			status: 400,
			code: "image_source_missing",
		});
	}

	const promptRaw = typeof input.prompt === "string" ? input.prompt : "";
	const prompt = promptRaw.trim() ? promptRaw : DEFAULT_PUBLIC_VISION_PROMPT;

	const request = buildPublicVisionTaskRequest(input, {
		imageUrl,
		imageData,
		prompt,
	});

	const { vendor, result } = await runPublicTask(c, userId, {
		vendor: input.vendor ?? "auto",
		vendorCandidates: input.vendorCandidates,
		request,
	});
	const raw = result?.raw as { text?: unknown } | null | undefined;
	const text = typeof raw?.text === "string" ? raw.text.trim() : "";
	if (!text) {
		throw new AppError("vision 未返回可用文本，请检查模型映射、图片可达性或上游响应", {
			status: 502,
			code: "vision_empty_text",
			details: {
				vendor,
				taskId: typeof result?.id === "string" ? result.id : null,
				modelAlias:
					typeof request.extras.modelAlias === "string" ? request.extras.modelAlias : null,
			},
		});
	}

	return c.json(
		PublicVisionResponseSchema.parse({
			id: result.id,
			vendor,
			text,
		}),
		200,
	);
});

const PublicOssUploadOpenApiRoute = createRoute({
	method: "post",
	path: "/oss/upload",
	tags: [PUBLIC_TAG],
	summary: "上传到对象存储 /public/oss/upload",
	description:
		"JSON 方式上传文件到对象存储（兼容 RustFS / Cloudflare R2）。支持 sourceUrl（远端 URL）或 dataUrl（base64）。会自动落库为当前用户资产并返回可访问 URL。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicOssUploadRequestSchema,
					example: {
						sourceUrl: "https://example.com/sample.mp4",
						fileName: "sample.mp4",
						contentType: "video/mp4",
						name: "产品演示视频",
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicOssUploadResponseSchema,
					example: {
						id: "asset_01HXYZ...",
						name: "产品演示视频",
						type: "video",
						url: "https://assets.example.com/uploads/user/u_1/20260212/xxx.mp4",
						key: "uploads/user/u_1/20260212/xxx.mp4",
						contentType: "video/mp4",
						size: 1200345,
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicOssUploadOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");
	const rustfsConfig = resolveRustfsConfig(c.env);
	if (!rustfsConfig) {
		throw new AppError("Object storage is not configured", {
			status: 500,
			code: "rustfs_not_configured",
		});
	}

	const sourceUrl = typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "";
	const dataUrl = typeof input.dataUrl === "string" ? input.dataUrl.trim() : "";
	if (!sourceUrl && !dataUrl) {
		throw new AppError("sourceUrl 或 dataUrl 必须提供一个", {
			status: 400,
			code: "upload_source_missing",
		});
	}

	let bodyBytes: Uint8Array;
	let sourceContentType = "application/octet-stream";
	if (dataUrl) {
		const parsed = decodeDataUrl(dataUrl);
		if (!parsed) {
			throw new AppError("dataUrl 格式无效，必须为 data:<mime>;base64,...", {
				status: 400,
				code: "invalid_data_url",
			});
		}
		bodyBytes = parsed.bytes;
		sourceContentType = parsed.contentType;
	} else {
		const fetched = await readBodyFromSourceUrl(sourceUrl);
		bodyBytes = fetched.bytes;
		sourceContentType = fetched.contentType;
	}

	if (bodyBytes.byteLength > PUBLIC_OSS_MAX_BYTES) {
		throw new AppError("文件过大（最大 30MB）", {
			status: 413,
			code: "file_too_large",
			details: { contentLength: bodyBytes.byteLength, maxBytes: PUBLIC_OSS_MAX_BYTES },
		});
	}

	const fileName = sanitizeUploadName(input.fileName || "");
	const contentType = normalizeContentType(input.contentType || sourceContentType);
	const ext = detectUploadExtension({ contentType, fileName: fileName || undefined });
	const key = buildPublicUploadKey(userId, ext);

	const client = createRustfsClient(c.env);
	await client.send(
		new PutObjectCommand({
			Bucket: rustfsConfig.bucket,
			Key: key,
			Body: bodyBytes,
			ContentType: contentType,
			CacheControl: "public, max-age=31536000, immutable",
			ContentLength: bodyBytes.byteLength,
		}),
	);

	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;
	const type = inferAssetType(contentType);
	const name =
		sanitizeUploadName(input.name || "") || fileName || (type === "video" ? "Video" : "File");
	const nowIso = new Date().toISOString();

	const row = await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "upload",
				type,
				url,
				contentType,
				size: bodyBytes.byteLength,
				originalName: fileName || null,
				key,
				prompt: typeof input.prompt === "string" ? input.prompt : null,
				vendor: typeof input.vendor === "string" ? input.vendor : null,
				modelKey: typeof input.modelKey === "string" ? input.modelKey : null,
				taskKind: typeof input.taskKind === "string" ? input.taskKind : null,
			},
			projectId: null,
		},
		nowIso,
	);

	return c.json(
		PublicOssUploadResponseSchema.parse({
			id: row.id,
			name,
			type,
			url,
			key,
			contentType,
			size: bodyBytes.byteLength,
		}),
		200,
	);
});

function extractTaskText(result: any): string {
	const raw = result?.raw || {};
	const resultText = typeof result?.text === "string" ? result.text.trim() : "";
	if (resultText) return resultText;
	const direct = typeof raw?.text === "string" ? raw.text.trim() : "";
	if (direct) return direct;
	const nested = typeof raw?.response?.text === "string" ? raw.response.text.trim() : "";
	if (nested) return nested;
	const outputTextDirect =
		typeof raw?.response?.output_text === "string"
			? raw.response.output_text.trim()
			: typeof raw?.output_text === "string"
				? raw.output_text.trim()
				: "";
	if (outputTextDirect) return outputTextDirect;
	const outputTextArray = Array.isArray(raw?.response?.output_text)
		? raw.response.output_text
				.filter((item: any) => typeof item === "string")
				.join("")
				.trim()
		: "";
	if (outputTextArray) return outputTextArray;
	const choiceContent =
		typeof raw?.response?.choices?.[0]?.message?.content === "string"
			? raw.response.choices[0].message.content.trim()
			: "";
	if (choiceContent) return choiceContent;
	const geminiCandidatesText = Array.isArray(raw?.response?.candidates)
		? raw.response.candidates
				.flatMap((candidate: any) =>
					Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
				)
				.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
				.join("")
				.trim()
		: "";
	if (geminiCandidatesText) return geminiCandidatesText;
	return "";
}

const PublicVideoUnderstandOpenApiRoute = createRoute({
	method: "post",
	path: "/video/understand",
	tags: [PUBLIC_TAG],
	summary: "视频理解 /public/video/understand",
	description:
		"显式视频理解接口。内部走统一任务入口 kind=chat，并透传 videoFileUri/videoMimeType 到上游多模态模型。默认建议不传 vendorCandidates，由系统级动态配置决定可用厂商；只有调用方明确要锁定厂商时再传。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicVideoUnderstandRequestSchema,
					example: {
						vendor: "auto",
						prompt: "请总结视频内容并给出 5 道题（含答案）。",
						videoUrl: "https://example.com/sample.mp4",
						videoMimeType: "video/mp4",
						modelAlias: "gemini-3-flash-preview",
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicVideoUnderstandResponseSchema,
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicVideoUnderstandOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");
	const rawFileUri =
		typeof input.videoFileUri === "string" ? input.videoFileUri.trim() : "";
	const rawVideoUrl = typeof input.videoUrl === "string" ? input.videoUrl.trim() : "";
	const rawVideoData = typeof input.videoData === "string" ? input.videoData.trim() : "";
	const normalizedVideoMimeType =
		typeof input.videoMimeType === "string" && input.videoMimeType.trim()
			? normalizeContentType(input.videoMimeType)
			: "video/mp4";

	const videoFileUri = rawFileUri
		? rawFileUri
		: await (async () => {
				if (rawVideoData) {
					const parsed = decodeDataUrl(rawVideoData);
					if (!parsed) {
						throw new AppError("videoData 格式无效，必须为 data:video/*;base64,...", {
							status: 400,
							code: "invalid_video_data_url",
						});
					}
					return uploadVideoToGeminiAndGetFileUri({
						c,
						userId,
						bytes: parsed.bytes,
						contentType: parsed.contentType || normalizedVideoMimeType,
						displayName: "video-understand",
					});
				}
				if (rawVideoUrl) {
					const fetched = await readBodyFromSourceUrl(rawVideoUrl);
					const contentType = /^video\//i.test(fetched.contentType)
						? fetched.contentType
						: normalizedVideoMimeType;
					return uploadVideoToGeminiAndGetFileUri({
						c,
						userId,
						bytes: fetched.bytes,
						contentType,
						displayName: "video-understand",
					});
				}
				throw new AppError("videoFileUri / videoUrl / videoData 至少提供一个", {
					status: 400,
					code: "video_source_missing",
				});
			})();
	const request = {
		kind: "chat" as const,
		prompt: input.prompt,
		extras: {
			videoFileUri,
			videoMimeType: normalizedVideoMimeType,
			...(typeof input.modelAlias === "string" && input.modelAlias.trim()
				? { modelAlias: input.modelAlias.trim() }
				: {}),
			...(typeof input.modelKey === "string" && input.modelKey.trim()
				? { modelKey: input.modelKey.trim() }
				: {}),
			...(typeof input.systemPrompt === "string" && input.systemPrompt.trim()
				? { systemPrompt: input.systemPrompt.trim() }
				: {}),
			...(typeof input.temperature === "number"
				? { temperature: input.temperature }
				: {}),
		},
	};

	const { vendor, result } = await runPublicTask(c, userId, {
		vendor: input.vendor ?? "auto",
		vendorCandidates: input.vendorCandidates,
		request,
	});
	return c.json(
		PublicVideoUnderstandResponseSchema.parse({
			id: result.id,
			vendor,
			text: extractTaskText(result),
			result,
		}),
		200,
	);
});

function isPublicTaskKindSupported(kind: string): boolean {
	const k = (kind || "").trim();
	return (
		k === "text_to_image" ||
		k === "image_edit" ||
		k === "text_to_video" ||
		k === "chat" ||
		k === "prompt_refine" ||
		k === "image_to_prompt"
	);
}

function pickAutoVendorsForKind(
	kind: string,
	enabledSystemVendors: Set<string>,
	extras?: Record<string, any> | null,
): string[] {
	const hasReferenceImages = (() => {
		const refs = Array.isArray((extras as any)?.referenceImages)
			? (extras as any).referenceImages
			: [];
		return refs.some((v: any) => typeof v === "string" && v.trim());
	})();
	const k = (kind || "").trim();
	if (!isPublicTaskKindSupported(k)) return [];
	const allowAgents = k === "chat" || k === "prompt_refine";
	const preferredOrder =
		k === "chat" && hasReferenceImages
			? ["agents", "apimart", "gemini", "openai", "yunwu"]
			: ["agents", "apimart", "gemini", "openai", "yunwu", "qwen", "anthropic", "veo"];
	const enabled = enabledSystemVendors || new Set<string>();
	const available = Array.from(enabled.values())
		.map((v) => normalizeDispatchVendor(v))
		.filter((v): v is string => !!v && (allowAgents || v !== "agents"))
		.sort((a, b) => a.localeCompare(b));
	const availableSet = new Set(available);
	const prioritized = preferredOrder.filter(
		(v) => availableSet.has(v) && (allowAgents || v !== "agents"),
	);
	const rest = available.filter((v) => !prioritized.includes(v));
	return Array.from(new Set([...prioritized, ...rest]).values());
}

type PublicVendorRoutingPriority = Record<string, string[]>;

let cachedPublicVendorRoutingPriority: { raw: string; priority: PublicVendorRoutingPriority } | null =
	null;

function readPublicVendorRoutingPriority(c: any): PublicVendorRoutingPriority {
	const raw =
		typeof c?.env?.PUBLIC_VENDOR_ROUTING === "string" ? c.env.PUBLIC_VENDOR_ROUTING : "";
	const cached = cachedPublicVendorRoutingPriority;
	if (cached && cached.raw === raw) {
		return cached.priority;
	}

	const empty: PublicVendorRoutingPriority = {};
	if (!raw || !raw.trim()) {
		cachedPublicVendorRoutingPriority = { raw, priority: empty };
		return empty;
	}

	try {
		const parsed = JSON.parse(raw);
		const root =
			parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as any) : null;
		const priorityRaw =
			root && root.priority && typeof root.priority === "object" && !Array.isArray(root.priority)
				? (root.priority as any)
				: root;
		if (!priorityRaw || typeof priorityRaw !== "object" || Array.isArray(priorityRaw)) {
			cachedPublicVendorRoutingPriority = { raw, priority: empty };
			return empty;
		}

		const priority: PublicVendorRoutingPriority = {};
		for (const [keyRaw, value] of Object.entries(priorityRaw)) {
			const key = String(keyRaw || "").trim();
			if (!key) continue;
			const list = Array.isArray(value)
				? value
						.map((v) => (typeof v === "string" ? v.trim() : ""))
						.filter(Boolean)
				: typeof value === "string"
					? value
							.split(",")
							.map((v) => v.trim())
							.filter(Boolean)
					: [];
			if (!list.length) continue;
			priority[key] = list;
		}

		cachedPublicVendorRoutingPriority = { raw, priority };
		return priority;
	} catch {
		cachedPublicVendorRoutingPriority = { raw, priority: empty };
		return empty;
	}
}

function uniqNormalizedVendors(input: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of input) {
		const v = normalizeDispatchVendor(item);
		if (!v || seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}

function resolvePublicVendorPriorityList(
	c: any,
	taskKind: string | null | undefined,
): string[] {
	const config = readPublicVendorRoutingPriority(c);
	const kind = typeof taskKind === "string" ? taskKind.trim() : "";
	if (!kind) return [];

	const catalogKind = resolveCatalogKindForTaskKind(kind);
	const raw =
		(Array.isArray(config[kind]) && config[kind]) ||
		(catalogKind && Array.isArray(config[catalogKind]) ? config[catalogKind] : null) ||
		(Array.isArray(config.default) && config.default) ||
		(Array.isArray(config["*"]) && config["*"]) ||
		[];
	return uniqNormalizedVendors(raw);
}

function reorderCandidatesByVendorOrder(candidates: string[], order: string[]): string[] {
	if (candidates.length <= 1) return candidates.slice();
	const normalizedOrder = uniqNormalizedVendors(order);
	if (!normalizedOrder.length) return candidates.slice();

	const used = new Set<number>();
	const out: string[] = [];
	for (const preferredVendor of normalizedOrder) {
		const idx = candidates.findIndex((candidate, i) => {
			if (used.has(i)) return false;
			return normalizeDispatchVendor(candidate) === preferredVendor;
		});
		if (idx >= 0) {
			used.add(idx);
			out.push(candidates[idx]!);
		}
	}
	for (let i = 0; i < candidates.length; i += 1) {
		if (!used.has(i)) out.push(candidates[i]!);
	}
	return out;
}

function resolvePinnedVendorsForPublicRequest(request: any): string[] {
	const kind = typeof request?.kind === "string" ? request.kind.trim() : "";
	if (!kind) return [];

	if (kind === "chat" || kind === "prompt_refine") {
		// If agents bridge is enabled, it will be included in enabledSystemVendors and tried first.
		// Otherwise it will be filtered out and have no effect.
		return ["agents"];
	}

	const extras = (request?.extras || {}) as Record<string, any>;

	if (kind === "text_to_image" || kind === "image_edit") {
		const pinned: string[] = [];

		const modelAliasRaw =
			typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
				? extras.modelAlias.trim()
				: "";
		if (/^nano-banana/i.test(modelAliasRaw)) {
			// Nano Banana 默认优先走 gemini（grsai draw / 官方 Banana 能力），降低 apimart 线路抖动影响。
			pinned.push("gemini");
		}

		const width = typeof request?.width === "number" ? request.width : null;
		const height = typeof request?.height === "number" ? request.height : null;
		const wantsStrictSize =
			(typeof width === "number" && Number.isFinite(width) && width > 0) ||
			(typeof height === "number" && Number.isFinite(height) && height > 0);
		if (wantsStrictSize) pinned.unshift("qwen");

		return pinned;
	}

	return [];
}

async function listEnabledSystemVendors(c: any): Promise<Set<string>> {
	const isLocalDevRequest = () => {
		try {
			const url = new URL(c?.req?.url);
			const host = url.hostname;
			return (
				host === "localhost" ||
				host === "127.0.0.1" ||
				host === "0.0.0.0" ||
				host === "::1"
			);
		} catch {
			return false;
		}
	};

	const agentsEnabled = isAgentsBridgeEnabled(c as any);

	try {
		await ensureModelCatalogSchema(c.env.DB);
		const [vendorsRows, keyRows] = await Promise.all([
			getPrismaClient().model_catalog_vendors.findMany({
				select: { key: true, enabled: true, auth_type: true },
			}),
			getPrismaClient().model_catalog_vendor_api_keys.findMany({
				select: { vendor_key: true, enabled: true, api_key: true },
			}),
		]);

		const enabledKeyVendors = new Set<string>();
		for (const row of keyRows) {
			const vendorKeyRaw =
				typeof row?.vendor_key === "string"
					? row.vendor_key.trim()
					: "";
			const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
			if (!vendorKey) continue;
			if (Number(row?.enabled ?? 1) === 0) continue;

			const apiKey =
				typeof row?.api_key === "string"
					? row.api_key
					: "";
			if (!apiKey || !String(apiKey).trim()) continue;

			enabledKeyVendors.add(vendorKey);
		}

		const enabledVendors = new Set<string>();
		for (const row of vendorsRows) {
			const vendorKeyRaw =
				typeof row?.key === "string"
					? row.key.trim()
					: "";
			const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
			if (!vendorKey) continue;
			if (Number(row?.enabled ?? 1) === 0) continue;

			const authType =
				typeof row?.auth_type === "string"
					? row.auth_type.trim().toLowerCase()
					: "";
			if (authType === "none" || enabledKeyVendors.has(vendorKey)) {
				enabledVendors.add(vendorKey);
			}
		}

		if (agentsEnabled) enabledVendors.add("agents");
		return enabledVendors;
	} catch (err: any) {
		if (isLocalDevRequest()) {
			console.warn(
				"[public-api] listEnabledSystemVendors failed",
				err?.message || err,
			);
		}
		return agentsEnabled ? new Set(["agents"]) : new Set();
	}
}

async function listEnabledUserVendors(c: any, userId: string): Promise<Set<string>> {
	const enabled = new Set<string>();
	const uid = typeof userId === "string" ? userId.trim() : "";
	if (!uid) return enabled;

	// 1) User proxy configs (proxy_providers)
	try {
		const rows = await getPrismaClient().proxy_providers.findMany({
			where: { owner_id: uid, enabled: 1 },
			select: { vendor: true, enabled_vendors: true },
		});

		for (const row of rows) {
			const vendorRaw = typeof row?.vendor === "string" ? row.vendor.trim() : "";
			const vendor = normalizeDispatchVendor(vendorRaw);
			if (vendor) enabled.add(vendor);

			const enabledVendorsRaw =
				typeof row?.enabled_vendors === "string" ? row.enabled_vendors.trim() : "";
			if (enabledVendorsRaw) {
				try {
					const parsed = JSON.parse(enabledVendorsRaw);
					if (Array.isArray(parsed)) {
						for (const item of parsed) {
							const v = normalizeDispatchVendor(typeof item === "string" ? item : "");
							if (v) enabled.add(v);
						}
					}
				} catch {
					// ignore malformed json
				}
			}
		}
	} catch {
		// best-effort only
	}

	// 2) User-owned model tokens (model_providers + model_tokens)
	try {
		const rows = await getPrismaClient().model_tokens.findMany({
			where: {
				user_id: uid,
				enabled: 1,
				model_providers: { owner_id: uid },
			},
			select: { model_providers: { select: { vendor: true } } },
			distinct: ["provider_id"],
		});
		for (const row of rows) {
			const vendorRaw =
				typeof row.model_providers?.vendor === "string"
					? row.model_providers.vendor.trim()
					: "";
			const vendor = normalizeDispatchVendor(vendorRaw);
			if (vendor) enabled.add(vendor);
		}
	} catch {
		// best-effort only
	}

	// 3) Shared tokens pool (cross-user)
	try {
		const nowIso = new Date().toISOString();
		const rows = await getPrismaClient().model_tokens.findMany({
			where: {
				shared: 1,
				enabled: 1,
				OR: [
					{ shared_disabled_until: null },
					{ shared_disabled_until: { lt: nowIso } },
				],
			},
			select: { model_providers: { select: { vendor: true } } },
			distinct: ["provider_id"],
		});
		for (const row of rows) {
			const vendorRaw =
				typeof row.model_providers?.vendor === "string"
					? row.model_providers.vendor.trim()
					: "";
			const vendor = normalizeDispatchVendor(vendorRaw);
			if (vendor) enabled.add(vendor);
		}
	} catch {
		// best-effort only
	}

	// Never include agents from user config (agents bridge is a separate runtime flag).
	enabled.delete("agents");
	return enabled;
}

function filterVendorsByEnabledSystemConfig(
	candidates: string[],
	enabledSystemVendors: Set<string>,
): string[] {
	const output: string[] = [];
	for (const candidate of candidates) {
		const v = normalizeDispatchVendor(candidate);
		if (!v) continue;
		if (!enabledSystemVendors.has(v)) continue;
		if (!output.includes(candidate)) output.push(candidate);
	}
	return output;
}

function resolveCatalogKindForTaskKind(
	taskKind: string | null | undefined,
): "text" | "image" | "video" | null {
	const k = (taskKind || "").trim();
	if (!k) return null;
	if (k === "chat" || k === "prompt_refine" || k === "image_to_prompt") return "text";
	if (k === "text_to_image" || k === "image_edit") return "image";
	if (k === "text_to_video" || k === "image_to_video") return "video";
	return null;
}

function isCatalogModelKindCompatibleForTaskKind(
	taskKind: string | null | undefined,
	modelKind: string | null | undefined,
): boolean {
	const expectedKind = resolveCatalogKindForTaskKind(taskKind);
	const kindRaw = typeof modelKind === "string" ? modelKind.trim() : "";
	if (!expectedKind || !kindRaw) return true;
	if (kindRaw === expectedKind) return true;
	return taskKind?.trim() === "image_to_prompt" && expectedKind === "text" && kindRaw === "image";
}

async function rankVendorsByRecentPerformance(
	c: any,
	userId: string,
	taskKind: string | null | undefined,
	vendorCandidates: string[],
): Promise<string[]> {
	if (!vendorCandidates.length) return [];
	const deduped = Array.from(
		new Set(vendorCandidates.map((v) => normalizeDispatchVendor(v)).filter(Boolean)),
	);
	if (deduped.length <= 1) return deduped;

	const taskKindFilter = typeof taskKind === "string" && taskKind.trim() ? taskKind.trim() : null;
	const isVideoTaskKind =
		taskKindFilter === "text_to_video" || taskKindFilter === "image_to_video";

	try {
		await ensureVendorCallLogsSchema(c.env.DB);
	} catch {
		return deduped;
	}

	const scoreVendor = async (vendor: string) => {
		const v = normalizeDispatchVendor(vendor);
		if (!v) return { vendor, rate: 0.5, total: 0, avgMs: Number.POSITIVE_INFINITY };
		try {
			const sinceIso = new Date(
				Date.now() - 7 * 24 * 60 * 60 * 1000,
			).toISOString();
			const rows = await getPrismaClient().vendor_api_call_logs.findMany({
				where: {
					user_id: userId,
					vendor: v,
					status: { in: ["succeeded", "failed"] },
					finished_at: { not: null },
					...(taskKindFilter ? { task_kind: taskKindFilter } : {}),
					...(!isVideoTaskKind ? { finished_at: { gte: sinceIso } } : {}),
				},
				select: { status: true, duration_ms: true },
			});

			const total = rows.length;
			const success = rows.filter((row) => row.status === "succeeded").length;
			const successDurations = rows
				.filter((row) => row.status === "succeeded")
				.map((row) => row.duration_ms)
				.filter(
					(duration): duration is number =>
						typeof duration === "number" && Number.isFinite(duration),
				);
			const avgMs =
				successDurations.length > 0
					? successDurations.reduce((sum, duration) => sum + duration, 0) /
						successDurations.length
					: Number.POSITIVE_INFINITY;
			const rate = (success + 1) / (total + 2); // Laplace smoothing
			return { vendor: v, rate, total, avgMs };
		} catch {
			return { vendor: v, rate: 0.5, total: 0, avgMs: Number.POSITIVE_INFINITY };
		}
	};

	const scored = await Promise.all(deduped.map((v) => scoreVendor(v)));

	if (isVideoTaskKind) {
		const MIN_CALLS_PER_VENDOR = 100;
		const isWarm = scored.every((s) => s.total >= MIN_CALLS_PER_VENDOR);
		if (!isWarm) return deduped;

		const sorted = scored.sort((a, b) => {
			if (b.rate !== a.rate) return b.rate - a.rate;
			if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs;
			if (b.total !== a.total) return b.total - a.total;
			return a.vendor.localeCompare(b.vendor);
		});
		return sorted.map((s) => s.vendor);
	}

	const enriched = scored.map((s) => ({
		...s,
		// Prefer faster expected time-to-success (avgMs / successRate), then more reliable.
		expectedMs:
			s.avgMs === Number.POSITIVE_INFINITY
				? Number.POSITIVE_INFINITY
				: s.avgMs / Math.max(0.001, s.rate),
	}));
	const sorted = enriched.sort((a, b) => {
		if (a.expectedMs !== b.expectedMs) return a.expectedMs - b.expectedMs;
		if (b.rate !== a.rate) return b.rate - a.rate;
		if (a.avgMs !== b.avgMs) return a.avgMs - b.avgMs;
		if (b.total !== a.total) return b.total - a.total;
		return a.vendor.localeCompare(b.vendor);
	});
	return sorted.map((s) => s.vendor);
}

async function resolvePreferredVendorFromModelCatalog(
	c: any,
	taskKind: string | null | undefined,
	extras: Record<string, any>,
	vendorCandidates: string[],
): Promise<string | null> {
	const raw =
		typeof extras?.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: "";
	if (!raw) return null;

	const eligibleVendorKeys = await listEligibleVendorKeysByModelKey(
		c as AppContext,
		taskKind,
		raw,
	);
	if (!eligibleVendorKeys.size) return null;

	for (const candidateVendor of vendorCandidates) {
		const normalized = normalizeDispatchVendor(candidateVendor);
		if (normalized && eligibleVendorKeys.has(normalized)) return normalized;
	}

	// Fall back to deterministic pick to preserve legacy behavior
	// (modelKey may map to vendors outside the default candidate list).
	const sorted = Array.from(eligibleVendorKeys.values()).sort((a, b) =>
		a.localeCompare(b),
	);
	return sorted[0] || null;
}

async function resolveVendorModelKeyMapByExactModelKey(
	c: AppContext,
	taskKind: string | null | undefined,
	modelKeyRaw: string,
): Promise<Map<string, string>> {
	const raw = String(modelKeyRaw || "").trim();
	if (!raw) return new Map<string, string>();

	const candidates = Array.from(
		new Set([raw, raw.startsWith("models/") ? raw.slice(7) : ""]).values(),
	).filter(Boolean);

	for (const modelKey of candidates) {
		try {
			const rows = await listCatalogModelsByModelKey(c.env.DB, modelKey);
			if (!rows.length) continue;

			const vendorModelKeyMap = new Map<string, string>();
			for (const row of rows) {
				if (!row) continue;
				if (Number(row.enabled ?? 1) === 0) continue;
				if (!isCatalogModelKindCompatibleForTaskKind(taskKind, row.kind)) continue;
				const vendorKeyRaw =
					typeof row.vendor_key === "string" ? row.vendor_key.trim() : "";
				const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
				const resolvedModelKey =
					typeof row.model_key === "string" ? row.model_key.trim() : "";
				if (!vendorKey || !resolvedModelKey) continue;
				if (!vendorModelKeyMap.has(vendorKey)) {
					vendorModelKeyMap.set(vendorKey, resolvedModelKey);
				}
			}

			if (vendorModelKeyMap.size) return vendorModelKeyMap;
		} catch {
			continue;
		}
	}

	return new Map<string, string>();
}

async function listEligibleVendorKeysByModelKey(
	c: AppContext,
	taskKind: string | null | undefined,
	modelKeyRaw: string,
): Promise<Set<string>> {
	const vendorModelKeyMap = await resolveVendorModelKeyMapByExactModelKey(
		c,
		taskKind,
		modelKeyRaw,
	);
	return new Set<string>(vendorModelKeyMap.keys());
}

type ResolvedPublicTaskVendors = {
	vendorRaw: string;
	enabledSystemVendors: Set<string>;
	rawCandidates: string[];
	vendorCandidates: string[];
	modelAliasRaw: string;
	aliasMap: Map<string, string> | null;
};

export async function resolvePublicTaskVendors(
	c: any,
	userId: string,
	inputVendor: unknown,
	request: any,
	inputVendorCandidates?: unknown,
): Promise<ResolvedPublicTaskVendors> {
	const extras = (request?.extras || {}) as Record<string, any>;
	const taskKind = typeof request?.kind === "string" ? request.kind.trim() : "";
	const vendorRaw = ((typeof inputVendor === "string" ? inputVendor : "") || "auto")
		.trim()
		.toLowerCase();
	const enabledSystemVendors = await listEnabledSystemVendors(c);
	const enabledUserVendors = await (async () => {
		const kind = typeof request?.kind === "string" ? request.kind.trim() : "";
		if (!kind) return new Set<string>();
		if (kind === "chat" || kind === "prompt_refine") return new Set<string>();
		return await listEnabledUserVendors(c, userId);
	})();
	const enabledVendors =
		enabledUserVendors.size > 0
			? new Set<string>([
					...Array.from(enabledSystemVendors.values()),
					...Array.from(enabledUserVendors.values()),
				])
			: enabledSystemVendors;
	const isAutoVendor = vendorRaw === "auto";
	const explicitVendor = !isAutoVendor ? normalizeDispatchVendor(vendorRaw) : "";
	if (explicitVendor && !enabledVendors.has(explicitVendor)) {
		const message =
			explicitVendor === "agents"
				? "Agents（vendor=agents）未启用：请配置 AGENTS_BRIDGE_BASE_URL，或在开发环境启用/默认自动拉起（AGENTS_BRIDGE_AUTOSTART=1）。"
				: "该厂商已禁用或未配置（系统级）";
		throw new AppError(message, {
			status: 400,
			code: "vendor_disabled",
			details: {
				vendorRaw: vendorRaw || null,
				vendor: explicitVendor,
				systemEnabledVendors: Array.from(enabledSystemVendors.values()),
				userEnabledVendors:
					enabledUserVendors.size > 0 ? Array.from(enabledUserVendors.values()) : [],
			},
		});
	}

	const modelKeyRaw =
		typeof extras?.modelKey === "string" && extras.modelKey.trim()
			? extras.modelKey.trim()
			: "";

	let modelAliasRaw =
		typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
			? extras.modelAlias.trim()
			: "";

	const vendorCandidatesHint = (() => {
		if (!isAutoVendor) return [];
		if (!Array.isArray(inputVendorCandidates) || !inputVendorCandidates.length) return [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const item of inputVendorCandidates) {
			if (typeof item !== "string") continue;
			const normalized = normalizeDispatchVendor(item);
			if (!normalized) continue;
			if (seen.has(normalized)) continue;
			seen.add(normalized);
			out.push(normalized);
		}
		return out;
	})();

	const defaultAutoCandidates = modelAliasRaw
		? Array.from(enabledVendors.values()).sort((a, b) => a.localeCompare(b))
		: pickAutoVendorsForKind(request.kind, enabledVendors, extras);
	const rawCandidates = isAutoVendor
		? vendorCandidatesHint.length
			? vendorCandidatesHint
			: defaultAutoCandidates
		: [vendorRaw];
	let vendorCandidates = isAutoVendor
		? filterVendorsByEnabledSystemConfig(rawCandidates, enabledVendors)
		: rawCandidates.filter((v) => !!normalizeDispatchVendor(v));

	// For auto routing, vendorCandidates is only a hint.
	// If hinted vendors are all unavailable, fall back to normal auto candidates
	// instead of failing with no_enabled_vendor.
	if (isAutoVendor && !vendorCandidates.length && vendorCandidatesHint.length) {
		vendorCandidates = filterVendorsByEnabledSystemConfig(
			defaultAutoCandidates,
			enabledVendors,
		);
	}

	const resolveAliasMap = async (modelAlias: string): Promise<Map<string, string>> => {
		try {
			const rows = await listCatalogModelsByModelAlias(c.env.DB, modelAlias);
			const map = new Map<string, string>();
			for (const row of rows) {
				if (!row) continue;
				if (Number((row as any).enabled ?? 1) === 0) continue;
				if (!isCatalogModelKindCompatibleForTaskKind(taskKind, (row as any).kind)) continue;
				const vendorKeyRaw =
					typeof (row as any).vendor_key === "string"
						? (row as any).vendor_key.trim()
						: "";
				const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
				if (!vendorKey) continue;
				const modelKey =
					typeof (row as any).model_key === "string"
						? (row as any).model_key.trim()
						: "";
				if (!modelKey) continue;
				if (!map.has(vendorKey)) map.set(vendorKey, modelKey);
			}
			return map;
		} catch {
			return new Map<string, string>();
		}
	};

	const resolveExactModelKeyMap = async (candidate: string): Promise<Map<string, string>> => {
		try {
			return await resolveVendorModelKeyMapByExactModelKey(
				c as AppContext,
				taskKind,
				candidate,
			);
		} catch {
			return new Map<string, string>();
		}
	};

	let aliasMap: Map<string, string> | null = null;
	const exactModelKeyMap =
		isAutoVendor && !modelAliasRaw && modelKeyRaw
			? await resolveVendorModelKeyMapByExactModelKey(c as AppContext, taskKind, modelKeyRaw)
			: new Map<string, string>();
	const supportedVendorsByModelKey =
		new Set<string>(exactModelKeyMap.keys());

	if (modelAliasRaw) {
		aliasMap = await resolveAliasMap(modelAliasRaw);
		const aliasAsModelKeyMap = await resolveExactModelKeyMap(modelAliasRaw);
		if (aliasAsModelKeyMap.size) {
			const merged = new Map<string, string>(aliasMap ?? []);
			for (const [vendorKey, exactModelKey] of aliasAsModelKeyMap.entries()) {
				if (!merged.has(vendorKey)) merged.set(vendorKey, exactModelKey);
			}
			aliasMap = merged;
		}
	} else if (modelKeyRaw && supportedVendorsByModelKey.size === 0) {
		// Backward/ergonomic compatibility: callers sometimes pass a public model alias via extras.modelKey.
		// Only fall back to alias lookup when exact model_key matching found no eligible vendors.
		const candidate = await resolveAliasMap(modelKeyRaw);
		if (candidate.size) {
			if (isAutoVendor) {
				modelAliasRaw = modelKeyRaw;
				aliasMap = candidate;
			} else {
				const explicitVendorKey = normalizeDispatchVendor(vendorRaw);
				if (explicitVendorKey && candidate.has(explicitVendorKey)) {
					modelAliasRaw = modelKeyRaw;
					aliasMap = new Map([[explicitVendorKey, candidate.get(explicitVendorKey)!]]);
				}
			}
		}
	}

	if (modelAliasRaw) {
		const supported =
			aliasMap && aliasMap.size
				? vendorCandidates.filter((candidate) => {
						const v = normalizeDispatchVendor(candidate);
						return !!v && aliasMap.has(v);
					})
				: [];

		if (!supported.length) {
			// agents bridge currently does not consume modelAlias/modelKey from /public/agents/chat extras.
			// Keep request pass-through when caller explicitly pins vendor=agents.
			if (explicitVendor === "agents") {
				vendorCandidates = ["agents"];
				return {
					vendorRaw,
					enabledSystemVendors,
					rawCandidates,
					vendorCandidates,
					modelAliasRaw,
					aliasMap,
				};
			}
			throw new AppError(
				"未找到可用的模型别名配置（请在 /stats -> 模型管理（系统级）为该别名配置并启用模型）",
				{
					status: 400,
					code: "model_alias_not_found",
					details: {
						taskKind: request?.kind ?? null,
						vendorRaw: vendorRaw || null,
						rawCandidates,
						systemEnabledVendors: Array.from(enabledSystemVendors.values()),
						userEnabledVendors:
							enabledUserVendors.size > 0 ? Array.from(enabledUserVendors.values()) : [],
						modelAlias: modelAliasRaw,
					},
				},
				);
			}

			vendorCandidates = supported;
	}

	// When caller provides a concrete modelKey (not alias), constrain auto candidates
	// to vendors that actually configure this modelKey in model catalog.
	if (isAutoVendor && !modelAliasRaw && modelKeyRaw) {
		const expectedKind = resolveCatalogKindForTaskKind(
			typeof request?.kind === "string" ? request.kind.trim() : "",
		);
		if (supportedVendorsByModelKey.size) {
			vendorCandidates = vendorCandidates.filter((candidate) => {
				const v = normalizeDispatchVendor(candidate);
				return !!v && supportedVendorsByModelKey.has(v);
			});
		} else if (expectedKind) {
			throw new AppError(
				`当前任务 ${String(request?.kind || "").trim() || "(unknown)"} 不支持模型 ${modelKeyRaw}。请改用 ${expectedKind} 类型模型，或传入正确的 modelKey / modelAlias。`,
				{
					status: 400,
					code: "model_kind_mismatch",
					details: {
						taskKind: request?.kind ?? null,
						expectedKind,
						modelKey: modelKeyRaw,
						vendorRaw: vendorRaw || null,
					},
				},
			);
		}
	}

	let preferredVendor: string | null = null;
	if (isAutoVendor && !modelAliasRaw) {
		preferredVendor = await resolvePreferredVendorFromModelCatalog(
			c,
			request.kind,
			extras,
			vendorCandidates,
		);
	}

	if (isAutoVendor && vendorCandidates.length > 1) {
		const pinnedVendors = uniqNormalizedVendors([
			...(preferredVendor ? [preferredVendor] : []),
			...resolvePinnedVendorsForPublicRequest(request),
		]).filter((v) => enabledVendors.has(v));

		const priorityVendors = resolvePublicVendorPriorityList(c, request?.kind ?? null);

		const pinnedCandidates: string[] = [];
		for (const v of pinnedVendors) {
			const candidate = vendorCandidates.find(
				(candidateVendor) => normalizeDispatchVendor(candidateVendor) === v,
			);
			if (candidate) pinnedCandidates.push(candidate);
		}

		const pinnedSet = new Set(pinnedVendors);
		const restCandidates = vendorCandidates.filter(
			(candidateVendor) => !pinnedSet.has(normalizeDispatchVendor(candidateVendor)),
		);

		if (priorityVendors.length) {
			const orderedRest = reorderCandidatesByVendorOrder(restCandidates, priorityVendors);
			const prioritySet = new Set(priorityVendors);
			const prioritized: string[] = [];
			const others: string[] = [];
			for (const candidate of orderedRest) {
				const v = normalizeDispatchVendor(candidate);
				if (prioritySet.has(v)) prioritized.push(candidate);
				else others.push(candidate);
			}

			const rankedOthers =
				others.length > 1
					? await rankVendorsByRecentPerformance(
							c,
							userId,
							request?.kind ?? null,
							others,
						)
					: others;

			vendorCandidates = [...pinnedCandidates, ...prioritized, ...rankedOthers];
		} else {
			const rankedRest =
				restCandidates.length > 1
					? await rankVendorsByRecentPerformance(
							c,
							userId,
							request?.kind ?? null,
							restCandidates,
						)
					: restCandidates;
			vendorCandidates = [...pinnedCandidates, ...rankedRest];
		}
	} else if (preferredVendor && enabledVendors.has(preferredVendor)) {
		// Even without reranking, keep modelKey resolved vendor stable.
		vendorCandidates = [
			preferredVendor,
			...vendorCandidates.filter(
				(v) => normalizeDispatchVendor(v) !== normalizeDispatchVendor(preferredVendor),
			),
		];
	}

	if (!vendorCandidates.length) {
		if (isAutoVendor && !isPublicTaskKindSupported(request?.kind)) {
			return Promise.reject(
				Object.assign(new Error("unsupported task kind"), {
					status: 400,
					code: "unsupported_task_kind",
					details: { kind: request?.kind },
				}),
			);
		}
		if (!isAutoVendor && !rawCandidates.length) {
			return Promise.reject(
				Object.assign(new Error("unsupported task kind"), {
					status: 400,
					code: "unsupported_task_kind",
					details: { kind: request?.kind },
				}),
			);
		}
		if (!isAutoVendor) {
			throw new AppError("无效的 vendor 参数", {
				status: 400,
				code: "invalid_vendor",
				details: { vendor: vendorRaw || null },
			});
		}
		const enabled = Array.from(enabledSystemVendors.values());
		const onlyAgents = enabled.length === 1 && enabledSystemVendors.has("agents");
		const kind = typeof request?.kind === "string" ? request.kind.trim() : "";
		const needsNonAgents = kind && kind !== "chat" && kind !== "prompt_refine";
		const message =
			onlyAgents && needsNonAgents
				? `当前仅启用了 Agents（仅支持 chat/prompt_refine）。要运行 ${kind}，请在 /stats -> 模型管理（系统级）启用并配置 OpenAI/Gemini 等厂商 API Key。`
				: "没有可用的全局厂商配置（请在 /stats -> 模型管理（系统级）启用并配置 API Key）";
		throw new AppError(
			message,
			{
				status: 400,
				code: "no_enabled_vendor",
				details: {
					kind: request?.kind,
					vendorRaw: vendorRaw || null,
					rawCandidates,
					systemEnabledVendors: Array.from(enabledSystemVendors.values()),
					userEnabledVendors:
						enabledUserVendors.size > 0 ? Array.from(enabledUserVendors.values()) : [],
					modelKey:
						typeof extras?.modelKey === "string" && extras.modelKey.trim()
							? extras.modelKey.trim()
							: null,
				},
			},
		);
	}

	return {
		vendorRaw,
		enabledSystemVendors: enabledVendors,
		rawCandidates,
		vendorCandidates,
		modelAliasRaw,
		aliasMap,
	};
}

export async function runPublicTask(
	c: any,
	userId: string,
	input: any,
): Promise<{ vendor: string; result: any }> {
	const abortSignal = isAbortSignalLike(input?.abortSignal) ? input.abortSignal : null;
	throwIfAbortSignalAborted(abortSignal);
	const request = await normalizeTaskAssetBackedVideoRequest(
		c as AppContext,
		userId,
		normalizeImageEditRequestKind(input.request),
	);
	const extras = (request?.extras || {}) as Record<string, any>;
	setTraceStage(c, "public:run:begin", {
		taskKind: request?.kind ?? null,
		vendor: typeof input?.vendor === "string" ? input.vendor : null,
		modelAlias:
			typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
				? extras.modelAlias.trim()
				: null,
	});
	const debug = isHttpDebugLogEnabled(c);
	const debugLog = (event: string, payload: Record<string, unknown>) => {
		if (!debug) return;
		try {
			console.log(
				JSON.stringify({
					ts: new Date().toISOString(),
					type: "public_task_debug",
					event,
					...payload,
				}),
			);
		} catch {
			// best-effort only
		}
	};

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (request?.kind) c.set("routingTaskKind", request.kind);

	const {
		vendorRaw,
		enabledSystemVendors,
		rawCandidates,
		vendorCandidates,
		modelAliasRaw,
		aliasMap,
	} = await resolvePublicTaskVendors(
		c,
		userId,
		input?.vendor,
		request,
		input?.vendorCandidates,
	);

	debugLog("vendor_candidates_resolved", {
		taskKind: request?.kind ?? null,
		vendorRaw: vendorRaw || null,
		rawCandidates,
		vendorCandidates,
		systemEnabledVendors: Array.from(enabledSystemVendors.values()),
		modelAlias: modelAliasRaw || null,
		modelKey:
			typeof extras?.modelKey === "string" && extras.modelKey.trim()
				? extras.modelKey.trim()
				: null,
	});
	setTraceStage(c, "public:vendors:resolved", {
		taskKind: request?.kind ?? null,
		vendorRaw: vendorRaw || null,
		vendorCandidates: vendorCandidates.slice(0, 12),
		modelAlias: modelAliasRaw || null,
	});

	let lastErr: any = null;
	let lastFailed: { vendor: string; result: any } | null = null;
	for (const vendorCandidate of vendorCandidates) {
		throwIfAbortSignalAborted(abortSignal);
		const v = normalizeDispatchVendor(vendorCandidate);
		setTraceStage(c, "public:vendor:attempt", {
			taskKind: request?.kind ?? null,
			vendorCandidate,
			dispatchVendor: v || null,
		});
			try {
				const requestForVendor = (() => {
					if (!modelAliasRaw) {
						// Ensure local-only fields don't leak upstream.
						const cleanExtras = { ...(request?.extras || {}) } as Record<string, any>;
						delete (cleanExtras as any).modelAlias;
						return { ...request, extras: cleanExtras };
					}
					if (v === "agents") {
						// agents is a capability route (agents-cli bridge), not a model-catalog vendor channel.
						// Keep caller-provided extras as-is and let agents bridge decide how to use modelAlias/modelKey.
						return { ...request };
					}

					const mappedModelKey = aliasMap?.get(v || "");
					if (!mappedModelKey) {
						// vendorCandidates should already be filtered, but keep a defensive guard.
						throw new AppError("未找到别名对应的模型 Key", {
							status: 400,
						code: "model_alias_not_found",
						details: {
							taskKind: request?.kind ?? null,
							vendor: v || null,
							modelAlias: modelAliasRaw,
						},
					});
				}

				const cleanExtras = { ...(request?.extras || {}) } as Record<string, any>;
				delete (cleanExtras as any).modelAlias;
				cleanExtras.modelKey = mappedModelKey;
				return { ...request, extras: cleanExtras };
			})();

			let result: any;
				if (v === "apimart") {
					if (requestForVendor.kind === "text_to_video") {
						result = await runApimartVideoTask(c, userId, requestForVendor);
						const nowIso = new Date().toISOString();
						await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{ kind: "video", taskId: result.id, vendor: "apimart" },
						nowIso,
					);
					} else if (
						requestForVendor.kind === "text_to_image" ||
						requestForVendor.kind === "image_edit"
					) {
						result = await runApimartImageTask(c, userId, requestForVendor);
						const nowIso = new Date().toISOString();
						await upsertVendorTaskRef(
						c.env.DB,
						userId,
						{ kind: "image", taskId: result.id, vendor: "apimart" },
							nowIso,
						);
					} else if (requestForVendor.kind === "image_to_prompt") {
						result = await runApimartImageToPromptTask(c, userId, requestForVendor);
					} else if (
						requestForVendor.kind === "chat" ||
						requestForVendor.kind === "prompt_refine"
					) {
						result = await runApimartTextTask(c, userId, requestForVendor);
				} else {
					throw Object.assign(new Error("invalid task kind"), {
						status: 400,
						code: "invalid_task_kind",
						details: { vendor: "apimart", kind: request.kind },
					});
				}
			} else if (v === "veo") {
				result = await runGenericTaskForVendor(c, userId, v, requestForVendor);
			} else if (v === "minimax" || v === "sora2api") {
				throw Object.assign(new Error(`${v} 已下线，不再支持调用`), {
					status: 410,
					code: "vendor_removed",
					details: { vendor: v },
				});
			} else if (v === "agents") {
				result = await runAgentsBridgeChatTask(c as any, userId, requestForVendor, {
					abortSignal,
					onStreamEvent:
						typeof input?.onAgentsStreamEvent === "function"
							? input.onAgentsStreamEvent
							: undefined,
				});
			} else {
				result = await runGenericTaskForVendor(c, userId, v, requestForVendor);
			}

			// For public endpoints, a failed TaskResult should trigger vendor fallback
			// (e.g. missing token / upstream transient issues).
			if (result?.status === "failed") {
				const sanitizedFailedResult = sanitizePublicTaskResult(result);
				// Persist failed result so callers can poll /public/tasks/result for error details,
				// and keep behavior consistent with succeeded results for sync vendors.
				try {
					const taskId =
						typeof sanitizedFailedResult === "object" &&
						sanitizedFailedResult &&
						typeof (sanitizedFailedResult as Record<string, unknown>)?.id === "string"
							? String((sanitizedFailedResult as Record<string, unknown>).id).trim()
							: String(result?.id || "").trim();
					const status =
						typeof sanitizedFailedResult === "object" &&
						sanitizedFailedResult &&
						typeof (sanitizedFailedResult as Record<string, unknown>)?.status === "string"
							? String((sanitizedFailedResult as Record<string, unknown>).status).trim()
							: typeof result?.status === "string"
								? result.status.trim()
								: "";
					const kind =
						typeof sanitizedFailedResult === "object" &&
						sanitizedFailedResult &&
						typeof (sanitizedFailedResult as Record<string, unknown>)?.kind === "string"
							? String((sanitizedFailedResult as Record<string, unknown>).kind).trim()
							: String(requestForVendor.kind || "").trim();
					if (taskId && kind && status === "failed") {
						const nowIso = new Date().toISOString();
						await upsertTaskResult(c.env.DB, {
							userId,
							taskId,
							vendor: v,
							kind,
							status,
							result: sanitizedFailedResult,
							completedAt: nowIso,
							nowIso,
						});
					}
				} catch (err: any) {
					console.warn(
						"[task-store] persist public failed result failed",
						err?.message || err,
					);
				}

				setTraceStage(c, "public:vendor:task_failed", {
					taskKind: request?.kind ?? null,
					vendor: v || null,
					resultStatus: "failed",
				});
				lastFailed = { vendor: v, result: sanitizedFailedResult };
				continue;
			}

			result = await maybeWrapSyncImageResultAsStoredTask(c as any, userId, {
				vendor: v,
				requestKind: requestForVendor.kind,
				result: result as any,
			});
			const sanitizedResult = sanitizePublicTaskResult(result);
			const hostingGap = detectPublicTaskAssetHostingGap({
				originalResult: result,
				sanitizedResult,
			});
			if (hostingGap) {
				throw new AppError(
					"任务已生成内联图片，但对象存储托管失败，无法返回公开 URL",
					{
						status: 502,
						code: "public_asset_hosting_failed",
						details: {
							vendor: v,
							taskKind: requestForVendor.kind,
							taskId:
								typeof (result as any)?.id === "string"
									? String((result as any).id).trim()
									: null,
							...hostingGap,
						},
					},
				);
			}

			// Persist snapshot so callers can safely poll /public/tasks/result (and see queued/running tasks in storage).
			try {
				const taskId =
					typeof sanitizedResult === "object" &&
					sanitizedResult &&
					typeof (sanitizedResult as Record<string, unknown>)?.id === "string"
						? String((sanitizedResult as Record<string, unknown>).id).trim()
						: String(result?.id || "").trim();
				const status =
					typeof sanitizedResult === "object" &&
					sanitizedResult &&
					typeof (sanitizedResult as Record<string, unknown>)?.status === "string"
						? String((sanitizedResult as Record<string, unknown>).status).trim()
						: typeof result?.status === "string"
							? result.status.trim()
							: "";
				const kind =
					typeof sanitizedResult === "object" &&
					sanitizedResult &&
					typeof (sanitizedResult as Record<string, unknown>)?.kind === "string"
						? String((sanitizedResult as Record<string, unknown>).kind).trim()
						: String(requestForVendor.kind || "").trim();
				if (
					taskId &&
					kind &&
					(status === "queued" ||
						status === "running" ||
						status === "succeeded" ||
						status === "failed")
				) {
					const nowIso = new Date().toISOString();
					const completedAt =
						status === "succeeded" || status === "failed" ? nowIso : null;
					await upsertTaskResult(c.env.DB, {
						userId,
						taskId,
						vendor: v,
						kind,
						status,
						result: sanitizedResult,
						completedAt,
						nowIso,
					});
				}
			} catch (err: any) {
				console.warn(
					"[task-store] persist public result failed",
					err?.message || err,
				);
			}

			return { vendor: v, result: sanitizedResult };
		} catch (err: any) {
			setTraceStage(c, "public:vendor:error", {
				taskKind: request?.kind ?? null,
				vendorCandidate,
				dispatchVendor: v || null,
				code: typeof err?.code === "string" ? err.code : null,
				status:
					typeof err?.status === "number"
						? err.status
						: Number.isFinite(Number(err?.status))
							? Number(err.status)
							: null,
				message:
					typeof err?.message === "string"
						? err.message.slice(0, 300)
						: String(err).slice(0, 300),
			});
			debugLog("vendor_candidate_failed", {
				taskKind: request?.kind ?? null,
				vendorCandidate,
				dispatchVendor: v || null,
				error: {
					name: typeof err?.name === "string" ? err.name : undefined,
					message: typeof err?.message === "string" ? err.message : String(err),
					status:
						typeof err?.status === "number"
							? err.status
							: Number.isFinite(Number(err?.status))
								? Number(err.status)
								: undefined,
					code: typeof err?.code === "string" ? err.code : undefined,
					details: err?.details ?? undefined,
				},
			});
			lastErr = err;
			throwIfAbortSignalAborted(abortSignal);
			continue;
		}
	}

	if (lastFailed) return lastFailed;
	throw lastErr || new Error("run public task failed");
}

// Unified public task API: supports image/video/chat via API key.
const PublicRunTaskOpenApiRoute = createRoute({
	method: "post",
	path: "/tasks",
	tags: [PUBLIC_TAG],
	summary: "统一任务入口 /public/tasks",
	description:
		"统一任务入口：当你希望完全复用内部 TaskRequest 结构时使用（支持 image/video/chat 等）。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicRunTaskRequestSchema,
					example: {
						vendor: "auto",
						request: {
							kind: "text_to_video",
							prompt: "雨夜霓虹街头，一只白猫缓慢走过…",
							extras: { modelAlias: "<YOUR_VIDEO_MODEL_ALIAS>", durationSeconds: 10 },
						},
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body / unsupported task kind",
			content: {
				"application/json": {
					schema: z.union([PublicValidationErrorSchema, PublicTaskKindErrorSchema]),
					example: {
						error: "Unsupported task kind for public API",
						code: "unsupported_task_kind",
						details: { kind: "image_to_video" },
					},
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicRunTaskOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);

	const input = c.req.valid("json");

	try {
		const { vendor, result } = await runPublicTask(c, userId, input);
		return c.json(
			PublicRunTaskResponseSchema.parse({
				vendor,
				result,
			}),
			200,
		);
	} catch (err: any) {
		if (err?.code === "unsupported_task_kind") {
			return c.json(
				{
					error: "Unsupported task kind for public API",
					code: "unsupported_task_kind",
					details: err?.details ?? null,
				},
				400,
			);
		}
		throw err;
	}
});

// Convenience endpoints (explicit "draw" / "video" naming) for external callers.
const PublicDrawOpenApiRoute = createRoute({
	method: "post",
	path: "/draw",
	tags: [PUBLIC_TAG],
	summary: "绘图 /public/draw",
	description:
		"便捷绘图接口：创建 text_to_image 或 image_edit 任务（vendor=auto 会在系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽）。支持通过 width/height 或 extras.aspectRatio/extras.resolution 配置尺寸/分辨率，但不同 vendor 支持不一致；如需严格像素宽高，建议指定 vendor=qwen。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicDrawRequestSchema,
					example: {
						vendor: "auto",
						kind: "text_to_image",
						prompt: "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
						extras: { modelAlias: "nano-banana-pro", aspectRatio: "1:1" },
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "gemini",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_image",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicDrawOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");

	const request = {
		kind: input.kind || "text_to_image",
		prompt: input.prompt,
		...(typeof input.negativePrompt === "string"
			? { negativePrompt: input.negativePrompt }
			: {}),
		...(typeof input.seed === "number" ? { seed: input.seed } : {}),
		...(typeof input.width === "number" ? { width: input.width } : {}),
		...(typeof input.height === "number"
			? { height: input.height }
			: {}),
		...(typeof input.steps === "number" ? { steps: input.steps } : {}),
		...(typeof input.cfgScale === "number"
			? { cfgScale: input.cfgScale }
			: {}),
		...(input.extras ? { extras: input.extras } : {}),
	};
	const normalizedRequest = normalizeImageEditRequestKind(request);

	const vendorRaw = (input.vendor || "auto").trim().toLowerCase();
	let dispatchVendor =
		vendorRaw && vendorRaw !== "auto" ? normalizeDispatchVendor(vendorRaw) : "";

	const extras = (normalizedRequest?.extras || {}) as Record<string, any>;
	const modelAliasRaw =
		typeof extras?.modelAlias === "string" && extras.modelAlias.trim()
			? extras.modelAlias.trim()
			: "";
	const looksLikeNanoBananaAlias = /^nano-banana/i.test(modelAliasRaw);

	const preferAsync =
		input.async === true ||
		(input.async !== false && dispatchVendor === "tuzi") ||
		(input.async !== false && vendorRaw === "auto" && looksLikeNanoBananaAlias);

	if (preferAsync) {
		if (vendorRaw === "auto") {
			const resolved = await resolvePublicTaskVendors(c, userId, input.vendor, normalizedRequest);

			const attempts = resolved.vendorCandidates
				.map((candidate) => {
					const v = normalizeDispatchVendor(candidate);
					if (!v) return null;

					const requestForVendor = (() => {
						const cleanExtras = { ...(extras || {}) } as Record<string, any>;
						delete (cleanExtras as any).modelAlias;
						if (!modelAliasRaw) return { ...normalizedRequest, extras: cleanExtras };

						const mappedModelKey = resolved.aliasMap?.get(v || "");
						if (!mappedModelKey) return null;
						cleanExtras.modelKey = mappedModelKey;
						return { ...normalizedRequest, extras: cleanExtras };
					})();

					if (!requestForVendor) return null;
					return { vendor: v, request: requestForVendor as any };
				})
				.filter(Boolean) as Array<{ vendor: string; request: any }>;

			if (!attempts.length) {
				throw new AppError(
					"没有可用的全局厂商配置（请在 /stats -> 模型管理（系统级）启用并配置 API Key）",
					{
						status: 400,
						code: "no_enabled_vendor",
						details: {
							kind: normalizedRequest?.kind,
							vendorRaw: vendorRaw || null,
							vendorCandidates: resolved.vendorCandidates,
							systemEnabledVendors: Array.from(resolved.enabledSystemVendors.values()),
							modelAlias: modelAliasRaw || null,
						},
					},
				);
			}

			try {
				// Hint proxy selector: prefer higher-success channels for this task kind.
					if (normalizedRequest?.kind) c.set("routingTaskKind", normalizedRequest.kind);
			} catch {
				// ignore
			}

			const result = await enqueueStoredTaskForVendorAttempts(c as any, userId, attempts);
			const firstVendor = normalizeDispatchVendor(attempts[0]?.vendor || "");

			return c.json(
				PublicRunTaskResponseSchema.parse({
					vendor: firstVendor || "auto",
					result,
				}),
				200,
			);
		}

		const enabledSystemVendors = await listEnabledSystemVendors(c);

		if (!dispatchVendor) {
			return c.json(
				{
					error: "vendor is required for async draw",
					code: "vendor_required",
				},
				400,
			);
		}

		if (!enabledSystemVendors.has(dispatchVendor)) {
			throw new AppError("该厂商已禁用或未配置（系统级）", {
				status: 400,
				code: "vendor_disabled",
				details: {
					vendorRaw: vendorRaw || null,
					vendor: dispatchVendor,
					systemEnabledVendors: Array.from(enabledSystemVendors.values()),
				},
			});
		}

		// Map modelAlias -> modelKey for this explicit vendor (keeps behavior aligned with /public/tasks).
		const requestForVendor = await (async () => {
			if (!modelAliasRaw) {
				const cleanExtras = { ...(extras || {}) } as Record<string, any>;
				delete (cleanExtras as any).modelAlias;
				return { ...request, extras: cleanExtras };
			}

			const expectedKind = resolveCatalogKindForTaskKind(normalizedRequest?.kind ?? null);
			let mappedModelKey: string | null = null;
			try {
				const rows = await listCatalogModelsByModelAlias(c.env.DB, modelAliasRaw);
				for (const row of rows) {
					if (!row) continue;
					if (Number((row as any).enabled ?? 1) === 0) continue;
					const kindRaw =
						typeof (row as any).kind === "string" ? (row as any).kind.trim() : "";
					if (expectedKind && kindRaw && kindRaw !== expectedKind) continue;
					const vendorKeyRaw =
						typeof (row as any).vendor_key === "string"
							? (row as any).vendor_key.trim()
							: "";
					const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
					if (!vendorKey || vendorKey !== dispatchVendor) continue;
					const mk =
						typeof (row as any).model_key === "string"
							? (row as any).model_key.trim()
							: "";
					if (!mk) continue;
					mappedModelKey = mk;
					break;
				}
				if (!mappedModelKey) {
					const rowsByModelKey = await listCatalogModelsByModelKey(c.env.DB, modelAliasRaw);
					for (const row of rowsByModelKey) {
						if (!row) continue;
						if (Number((row as any).enabled ?? 1) === 0) continue;
						const kindRaw =
							typeof (row as any).kind === "string" ? (row as any).kind.trim() : "";
						if (expectedKind && kindRaw && kindRaw !== expectedKind) continue;
						const vendorKeyRaw =
							typeof (row as any).vendor_key === "string"
								? (row as any).vendor_key.trim()
								: "";
						const vendorKey = normalizeDispatchVendor(vendorKeyRaw);
						if (!vendorKey || vendorKey !== dispatchVendor) continue;
						const mk =
							typeof (row as any).model_key === "string"
								? (row as any).model_key.trim()
								: "";
						if (!mk) continue;
						mappedModelKey = mk;
						break;
					}
				}
			} catch {
				mappedModelKey = null;
			}

			if (!mappedModelKey) {
				throw new AppError(
					"未找到可用的模型别名配置（请在 /stats -> 模型管理（系统级）为该别名配置并启用模型）",
					{
						status: 400,
						code: "model_alias_not_found",
						details: {
							taskKind: normalizedRequest?.kind ?? null,
							vendor: dispatchVendor,
							modelAlias: modelAliasRaw,
						},
					},
				);
			}

			const cleanExtras = { ...(extras || {}) } as Record<string, any>;
			delete (cleanExtras as any).modelAlias;
			cleanExtras.modelKey = mappedModelKey;
				return { ...normalizedRequest, extras: cleanExtras };
		})();

			try {
				// Hint proxy selector: prefer higher-success channels for this task kind.
				if (requestForVendor?.kind) c.set("routingTaskKind", requestForVendor.kind);
			} catch {
				// ignore
			}

			const result = await enqueueStoredTaskForVendor(
				c as any,
				userId,
				dispatchVendor,
				requestForVendor as any,
		);

		return c.json(
			PublicRunTaskResponseSchema.parse({
				vendor: dispatchVendor,
				result,
			}),
			200,
		);
	}

	const { vendor, result } = await runPublicTask(c, userId, {
		vendor: input.vendor,
		vendorCandidates: input.vendorCandidates,
		request: normalizedRequest,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
		200,
	);
});

const PublicVideoOpenApiRoute = createRoute({
	method: "post",
	path: "/video",
	tags: [PUBLIC_TAG],
	summary: "生成视频 /public/video",
	description:
		"便捷视频接口：创建 text_to_video 任务（vendor=auto 会在系统级已启用且已配置的厂商列表中依次重试，直到成功或候选耗尽；可通过 extras.modelAlias 指定模型（推荐；兼容 extras.modelKey））。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicVideoRequestSchema,
					example: {
						vendor: "auto",
						prompt: "雨夜霓虹街头，一只白猫缓慢走过…",
						durationSeconds: 10,
						extras: { modelAlias: "<YOUR_VIDEO_MODEL_ALIAS>" },
					},
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicRunTaskResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "queued",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body",
			content: {
				"application/json": {
					schema: PublicValidationErrorSchema,
					example: { error: "Invalid request body", issues: [] },
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicVideoOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");

	const extras: Record<string, any> = input.extras ? { ...input.extras } : {};
	if (typeof input.durationSeconds === "number") {
		extras.durationSeconds = input.durationSeconds;
	}

	const request = {
		kind: "text_to_video",
		prompt: input.prompt,
		extras,
	};

	const { vendor, result } = await runPublicTask(c, userId, {
		vendor: input.vendor,
		vendorCandidates: input.vendorCandidates,
		request,
	});

	return c.json(
		PublicRunTaskResponseSchema.parse({
			vendor,
			result,
		}),
		200,
	);
});

// Unified public polling API: resolve vendor via vendor_task_refs when possible.
const PublicFetchTaskResultOpenApiRoute = createRoute({
	method: "post",
	path: "/tasks/result",
	tags: [PUBLIC_TAG],
	summary: "查询任务结果 /public/tasks/result",
	description: "轮询任务状态与结果；支持 vendor=auto 自动基于 taskId 推断。",
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: PublicFetchTaskResultRequestSchema,
					example: { taskId: "task_01HXYZ...", taskKind: "text_to_video" },
				},
			},
		},
	},
	responses: {
		200: {
			description: "OK",
			content: {
				"application/json": {
					schema: PublicFetchTaskResultResponseSchema,
					example: {
						vendor: "veo",
						result: {
							id: "task_01HXYZ...",
							kind: "text_to_video",
							status: "running",
							assets: [],
							raw: {},
						},
					},
				},
			},
		},
		400: {
			description: "Invalid request body / vendor required",
			content: {
				"application/json": {
					schema: z.union([PublicValidationErrorSchema, PublicTaskKindErrorSchema]),
					example: {
						error: "vendor is required (or the task vendor cannot be inferred)",
						code: "vendor_required",
					},
				},
			},
		},
		401: {
			description: "Unauthorized (missing/invalid JWT or API key)",
			content: { "application/json": { schema: PublicAppErrorSchema } },
		},
	},
});

publicApiRouter.openapi(PublicFetchTaskResultOpenApiRoute, async (c) => {
	const userId = requirePublicUserId(c);
	const input = c.req.valid("json");
	const outcome = await fetchTaskResultForPolling(c as any, userId, {
		taskId: input.taskId,
		vendor: input.vendor ?? null,
		taskKind: input.taskKind ?? null,
		prompt: typeof input.prompt === "string" ? input.prompt : null,
		mode: "public",
	});

	if (!outcome.ok) return c.json((outcome as any).body, (outcome as any).status);

	return c.json(
		PublicFetchTaskResultResponseSchema.parse({
			vendor: outcome.vendor,
			result: outcome.result,
		}),
		200,
	);
	});
