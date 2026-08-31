export const STORY_PREVIEW_CONTRACT_SCHEMA_VERSION = "story-preview-contract/v1" as const;

export const STORY_PREVIEW_REFERENCE_ROLES = [
	"identity",
	"layout",
	"content",
	"style",
] as const;

export const STORY_PREVIEW_REFERENCE_KINDS = [
	"character",
	"scene",
	"prop",
	"vfx",
	"content",
] as const;

export type StoryPreviewReferenceRole = (typeof STORY_PREVIEW_REFERENCE_ROLES)[number];
export type StoryPreviewReferenceKind = (typeof STORY_PREVIEW_REFERENCE_KINDS)[number];

export type StoryPreviewReference = Readonly<{
	nodeId?: string;
	assetId?: string;
	role: StoryPreviewReferenceRole;
	entityKind: StoryPreviewReferenceKind;
	entityName: string;
}>;

export type StoryPreviewWindow = Readonly<{
	startSeconds: number;
	endSeconds: number;
}>;

export const STORY_PREVIEW_SCOPES = [
	"full_story",
	"user_window",
] as const;

export type StoryPreviewScope = (typeof STORY_PREVIEW_SCOPES)[number];

export type StoryPreviewContract = Readonly<{
	schemaVersion: typeof STORY_PREVIEW_CONTRACT_SCHEMA_VERSION;
	storyDurationSeconds: number;
	previewScope: StoryPreviewScope;
	previewWindow: StoryPreviewWindow;
	frameIntervalSeconds: number;
	requiredReferences: readonly StoryPreviewReference[];
}>;

export type StoryPreviewCell = Readonly<{
	cellIndex: number;
	startSeconds: number;
	endSeconds: number;
	timeRange: string;
	narrativeFunction: string;
	frameDescription: string;
	visibleAction: string;
	stateBefore: string;
	stateAfter: string;
	causeFromPrevious: string;
	transitionToNext: string;
	blocking: string;
	cameraState: string;
	motionTransition: string;
	physicalFeedback: string;
	environmentChange: string;
	subjectRefIds: readonly string[];
}>;

export type StoryPreviewReferenceManifestEntry = Readonly<{
	nodeId?: string;
	assetId?: string;
	role: StoryPreviewReferenceRole;
	entityKind: StoryPreviewReferenceKind;
	entityName: string;
}>;

export type StoryPreviewNodeContract = Readonly<{
	contract: StoryPreviewContract;
	referenceManifest: readonly StoryPreviewReferenceManifestEntry[];
	cells: readonly StoryPreviewCell[];
	previewSeriesId: string;
	previewBoardIndex: number;
	previewBoardCount: number;
}>;

export type StoryPreviewBoardTimeline = Readonly<{
	totalFrameCount: number;
	boardCount: number;
	boardIndex: number;
	frames: readonly Readonly<{
		cellIndex: number;
		startSeconds: number;
		endSeconds: number;
	}>[];
}>;

const MAX_STORY_DURATION_SECONDS = 3600;
const MAX_PREVIEW_REFERENCES = 32;
const MAX_PREVIEW_CELLS = 9;
const TIME_EPSILON_SECONDS = 0.000001;

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const items = value.map(readTrimmedString).filter(Boolean);
	return items.length === value.length ? items : null;
}

function normalizeReference(value: unknown): StoryPreviewReference | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const nodeId = readTrimmedString(record.nodeId);
	const assetId = readTrimmedString(record.assetId);
	const role = readTrimmedString(record.role);
	const entityKind = readTrimmedString(record.entityKind);
	const entityName = readTrimmedString(record.entityName);
	if (
		(nodeId && assetId) ||
		(!nodeId && !assetId) ||
		!STORY_PREVIEW_REFERENCE_ROLES.includes(role as StoryPreviewReferenceRole) ||
		!STORY_PREVIEW_REFERENCE_KINDS.includes(entityKind as StoryPreviewReferenceKind) ||
		!entityName
	) return null;
	return {
		...(nodeId ? { nodeId } : {}),
		...(assetId ? { assetId } : {}),
		role: role as StoryPreviewReferenceRole,
		entityKind: entityKind as StoryPreviewReferenceKind,
		entityName,
	};
}

