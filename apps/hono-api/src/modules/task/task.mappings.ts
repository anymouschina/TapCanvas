import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { getPrismaClient } from "../../platform/node/prisma";
import { ensureModelCatalogSchema } from "../model-catalog/model-catalog.repo";
import { extractUpstreamErrorMessage } from "./task.http-utils";
import {
	parseSizeToDimensions,
	renderImageContainPad,
} from "./task.image-fit";
import {
	canContainPadMimeType,
	isSupportedMappedVideoReferenceMimeType,
	normalizeMimeType,
} from "./task.mime";
import { TaskAssetSchema, TaskResultSchema, type TaskRequestDto, type TaskStatus } from "./task.schemas";

export type MappingStage = "create" | "result";

export type ModelCatalogVendorAuthForTask = {
	authType: "none" | "bearer" | "x-api-key" | "query";
	authHeader: string | null;
	authQueryParam: string | null;
};

export type RuntimeModelCatalogMapping = {
	id: string;
	vendorKey: string;
	taskKind: TaskRequestDto["kind"];
	name: string;
	requestMapping: unknown | null;
	responseMapping: unknown | null;
};

type StageTemplateRecord = Record<string, unknown>;
type MappingSelectionOptions = {
	preferredMappingId?: string | null;
	stage?: MappingStage;
	req?: TaskRequestDto | null;
	taskId?: string | null;
	modelKey?: string | null;
	apiKey?: string | null;
};

function safeJsonParse(input: unknown): any | null {
	if (typeof input !== "string") return null;
	const raw = input.trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function normalizeVendorKey(vendor: string): string {
	const raw = (vendor || "").trim().toLowerCase();
	if (!raw) return "";
	const parts = raw
		.split(":")
		.map((p) => p.trim())
		.filter(Boolean);
	const head = parts.length ? parts[0]! : raw;
	const last = parts.length ? parts[parts.length - 1]! : raw;
	if (head === "direct") {
		return last === "google" ? "gemini" : last;
	}
	for (const known of ["apimart", "comfly", "grsai", "yunwu"] as const) {
		if (head === known || raw.startsWith(`${known}-`) || raw.startsWith(`${known}:`)) {
			return known;
		}
	}
	if (last === "google") return "gemini";
	return last;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

type FetchAsFileFailureSummary = {
	upstreamCode: string | null;
	upstreamMessage: string | null;
};

function summarizeFailureText(raw: unknown, maxLength = 240): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function extractFailureCode(data: unknown): string | null {
	if (!isRecord(data)) return null;
	const directKeys = ["code", "Code", "error_code", "errorCode", "EC"] as const;
	for (const key of directKeys) {
		const value = data[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	const nestedError = data.error;
	if (!isRecord(nestedError)) return null;
	for (const key of directKeys) {
		const value = nestedError[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return null;
}

function extractFailureMessage(data: unknown): string | null {
	if (!isRecord(data)) return null;
	const directKeys = ["message", "Message", "msg"] as const;
	for (const key of directKeys) {
		const value = data[key];
		const summarized = summarizeFailureText(value);
		if (summarized) return summarized;
	}
	const nestedError = data.error;
	if (!isRecord(nestedError)) {
		const fallback = summarizeFailureText(extractUpstreamErrorMessage(data, ""));
		return fallback;
	}
	for (const key of directKeys) {
		const value = nestedError[key];
		const summarized = summarizeFailureText(value);
		if (summarized) return summarized;
	}
	return summarizeFailureText(extractUpstreamErrorMessage(data, ""));
}

async function summarizeFetchAsFileFailure(res: Response): Promise<FetchAsFileFailureSummary> {
	let rawText = "";
	try {
		rawText = await res.clone().text();
	} catch {
		return { upstreamCode: null, upstreamMessage: null };
	}
	const trimmed = rawText.trim();
	if (!trimmed) {
		return { upstreamCode: null, upstreamMessage: null };
	}
	const contentType = (res.headers.get("content-type") || "").toLowerCase();
	const looksJson =
		contentType.includes("application/json") ||
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"));
	if (!looksJson) {
		return {
			upstreamCode: null,
			upstreamMessage: summarizeFailureText(trimmed),
		};
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return {
			upstreamCode: extractFailureCode(parsed),
			upstreamMessage: extractFailureMessage(parsed) ?? summarizeFailureText(trimmed),
		};
	} catch {
		return {
			upstreamCode: null,
			upstreamMessage: summarizeFailureText(trimmed),
		};
	}
}

export async function resolveEnabledModelCatalogMappingForTask(
	c: AppContext,
	vendorKey: string,
	taskKind: TaskRequestDto["kind"],
	options?: MappingSelectionOptions,
): Promise<RuntimeModelCatalogMapping | null> {
	const vk = normalizeVendorKey(vendorKey);
	if (!vk) return null;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const rows = await getPrismaClient().model_catalog_mappings.findMany({
			where: {
				vendor_key: vk,
				task_kind: taskKind,
				enabled: 1,
			},
			orderBy: [{ updated_at: "desc" }, { created_at: "desc" }, { name: "asc" }],
		});
		if (!rows.length) return null;
		const mappings = rows.map((row) => ({
			id: row.id,
			vendorKey: row.vendor_key || vk,
			taskKind,
			name: row.name,
			requestMapping: safeJsonParse(row.request_mapping ?? null),
			responseMapping: safeJsonParse(row.response_mapping ?? null),
		}));
		return selectEnabledModelCatalogMappingForRequest(mappings, options);
	} catch {
		return null;
	}
}

function normalizeOptionalString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function pickStageMapping(mapping: unknown, stage: MappingStage): any | null {
	if (!mapping) return null;
	if (!isRecord(mapping)) return null;

	if (stage === "create") {
		const create = mapping.create;
		if (isRecord(create)) return create;
	}
	if (stage === "result") {
		const result = mapping.result;
		if (isRecord(result)) return result;
		const query = mapping.query;
		if (isRecord(query)) return query;
		const poll = mapping.poll;
		if (isRecord(poll)) return poll;
	}

	// Fallback: treat the mapping itself as a stage mapping.
	return mapping;
}

function normalizeExprSpec(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (!Array.isArray(value)) return "";
	return value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter(Boolean)
		.join("|");
}

function isMeaningfulValue(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "boolean") return true;
	if (Array.isArray(value)) return value.length > 0;
	return value !== null && typeof value !== "undefined";
}

function renderTemplateString(input: string, source: unknown): string {
	const raw = String(input || "");
	return raw
		.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
			const resolved = extractValueByExpr(source, expr);
			if (typeof resolved === "undefined" || resolved === null) return "";
			if (typeof resolved === "string") return resolved;
			if (typeof resolved === "number" || typeof resolved === "boolean") {
				return String(resolved);
			}
			try {
				return JSON.stringify(resolved);
			} catch {
				return "";
			}
		})
		.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
			const resolved = extractValueByExpr(source, expr);
			if (typeof resolved === "undefined" || resolved === null) return "";
			if (typeof resolved === "string") return resolved;
			if (typeof resolved === "number" || typeof resolved === "boolean") {
				return String(resolved);
			}
			try {
				return JSON.stringify(resolved);
			} catch {
				return "";
			}
		});
}

