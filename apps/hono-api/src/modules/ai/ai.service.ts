import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	PromptSampleInputSchema,
	PromptSampleSchema,
	type PromptSampleDto,
} from "./ai.schemas";
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
		const sqlParts: string[] = [
			"SELECT * FROM prompt_samples WHERE user_id = ?",
		];
		const bindings: unknown[] = [userId];
		if (normalizedKind) {
			sqlParts.push("AND node_kind = ?");
			bindings.push(normalizedKind);
		}
		sqlParts.push("ORDER BY updated_at DESC");
		sqlParts.push(
			"LIMIT ?",
		);
		const take = normalizedQuery ? 50 : limit * 2;
		bindings.push(take);

		const stmt = c.env.DB.prepare(sqlParts.join(" "));
		const { results } = await stmt.bind(...bindings).all<PromptSampleRow>();
		customRows = results ?? [];
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

	await c.env.DB.prepare(
		`INSERT INTO prompt_samples
     (id, user_id, node_kind, scene, command_type, title, prompt,
      description, input_hint, output_note, keywords, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			userId,
			nodeKind,
			scene,
			commandType,
			title,
			prompt,
			parsed.description ?? null,
			parsed.inputHint ?? null,
			parsed.outputNote ?? null,
			JSON.stringify(keywords),
			nowIso,
			nowIso,
		)
		.run();

	const row = await c.env.DB.prepare(
		`SELECT * FROM prompt_samples WHERE id = ? AND user_id = ?`,
	)
		.bind(id, userId)
		.first<PromptSampleRow>();
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
	const existing = await c.env.DB.prepare(
		`SELECT id FROM prompt_samples WHERE id = ? AND user_id = ?`,
	)
		.bind(id, userId)
		.first<Pick<PromptSampleRow, "id">>();
	if (!existing) {
		throw new AppError("未找到该案例或无权删除", {
			status: 404,
			code: "prompt_sample_not_found",
		});
	}
	await c.env.DB.prepare(
		`DELETE FROM prompt_samples WHERE id = ? AND user_id = ?`,
	)
		.bind(id, userId)
		.run();
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
