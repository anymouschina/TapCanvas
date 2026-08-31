export const STORYBOARD_ADVENTURE_PROTOCOL_VERSION = 1 as const;

export const SBA_BASIS_STATUSES = ["current", "stale", "unverified"] as const;
export const SBA_NODE_STATUSES = ["active", "archived"] as const;
export const SBA_SELECTION_STATUSES = ["candidate", "selected", "superseded"] as const;
export const SBA_BASIS_MODES = ["book_ledger", "task_context"] as const;
export const SBA_PROJECTION_CATEGORIES = [
	"characters",
	"relationships",
	"knowledge",
	"resources",
	"world",
	"hooks",
] as const;
export const SBA_RISK_KINDS = ["continuity", "causality", "character", "production"] as const;

export type SbaBasisStatus = (typeof SBA_BASIS_STATUSES)[number];
export type SbaNodeStatus = (typeof SBA_NODE_STATUSES)[number];
export type SbaSelectionStatus = (typeof SBA_SELECTION_STATUSES)[number];
export type SbaBasisMode = (typeof SBA_BASIS_MODES)[number];
export type SbaProjectionCategory = (typeof SBA_PROJECTION_CATEGORIES)[number];
export type SbaRiskKind = (typeof SBA_RISK_KINDS)[number];

export type SbaSourceRef = {
	kind: string;
	id: string;
	version: string | null;
	contentSha256: string | null;
	updatedAt: string | null;
};

export type SbaStoryBasis = {
	version: typeof STORYBOARD_ADVENTURE_PROTOCOL_VERSION;
	mode: SbaBasisMode;
	projectId: string;
	bookId: string | null;
	effectiveAt: { chapter: number; sequence: number } | null;
	ledgerRevision: number | null;
	consumedFactIds: string[];
	sourceRefs: SbaSourceRef[];
};

export type SbaProjectionItem = {
	id: string;
	summary: string;
};

export type SbaProjectionRisk = {
	id: string;
	kind: SbaRiskKind;
	rationale: string;
};

export type SbaFutureBeat = SbaProjectionItem & {
	horizon: "next" | "later";
};

export type SbaProductionImpact = SbaProjectionItem & {
	kind: "character" | "scene" | "prop" | "wardrobe" | "vfx" | "audio";
};

export type SbaProjection = {
	version: typeof STORYBOARD_ADVENTURE_PROTOCOL_VERSION;
	status: "candidate";
	decision: string;
	immediateConsequence: string;
	projectedChanges: Record<SbaProjectionCategory, SbaProjectionItem[]>;
	openQuestions: SbaProjectionItem[];
	risks: SbaProjectionRisk[];
	uncertainties: SbaProjectionItem[];
	futureBeats: SbaFutureBeat[];
	productionImpact: SbaProductionImpact[];
	continuityAnchors: SbaProjectionItem[];
};

export type SbaSelectionEvent = {
	version: typeof STORYBOARD_ADVENTURE_PROTOCOL_VERSION;
	eventId: string;
	branchNodeId: string;
	parentNodeId: string | null;
	sbaPath: string;
	basisFingerprint: string;
	selectedAt: string;
	source: "choices_card" | "canvas_node" | "user_instruction";
};

export type SbaMomentBoardData = {
	sbaContractVersion: typeof STORYBOARD_ADVENTURE_PROTOCOL_VERSION;
	sbaRole: "moment-board";
	sbaPath: string;
	sbaDepth: number;
	sbaParentNodeId: string | null;
	sbaStatus: SbaNodeStatus;
	sbaBasisStatus: SbaBasisStatus;
	sbaSelectionStatus: SbaSelectionStatus;
	sbaStoryBasis: SbaStoryBasis;
	sbaProjection: SbaProjection;
	basisFingerprint?: string;
	sbaSelectionEvents?: SbaSelectionEvent[];
};

export type SbaChoiceMetadata = {
	kind: "sba_branch";
	version: typeof STORYBOARD_ADVENTURE_PROTOCOL_VERSION;
	selectionEventId: string;
	branchNodeId: string;
	sbaPath: string;
	basisFingerprint: string;
};