function matchesTemplateWhen(source: unknown, when: unknown): boolean {
	if (!isRecord(when)) return false;
	if (Array.isArray(when.all)) {
		return when.all.every((item) => matchesTemplateWhen(source, item));
	}
	if (Array.isArray(when.any)) {
		return when.any.some((item) => matchesTemplateWhen(source, item));
	}
	const existsExpr = normalizeExprSpec(when.exists);
	if (existsExpr) {
		return isMeaningfulValue(extractValueByExpr(source, existsExpr));
	}
	const notExistsExpr = normalizeExprSpec((when as StageTemplateRecord).notExists);
	if (notExistsExpr) {
		return !isMeaningfulValue(extractValueByExpr(source, notExistsExpr));
	}
	const equalsConfig = isRecord((when as StageTemplateRecord).equals)
		? ((when as StageTemplateRecord).equals as StageTemplateRecord)
		: null;
	if (equalsConfig) {
		const leftExpr = normalizeExprSpec(
			equalsConfig.left ?? equalsConfig.from ?? equalsConfig.path,
		);
		if (!leftExpr) return false;
		const leftValue = extractValueByExpr(source, leftExpr);
		const rightValue =
			"value" in equalsConfig
				? equalsConfig.value
				: extractValueByExpr(
						source,
						normalizeExprSpec(
							equalsConfig.right ?? equalsConfig.to ?? equalsConfig.other,
						),
				  );
		return leftValue === rightValue;
	}
	return false;
}

function resolveSelectedStageMapping(
	mapping: unknown,
	stage: MappingStage,
	source: unknown,
): StageTemplateRecord | null {
	const picked = pickStageMapping(mapping, stage);
	if (!isRecord(picked)) return null;
	const candidates = Array.isArray(picked.candidates)
		? picked.candidates.filter(isRecord)
		: [];
	for (const candidate of candidates) {
		if (matchesTemplateWhen(source, candidate.when)) return candidate;
	}
	if (isRecord(picked.default)) return picked.default;
	return picked;
}

function matchesMappingProfile(
	mapping: RuntimeModelCatalogMapping,
	stage: MappingStage,
	source: Record<string, unknown>,
): { matched: boolean; score: number } {
	const requestMapping = isRecord(mapping.requestMapping) ? mapping.requestMapping : null;
	if (!requestMapping) return { matched: false, score: 0 };

	let matched = true;
	let score = 0;

	const rootWhen = requestMapping.match ?? requestMapping.when;
	if (typeof rootWhen !== "undefined") {
		if (!matchesTemplateWhen(source, rootWhen)) return { matched: false, score: -1 };
		score += 1_000;
	}

	const stageTemplate = pickStageMapping(mapping.requestMapping, stage);
	if (!isRecord(stageTemplate)) return { matched, score };

	const stageWhen = stageTemplate.match ?? stageTemplate.when;
	if (typeof stageWhen !== "undefined") {
		if (!matchesTemplateWhen(source, stageWhen)) return { matched: false, score: -1 };
		score += 100;
	}

	const candidates = Array.isArray(stageTemplate.candidates)
		? stageTemplate.candidates.filter(isRecord)
		: [];
	for (const candidate of candidates) {
		if (matchesTemplateWhen(source, candidate.when)) {
			score += 10;
			break;
		}
	}

	return { matched, score };
}

function isTemplateString(value: string): boolean {
	return value.includes("{{") || value.includes("${");
}

function normalizeModelKeyForMatch(value: string | null | undefined): string {
	const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!trimmed) return "";
	return trimmed.startsWith("models/") ? trimmed.slice(7) : trimmed;
}

function shouldInspectModelPath(expr: string): boolean {
	const normalized = normalizeExprSpec(expr).toLowerCase();
	return (
		normalized === "model.model_key" ||
		normalized === "modelinfo.model_key" ||
		normalized === "request.extras.modelkey" ||
		normalized === "request.params.modelkey" ||
		normalized === "request.modelkey" ||
		normalized === "modelkey"
	);
}

function collectFixedModelKeysFromWhen(
	when: unknown,
	out: Set<string>,
): void {
	if (!isRecord(when)) return;
	const all = Array.isArray(when.all) ? when.all : [];
	for (const item of all) collectFixedModelKeysFromWhen(item, out);
	const any = Array.isArray(when.any) ? when.any : [];
	for (const item of any) collectFixedModelKeysFromWhen(item, out);

	const equalsConfig = isRecord((when as StageTemplateRecord).equals)
		? ((when as StageTemplateRecord).equals as StageTemplateRecord)
		: null;
	if (!equalsConfig) return;

	const leftExpr = normalizeExprSpec(
		equalsConfig.left ?? equalsConfig.from ?? equalsConfig.path,
	);
	if (!shouldInspectModelPath(leftExpr)) return;
	const value =
		typeof equalsConfig.value === "string" ? equalsConfig.value.trim() : "";
	const normalizedValue = normalizeModelKeyForMatch(value);
	if (normalizedValue) out.add(normalizedValue);
}

function collectFixedModelKeysFromValue(
	value: unknown,
	out: Set<string>,
	allowDirectString = false,
): void {
	if (typeof value === "string") {
		if (!allowDirectString) return;
		const trimmed = value.trim();
		if (!trimmed || isTemplateString(trimmed)) return;
		const normalized = normalizeModelKeyForMatch(trimmed);
		if (normalized) out.add(normalized);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectFixedModelKeysFromValue(item, out, allowDirectString);
		return;
	}
	if (!isRecord(value)) return;

	for (const [key, child] of Object.entries(value)) {
		const normalizedKey = key.trim().toLowerCase();
		if (
			normalizedKey === "when" ||
			normalizedKey === "match"
		) {
			collectFixedModelKeysFromWhen(child, out);
			continue;
		}
		if (
			normalizedKey === "model" ||
			normalizedKey === "model_key" ||
			normalizedKey === "modelkey"
		) {
			collectFixedModelKeysFromValue(child, out, true);
			continue;
		}
		collectFixedModelKeysFromValue(child, out, false);
	}
}

