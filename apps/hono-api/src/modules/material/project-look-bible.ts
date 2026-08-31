import { createHash, randomUUID } from "node:crypto";
import { getPrismaClient } from "../../platform/node/prisma";

export const PROJECT_LOOK_BIBLE_KIND = "projectLookBible" as const;
export const PROJECT_LOOK_BIBLE_SCHEMA_VERSION = "project-look-bible/v1" as const;

export type ProjectLookBibleGlobalCore = {
	styleName: string;
	summary: string;
	visualDirectives: string[];
	negativeDirectives: string[];
	consistencyRules: string[];
	characterPrompt: string;
	imagePrompt: string;
	videoPrompt: string;
};

export type ProjectLookBibleSection = {
	id: string;
	name: string;
	dimension: string;
	applicability: string;
	directives: string[];
	imagePrompt: string;
	videoPrompt: string;
};

export type ProjectLookBibleV1 = {
	schemaVersion: typeof PROJECT_LOOK_BIBLE_SCHEMA_VERSION;
	name: string;
	summary: string;
	globalCore: ProjectLookBibleGlobalCore;
	sections: ProjectLookBibleSection[];
	contentExclusions: string[];
};

export type ProjectLookBibleSnapshot = {
	kind: typeof PROJECT_LOOK_BIBLE_KIND;
	schemaVersion: typeof PROJECT_LOOK_BIBLE_SCHEMA_VERSION;
	revision: number;
	projectId: string;
	sourceNodeId: string;
	sourceFlowId: string | null;
	sourceChapterId: string | null;
	sourceDocument: string;
	sourceDocumentHash: string;
	lookBibleHash: string;
	lookBible: ProjectLookBibleV1;
	activatedAt: string;
};

export type ActiveProjectLookBible = ProjectLookBibleSnapshot & {
	assetId: string;
	assetName: string;
};

const MAX_SOURCE_DOCUMENT_CHARACTERS = 120_000;
const MAX_DIRECTIVE_ITEMS = 24;
const MAX_SECTIONS = 16;

function readString(value: unknown, field: string, maxCharacters: number): string {
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	const normalized = value.trim();
	if (!normalized) throw new Error(`${field} must not be empty`);
	if (Array.from(normalized).length > maxCharacters) {
		throw new Error(`${field} exceeds ${maxCharacters} characters`);
	}
	return normalized;
}

function readText(value: unknown, field: string, maxCharacters: number): string {
	if (typeof value !== "string") throw new Error(`${field} must be a string`);
	const normalized = value.trim();
	if (Array.from(normalized).length > maxCharacters) {
		throw new Error(`${field} exceeds ${maxCharacters} characters`);
	}
	return normalized;
}