export type SbaNodePresentation = {
	basisStatus: SbaBasisStatus;
	nodeStatus: SbaNodeStatus;
	selectionStatus: SbaSelectionStatus;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as UnknownRecord;
}

function readString(value: unknown, maxLength = 10_000): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized && normalized.length <= maxLength ? normalized : null;
}

function readNullableString(value: unknown, maxLength = 10_000): string | null | undefined {
	if (value === null) return null;
	return readString(value, maxLength) ?? undefined;
}

function readEnum<const TValues extends readonly string[]>(
	value: unknown,
	values: TValues,
): TValues[number] | null {
	if (typeof value !== "string") return null;
	return (values as readonly string[]).includes(value) ? (value as TValues[number]) : null;
}

function readInteger(value: unknown, min = 0): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= min ? value : null;
}

function readStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const normalized: string[] = [];
	for (const item of value) {
		const text = readString(item, 500);
		if (!text) return null;
		normalized.push(text);
	}
	return normalized;
}

function parseProjectionItem(value: unknown): SbaProjectionItem | null {
	const record = asRecord(value);
	const id = readString(record?.id, 200);
	const summary = readString(record?.summary, 2_000);
	return id && summary ? { id, summary } : null;
}

function parseProjectionItems(value: unknown): SbaProjectionItem[] | null {
	if (!Array.isArray(value)) return null;
	const items: SbaProjectionItem[] = [];
	const ids = new Set<string>();
	for (const raw of value) {
		const item = parseProjectionItem(raw);
		if (!item || ids.has(item.id)) return null;
		ids.add(item.id);
		items.push(item);
	}
	return items;
}

export function parseSbaStoryBasis(value: unknown): SbaStoryBasis | null {
	const record = asRecord(value);
	if (!record || record.version !== STORYBOARD_ADVENTURE_PROTOCOL_VERSION) return null;
	const mode = readEnum(record.mode, SBA_BASIS_MODES);
	const projectId = readString(record.projectId, 200);
	const bookId = readNullableString(record.bookId, 200);
	const ledgerRevision = record.ledgerRevision === null ? null : readInteger(record.ledgerRevision);
	const consumedFactIds = readStringArray(record.consumedFactIds);
	if (!mode || !projectId || typeof bookId === "undefined" || ledgerRevision === null && record.ledgerRevision !== null || !consumedFactIds) return null;

	let effectiveAt: SbaStoryBasis["effectiveAt"] = null;
	if (record.effectiveAt !== null) {
		const effective = asRecord(record.effectiveAt);
		const chapter = readInteger(effective?.chapter, 1);
		const sequence = readInteger(effective?.sequence, 0);
		if (chapter === null || sequence === null) return null;
		effectiveAt = { chapter, sequence };
	}
	if (mode === "task_context" && (bookId !== null || ledgerRevision !== null || effectiveAt !== null || consumedFactIds.length > 0)) return null;
	if (mode === "book_ledger" && (bookId === null || ledgerRevision === null || effectiveAt === null)) return null;

	if (!Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0) return null;
	const sourceRefs: SbaSourceRef[] = [];
	for (const raw of record.sourceRefs) {
		const source = asRecord(raw);
		const kind = readString(source?.kind, 100);
		const id = readString(source?.id, 500);
		const version = readNullableString(source?.version, 500);
		const contentSha256 = readNullableString(source?.contentSha256, 128);
		const updatedAt = readNullableString(source?.updatedAt, 100);
		if (!kind || !id || typeof version === "undefined" || typeof contentSha256 === "undefined" || typeof updatedAt === "undefined") return null;
		sourceRefs.push({ kind, id, version, contentSha256, updatedAt });
	}
	return { version: 1, mode, projectId, bookId, effectiveAt, ledgerRevision, consumedFactIds, sourceRefs };
}