function extractFixedModelKeysForMapping(
	mapping: RuntimeModelCatalogMapping,
	stage: MappingStage,
): string[] {
	const out = new Set<string>();
	const requestMapping = isRecord(mapping.requestMapping) ? mapping.requestMapping : null;
	if (!requestMapping) return [];
	collectFixedModelKeysFromWhen(requestMapping.match ?? requestMapping.when, out);
	const stageTemplate = pickStageMapping(requestMapping, stage);
	if (stageTemplate) {
		collectFixedModelKeysFromValue(stageTemplate, out, false);
	}
	return Array.from(out);
}

function scoreMappingModelAffinity(
	mapping: RuntimeModelCatalogMapping,
	stage: MappingStage,
	requestedModelKey: string | null,
): { matched: boolean; score: number } {
	const normalizedRequested = normalizeModelKeyForMatch(requestedModelKey);
	if (!normalizedRequested) return { matched: true, score: 0 };
	const fixedModelKeys = extractFixedModelKeysForMapping(mapping, stage);
	if (fixedModelKeys.length === 0) {
		return { matched: true, score: 0 };
	}
	if (fixedModelKeys.includes(normalizedRequested)) {
		return { matched: true, score: 10_000 };
	}
	return { matched: false, score: -10_000 };
}

export function selectEnabledModelCatalogMappingForRequest(
	mappings: RuntimeModelCatalogMapping[],
	options?: MappingSelectionOptions,
): RuntimeModelCatalogMapping | null {
	if (!mappings.length) return null;

	const preferredMappingId = normalizeOptionalString(options?.preferredMappingId);
	if (preferredMappingId) {
		const exact = mappings.find((mapping) => mapping.id === preferredMappingId) ?? null;
		if (exact) return exact;
	}

	const stage = options?.stage ?? "create";
	const modelKey = normalizeOptionalString(options?.modelKey);
	const req =
		options?.req ??
		({
			kind: mappings[0]!.taskKind,
			prompt: "",
			extras: {},
		} satisfies TaskRequestDto);
	const source = buildMappingTemplateSource({
		req,
		taskId: normalizeOptionalString(options?.taskId),
		modelKey,
		apiKey: normalizeOptionalString(options?.apiKey),
	});

	let bestMatched: RuntimeModelCatalogMapping | null = null;
	let bestMatchedScore = -1;

	for (const mapping of mappings) {
		const modelAffinity = scoreMappingModelAffinity(mapping, stage, modelKey);
		if (!modelAffinity.matched) continue;
		const { matched, score } = matchesMappingProfile(mapping, stage, source);
		if (!matched) continue;
		const finalScore = score + modelAffinity.score;
		if (finalScore > bestMatchedScore) {
			bestMatched = mapping;
			bestMatchedScore = finalScore;
		}
	}

	return bestMatched;
}

function buildMappingTemplateSource(input: {
	req: TaskRequestDto;
	taskId?: string | null;
	modelKey?: string | null;
	apiKey?: string | null;
}): Record<string, unknown> {
	const extras =
		input.req.extras && typeof input.req.extras === "object" && !Array.isArray(input.req.extras)
			? input.req.extras
			: {};
	const taskId = typeof input.taskId === "string" && input.taskId.trim()
		? input.taskId.trim()
		: null;
	const modelKey =
		typeof input.modelKey === "string" && input.modelKey.trim()
			? input.modelKey.trim()
			: null;
	return {
		...input.req,
		extras,
		taskId,
		id: taskId,
		modelKey,
		request: {
			kind: input.req.kind,
			prompt: input.req.prompt,
			negativePrompt:
				typeof input.req.negativePrompt === "string"
					? input.req.negativePrompt
					: null,
			params: extras,
			extras,
		},
		task: { id: taskId },
		modelInfo: { model_key: modelKey },
		model: { model_key: modelKey },
		providerMeta: { query_id: taskId },
		account: {
			account_key:
				typeof input.apiKey === "string" && input.apiKey.trim()
					? input.apiKey.trim()
					: null,
		},
	};
}

function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").trim();
	if (!cleaned) return new Uint8Array(0);
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function toSafeBlobPart(input: Uint8Array): ArrayBuffer {
	const bytes = new Uint8Array(Array.from(input));
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
}

function extractInlineImageDataUrlsFromGenerateContent(payload: any): string[] {
	if (!payload || typeof payload !== "object") return [];
	const urls = new Set<string>();
	const candidates = Array.isArray((payload as any).candidates)
		? (payload as any).candidates
		: [];

	for (const candidate of candidates) {
		const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
		for (const part of parts) {
			const inline = part?.inlineData || part?.inline_data || null;
			if (inline && typeof inline === "object") {
				const base64 = typeof inline?.data === "string" ? inline.data.trim() : "";
				if (base64) {
					const mimeType =
						typeof inline?.mimeType === "string" && inline.mimeType.trim()
							? inline.mimeType.trim()
							: typeof inline?.mime_type === "string" && inline.mime_type.trim()
								? inline.mime_type.trim()
								: "image/png";
					urls.add(`data:${mimeType};base64,${base64.replace(/\s+/g, "")}`);
				}
			}

			const fileData = part?.fileData || part?.file_data || null;
			if (fileData && typeof fileData === "object") {
				const fileUri =
					typeof fileData?.fileUri === "string" && fileData.fileUri.trim()
						? fileData.fileUri.trim()
						: typeof fileData?.file_uri === "string" && fileData.file_uri.trim()
							? fileData.file_uri.trim()
							: "";
				if (fileUri) urls.add(fileUri);
			}
		}
	}

	return Array.from(urls);
}

function detectImageExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct === "image/png") return "png";
	if (ct === "image/jpeg") return "jpg";
	if (ct === "image/webp") return "webp";
	if (ct === "image/gif") return "gif";
	if (ct === "video/mp4") return "mp4";
	return "bin";
}

type ValueSpec =
	| string
	| number
	| boolean
	| null
	| undefined
	| { from?: string; value?: any; transform?: string; filename?: string | null }
	| Record<string, any>
	| any[];

type FetchAsFileResolved = {
	blob: Blob;
	filename: string;
	mode: "fetched_file" | "data_url_file" | "contain_pad_file";
	width: number | null;
	height: number | null;
};

type FetchAsFileResizeHint = {
	targetWidth: number;
	targetHeight: number;
	background: string;
	reason: string;
};

type FetchAsFileOptions = {
	resizeHint?: FetchAsFileResizeHint | null;
	fieldName?: string;
	requestPath?: string;
};

type RequestLogFieldFile = {
	kind: "file";
	filename: string;
	contentType: string;
	sizeBytes: number;
	imageWidth?: number;
	imageHeight?: number;
	mode?: string;
};

type RequestLogField = string | number | boolean | null | RequestLogFieldFile;

