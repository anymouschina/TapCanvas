export const SCRIPT_STRUCTURE_PROTOCOL_VERSION = "v1" as const;

export type ScriptStructureCharacter = {
	id: string;
	name: string;
	gender: string;
	age: string;
	role: string;
	personality: string;
	traits: string;
	skills: string;
	keyActions: string;
	appearance: string;
	relationships: string;
	tags: string[];
	notes: string;
};

export type ScriptStructureEpisode = {
	id: string;
	index: number;
	title: string;
	description: string;
	sceneIds: string[];
};

export type ScriptStructureSceneTime =
	| "day"
	| "night"
	| "dawn"
	| "dusk"
	| "noon"
	| "midnight";

export type ScriptStructureScene = {
	id: string;
	episodeId: string;
	name: string;
	location: string;
	time: ScriptStructureSceneTime;
	atmosphere: string;
	visualPrompt: string;
	tags: string[];
	notes: string;
};

export type ScriptStructureParagraph = {
	id: number;
	text: string;
	sceneRefId: string;
};

export type ScriptStructureDocument = {
	version: typeof SCRIPT_STRUCTURE_PROTOCOL_VERSION;
	title: string;
	genre: string;
	logline: string;
	characters: ScriptStructureCharacter[];
	episodes: ScriptStructureEpisode[];
	scenes: ScriptStructureScene[];
	storyParagraphs: ScriptStructureParagraph[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as UnknownRecord)
		: null;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown, limit: number): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const item of value) {
		const text = normalizeText(item);
		if (!text) continue;
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function normalizeSceneTime(value: unknown): ScriptStructureSceneTime {
	const normalized = normalizeText(value).toLowerCase();
	switch (normalized) {
		case "night":
		case "dawn":
		case "dusk":
		case "noon":
		case "midnight":
			return normalized;
		default:
			return "day";
	}
}

export function normalizeScriptStructureDocument(
	input: unknown,
): ScriptStructureDocument | null {
	const record = asRecord(input);
	if (!record) return null;
	const charactersRaw = Array.isArray(record.characters) ? record.characters : [];
	const episodesRaw = Array.isArray(record.episodes) ? record.episodes : [];
	const scenesRaw = Array.isArray(record.scenes) ? record.scenes : [];
	const storyParagraphsRaw = Array.isArray(record.storyParagraphs)
		? record.storyParagraphs
		: [];

	const characters: ScriptStructureCharacter[] = charactersRaw
		.map((item) => {
			const value = asRecord(item);
			if (!value) return null;
			const id = normalizeText(value.id);
			const name = normalizeText(value.name);
			if (!id || !name) return null;
			return {
				id,
				name,
				gender: normalizeText(value.gender),
				age: normalizeText(value.age),
				role: normalizeText(value.role),
				personality: normalizeText(value.personality),
				traits: normalizeText(value.traits),
				skills: normalizeText(value.skills),
				keyActions: normalizeText(value.keyActions),
				appearance: normalizeText(value.appearance),
				relationships: normalizeText(value.relationships),
				tags: normalizeStringList(value.tags, 12),
				notes: normalizeText(value.notes),
			};
		})
		.filter((item): item is ScriptStructureCharacter => item !== null);

	const episodes: ScriptStructureEpisode[] = episodesRaw
		.map((item) => {
			const value = asRecord(item);
			if (!value) return null;
			const id = normalizeText(value.id);
			const title = normalizeText(value.title);
			const index = Number(value.index);
			if (!id || !title || !Number.isInteger(index) || index <= 0) return null;
			return {
				id,
				index,
				title,
				description: normalizeText(value.description),
				sceneIds: normalizeStringList(value.sceneIds, 500),
			};
		})
		.filter((item): item is ScriptStructureEpisode => item !== null);

	const scenes: ScriptStructureScene[] = scenesRaw
		.map((item) => {
			const value = asRecord(item);
			if (!value) return null;
			const id = normalizeText(value.id);
			const episodeId = normalizeText(value.episodeId);
			const name = normalizeText(value.name);
			if (!id || !episodeId || !name) return null;
			return {
				id,
				episodeId,
				name,
				location: normalizeText(value.location),
				time: normalizeSceneTime(value.time),
				atmosphere: normalizeText(value.atmosphere),
				visualPrompt: normalizeText(value.visualPrompt),
				tags: normalizeStringList(value.tags, 16),
				notes: normalizeText(value.notes),
			};
		})
		.filter((item): item is ScriptStructureScene => item !== null);

	const storyParagraphs: ScriptStructureParagraph[] = storyParagraphsRaw
		.map((item) => {
			const value = asRecord(item);
			if (!value) return null;
			const id = Number(value.id);
			const text = normalizeText(value.text);
			const sceneRefId = normalizeText(value.sceneRefId);
			if (!Number.isInteger(id) || id <= 0 || !text || !sceneRefId) return null;
			return { id, text, sceneRefId };
		})
		.filter((item): item is ScriptStructureParagraph => item !== null);

	return {
		version: SCRIPT_STRUCTURE_PROTOCOL_VERSION,
		title: normalizeText(record.title),
		genre: normalizeText(record.genre),
		logline: normalizeText(record.logline),
		characters,
		episodes,
		scenes,
		storyParagraphs,
	};
}
