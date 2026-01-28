import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { ensureModelCatalogSchema } from "../model-catalog/model-catalog.repo";
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
	const last = parts.length ? parts[parts.length - 1]! : raw;
	if (last === "google") return "gemini";
	if (last === "hailuo") return "minimax";
	return last;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function resolveEnabledModelCatalogMappingForTask(
	c: AppContext,
	vendorKey: string,
	taskKind: TaskRequestDto["kind"],
): Promise<RuntimeModelCatalogMapping | null> {
	const vk = normalizeVendorKey(vendorKey);
	if (!vk) return null;
	try {
		await ensureModelCatalogSchema(c.env.DB);
		const row = await c.env.DB.prepare(
			`SELECT id, vendor_key, task_kind, name, request_mapping, response_mapping
       FROM model_catalog_mappings
       WHERE vendor_key = ? AND task_kind = ? AND enabled = 1
       ORDER BY updated_at DESC, created_at DESC, name ASC
       LIMIT 1`,
		)
			.bind(vk, taskKind)
			.first<any>();
		if (!row) return null;
		return {
			id: String(row.id),
			vendorKey: String(row.vendor_key || vk),
			taskKind: taskKind,
			name: typeof row.name === "string" ? row.name : "",
			requestMapping: safeJsonParse(row.request_mapping ?? null),
			responseMapping: safeJsonParse(row.response_mapping ?? null),
		};
	} catch {
		return null;
	}
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
		const poll = mapping.poll;
		if (isRecord(poll)) return poll;
	}

	// Fallback: treat the mapping itself as a stage mapping.
	return mapping;
}