type MappedRequestLog = {
	url: string;
	method: string;
	contentType: "json" | "multipart";
	headers: Record<string, string>;
	jsonBody?: unknown;
	formData?: Record<string, RequestLogField | RequestLogField[]>;
};

function parsePathSegments(path: string): Array<{ key: string; brackets: string[] }> {
	const out: Array<{ key: string; brackets: string[] }> = [];
	const raw = (path || "").trim();
	if (!raw) return out;
	const parts = raw.split(".").map((p) => p.trim()).filter(Boolean);
	for (const part of parts) {
		const keyMatch = part.match(/^([^\[]+)?/);
		const key = keyMatch && typeof keyMatch[1] === "string" ? keyMatch[1] : "";
		const brackets = Array.from(part.matchAll(/\[([^\]]+)\]/g)).map((m) => String(m[1] || "").trim());
		out.push({ key: key || "", brackets });
	}
	return out;
}

function getByPath(root: any, path: string): any {
	const segments = parsePathSegments(path);
	if (!segments.length) return undefined;
	let current: any[] = [root];
	for (const seg of segments) {
		const next: any[] = [];
		for (const item of current) {
			if (!item) continue;
			const base = seg.key ? (item as any)[seg.key] : item;
			let values: any[] = [base];
			for (const b of seg.brackets) {
				const expanded: any[] = [];
				for (const v of values) {
					if (!Array.isArray(v)) continue;
					if (b === "*" || b === "[*]") {
						expanded.push(...v);
						continue;
					}
					const idx = Number(b);
					if (Number.isFinite(idx)) {
						expanded.push(v[Math.max(0, Math.floor(idx))]);
					}
				}
				values = expanded;
			}
			next.push(...values);
		}
		current = next;
		if (!current.length) break;
	}
	if (!current.length) return undefined;
	if (current.length === 1) return current[0];
	return current;
}

function extractFirstByExpr(root: any, expr: string): any {
	const raw = (expr || "").trim();
	if (!raw) return undefined;
	const candidates = raw.split("|").map((s) => s.trim()).filter(Boolean);
	for (const c of candidates) {
		const v = getByPath(root, c);
		if (typeof v === "string" && v.trim()) return v.trim();
		if (typeof v === "number" && Number.isFinite(v)) return v;
		if (typeof v === "boolean") return v;
		if (v && typeof v === "object") return v;
		if (Array.isArray(v) && v.length) {
			for (const item of v) {
				if (typeof item === "string" && item.trim()) return item.trim();
				if (typeof item === "number" && Number.isFinite(item)) return item;
				if (typeof item === "boolean") return item;
				if (item && typeof item === "object") return item;
			}
		}
	}
	return undefined;
}

function extractValueByExpr(root: any, expr: string): any {
	const raw = (expr || "").trim();
	if (!raw) return undefined;
	const candidates = raw.split("|").map((s) => s.trim()).filter(Boolean);
	for (const c of candidates) {
		const v = getByPath(root, c);
		if (v === undefined || v === null) continue;
		if (typeof v === "string") {
			const trimmed = v.trim();
			if (!trimmed) continue;
			return trimmed;
		}
		if (typeof v === "number") {
			if (!Number.isFinite(v)) continue;
			return v;
		}
		if (typeof v === "boolean") return v;
		if (Array.isArray(v)) {
			if (!v.length) continue;
			return v.map((item) => (typeof item === "string" ? item.trim() : item));
		}
		if (typeof v === "object") return v;
		return v;
	}
	return undefined;
}

function extractAllByExpr(root: any, expr: string): any[] {
	const raw = (expr || "").trim();
	if (!raw) return [];
	const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
	const out: any[] = [];
	for (const p of parts) {
		const v = getByPath(root, p);
		if (typeof v === "undefined" || v === null) continue;
		if (Array.isArray(v)) out.push(...v);
		else out.push(v);
	}
	return out;
}

function looksLikeSourceExpr(raw: string): boolean {
	const trimmed = raw.trim();
	if (!trimmed) return false;
	if (trimmed.includes("|")) return true;
	const exprRootPattern =
		/^(request|task|model|modelInfo|providerMeta|account|extras|kind|prompt|negativePrompt|seed|width|height|steps|cfgScale|taskId|id|modelKey)(?:[.[]|$)/;
	return exprRootPattern.test(trimmed);
}

function resolveValueFromSource(source: any, spec: ValueSpec): any {
	if (typeof spec === "string") {
		const raw = spec.trim();
		if (!raw) return undefined;
		const pureDoubleBrace = raw.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
		if (pureDoubleBrace && pureDoubleBrace[1]) {
			return extractValueByExpr(source, pureDoubleBrace[1]);
		}
		const pureDollarBrace = raw.match(/^\$\{([^}]+)\}$/);
		if (pureDollarBrace && pureDollarBrace[1]) {
			return extractValueByExpr(source, pureDollarBrace[1]);
		}
		if (raw.includes("{{") || raw.includes("${")) {
			return renderTemplateString(raw, source);
		}
		if (looksLikeSourceExpr(raw)) {
			return extractValueByExpr(source, raw);
		}
		return raw;
	}
	if (typeof spec === "number" || typeof spec === "boolean" || spec === null) return spec;
	if (Array.isArray(spec)) {
		return spec.map((v) => resolveValueFromSource(source, v as any));
	}
	if (isRecord(spec)) {
		if (typeof spec.value !== "undefined") return spec.value;
		if (typeof spec.from === "string" && spec.from.trim()) {
			return extractValueByExpr(source, spec.from.trim());
		}
		// Nested JSON object mapping (best-effort)
		const out: Record<string, any> = {};
		for (const [k, v] of Object.entries(spec)) {
			if (k === "from" || k === "value" || k === "transform" || k === "filename") continue;
			out[k] = resolveValueFromSource(source, v as any);
		}
		return out;
	}
	return undefined;
}

function normalizeStatusMappingConfig(
	value: unknown,
): Partial<Record<TaskStatus, string[]>> {
	if (!isRecord(value)) return {};
	const out: Partial<Record<TaskStatus, string[]>> = {};
	for (const status of ["queued", "running", "succeeded", "failed"] as const) {
		const raw = (value as StageTemplateRecord)[status];
		if (!Array.isArray(raw)) continue;
		const tokens = raw
			.map((item) =>
				typeof item === "string" ? item.trim().toLowerCase() : "",
			)
			.filter(Boolean);
		if (tokens.length) out[status] = tokens;
	}
	return out;
}