function referenceKey(reference: Pick<StoryPreviewReference, "nodeId" | "assetId">): string {
	return reference.nodeId ? `node:${reference.nodeId}` : `asset:${reference.assetId ?? ""}`;
}

function sameReferenceDetails(
	left: readonly StoryPreviewReference[],
	right: readonly StoryPreviewReference[],
): boolean {
	if (left.length !== right.length) return false;
	const rightByKey = new Map(right.map((reference) => [referenceKey(reference), reference]));
	return left.every((reference) => {
		const other = rightByKey.get(referenceKey(reference));
		return Boolean(other)
			&& other?.role === reference.role
			&& other.entityKind === reference.entityKind
			&& other.entityName === reference.entityName;
	});
}

export function normalizeStoryPreviewReferences(value: unknown): StoryPreviewReference[] | null {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PREVIEW_REFERENCES) return null;
	const normalized: StoryPreviewReference[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const reference = normalizeReference(item);
		if (!reference) return null;
		const key = referenceKey(reference);
		if (seen.has(key)) return null;
		seen.add(key);
		normalized.push(reference);
	}
	return normalized;
}

export function normalizeStoryPreviewContract(value: unknown): StoryPreviewContract | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const schemaVersion = readTrimmedString(record.schemaVersion);
	const storyDurationSeconds = readFiniteNumber(record.storyDurationSeconds);
	const frameIntervalSeconds = readFiniteNumber(record.frameIntervalSeconds);
	const requestedScope = readTrimmedString(record.previewScope);
	const window = record.previewWindow;
	const requiredReferences = normalizeStoryPreviewReferences(record.requiredReferences);
	if (
		schemaVersion !== STORY_PREVIEW_CONTRACT_SCHEMA_VERSION ||
		storyDurationSeconds === null ||
		storyDurationSeconds <= 0 ||
		storyDurationSeconds > MAX_STORY_DURATION_SECONDS ||
		frameIntervalSeconds === null ||
		frameIntervalSeconds <= 0 ||
		!STORY_PREVIEW_SCOPES.includes(requestedScope as StoryPreviewScope) ||
		!requiredReferences
	) return null;

	const hasWindow = Boolean(window) && typeof window === "object" && !Array.isArray(window);
	const windowRecord = hasWindow ? window as Record<string, unknown> : null;
	const requestedStartSeconds = windowRecord ? readFiniteNumber(windowRecord.startSeconds) : null;
	const requestedEndSeconds = windowRecord ? readFiniteNumber(windowRecord.endSeconds) : null;
	if (hasWindow && (requestedStartSeconds === null || requestedEndSeconds === null)) return null;

	// Scope is an explicit frozen fact. A full-story scope deterministically
	// expands to the entire duration; a partial scope must provide both bounds.
	const previewScope = requestedScope as StoryPreviewScope;
	const startSeconds = previewScope === "full_story" ? 0 : requestedStartSeconds;
	const endSeconds = previewScope === "full_story" ? storyDurationSeconds : requestedEndSeconds;
	if (
		startSeconds === null ||
		endSeconds === null ||
		startSeconds < 0 ||
		endSeconds <= startSeconds ||
		endSeconds > storyDurationSeconds ||
		(previewScope === "full_story" && hasWindow && (
			requestedStartSeconds !== 0 || requestedEndSeconds !== storyDurationSeconds
		))
	) return null;
	return {
		schemaVersion,
		storyDurationSeconds,
		previewScope,
		previewWindow: { startSeconds, endSeconds },
		frameIntervalSeconds,
		requiredReferences,
	};
}