function interpolateTemplate(input: string, vars: Record<string, string | null | undefined>): string {
	const raw = String(input || "");
	return raw.replace(/\$\{(\w+)\}/g, (_, key) => {
		const v = vars[key];
		return typeof v === "string" ? v : "";
	});
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

function detectImageExtensionFromMimeType(contentType: string): string {
	const ct = (contentType || "").toLowerCase();
	if (ct === "image/png") return "png";
	if (ct === "image/jpeg") return "jpg";
	if (ct === "image/webp") return "webp";
	if (ct === "image/gif") return "gif";
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

function resolveValueFromSource(source: any, spec: ValueSpec): any {
	if (typeof spec === "string") {
		return extractFirstByExpr(source, spec);
	}
	if (typeof spec === "number" || typeof spec === "boolean" || spec === null) return spec;
	if (Array.isArray(spec)) {
		return spec.map((v) => resolveValueFromSource(source, v as any));
	}
	if (isRecord(spec)) {
		if (typeof spec.value !== "undefined") return spec.value;
		if (typeof spec.from === "string" && spec.from.trim()) {
			return extractFirstByExpr(source, spec.from.trim());
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

function normalizeMappedTaskStatus(value: unknown): TaskStatus {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (!normalized) return "running";
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

async function resolveFetchAsFile(
	c: AppContext,
	input: string,
): Promise<{ blob: Blob; filename: string; mode: "fetched_file" | "url_file" | "data_url_file" }> {
	const ref = String(input || "").trim();
	if (!ref) {
		return { blob: new Blob([""], { type: "text/plain" }), filename: "input_reference.url", mode: "url_file" };
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
		const bytes = decodeBase64ToBytes(base64);
		const ext = detectImageExtensionFromMimeType(mimeType);
		return {
			blob: new Blob([bytes], { type: mimeType }),
			filename: `input_reference.${ext || "bin"}`,
			mode: "data_url_file",
		};
	}

	if (/^https?:\/\//i.test(ref)) {
		try {
			const res = await fetchWithHttpDebugLog(
				c,
				ref,
				{ method: "GET", headers: { Accept: "image/*,*/*;q=0.8" } },
				{ tag: "mapping:fetchAsFile" },
			);
			if (res.ok) {
				const contentType =
					(res.headers.get("content-type") || "").split(";")[0]?.trim() ||
					"application/octet-stream";
				const buf = await res.arrayBuffer();
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
				};
			}
		} catch {
			// fall through to url_file fallback
		}
	}

	return {
		blob: new Blob([ref], { type: "text/plain" }),
		filename: "input_reference.url",
		mode: "url_file",
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
}): Promise<{ url: string; init: RequestInit }> {
	const stageMapping = pickStageMapping(options.requestMapping, options.stage);
	if (!stageMapping || !isRecord(stageMapping)) {
		throw new AppError("mapping.requestMapping 未配置或格式错误", {
			status: 400,
			code: "mapping_request_invalid",
		});
	}

	const endpointRaw = stageMapping.endpoint;
	const endpoint = isRecord(endpointRaw) ? endpointRaw : null;
	const method =
		typeof endpoint?.method === "string" && endpoint.method.trim()
			? endpoint.method.trim().toUpperCase()
			: "POST";
	const pathRaw =
		typeof endpoint?.path === "string" && endpoint.path.trim()
			? endpoint.path.trim()
			: "";
	if (!pathRaw) {
		throw new AppError("mapping.endpoint.path is required", {
			status: 400,
			code: "mapping_endpoint_missing",
		});
	}

	const interpolatedPath = interpolateTemplate(pathRaw, {
		taskId: options.taskId || null,
		id: options.taskId || null,
	});

	const isAbsolute = /^https?:\/\//i.test(interpolatedPath);
	const u = isAbsolute
		? new URL(interpolatedPath)
		: new URL(interpolatedPath.replace(/^\/+/, "/"), options.baseUrl);

	// Query params mapping
	const queryMapping = stageMapping.query;
	if (isRecord(queryMapping)) {
		const source = { ...options.req, extras: options.req.extras || {} };
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
	const headersMapping = stageMapping.headers;
	if (isRecord(headersMapping)) {
		const source = { ...options.req, extras: options.req.extras || {} };
		for (const [k, v] of Object.entries(headersMapping)) {
			const value = resolveValueFromSource(source, v as any);
			if (typeof value === "undefined" || value === null) continue;
			headers[k] = typeof value === "string" ? value : String(value);
		}
	}

	const contentTypeRaw =
		(typeof endpoint?.contentType === "string" && endpoint.contentType.trim()) ||
		(typeof (stageMapping as any).contentType === "string" && String((stageMapping as any).contentType).trim()) ||
		"json";
	const contentType = contentTypeRaw.toLowerCase();

	const init: RequestInit = {
		method,
		headers,
	};

	const methodNoBody = method === "GET" || method === "HEAD";
	if (!methodNoBody) {
		const source = { ...options.req, extras: options.req.extras || {} };
		if (contentType === "multipart") {
			const formMapping =
				(isRecord(stageMapping.formData) && stageMapping.formData) ||
				(isRecord(stageMapping.input) && stageMapping.input) ||
				null;
			if (!formMapping) {
				throw new AppError("mapping.formData is required for multipart requests", {
					status: 400,
					code: "mapping_formData_missing",
				});
			}
			const form = new FormData();
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
						const file = await resolveFetchAsFile(options.c, rawString);
						const filename =
							typeof (v as any).filename === "string" && (v as any).filename.trim()
								? String((v as any).filename).trim()
								: file.filename;
						form.append(k, file.blob, filename);
						continue;
					}
				}

				const value = resolveValueFromSource(source, v as any);
				if (typeof value === "undefined" || value === null) continue;
				if (typeof value === "string") {
					if (value.trim()) form.append(k, value);
					continue;
				}
				if (typeof value === "number" || typeof value === "boolean") {
					form.append(k, String(value));
					continue;
				}
				if (value instanceof Blob) {
					form.append(k, value);
					continue;
				}
				try {
					form.append(k, JSON.stringify(value));
				} catch {
					form.append(k, String(value));
				}
			}
			init.body = form;
		} else {
			const jsonMapping =
				(isRecord((stageMapping as any).json) && (stageMapping as any).json) ||
				(isRecord(stageMapping.input) && stageMapping.input) ||
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
				if (Array.isArray(node)) return node.map((v) => buildObject(v));
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
			init.body = JSON.stringify(bodyObj ?? {});
		}
	}

	return { url: u.toString(), init };
}

export function parseMappedTaskResultFromPayload(options: {
	vendorKey: string;
	model: string | null;
	stage: MappingStage;
	reqKind: TaskRequestDto["kind"];
	payload: any;
	responseMapping: unknown;
	fallbackTaskId?: string | null;
}): ReturnType<typeof TaskResultSchema.parse> {
	const stageMapping = pickStageMapping(options.responseMapping, options.stage);
	const mapping = stageMapping && isRecord(stageMapping) ? stageMapping : {};

	const taskIdExpr =
		typeof (mapping as any).taskId === "string" ? String((mapping as any).taskId).trim() : "";
	const statusExpr =
		typeof (mapping as any).status === "string" ? String((mapping as any).status).trim() : "";
	const progressExpr =
		typeof (mapping as any).progress === "string" ? String((mapping as any).progress).trim() : "";
	const errorExpr =
		typeof (mapping as any).errorMessage === "string"
			? String((mapping as any).errorMessage).trim()
			: "";

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
		rawStatus != null ? normalizeMappedTaskStatus(rawStatus) : options.stage === "create" ? "queued" : "running";

	const rawProgress = progressExpr ? extractFirstByExpr(options.payload, progressExpr) : options.payload?.progress;
	const progress =
		typeof rawProgress === "number" && Number.isFinite(rawProgress)
			? Math.max(0, Math.min(100, Math.round(rawProgress)))
			: undefined;

	const assetsConfig = isRecord((mapping as any).assets) ? ((mapping as any).assets as any) : null;
	const assetTypeRaw = assetsConfig && typeof assetsConfig.type === "string" ? assetsConfig.type.trim() : "";
	const assetType = assetTypeRaw === "image" || assetTypeRaw === "video" ? assetTypeRaw : null;
	const urlsExpr =
		assetsConfig && typeof assetsConfig.urls === "string" ? String(assetsConfig.urls).trim() : "";
	const urlExpr =
		assetsConfig && typeof assetsConfig.url === "string" ? String(assetsConfig.url).trim() : "";
	const urls = (() => {
		const collected = new Set<string>();
		const add = (v: any) => {
			if (typeof v === "string" && v.trim()) collected.add(v.trim());
		};
		if (urlsExpr) extractAllByExpr(options.payload, urlsExpr).forEach(add);
		if (urlExpr) add(extractFirstByExpr(options.payload, urlExpr));
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
	if (isAssetTask) {
		if (status === "succeeded" && !assets.length) {
			status = "running";
		}
		if (status !== "succeeded" && assets.length) {
			status = "succeeded";
		}
	}

	const errorMessageValue = errorExpr ? extractFirstByExpr(options.payload, errorExpr) : null;
	const errorMessage =
		typeof errorMessageValue === "string" && errorMessageValue.trim()
			? errorMessageValue.trim()
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
			response: options.payload ?? null,
		},
	});
}