function normalizeMappedTaskStatus(
	value: unknown,
	customStatusMapping?: unknown,
): TaskStatus {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "running";
		const customMap = normalizeStatusMappingConfig(customStatusMapping);
		for (const status of ["queued", "running", "succeeded", "failed"] as const) {
			const tokens = customMap[status];
			if (tokens?.includes(normalized)) return status;
		}
		if (
			normalized === "queued" ||
			normalized === "pending" ||
			normalized === "submitted" ||
			normalized === "waiting"
		) {
			return "queued";
		}
		if (
			normalized === "running" ||
			normalized === "processing" ||
			normalized === "generating" ||
			normalized === "in_progress" ||
			normalized === "in-progress"
		) {
			return "running";
		}
		if (
			normalized === "completed" ||
			normalized === "complete" ||
			normalized === "succeed" ||
			normalized === "succeeded" ||
			normalized === "success" ||
			normalized === "done"
		) {
			return "succeeded";
		}
		if (
			normalized === "failed" ||
			normalized === "failure" ||
			normalized === "error" ||
			normalized === "cancelled" ||
			normalized === "canceled"
		) {
			return "failed";
		}
		return "running";
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		const code = Math.floor(value);
		if (code === 0) return "queued";
		if (code === 1) return "running";
		if (code === 2) return "succeeded";
		if (code === 3 || code === -1) return "failed";
	}
	if (typeof value === "boolean") return value ? "succeeded" : "running";
	return "running";
}

function validateMappedInputReferenceMimeType(input: {
	fieldName?: string;
	requestPath?: string;
	mimeType: string;
	source: string;
}): void {
	if (input.fieldName !== "input_reference") return;
	if (!input.requestPath || !/^\/v1\/videos(?:\/|$)/i.test(input.requestPath)) return;
	const mimeType = normalizeMimeType(input.mimeType);
	if (isSupportedMappedVideoReferenceMimeType(mimeType)) {
		return;
	}
	throw new AppError(
		`input_reference 文件类型不受支持: ${mimeType || "unknown"}。仅支持 image/jpeg、image/png、image/webp、video/mp4`,
		{
			status: 400,
			code: "mapping_fetchAsFile_invalid_mime",
			details: {
				fieldName: input.fieldName,
				requestPath: input.requestPath,
				contentType: mimeType || null,
				source: input.source.slice(0, 160),
			},
		},
	);
}

async function resolveFetchAsFile(
	c: AppContext,
	input: string,
	options?: FetchAsFileOptions,
): Promise<FetchAsFileResolved> {
	const ref = String(input || "").trim();
	if (!ref) {
		throw new AppError("fetchAsFile 输入为空，无法构造上传文件", {
			status: 400,
			code: "mapping_fetchAsFile_empty",
		});
	}
	if (/^blob:/i.test(ref)) {
		throw new AppError("fetchAsFile 不支持 blob: URL，请先上传为可访问的图片地址", {
			status: 400,
			code: "mapping_fetchAsFile_invalid",
		});
	}

	const dataUrlMatch = ref.match(/^data:([^;]+);base64,(.+)$/i);
	if (dataUrlMatch) {
		const mimeType = (dataUrlMatch[1] || "").trim() || "application/octet-stream";
		const base64 = (dataUrlMatch[2] || "").trim();
		const buffer = Buffer.from(decodeBase64ToBytes(base64));
		validateMappedInputReferenceMimeType({
			fieldName: options?.fieldName,
			requestPath: options?.requestPath,
			mimeType,
			source: ref,
		});
		if (options?.resizeHint && canContainPadMimeType(mimeType)) {
			const padded = await renderImageContainPad({
				buffer,
				contentType: mimeType,
				targetWidth: options.resizeHint.targetWidth,
				targetHeight: options.resizeHint.targetHeight,
				background: options.resizeHint.background,
			});
			console.info(
				`[mapping:fetchAsFile] contain_pad source=data_url original=${padded.sourceWidth}x${padded.sourceHeight} target=${options.resizeHint.targetWidth}x${options.resizeHint.targetHeight} reason=${options.resizeHint.reason}`,
			);
			return {
				blob: new Blob([toSafeBlobPart(padded.buffer)], {
					type: padded.contentType,
				}),
				filename: `input_reference.${padded.filenameExtension}`,
				mode: "contain_pad_file",
				width: options.resizeHint.targetWidth,
				height: options.resizeHint.targetHeight,
			};
		}
		const ext = detectImageExtensionFromMimeType(mimeType);
		return {
			blob: new Blob([buffer], { type: mimeType }),
			filename: `input_reference.${ext || "bin"}`,
			mode: "data_url_file",
			width: null,
			height: null,
		};
	}

	if (/^https?:\/\//i.test(ref)) {
		let res: Response;
		try {
			res = await fetchWithHttpDebugLog(
				c,
				ref,
				{ method: "GET", headers: { Accept: "image/*,video/mp4,*/*;q=0.8" } },
				{ tag: "mapping:fetchAsFile" },
			);
		} catch (error: any) {
			throw new AppError("fetchAsFile 下载引用资源失败", {
				status: 502,
				code: "mapping_fetchAsFile_fetch_failed",
				details: { message: error?.message ?? String(error), source: ref.slice(0, 160) },
			});
		}
		if (!res.ok) {
			const failureSummary = await summarizeFetchAsFileFailure(res);
			const failureLabel = [failureSummary.upstreamCode, failureSummary.upstreamMessage]
				.filter((item): item is string => typeof item === "string" && item.length > 0)
				.join(" - ");
			throw new AppError(
				failureLabel
					? `fetchAsFile 下载引用资源失败: ${res.status} (${failureLabel})`
					: `fetchAsFile 下载引用资源失败: ${res.status}`,
				{
				status: 502,
				code: "mapping_fetchAsFile_fetch_failed",
				details: {
					upstreamStatus: res.status,
					upstreamCode: failureSummary.upstreamCode,
					upstreamMessage: failureSummary.upstreamMessage,
					source: ref.slice(0, 160),
				},
			},
			);
		}
		const contentType =
			(res.headers.get("content-type") || "").split(";")[0]?.trim() ||
			"application/octet-stream";
		validateMappedInputReferenceMimeType({
			fieldName: options?.fieldName,
			requestPath: options?.requestPath,
			mimeType: contentType,
			source: ref,
		});
		const buf = await res.arrayBuffer();
		const buffer = Buffer.from(buf);
		if (options?.resizeHint && canContainPadMimeType(contentType)) {
			const padded = await renderImageContainPad({
				buffer,
				contentType,
				targetWidth: options.resizeHint.targetWidth,
				targetHeight: options.resizeHint.targetHeight,
				background: options.resizeHint.background,
			});
			console.info(
				`[mapping:fetchAsFile] contain_pad source=${ref} original=${padded.sourceWidth}x${padded.sourceHeight} target=${options.resizeHint.targetWidth}x${options.resizeHint.targetHeight} reason=${options.resizeHint.reason}`,
			);
			return {
				blob: new Blob([toSafeBlobPart(padded.buffer)], {
					type: padded.contentType,
				}),
				filename: `input_reference.${padded.filenameExtension}`,
				mode: "contain_pad_file",
				width: options.resizeHint.targetWidth,
				height: options.resizeHint.targetHeight,
			};
		}
		const extFromUrl = (() => {
			try {
				const pathname = new URL(ref).pathname || "";
				const m = pathname.match(/\.([a-zA-Z0-9]+)$/);
				return m && m[1] ? m[1].toLowerCase() : null;
			} catch {
				return null;
			}
		})();
		const ext = extFromUrl || detectImageExtensionFromMimeType(contentType);
		return {
			blob: new Blob([buf], { type: contentType }),
			filename: `input_reference.${ext || "bin"}`,
			mode: "fetched_file",
			width: null,
			height: null,
		};
	}

	throw new AppError("fetchAsFile 仅支持 http(s) URL 或 data:* URL", {
		status: 400,
		code: "mapping_fetchAsFile_invalid",
		details: { source: ref.slice(0, 160) },
	});
}