function readStringArray(
	value: unknown,
	field: string,
	options: { minItems?: number; maxItems?: number; maxItemCharacters?: number } = {},
): string[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	const minItems = options.minItems ?? 0;
	const maxItems = options.maxItems ?? MAX_DIRECTIVE_ITEMS;
	if (value.length < minItems || value.length > maxItems) {
		throw new Error(`${field} item count must be between ${minItems} and ${maxItems}`);
	}
	return value.map((item, index) =>
		readString(item, `${field}[${index}]`, options.maxItemCharacters ?? 1_200),
	);
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

export function normalizeProjectLookBible(value: unknown): ProjectLookBibleV1 {
	const root = readRecord(value, "lookBible");
	if (root.schemaVersion !== PROJECT_LOOK_BIBLE_SCHEMA_VERSION) {
		throw new Error(`lookBible.schemaVersion must be ${PROJECT_LOOK_BIBLE_SCHEMA_VERSION}`);
	}
	const global = readRecord(root.globalCore, "lookBible.globalCore");
	const sections = Array.isArray(root.sections) ? root.sections : null;
	if (!sections) throw new Error("lookBible.sections must be an array");
	if (sections.length > MAX_SECTIONS) {
		throw new Error(`lookBible.sections exceeds ${MAX_SECTIONS} items`);
	}
	const normalizedSections = sections.map((value, index): ProjectLookBibleSection => {
		const section = readRecord(value, `lookBible.sections[${index}]`);
		return {
			id: readString(section.id, `lookBible.sections[${index}].id`, 120),
			name: readString(section.name, `lookBible.sections[${index}].name`, 200),
			dimension: readString(section.dimension, `lookBible.sections[${index}].dimension`, 120),
			applicability: readText(section.applicability, `lookBible.sections[${index}].applicability`, 1_200),
			directives: readStringArray(section.directives, `lookBible.sections[${index}].directives`),
			imagePrompt: readText(section.imagePrompt, `lookBible.sections[${index}].imagePrompt`, 2_000),
			videoPrompt: readText(section.videoPrompt, `lookBible.sections[${index}].videoPrompt`, 2_000),
		};
	});
	const sectionIds = new Set(normalizedSections.map((section) => section.id));
	if (sectionIds.size !== normalizedSections.length) {
		throw new Error("lookBible.sections ids must be unique");
	}
	return {
		schemaVersion: PROJECT_LOOK_BIBLE_SCHEMA_VERSION,
		name: readString(root.name, "lookBible.name", 200),
		summary: readString(root.summary, "lookBible.summary", 1_200),
		globalCore: {
			styleName: readString(global.styleName, "lookBible.globalCore.styleName", 200),
			summary: readString(global.summary, "lookBible.globalCore.summary", 1_200),
			visualDirectives: readStringArray(global.visualDirectives, "lookBible.globalCore.visualDirectives"),
			negativeDirectives: readStringArray(
				global.negativeDirectives,
				"lookBible.globalCore.negativeDirectives",
			),
			consistencyRules: readStringArray(global.consistencyRules, "lookBible.globalCore.consistencyRules"),
			characterPrompt: readText(global.characterPrompt, "lookBible.globalCore.characterPrompt", 6_000),
			imagePrompt: readText(global.imagePrompt, "lookBible.globalCore.imagePrompt", 6_000),
			videoPrompt: readText(global.videoPrompt, "lookBible.globalCore.videoPrompt", 6_000),
		},
		sections: normalizedSections,
		contentExclusions: readStringArray(
			root.contentExclusions,
			"lookBible.contentExclusions",
			{ maxItems: 48 },
		),
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseSnapshot(data: string | null): ProjectLookBibleSnapshot | null {
	if (!data) return null;
	try {
		const raw = JSON.parse(data) as unknown;
		const record = readRecord(raw, "projectLookBibleSnapshot");
		if (
			record.kind !== PROJECT_LOOK_BIBLE_KIND ||
			record.schemaVersion !== PROJECT_LOOK_BIBLE_SCHEMA_VERSION
		) {
			return null;
		}
		const revision = Number(record.revision);
		if (!Number.isInteger(revision) || revision < 1) return null;
		return {
			kind: PROJECT_LOOK_BIBLE_KIND,
			schemaVersion: PROJECT_LOOK_BIBLE_SCHEMA_VERSION,
			revision,
			projectId: readString(record.projectId, "projectId", 200),
			sourceNodeId: readString(record.sourceNodeId, "sourceNodeId", 300),
			sourceFlowId:
				typeof record.sourceFlowId === "string" && record.sourceFlowId.trim()
					? record.sourceFlowId.trim()
					: null,
			sourceChapterId:
				typeof record.sourceChapterId === "string" && record.sourceChapterId.trim()
					? record.sourceChapterId.trim()
					: null,
			sourceDocument: readString(
				record.sourceDocument,
				"sourceDocument",
				MAX_SOURCE_DOCUMENT_CHARACTERS,
			),
			sourceDocumentHash: readString(record.sourceDocumentHash, "sourceDocumentHash", 128),
			lookBibleHash: readString(record.lookBibleHash, "lookBibleHash", 128),
			lookBible: normalizeProjectLookBible(record.lookBible),
			activatedAt: readString(record.activatedAt, "activatedAt", 100),
		};
	} catch {
		return null;
	}
}

async function listProjectLookBibleRows(input: {
	ownerId: string;
	projectId: string;
}): Promise<Array<{ id: string; name: string; data: string | null; created_at: string; updated_at: string }>> {
	return getPrismaClient().assets.findMany({
		where: {
			owner_id: input.ownerId,
			project_id: input.projectId,
			data: { contains: `"kind":"${PROJECT_LOOK_BIBLE_KIND}"` },
		},
		orderBy: [{ created_at: "desc" }, { id: "desc" }],
	});
}

export async function getActiveProjectLookBible(input: {
	ownerId: string;
	projectId: string;
}): Promise<ActiveProjectLookBible | null> {
	const rows = await listProjectLookBibleRows(input);
	const parsed = rows
		.map((row) => ({ row, snapshot: parseSnapshot(row.data) }))
		.filter((entry): entry is { row: (typeof rows)[number]; snapshot: ProjectLookBibleSnapshot } =>
			Boolean(entry.snapshot && entry.snapshot.projectId === input.projectId),
		)
		.sort((left, right) => {
			const revisionDelta = right.snapshot.revision - left.snapshot.revision;
			if (revisionDelta !== 0) return revisionDelta;
			return right.snapshot.activatedAt.localeCompare(left.snapshot.activatedAt);
		});
	const active = parsed[0];
	return active
		? {
				...active.snapshot,
				assetId: active.row.id,
				assetName: active.row.name,
			}
		: null;
}

export async function confirmProjectLookBible(input: {
	ownerId: string;
	projectId: string;
	sourceNodeId: string;
	sourceFlowId?: string | null;
	sourceChapterId?: string | null;
	sourceDocument: string;
	lookBible: unknown;
	nowIso?: string;
}): Promise<{ active: ActiveProjectLookBible; created: boolean }> {
	const sourceDocument = readString(
		input.sourceDocument,
		"sourceDocument",
		MAX_SOURCE_DOCUMENT_CHARACTERS,
	);
	const lookBible = normalizeProjectLookBible(input.lookBible);
	const sourceDocumentHash = sha256(sourceDocument);
	const lookBibleHash = sha256(JSON.stringify(lookBible));
	const rows = await listProjectLookBibleRows({ ownerId: input.ownerId, projectId: input.projectId });
	for (const row of rows) {
		const snapshot = parseSnapshot(row.data);
		if (
			snapshot &&
			snapshot.projectId === input.projectId &&
			snapshot.sourceNodeId === input.sourceNodeId &&
			snapshot.sourceDocumentHash === sourceDocumentHash &&
			snapshot.lookBibleHash === lookBibleHash
		) {
			return {
				created: false,
				active: { ...snapshot, assetId: row.id, assetName: row.name },
			};
		}
	}
	const revisions = rows
		.map((row) => parseSnapshot(row.data)?.revision ?? 0)
		.filter((revision) => revision > 0);
	const revision = (revisions.length ? Math.max(...revisions) : 0) + 1;
	const activatedAt = input.nowIso ?? new Date().toISOString();
	const snapshot: ProjectLookBibleSnapshot = {
		kind: PROJECT_LOOK_BIBLE_KIND,
		schemaVersion: PROJECT_LOOK_BIBLE_SCHEMA_VERSION,
		revision,
		projectId: input.projectId,
		sourceNodeId: input.sourceNodeId,
		sourceFlowId: input.sourceFlowId?.trim() || null,
		sourceChapterId: input.sourceChapterId?.trim() || null,
		sourceDocument,
		sourceDocumentHash,
		lookBibleHash,
		lookBible,
		activatedAt,
	};
	const assetId = `project-look-bible-${randomUUID()}`;
	const assetName = `项目视觉圣经｜${lookBible.name}｜V${revision}`;
	const row = await getPrismaClient().assets.create({
		data: {
			id: assetId,
			name: assetName,
			data: JSON.stringify(snapshot),
			owner_id: input.ownerId,
			project_id: input.projectId,
			created_at: activatedAt,
			updated_at: activatedAt,
		},
	});
	return {
		created: true,
		active: { ...snapshot, assetId: row.id, assetName: row.name },
	};
}

export function buildProjectLookBibleImagePrompt(input: {
	active: ActiveProjectLookBible;
	roleCard: boolean;
	sectionIds?: string[] | null;
}): string {
	const sectionIds = Array.from(new Set((input.sectionIds ?? []).map((id) => id.trim()).filter(Boolean)));
	const sectionsById = new Map(input.active.lookBible.sections.map((section) => [section.id, section]));
	const selectedSections = sectionIds.map((sectionId) => {
		const section = sectionsById.get(sectionId);
		if (!section) throw new Error(`project_look_section_not_found:${sectionId}`);
		return section;
	});
	const sectionPrompts = selectedSections.map((section) => section.imagePrompt).filter(Boolean);
	if (input.roleCard && sectionPrompts.length > 0) {
		throw new Error("project_look_sections_not_allowed_for_role_card");
	}
	return [
		input.roleCard
			? input.active.lookBible.globalCore.characterPrompt
			: input.active.lookBible.globalCore.imagePrompt,
		...sectionPrompts,
	]
		.filter(Boolean)
		.join("\n");
}

export function buildProjectLookBibleVideoPrompt(input: {
	active: ActiveProjectLookBible;
	sectionIds: string[];
}): string {
	const sectionIds = Array.from(new Set(input.sectionIds.map((id) => id.trim()).filter(Boolean)));
	const sectionsById = new Map(input.active.lookBible.sections.map((section) => [section.id, section]));
	return sectionIds.map((sectionId) => {
		const section = sectionsById.get(sectionId);
		if (!section) throw new Error(`project_look_section_not_found:${sectionId}`);
		return section.videoPrompt;
	}).filter(Boolean).join("\n");
}