export function canonicalizeSbaStoryBasis(basis: SbaStoryBasis): string {
	const sourceRefs = [...basis.sourceRefs].sort((left, right) =>
		`${left.kind}:${left.id}:${left.version ?? ""}:${left.contentSha256 ?? ""}:${left.updatedAt ?? ""}`
			.localeCompare(`${right.kind}:${right.id}:${right.version ?? ""}:${right.contentSha256 ?? ""}:${right.updatedAt ?? ""}`),
	);
	return JSON.stringify({
		version: basis.version,
		mode: basis.mode,
		projectId: basis.projectId,
		bookId: basis.bookId,
		effectiveAt: basis.effectiveAt,
		ledgerRevision: basis.ledgerRevision,
		consumedFactIds: [...basis.consumedFactIds].sort(),
		sourceRefs,
	});
}

export function parseSbaProjection(value: unknown): SbaProjection | null {
	const record = asRecord(value);
	if (!record || record.version !== 1 || record.status !== "candidate") return null;
	const decision = readString(record.decision, 4_000);
	const immediateConsequence = readString(record.immediateConsequence, 4_000);
	const projectedRecord = asRecord(record.projectedChanges);
	if (!decision || !immediateConsequence || !projectedRecord) return null;
	const projectedEntries = SBA_PROJECTION_CATEGORIES.map((category) => [category, parseProjectionItems(projectedRecord[category])] as const);
	if (projectedEntries.some(([, items]) => items === null)) return null;
	const projectedChanges = Object.fromEntries(projectedEntries) as Record<SbaProjectionCategory, SbaProjectionItem[]>;
	const openQuestions = parseProjectionItems(record.openQuestions);
	const uncertainties = parseProjectionItems(record.uncertainties);
	const continuityAnchors = parseProjectionItems(record.continuityAnchors);
	if (!openQuestions || !uncertainties || !continuityAnchors) return null;

	if (!Array.isArray(record.risks)) return null;
	const risks: SbaProjectionRisk[] = [];
	for (const raw of record.risks) {
		const risk = asRecord(raw);
		const id = readString(risk?.id, 200);
		const kind = readEnum(risk?.kind, SBA_RISK_KINDS);
		const rationale = readString(risk?.rationale, 2_000);
		if (!id || !kind || !rationale) return null;
		risks.push({ id, kind, rationale });
	}

	if (!Array.isArray(record.futureBeats) || !Array.isArray(record.productionImpact)) return null;
	const futureBeats: SbaFutureBeat[] = [];
	for (const raw of record.futureBeats) {
		const item = parseProjectionItem(raw);
		const horizon = readEnum(asRecord(raw)?.horizon, ["next", "later"] as const);
		if (!item || !horizon) return null;
		futureBeats.push({ ...item, horizon });
	}
	const productionImpact: SbaProductionImpact[] = [];
	for (const raw of record.productionImpact) {
		const item = parseProjectionItem(raw);
		const kind = readEnum(asRecord(raw)?.kind, ["character", "scene", "prop", "wardrobe", "vfx", "audio"] as const);
		if (!item || !kind) return null;
		productionImpact.push({ ...item, kind });
	}
	const allProjectionItemIds = [
		...Object.values(projectedChanges).flatMap((items) => items.map((item) => item.id)),
		...openQuestions.map((item) => item.id),
		...risks.map((item) => item.id),
		...uncertainties.map((item) => item.id),
		...futureBeats.map((item) => item.id),
		...productionImpact.map((item) => item.id),
		...continuityAnchors.map((item) => item.id),
	];
	if (new Set(allProjectionItemIds).size !== allProjectionItemIds.length) return null;
	return {
		version: 1,
		status: "candidate",
		decision,
		immediateConsequence,
		projectedChanges,
		openQuestions,
		risks,
		uncertainties,
		futureBeats,
		productionImpact,
		continuityAnchors,
	};
}

export function parseSbaSelectionEvent(value: unknown): SbaSelectionEvent | null {
	const record = asRecord(value);
	if (!record || record.version !== 1) return null;
	const eventId = readString(record.eventId, 200);
	const branchNodeId = readString(record.branchNodeId, 200);
	const parentNodeId = readNullableString(record.parentNodeId, 200);
	const sbaPath = readString(record.sbaPath, 200);
	const basisFingerprint = readString(record.basisFingerprint, 128);
	const selectedAt = readString(record.selectedAt, 100);
	const source = readEnum(record.source, ["choices_card", "canvas_node", "user_instruction"] as const);
	if (!eventId || !branchNodeId || typeof parentNodeId === "undefined" || !sbaPath || !basisFingerprint || !selectedAt || !source) return null;
	return { version: 1, eventId, branchNodeId, parentNodeId, sbaPath, basisFingerprint, selectedAt, source };
}