function resolveSoraReferenceResizeHint(input: {
	fieldName: string;
	requestPath: string;
	source: Record<string, unknown>;
}): FetchAsFileResizeHint | null {
	if (input.fieldName !== "input_reference") return null;
	if (!/^\/v1\/videos(?:\/|$)/i.test(input.requestPath)) return null;
	const extras = isRecord(input.source.extras) ? input.source.extras : null;
	const sizeValue =
		extras && typeof extras.size === "string" && extras.size.trim()
			? extras.size.trim()
			: null;
	const parsed = parseSizeToDimensions(sizeValue);
	if (!parsed) return null;
	return {
		targetWidth: parsed.width,
		targetHeight: parsed.height,
		background: "#000000",
		reason: "sora_input_reference_autopad",
	};
}

export async function buildMappedUpstreamRequest(options: {
	c: AppContext;
	baseUrl: string;
	apiKey: string;
	auth: ModelCatalogVendorAuthForTask | null;
	stage: MappingStage;
	requestMapping: unknown;
	req: TaskRequestDto;
	taskId?: string | null;
}): Promise<{
	url: string;
	init: RequestInit;
	requestLog: MappedRequestLog;
	selectedStageMapping: StageTemplateRecord | null;
}> {
	const modelKey =
		typeof (options.req as Record<string, unknown>)?.extras === "object" &&
		options.req.extras &&
		typeof (options.req.extras as Record<string, unknown>).modelKey === "string"
			? String((options.req.extras as Record<string, unknown>).modelKey)
			: null;
	const source = buildMappingTemplateSource({
		req: options.req,
		taskId: options.taskId || null,
		modelKey,
		apiKey: options.apiKey,
	});
	const stageMapping = resolveSelectedStageMapping(
		options.requestMapping,
		options.stage,
		source,
	);
	if (!stageMapping || !isRecord(stageMapping)) {
		throw new AppError("mapping.requestMapping 未配置或格式错误", {
			status: 400,
			code: "mapping_request_invalid",
		});
	}

	const endpointRaw = stageMapping.endpoint;
	const endpoint = isRecord(endpointRaw) ? endpointRaw : null;
	const method =
		typeof stageMapping.method === "string" && stageMapping.method.trim()
			? stageMapping.method.trim().toUpperCase()
			: typeof endpoint?.method === "string" && endpoint.method.trim()
				? endpoint.method.trim().toUpperCase()
			: "POST";
	const pathRaw =
		typeof stageMapping.path === "string" && stageMapping.path.trim()
			? stageMapping.path.trim()
			: typeof endpoint?.path === "string" && endpoint.path.trim()
				? endpoint.path.trim()
			: "";
	if (!pathRaw) {
		throw new AppError("mapping.endpoint.path is required", {
			status: 400,
			code: "mapping_endpoint_missing",
		});
	}

	const interpolatedPath = renderTemplateString(pathRaw, source);

	const isAbsolute = /^https?:\/\//i.test(interpolatedPath);
	const u = isAbsolute
		? new URL(interpolatedPath)
		: new URL(interpolatedPath.replace(/^\/+/, "/"), options.baseUrl);

	// Query params mapping
	const queryMapping = isRecord(stageMapping.query)
		? stageMapping.query
		: isRecord(endpoint?.query)
			? endpoint.query
			: null;
	if (isRecord(queryMapping)) {
		for (const [k, v] of Object.entries(queryMapping)) {
			const value = resolveValueFromSource(source, v as any);
			if (typeof value === "undefined" || value === null) continue;
			u.searchParams.set(k, typeof value === "string" ? value : String(value));
		}
	}

	const headers: Record<string, string> = {
		Accept: "application/json",
	};

	// Auth injection
	const auth = options.auth;
	if (auth?.authType === "none") {
		// no-op
	} else if (auth?.authType === "query") {
		const param = auth.authQueryParam || "api_key";
		u.searchParams.set(param, options.apiKey);
	} else if (auth?.authType === "x-api-key") {
		const header = auth.authHeader || "X-API-Key";
		headers[header] = options.apiKey;
	} else {
		const header = auth?.authHeader || "Authorization";
		headers[header] = `Bearer ${options.apiKey}`;
	}

	// Custom headers mapping
	const headersMapping = isRecord(stageMapping.headers)
		? stageMapping.headers
		: isRecord(endpoint?.headers)
			? endpoint.headers
			: null;
	if (isRecord(headersMapping)) {
		for (const [k, v] of Object.entries(headersMapping)) {
			const value = resolveValueFromSource(source, v as any);
			if (typeof value === "undefined" || value === null) continue;
			headers[k] = typeof value === "string" ? value : String(value);
		}
	}

	const headerContentType = (() => {
		for (const [key, value] of Object.entries(headers)) {
			if (key.toLowerCase() === "content-type") return value;
		}
		return "";
	})();
	const contentTypeRaw =
		(typeof endpoint?.contentType === "string" && endpoint.contentType.trim()) ||
		(typeof stageMapping.contentType === "string" && stageMapping.contentType.trim()) ||
		(/multipart\/form-data/i.test(headerContentType) ? "multipart" : "json");
	const contentType = contentTypeRaw.toLowerCase();

	const init: RequestInit = {
		method,
		headers,
	};
	const requestLogHeaders: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "authorization") {
			requestLogHeaders[key] = "***";
			continue;
		}
		requestLogHeaders[key] = value;
	}
	const requestLog: MappedRequestLog = {
		url: u.toString(),
		method,
		contentType: contentType === "multipart" ? "multipart" : "json",
		headers: requestLogHeaders,
	};

	const methodNoBody = method === "GET" || method === "HEAD";
	if (!methodNoBody) {
		if (contentType === "multipart") {
			const formMapping =
				(isRecord(stageMapping.formData) && stageMapping.formData) ||
				(isRecord(stageMapping.input) && stageMapping.input) ||
				(isRecord(stageMapping.body) && stageMapping.body) ||
				null;
			if (!formMapping) {
				throw new AppError("mapping.formData is required for multipart requests", {
					status: 400,
					code: "mapping_formData_missing",
				});
			}
			const form = new FormData();
			const formLog: Record<string, RequestLogField | RequestLogField[]> = {};
			const appendFormLog = (
				key: string,
				value: RequestLogField,
			): void => {
				const existing = formLog[key];
				if (typeof existing === "undefined") {
					formLog[key] = value;
					return;
				}
				if (Array.isArray(existing)) {
					existing.push(value);
					return;
				}
				formLog[key] = [existing, value];
			};
			for (const [k, v] of Object.entries(formMapping)) {
				if (typeof v === "undefined" || v === null) continue;
				if (isRecord(v) && typeof (v as any).transform === "string") {
					const transform = String((v as any).transform || "").trim();
					if (transform === "fetchAsFile") {
						const from =
							typeof (v as any).from === "string" && (v as any).from.trim()
								? String((v as any).from).trim()
								: "";
						const rawValue = from ? extractFirstByExpr(source, from) : resolveValueFromSource(source, v as any);
						const rawString = typeof rawValue === "string" ? rawValue : rawValue != null ? String(rawValue) : "";
						if (!rawString.trim()) continue;
						const resizeHint = resolveSoraReferenceResizeHint({
							fieldName: k,
							requestPath: u.pathname,
							source,
						});
						const file = await resolveFetchAsFile(options.c, rawString, {
							resizeHint,
							fieldName: k,
							requestPath: u.pathname,
						});
						const filename =
							typeof (v as any).filename === "string" && (v as any).filename.trim()
								? String((v as any).filename).trim()
								: file.filename;
						form.append(k, file.blob, filename);
						appendFormLog(k, {
							kind: "file",
							filename,
							contentType: file.blob.type || "application/octet-stream",
							sizeBytes: file.blob.size,
							...(typeof file.width === "number" ? { imageWidth: file.width } : {}),
							...(typeof file.height === "number" ? { imageHeight: file.height } : {}),
							mode: file.mode,
						});
						continue;
					}
				}

				const value = resolveValueFromSource(source, v as any);
				if (typeof value === "undefined" || value === null) continue;
				if (typeof value === "string") {
					if (value.trim()) {
						form.append(k, value);
						appendFormLog(k, value);
					}
					continue;
				}
				if (typeof value === "number" || typeof value === "boolean") {
					form.append(k, String(value));
					appendFormLog(k, value);
					continue;
				}
				if (value instanceof Blob) {
					form.append(k, value);
					appendFormLog(k, {
						kind: "file",
						filename: "blob",
						contentType: value.type || "application/octet-stream",
						sizeBytes: value.size,
					});
					continue;
				}
				try {
					form.append(k, JSON.stringify(value));
					appendFormLog(k, JSON.stringify(value));
				} catch {
					form.append(k, String(value));
					appendFormLog(k, String(value));
				}
			}
			init.body = form;
			requestLog.formData = formLog;
		} else {
			const jsonMapping =
				(isRecord((stageMapping as any).json) && (stageMapping as any).json) ||
				(isRecord(stageMapping.input) && stageMapping.input) ||
				(isRecord(stageMapping.body) && stageMapping.body) ||
				null;
			if (!jsonMapping) {
				throw new AppError("mapping.input/json is required for json requests", {
					status: 400,
					code: "mapping_json_missing",
				});
			}
			const buildObject = (node: any): any => {
				if (typeof node === "string" || typeof node === "number" || typeof node === "boolean" || node === null) {
					return resolveValueFromSource(source, node as any);
				}
				if (Array.isArray(node)) {
					const mappedItems = node
						.map((v) => buildObject(v))
						.filter((item) => typeof item !== "undefined");
					return mappedItems;
				}
				if (isRecord(node)) {
					// leaf value mapping object
					if (typeof (node as any).from === "string" || typeof (node as any).value !== "undefined") {
						return resolveValueFromSource(source, node as any);
					}
					const out: Record<string, any> = {};
					for (const [k, v] of Object.entries(node)) {
						const mapped = buildObject(v);
						if (typeof mapped === "undefined") continue;
						out[k] = mapped;
					}
					return out;
				}
				return undefined;
			};
			const bodyObj = buildObject(jsonMapping);
			headers["Content-Type"] = "application/json";
			requestLog.headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(bodyObj ?? {});
			requestLog.jsonBody = bodyObj ?? {};
		}
	}

	return {
		url: u.toString(),
		init,
		requestLog,
		selectedStageMapping: stageMapping,
	};
}

