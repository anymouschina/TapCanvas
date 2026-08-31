import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	CreateLlmNodePresetRequestSchema,
	LlmNodePresetSchema,
	LlmNodePresetStyleReferenceSchema,
	PromptSampleInputSchema,
	PromptSampleSchema,
	UpsertAdminLlmNodePresetRequestSchema,
	type LlmNodePresetDto,
	type PromptSampleDto,
} from "./ai.schemas";
import { isAdminRequest } from "../team/team.service";
import {
	PROMPT_SAMPLES,
	matchPromptSamples,
	type PromptSample as OfficialPromptSample,
} from "./prompt-samples.data";

type PromptSampleRow = {
	id: string;
	user_id: string;
	node_kind: string;
	scene: string;
	command_type: string;
	title: string;
	prompt: string;
	description: string | null;
	input_hint: string | null;
	output_note: string | null;
	keywords: string | null;
	created_at: string;
	updated_at: string;
};

type LlmNodePresetRow = {
	id: string;
	owner_id: string | null;
	scope: string;
	preset_type: string;
	title: string;
	prompt: string;
	description: string | null;
	meta: string | null;
	enabled: number;
	sort_order: number | null;
	created_at: string;
	updated_at: string;
};

const PRESET_SCOPE_USER = "user";
const PRESET_SCOPE_BASE = "base";
let llmNodePresetSchemaReady = false;

async function ensureLlmNodePresetSchema(c: AppContext): Promise<void> {
	void c;
	if (llmNodePresetSchemaReady) return;
	llmNodePresetSchemaReady = true;
}

function normalizeLlmNodePresetType(
	type?: string | null,
): "text" | "image" | "video" | undefined {
	const raw = String(type || "").trim().toLowerCase();
	if (raw === "text") return "text";
	if (raw === "image") return "image";
	if (raw === "video") return "video";
	return undefined;
}

function normalizeLlmNodePresetScope(
	scope?: string | null,
): typeof PRESET_SCOPE_BASE | typeof PRESET_SCOPE_USER | undefined {
	const raw = String(scope || "").trim().toLowerCase();
	if (!raw) return undefined;
	if (raw === PRESET_SCOPE_BASE) return PRESET_SCOPE_BASE;
	if (raw === PRESET_SCOPE_USER) return PRESET_SCOPE_USER;
	throw new AppError("无效的预设范围", {
		status: 400,
		code: "invalid_node_preset_scope",
	});
}

type ParsedPresetMeta = Pick<LlmNodePresetDto, "referenceImageUrl" | "styleReference">;

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const output: string[] = [];
	for (const item of value) {
		const text = typeof item === "string" ? item.trim() : "";
		if (text) output.push(text);
	}
	return output;
}

function parsePresetMeta(raw: string | null | undefined): ParsedPresetMeta {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const record = parsed as Record<string, unknown>;
		const url = typeof record.referenceImageUrl === "string" ? record.referenceImageUrl.trim() : "";
		const rawStyleReference =
			record.styleReference && typeof record.styleReference === "object" && !Array.isArray(record.styleReference)
				? (record.styleReference as Record<string, unknown>)
				: {};
		const styleReference = LlmNodePresetStyleReferenceSchema.parse({
			...(typeof record.styleId === "string" && record.styleId.trim() ? { styleId: record.styleId.trim() } : {}),
			...(typeof rawStyleReference.styleId === "string" && rawStyleReference.styleId.trim()
				? { styleId: rawStyleReference.styleId.trim() }
				: {}),
			...(readStringArray(record.categories).length ? { categories: readStringArray(record.categories) } : {}),
			...(readStringArray(rawStyleReference.categories).length ? { categories: readStringArray(rawStyleReference.categories) } : {}),
			...(readStringArray(record.tags).length ? { tags: readStringArray(record.tags) } : {}),
			...(readStringArray(rawStyleReference.tags).length ? { tags: readStringArray(rawStyleReference.tags) } : {}),
			...(typeof rawStyleReference.era === "string" && rawStyleReference.era.trim()
				? { era: rawStyleReference.era.trim() }
				: {}),
			...(typeof rawStyleReference.region === "string" && rawStyleReference.region.trim()
				? { region: rawStyleReference.region.trim() }
				: {}),
			...(typeof rawStyleReference.ethnicity === "string" && rawStyleReference.ethnicity.trim()
				? { ethnicity: rawStyleReference.ethnicity.trim() }
				: {}),
			...(typeof rawStyleReference.medium === "string" && rawStyleReference.medium.trim()
				? { medium: rawStyleReference.medium.trim() }
				: {}),
		});
		return {
			...(url ? { referenceImageUrl: url } : {}),
			...(Object.keys(styleReference).length ? { styleReference } : {}),
		};
	} catch {
		return {};
	}
}