export function normalizeStoryPreviewCells(value: unknown): StoryPreviewCell[] | null {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PREVIEW_CELLS) return null;
	const cells: StoryPreviewCell[] = [];
	const seenIndexes = new Set<number>();
	for (const item of value) {
		if (!item || typeof item !== "object" || Array.isArray(item)) return null;
		const record = item as Record<string, unknown>;
		const cellIndex = readFiniteNumber(record.cellIndex);
		const startSeconds = readFiniteNumber(record.startSeconds);
		const endSeconds = readFiniteNumber(record.endSeconds);
		const timeRange = readTrimmedString(record.timeRange);
		const narrativeFunction = readTrimmedString(record.narrativeFunction);
		const frameDescription = readTrimmedString(record.frameDescription);
		const visibleAction = readTrimmedString(record.visibleAction);
		const stateBefore = readTrimmedString(record.stateBefore);
		const stateAfter = readTrimmedString(record.stateAfter);
		const causeFromPrevious = readTrimmedString(record.causeFromPrevious);
		const transitionToNext = readTrimmedString(record.transitionToNext);
		const blocking = readTrimmedString(record.blocking);
		const cameraState = readTrimmedString(record.cameraState);
		const motionTransition = readTrimmedString(record.motionTransition);
		const physicalFeedback = readTrimmedString(record.physicalFeedback);
		const environmentChange = readTrimmedString(record.environmentChange);
		const subjectRefIds = readStringList(record.subjectRefIds);
		if (
			cellIndex === null ||
			!Number.isInteger(cellIndex) ||
			cellIndex < 1 ||
			startSeconds === null ||
			endSeconds === null ||
			startSeconds < 0 ||
			endSeconds <= startSeconds ||
			!timeRange ||
			!narrativeFunction ||
			!frameDescription ||
			!visibleAction ||
			!stateBefore ||
			!stateAfter ||
			!causeFromPrevious ||
			!transitionToNext ||
			!blocking ||
			!cameraState ||
			!motionTransition ||
			!physicalFeedback ||
			!environmentChange ||
			!subjectRefIds ||
			subjectRefIds.length < 1 ||
			subjectRefIds.length > MAX_PREVIEW_REFERENCES ||
			new Set(subjectRefIds).size !== subjectRefIds.length ||
			seenIndexes.has(cellIndex)
		) return null;
		seenIndexes.add(cellIndex);
		cells.push({
			cellIndex,
			startSeconds,
			endSeconds,
			timeRange,
			narrativeFunction,
			frameDescription,
			visibleAction,
			stateBefore,
			stateAfter,
			causeFromPrevious,
			transitionToNext,
			blocking,
			cameraState,
			motionTransition,
			physicalFeedback,
			environmentChange,
			subjectRefIds,
		});
	}
	return cells.sort((left, right) => left.cellIndex - right.cellIndex);
}

function nearlyEqualSeconds(left: number, right: number): boolean {
	return Math.abs(left - right) <= TIME_EPSILON_SECONDS;
}

export function getStoryPreviewBoardTimeline(
	contract: StoryPreviewContract,
	boardIndex: number,
): StoryPreviewBoardTimeline | null {
	if (!Number.isInteger(boardIndex) || boardIndex < 0) return null;
	const durationSeconds = contract.previewWindow.endSeconds - contract.previewWindow.startSeconds;
	const totalFrameCount = Math.ceil(
		Math.max(0, durationSeconds - TIME_EPSILON_SECONDS) / contract.frameIntervalSeconds,
	);
	if (totalFrameCount < 1) return null;
	const boardCount = Math.ceil(totalFrameCount / MAX_PREVIEW_CELLS);
	if (boardIndex >= boardCount) return null;
	const firstGlobalFrameIndex = boardIndex * MAX_PREVIEW_CELLS;
	const frameCount = Math.min(MAX_PREVIEW_CELLS, totalFrameCount - firstGlobalFrameIndex);
	const frames = Array.from({ length: frameCount }, (_, localIndex) => {
		const globalFrameIndex = firstGlobalFrameIndex + localIndex;
		const startSeconds = contract.previewWindow.startSeconds
			+ globalFrameIndex * contract.frameIntervalSeconds;
		const endSeconds = Math.min(
			contract.previewWindow.endSeconds,
			startSeconds + contract.frameIntervalSeconds,
		);
		return {
			cellIndex: localIndex + 1,
			startSeconds,
			endSeconds,
		};
	});
	return {
		totalFrameCount,
		boardCount,
		boardIndex,
		frames,
	};
}