export function parseMappedTaskResultFromPayload(options: {
	vendorKey: string;
	model: string | null;
	stage: MappingStage;
	reqKind: TaskRequestDto["kind"];
	payload: any;
	responseMapping: unknown;
	fallbackTaskId?: string | null;
	selectedStageMapping?: unknown;
}): ReturnType<typeof TaskResultSchema.parse> {
	const selectedStageMapping =
		options.selectedStageMapping && isRecord(options.selectedStageMapping)
			? (options.selectedStageMapping as StageTemplateRecord)
			: null;
	const selectedResponseMapping =
		selectedStageMapping &&
		(isRecord(selectedStageMapping.responseMapping) ||
			isRecord(selectedStageMapping.response_mapping) ||
			normalizeExprSpec(selectedStageMapping.taskId).length > 0 ||
			normalizeExprSpec(selectedStageMapping.task_id).length > 0 ||
			normalizeExprSpec(selectedStageMapping.status).length > 0 ||
			normalizeExprSpec(selectedStageMapping.assets).length > 0 ||
			normalizeExprSpec(selectedStageMapping.video_url).length > 0)
			? selectedStageMapping
			: null;
	const stageMapping =
		selectedResponseMapping ||
		resolveSelectedStageMapping(options.responseMapping, options.stage, {
			request: {},
		});
	const responseMappingRecord =
		stageMapping && isRecord(stageMapping.responseMapping)
			? (stageMapping.responseMapping as StageTemplateRecord)
			: stageMapping && isRecord(stageMapping.response_mapping)
				? (stageMapping.response_mapping as StageTemplateRecord)
				: null;
	const mapping =
		responseMappingRecord ||
		(stageMapping && isRecord(stageMapping) ? stageMapping : {});
	const mappingRoot =
		options.responseMapping && isRecord(options.responseMapping)
			? (options.responseMapping as StageTemplateRecord)
			: null;
	const statusMapping =
		(stageMapping && isRecord(stageMapping.statusMapping) && stageMapping.statusMapping) ||
		(stageMapping && isRecord(stageMapping.status_mapping) && stageMapping.status_mapping) ||
		(mappingRoot && isRecord(mappingRoot.statusMapping) && mappingRoot.statusMapping) ||
		(mappingRoot && isRecord(mappingRoot.status_mapping) && mappingRoot.status_mapping) ||
		undefined;

	const taskIdExpr =
		normalizeExprSpec((mapping as StageTemplateRecord).taskId) ||
		normalizeExprSpec((mapping as StageTemplateRecord).task_id);
	const statusExpr =
		normalizeExprSpec((mapping as StageTemplateRecord).status);
	const progressExpr =
		normalizeExprSpec((mapping as StageTemplateRecord).progress);
	const errorExpr =
		normalizeExprSpec((mapping as StageTemplateRecord).errorMessage) ||
		normalizeExprSpec((mapping as StageTemplateRecord).error_message);

	const extractedTaskId =
		(typeof extractFirstByExpr(options.payload, taskIdExpr) === "string" &&
			String(extractFirstByExpr(options.payload, taskIdExpr)).trim()) ||
		(typeof options.payload?.id === "string" && options.payload.id.trim()) ||
		(typeof options.payload?.task_id === "string" && options.payload.task_id.trim()) ||
		(typeof options.payload?.taskId === "string" && options.payload.taskId.trim()) ||
		(options.fallbackTaskId ? String(options.fallbackTaskId).trim() : "") ||
		`${options.vendorKey}-${Date.now().toString(36)}`;

	const rawStatus =
		statusExpr ? extractFirstByExpr(options.payload, statusExpr) : options.payload?.status;
	let status =
		rawStatus != null
			? normalizeMappedTaskStatus(rawStatus, statusMapping)
			: options.stage === "create"
				? "queued"
				: "running";

	const rawProgress = progressExpr ? extractFirstByExpr(options.payload, progressExpr) : options.payload?.progress;
	const progress =
		typeof rawProgress === "number" && Number.isFinite(rawProgress)
			? Math.max(0, Math.min(100, Math.round(rawProgress)))
			: undefined;

	const assetsConfig = isRecord((mapping as any).assets) ? ((mapping as any).assets as any) : null;
	const assetTypeRaw = assetsConfig && typeof assetsConfig.type === "string" ? assetsConfig.type.trim() : "";
	const assetType = assetTypeRaw === "image" || assetTypeRaw === "video" ? assetTypeRaw : null;
	const urlsExpr =
		assetsConfig ? normalizeExprSpec(assetsConfig.urls) : normalizeExprSpec((mapping as StageTemplateRecord).assets);
	const urlExpr =
		assetsConfig
			? normalizeExprSpec(assetsConfig.url)
			: normalizeExprSpec((mapping as StageTemplateRecord).videoUrl) ||
				normalizeExprSpec((mapping as StageTemplateRecord).video_url) ||
				normalizeExprSpec((mapping as StageTemplateRecord).imageUrl) ||
				normalizeExprSpec((mapping as StageTemplateRecord).image_url);
	const urls = (() => {
		const collected = new Set<string>();
		const add = (v: any) => {
			if (typeof v === "string" && v.trim()) collected.add(v.trim());
		};
		if (urlsExpr) extractAllByExpr(options.payload, urlsExpr).forEach(add);
		if (urlExpr) add(extractFirstByExpr(options.payload, urlExpr));
		if (!collected.size && (options.reqKind === "text_to_image" || options.reqKind === "image_edit")) {
			extractInlineImageDataUrlsFromGenerateContent(options.payload).forEach(add);
		}
		return Array.from(collected);
	})();

	const inferredAssetType =
		assetType ||
		(options.reqKind === "text_to_image" || options.reqKind === "image_edit"
			? "image"
			: "video");

	const assets = urls.map((u) => TaskAssetSchema.parse({ type: inferredAssetType, url: u, thumbnailUrl: null }));

	const isAssetTask =
		options.reqKind === "text_to_image" ||
		options.reqKind === "image_edit" ||
		options.reqKind === "text_to_video" ||
		options.reqKind === "image_to_video";
	const hasSyncModelOutput = (() => {
		if (Array.isArray((options.payload as any)?.candidates) && (options.payload as any).candidates.length) {
			return true;
		}
		if (Array.isArray((options.payload as any)?.choices) && (options.payload as any).choices.length) {
			return true;
		}
		return false;
	})();
	if (isAssetTask) {
		if (status === "succeeded" && !assets.length) {
			status = "running";
		}
		if (status !== "succeeded" && assets.length) {
			status = "succeeded";
		}
	} else if ((status === "queued" || status === "running") && hasSyncModelOutput) {
		status = "succeeded";
	}

	const errorMessageValue = errorExpr ? extractFirstByExpr(options.payload, errorExpr) : null;
	const errorMessage =
		typeof errorMessageValue === "string" && errorMessageValue.trim()
			? errorMessageValue.trim()
			: null;
	const providerMetaMapping =
		stageMapping && isRecord(stageMapping.providerMetaMapping)
			? (stageMapping.providerMetaMapping as StageTemplateRecord)
			: stageMapping && isRecord(stageMapping.provider_meta_mapping)
				? (stageMapping.provider_meta_mapping as StageTemplateRecord)
				: null;
	const providerMeta = (() => {
		if (!providerMetaMapping) return null;
		const entries = Object.entries(providerMetaMapping).flatMap(([key, expr]) => {
			const normalizedExpr = normalizeExprSpec(expr);
			if (!normalizedExpr) return [];
			const extracted = extractFirstByExpr(options.payload, normalizedExpr);
			if (!isMeaningfulValue(extracted)) return [];
			return [[key, extracted] as const];
		});
		return entries.length ? Object.fromEntries(entries) : null;
	})();
	const pid =
		providerMeta &&
		typeof (providerMeta as Record<string, unknown>).query_id === "string" &&
		String((providerMeta as Record<string, unknown>).query_id).trim()
			? String((providerMeta as Record<string, unknown>).query_id).trim()
			: null;

	return TaskResultSchema.parse({
		id: extractedTaskId,
		kind: options.reqKind,
		status,
		assets,
		raw: {
			provider: "mapping",
			vendor: options.vendorKey,
			model: options.model,
			stage: options.stage,
			progress,
			errorMessage,
			error: errorMessage,
			message: errorMessage,
			...(providerMeta ? { providerMeta } : {}),
			...(pid ? { pid, vendorTaskId: pid } : {}),
			response: options.payload ?? null,
		},
	});
}