function buildPresetMeta(input: {
	referenceImageUrl?: string | null;
	styleReference?: LlmNodePresetDto["styleReference"];
}): string | null {
	const referenceImageUrl = input.referenceImageUrl?.trim() || "";
	const styleReference = input.styleReference
		? LlmNodePresetStyleReferenceSchema.parse(input.styleReference)
		: undefined;
	const meta = {
		...(referenceImageUrl ? { referenceImageUrl } : {}),
		...(styleReference && Object.keys(styleReference).length ? { styleReference } : {}),
	};
	return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

function mapLlmNodePresetRow(row: LlmNodePresetRow): LlmNodePresetDto {
	const type = normalizeLlmNodePresetType(row.preset_type) ?? "text";
	const scope = row.scope === PRESET_SCOPE_BASE ? PRESET_SCOPE_BASE : PRESET_SCOPE_USER;
	const meta = parsePresetMeta(row.meta);
	return LlmNodePresetSchema.parse({
		id: row.id,
		title: row.title,
		type,
		prompt: row.prompt,
		description: row.description || undefined,
		...meta,
		scope,
		enabled: !!row.enabled,
		sortOrder: row.sort_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	});
}

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizePromptSampleKind(
	kind?: string | null,
): OfficialPromptSample["nodeKind"] | undefined {
	if (!kind) return undefined;
	if (kind === "image") return "image";
	if (kind === "composeVideo" || kind === "video") return "composeVideo";
	if (kind === "storyboard") return "storyboard";
	return undefined;
}

function normalizePromptSampleSource(
	source?: string | null,
): "official" | "custom" | "all" {
	if (!source) return "all";
	const lower = source.toLowerCase();
	if (lower === "official") return "official";
	if (lower === "custom") return "custom";
	return "all";
}

function mapOfficialPromptSample(sample: OfficialPromptSample): PromptSampleDto {
	return PromptSampleSchema.parse({
		...sample,
		source: "official" as const,
	});
}

function mapCustomPromptSample(row: PromptSampleRow): PromptSampleDto {
	let keywords: string[] = [];
	if (row.keywords) {
		try {
			const parsed = JSON.parse(row.keywords);
			if (Array.isArray(parsed)) {
				keywords = parsed
					.filter((v) => typeof v === "string" && v.trim())
					.map((v) => v.trim());
			}
		} catch {
			keywords = [];
		}
	}
	return PromptSampleSchema.parse({
		id: row.id,
		scene: row.scene,
		commandType: row.command_type,
		title: row.title,
		nodeKind: (normalizePromptSampleKind(row.node_kind) ??
			"image") as OfficialPromptSample["nodeKind"],
		prompt: row.prompt,
		description: row.description || undefined,
		inputHint: row.input_hint || undefined,
		outputNote: row.output_note || undefined,
		keywords,
		source: "custom",
	});
}

function computeCustomPromptSampleScore(
	sample: PromptSampleDto,
	query: string,
): number {
	let score = 0;
	const q = query.toLowerCase();
	const collect = [
		sample.title,
		sample.scene,
		sample.commandType,
		sample.prompt,
		sample.description,
		sample.inputHint,
		sample.outputNote,
	];
	collect.forEach((field) => {
		if (field && field.toLowerCase().includes(q)) {
			score += field === sample.prompt ? 3 : 2;
		}
	});
	sample.keywords?.forEach((keyword) => {
		if (keyword.toLowerCase().includes(q)) {
			score += 2;
		}
	});
	return score;
}

function filterCustomPromptSamples(
	samples: PromptSampleDto[],
	query: string,
): PromptSampleDto[] {
	const haystack = query.toLowerCase();
	const scored = samples
		.map((sample) => ({
			sample,
			score: computeCustomPromptSampleScore(sample, haystack),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((item) => item.sample);
	return scored.length ? scored : samples;
}

export async function listPromptSamples(
	c: AppContext,
	userId: string,
	input?: { q?: string; nodeKind?: string; source?: string },
): Promise<{ samples: PromptSampleDto[] }> {
	const normalizedKind = normalizePromptSampleKind(input?.nodeKind);
	const normalizedQuery = (input?.q || "").trim();
	const normalizedSource = normalizePromptSampleSource(input?.source);
	const limit = 12;

	const includeOfficial = normalizedSource !== "custom";
	const includeCustom = normalizedSource !== "official";

	const officialPool: OfficialPromptSample[] = includeOfficial
		? normalizedKind
			? PROMPT_SAMPLES.filter((s) => s.nodeKind === normalizedKind)
			: PROMPT_SAMPLES
		: [];

	let customRows: PromptSampleRow[] = [];
	if (includeCustom) {
		const take = normalizedQuery ? 50 : limit * 2;
		customRows = await getPrismaClient().prompt_samples.findMany({
			where: {
				user_id: userId,
				...(normalizedKind ? { node_kind: normalizedKind } : {}),
			},
			orderBy: { updated_at: "desc" },
			take,
		});
	}

	const customSamples = customRows.map(mapCustomPromptSample);
	const officialSamples = officialPool.map(mapOfficialPromptSample);

	let filteredCustom = customSamples;
	if (normalizedQuery) {
		filteredCustom = filterCustomPromptSamples(
			customSamples,
			normalizedQuery,
		);
	}

	let filteredOfficial = officialSamples;
	if (normalizedQuery) {
		const matched = matchPromptSamples(normalizedQuery, limit * 2);
		const filteredMatched = normalizedKind
			? matched.filter((s) => s.nodeKind === normalizedKind)
			: matched;
		filteredOfficial = filteredMatched.map(mapOfficialPromptSample);
	}

	const combined: PromptSampleDto[] = [];
	if (includeCustom) {
		combined.push(...filteredCustom);
	}
	if (combined.length < limit && includeOfficial) {
		combined.push(...filteredOfficial);
	}

	if (!normalizedQuery && includeOfficial && combined.length < limit) {
		combined.push(
			...officialSamples.filter(
				(sample) =>
					!filteredOfficial.some((match) => match.id === sample.id),
			),
		);
	}

	return { samples: combined.slice(0, limit) };
}

export async function createPromptSample(
	c: AppContext,
	userId: string,
	input: unknown,
) {
	const parsed = PromptSampleInputSchema.parse(input);
	const nodeKind = normalizePromptSampleKind(parsed.nodeKind) ?? "image";
	const title = parsed.title.trim();
	const scene = parsed.scene.trim();
	const commandType = parsed.commandType.trim();
	const prompt = parsed.prompt.trim();
	if (!title || !scene || !commandType || !prompt) {
		throw new AppError("标题、场景、指令类型与提示词不能为空", {
			status: 400,
			code: "invalid_prompt_sample",
		});
	}
	const keywords = (parsed.keywords || [])
		.map((k) => (k || "").trim())
		.filter(Boolean);

	const nowIso = new Date().toISOString();
	const id = crypto.randomUUID();

	await getPrismaClient().prompt_samples.create({
		data: {
			id,
			user_id: userId,
			node_kind: nodeKind,
			scene,
			command_type: commandType,
			title,
			prompt,
			description: parsed.description ?? null,
			input_hint: parsed.inputHint ?? null,
			output_note: parsed.outputNote ?? null,
			keywords: JSON.stringify(keywords),
			created_at: nowIso,
			updated_at: nowIso,
		},
	});

	const row = await getPrismaClient().prompt_samples.findFirst({
		where: { id, user_id: userId },
	});
	if (!row) {
		throw new AppError("create prompt sample failed", {
			status: 500,
			code: "prompt_sample_create_failed",
		});
	}
	return mapCustomPromptSample(row);
}

export async function deletePromptSample(
	c: AppContext,
	userId: string,
	id: string,
) {
	void c;
	const existing = await getPrismaClient().prompt_samples.findFirst({
		where: { id, user_id: userId },
		select: { id: true },
	});
	if (!existing) {
		throw new AppError("未找到该案例或无权删除", {
			status: 404,
			code: "prompt_sample_not_found",
		});
	}
	await getPrismaClient().prompt_samples.deleteMany({
		where: { id, user_id: userId },
	});
	return { success: true };
}

export async function parsePromptSample(
	_c: AppContext,
	_userId: string,
	input: { rawPrompt: string; nodeKind?: string | null },
) {
	const rawPrompt = (input.rawPrompt || "").trim();
	if (!rawPrompt) {
		throw new AppError("rawPrompt 不能为空", {
			status: 400,
			code: "invalid_prompt_sample",
		});
	}
	const normalizedKind =
		normalizePromptSampleKind(input.nodeKind) ?? "composeVideo";
	const titleSeed = rawPrompt.replace(/\s+/g, " ").trim();
	const title =
		titleSeed.length > 24 ? `${titleSeed.slice(0, 24)}…` : titleSeed;

	return PromptSampleInputSchema.parse({
		scene: "自定义场景",
		commandType: "自定义指令",
		title: title || "自定义模板",
		nodeKind: normalizedKind,
		prompt: rawPrompt,
		description: undefined,
		inputHint: undefined,
		outputNote: undefined,
		keywords: [],
	});
}

export async function listLlmNodePresets(
	c: AppContext,
	userId: string,
	input?: { q?: string; type?: string | null; scope?: string | null; limit?: string | number | null },
): Promise<LlmNodePresetDto[]> {
	await ensureLlmNodePresetSchema(c);
	const normalizedType = normalizeLlmNodePresetType(input?.type);
	const normalizedScope = normalizeLlmNodePresetScope(input?.scope);
	const q = String(input?.q || "").trim().toLowerCase();
	const rawLimit = Number(input?.limit ?? 200);
	const limit = Number.isFinite(rawLimit)
		? Math.max(1, Math.min(300, Math.trunc(rawLimit)))
		: 200;
	const scopeFilter =
		normalizedScope === PRESET_SCOPE_BASE
			? [{ scope: PRESET_SCOPE_BASE, owner_id: null }]
			: normalizedScope === PRESET_SCOPE_USER
				? [{ scope: PRESET_SCOPE_USER, owner_id: userId }]
				: [
					{ scope: PRESET_SCOPE_BASE, owner_id: null },
					{ scope: PRESET_SCOPE_USER, owner_id: userId },
				];
	const rows = (await getPrismaClient().llm_node_presets.findMany({
		where: {
			enabled: 1,
			OR: scopeFilter,
			...(normalizedType ? { preset_type: normalizedType } : {}),
		},
		orderBy: [{ updated_at: "desc" }],
	}))
		.sort((a, b) => {
			const aBase = a.scope === PRESET_SCOPE_BASE ? 0 : 1;
			const bBase = b.scope === PRESET_SCOPE_BASE ? 0 : 1;
			if (aBase !== bBase) return aBase - bBase;
			const aNull = a.sort_order == null ? 1 : 0;
			const bNull = b.sort_order == null ? 1 : 0;
			if (aNull !== bNull) return aNull - bNull;
			if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
				return (a.sort_order ?? 0) - (b.sort_order ?? 0);
			}
			return b.updated_at.localeCompare(a.updated_at);
		})
		.map(mapLlmNodePresetRow);
	if (!q) return rows.slice(0, limit);
	const filtered = rows.filter((row) => {
		const title = row.title.toLowerCase();
		const desc = (row.description || "").toLowerCase();
		const prompt = row.prompt.toLowerCase();
		const styleReference = row.styleReference;
		const metaText = [
			styleReference?.styleId,
			styleReference?.era,
			styleReference?.region,
			styleReference?.ethnicity,
			styleReference?.medium,
			...(styleReference?.categories || []),
			...(styleReference?.tags || []),
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		return title.includes(q) || desc.includes(q) || prompt.includes(q) || metaText.includes(q);
	});
	return filtered.slice(0, limit);
}

export async function createLlmNodePreset(
	c: AppContext,
	userId: string,
	input: unknown,
): Promise<LlmNodePresetDto> {
	await ensureLlmNodePresetSchema(c);
	const parsed = CreateLlmNodePresetRequestSchema.parse(input);
	const title = parsed.title.trim();
	const prompt = parsed.prompt.trim();
	if (!title) {
		throw new AppError("标题不能为空", {
			status: 400,
			code: "invalid_node_preset",
		});
	}
	const referenceImageUrl = parsed.referenceImageUrl?.trim() || null;
	const meta = buildPresetMeta({
		referenceImageUrl,
		styleReference: parsed.styleReference,
	});
	const nowIso = new Date().toISOString();
	const id = crypto.randomUUID();
	await getPrismaClient().llm_node_presets.create({
		data: {
			id,
			owner_id: userId,
			scope: PRESET_SCOPE_USER,
			preset_type: parsed.type,
			title,
			prompt,
			description: parsed.description ?? null,
			meta,
			enabled: 1,
			sort_order: null,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	const row = await getPrismaClient().llm_node_presets.findFirst({
		where: { id, owner_id: userId },
	});
	if (!row) {
		throw new AppError("create node preset failed", {
			status: 500,
			code: "node_preset_create_failed",
		});
	}
	return mapLlmNodePresetRow(row);
}

export async function deleteLlmNodePreset(
	c: AppContext,
	userId: string,
	id: string,
): Promise<void> {
	await ensureLlmNodePresetSchema(c);
	const existing = await getPrismaClient().llm_node_presets.findFirst({
		where: { id, scope: PRESET_SCOPE_USER, owner_id: userId },
		select: { id: true },
	});
	if (existing) {
		await getPrismaClient().llm_node_presets.deleteMany({
			where: { id, scope: PRESET_SCOPE_USER, owner_id: userId },
		});
		return;
	}

	const sourcePreset = await getPrismaClient().llm_node_presets.findFirst({
		where: { id, enabled: 1 },
		select: { id: true, preset_type: true, meta: true },
	});
	const sourceReferenceImageUrl = parsePresetMeta(sourcePreset?.meta).referenceImageUrl?.trim() || "";
	if (!sourcePreset || !sourceReferenceImageUrl) {
		throw new AppError("未找到该预设或无权删除", {
			status: 404,
			code: "node_preset_not_found",
		});
	}

	const userPresets = await getPrismaClient().llm_node_presets.findMany({
		where: {
			scope: PRESET_SCOPE_USER,
			owner_id: userId,
			preset_type: sourcePreset.preset_type,
		},
		select: { id: true, meta: true },
	});
	const matchedUserPresetIds = userPresets
		.filter((preset) => parsePresetMeta(preset.meta).referenceImageUrl?.trim() === sourceReferenceImageUrl)
		.map((preset) => preset.id);
	if (!matchedUserPresetIds.length) {
		throw new AppError("未找到该预设或无权删除", {
			status: 404,
			code: "node_preset_not_found",
		});
	}

	await getPrismaClient().llm_node_presets.deleteMany({
		where: {
			id: { in: matchedUserPresetIds },
			scope: PRESET_SCOPE_USER,
			owner_id: userId,
		},
	});
}

export async function listAdminLlmNodePresets(
	c: AppContext,
	input?: { type?: string | null },
): Promise<LlmNodePresetDto[]> {
	requireAdmin(c);
	await ensureLlmNodePresetSchema(c);
	const normalizedType = normalizeLlmNodePresetType(input?.type);
	const rows = await getPrismaClient().llm_node_presets.findMany({
		where: {
			scope: PRESET_SCOPE_BASE,
			...(normalizedType ? { preset_type: normalizedType } : {}),
		},
		orderBy: [{ updated_at: "desc" }],
	});
	return rows
		.sort((a, b) => {
			const aNull = a.sort_order == null ? 1 : 0;
			const bNull = b.sort_order == null ? 1 : 0;
			if (aNull !== bNull) return aNull - bNull;
			if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
				return (a.sort_order ?? 0) - (b.sort_order ?? 0);
			}
			return b.updated_at.localeCompare(a.updated_at);
		})
		.map(mapLlmNodePresetRow);
}

export async function upsertAdminLlmNodePreset(
	c: AppContext,
	input: unknown,
): Promise<LlmNodePresetDto> {
	requireAdmin(c);
	await ensureLlmNodePresetSchema(c);
	const parsed = UpsertAdminLlmNodePresetRequestSchema.parse(input);
	const title = parsed.title.trim();
	const prompt = parsed.prompt.trim();
	if (!title || !prompt) {
		throw new AppError("标题和提示词不能为空", {
			status: 400,
			code: "invalid_node_preset",
		});
	}
	const nowIso = new Date().toISOString();
	const id = parsed.id?.trim() || `node_preset_${crypto.randomUUID()}`;
	const enabled = parsed.enabled === false ? 0 : 1;
	const referenceImageUrl = parsed.referenceImageUrl?.trim() || null;
	const meta = buildPresetMeta({
		referenceImageUrl,
		styleReference: parsed.styleReference,
	});
	await getPrismaClient().llm_node_presets.upsert({
		where: { id },
		create: {
			id,
			owner_id: null,
			scope: PRESET_SCOPE_BASE,
			preset_type: parsed.type,
			title,
			prompt,
			description: parsed.description ?? null,
			meta,
			enabled,
			sort_order: parsed.sortOrder ?? null,
			created_at: nowIso,
			updated_at: nowIso,
		},
		update: {
			scope: PRESET_SCOPE_BASE,
			owner_id: null,
			preset_type: parsed.type,
			title,
			prompt,
			description: parsed.description ?? null,
			meta,
			enabled,
			sort_order: parsed.sortOrder ?? null,
			updated_at: nowIso,
		},
	});
	const row = await getPrismaClient().llm_node_presets.findFirst({
		where: { id, scope: PRESET_SCOPE_BASE },
	});
	if (!row) {
		throw new AppError("upsert node preset failed", {
			status: 500,
			code: "node_preset_upsert_failed",
		});
	}
	return mapLlmNodePresetRow(row);
}

export async function deleteAdminLlmNodePreset(
	c: AppContext,
	id: string,
): Promise<void> {
	requireAdmin(c);
	await ensureLlmNodePresetSchema(c);
	const existing = await getPrismaClient().llm_node_presets.findFirst({
		where: { id, scope: PRESET_SCOPE_BASE },
		select: { id: true },
	});
	if (!existing) {
		throw new AppError("未找到该基础预设", {
			status: 404,
			code: "node_preset_not_found",
		});
	}
	await getPrismaClient().llm_node_presets.deleteMany({
		where: { id, scope: PRESET_SCOPE_BASE },
	});
}