export function normalizeStoryPreviewNodeContract(value: unknown): StoryPreviewNodeContract | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const data = value as Record<string, unknown>;
	const contract = normalizeStoryPreviewContract(data.storyPreviewContract);
	const referenceManifest = normalizeStoryPreviewReferences(data.referenceManifest);
	const cells = normalizeStoryPreviewCells(data.storyPreviewCells);
	const previewSeriesId = readTrimmedString(data.previewSeriesId);
	const previewBoardIndex = readFiniteNumber(data.previewBoardIndex);
	const previewBoardCount = readFiniteNumber(data.previewBoardCount);
	const previewShotCount = readFiniteNumber(data.previewShotCount);
	if (
		!contract ||
		!referenceManifest ||
		!cells ||
		!previewSeriesId ||
		previewBoardIndex === null ||
		!Number.isInteger(previewBoardIndex) ||
		previewBoardIndex < 0 ||
		previewBoardCount === null ||
		!Number.isInteger(previewBoardCount) ||
		previewBoardCount < 1 ||
		previewShotCount === null ||
		!Number.isInteger(previewShotCount) ||
		cells.length !== previewShotCount ||
		cells.some((cell, index) => cell.cellIndex !== index + 1)
	) return null;
	const timeline = getStoryPreviewBoardTimeline(contract, previewBoardIndex);
	if (
		!timeline ||
		previewBoardCount !== timeline.boardCount ||
		previewShotCount !== timeline.frames.length ||
		cells.some((cell, index) => {
			const expected = timeline.frames[index];
			return !expected
				|| cell.cellIndex !== expected.cellIndex
				|| !nearlyEqualSeconds(cell.startSeconds, expected.startSeconds)
				|| !nearlyEqualSeconds(cell.endSeconds, expected.endSeconds);
		})
	) return null;
	if (!sameReferenceDetails(contract.requiredReferences, referenceManifest)) return null;
	const actualSubjectKeys = new Set([
		...contract.requiredReferences.map(referenceKey),
	]);
	if (cells.some((cell) => cell.subjectRefIds.some((id) => !actualSubjectKeys.has(id)))) {
		return null;
	}
	if (cells.some((cell) => cell.startSeconds < contract.previewWindow.startSeconds || cell.endSeconds > contract.previewWindow.endSeconds)) {
		return null;
	}
	return {
		contract,
		referenceManifest,
		cells,
		previewSeriesId,
		previewBoardIndex,
		previewBoardCount,
	};
}

export function storyPreviewContractsEqual(
	left: StoryPreviewContract,
	right: StoryPreviewContract,
): boolean {
	const canonicalize = (contract: StoryPreviewContract) => ({
		...contract,
		requiredReferences: [...contract.requiredReferences].sort((a, b) => {
			const leftKey = referenceKey(a);
			const rightKey = referenceKey(b);
			return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
		}),
	});
	return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function getStoryPreviewReferenceKeys(
	references: readonly StoryPreviewReference[],
): { nodeIds: string[]; assetIds: string[] } {
	return {
		nodeIds: references.flatMap((reference) => reference.nodeId ? [reference.nodeId] : []),
		assetIds: references.flatMap((reference) => reference.assetId ? [reference.assetId] : []),
	};
}