export function parseSbaMomentBoardData(value: unknown): SbaMomentBoardData | null {
	const record = asRecord(value);
	if (!record || record.sbaContractVersion !== 1 || record.sbaRole !== "moment-board") return null;
	const sbaPath = readString(record.sbaPath, 200);
	const sbaDepth = readInteger(record.sbaDepth, 1);
	const sbaParentNodeId = readNullableString(record.sbaParentNodeId, 200);
	const sbaStatus = readEnum(record.sbaStatus, SBA_NODE_STATUSES);
	const sbaBasisStatus = readEnum(record.sbaBasisStatus, SBA_BASIS_STATUSES);
	const sbaSelectionStatus = readEnum(record.sbaSelectionStatus, SBA_SELECTION_STATUSES);
	const sbaStoryBasis = parseSbaStoryBasis(record.sbaStoryBasis);
	const sbaProjection = parseSbaProjection(record.sbaProjection);
	if (!sbaPath || sbaDepth === null || typeof sbaParentNodeId === "undefined" || !sbaStatus || !sbaBasisStatus || !sbaSelectionStatus || !sbaStoryBasis || !sbaProjection) return null;
	const basisFingerprint = record.basisFingerprint === undefined ? undefined : readString(record.basisFingerprint, 128) ?? undefined;
	if (record.basisFingerprint !== undefined && !basisFingerprint) return null;
	let sbaSelectionEvents: SbaSelectionEvent[] | undefined;
	if (record.sbaSelectionEvents !== undefined) {
		if (!Array.isArray(record.sbaSelectionEvents)) return null;
		sbaSelectionEvents = [];
		for (const raw of record.sbaSelectionEvents) {
			const event = parseSbaSelectionEvent(raw);
			if (!event) return null;
			sbaSelectionEvents.push(event);
		}
	}
	return {
		sbaContractVersion: 1,
		sbaRole: "moment-board",
		sbaPath,
		sbaDepth,
		sbaParentNodeId,
		sbaStatus,
		sbaBasisStatus,
		sbaSelectionStatus,
		sbaStoryBasis,
		sbaProjection,
		...(basisFingerprint ? { basisFingerprint } : {}),
		...(sbaSelectionEvents ? { sbaSelectionEvents } : {}),
	};
}

export function parseSbaChoiceMetadata(value: unknown): SbaChoiceMetadata | null {
	const record = asRecord(value);
	if (!record || record.kind !== "sba_branch" || record.version !== 1) return null;
	const selectionEventId = readString(record.selectionEventId, 200);
	const branchNodeId = readString(record.branchNodeId, 200);
	const sbaPath = readString(record.sbaPath, 200);
	const basisFingerprint = readString(record.basisFingerprint, 128);
	return selectionEventId && branchNodeId && sbaPath && basisFingerprint
		? { kind: "sba_branch", version: 1, selectionEventId, branchNodeId, sbaPath, basisFingerprint }
		: null;
}

export function serializeSbaChoiceSelection(metadata: SbaChoiceMetadata, label: string): string {
	return `[SBA_SELECTION] ${JSON.stringify({ ...metadata, label: readString(label, 500) || label })}`;
}

export function readSbaNodePresentation(value: unknown): SbaNodePresentation | null {
	const record = asRecord(value);
	if (!record || record.sbaRole !== "moment-board") return null;
	const basisStatus = readEnum(record.sbaBasisStatus, SBA_BASIS_STATUSES);
	const nodeStatus = readEnum(record.sbaStatus, SBA_NODE_STATUSES);
	const selectionStatus = readEnum(record.sbaSelectionStatus, SBA_SELECTION_STATUSES);
	return basisStatus && nodeStatus && selectionStatus ? { basisStatus, nodeStatus, selectionStatus } : null;
}
