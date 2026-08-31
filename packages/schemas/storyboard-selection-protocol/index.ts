export const STORYBOARD_SELECTION_PROTOCOL_VERSION = 1 as const;

export const STORYBOARD_SELECTION_SCOPES = ["chunk", "frame"] as const;

export const STORYBOARD_REFERENCE_BINDING_KINDS = [
	"continuity_tail",
	"role",
	"reference",
	"scene_prop",
	"spell_fx",
];

export const STORYBOARD_GROUP_SIZES = [1, 4, 9, 25] as const;

export type StoryboardSelectionScope = (typeof STORYBOARD_SELECTION_SCOPES)[number];
export type StoryboardReferenceBindingKind =
	(typeof STORYBOARD_REFERENCE_BINDING_KINDS)[number];
export type StoryboardGroupSize = (typeof STORYBOARD_GROUP_SIZES)[number];

export type StoryboardReferenceBinding = {
	kind: StoryboardReferenceBindingKind;
	refId?: string;
	label: string;
	imageUrl: string;
};

export type StoryboardSelectionContext = {
	version: typeof STORYBOARD_SELECTION_PROTOCOL_VERSION;
	scope: StoryboardSelectionScope;
	taskId?: string;
	planId?: string;
	chunkId?: string;
	chunkIndex?: number;
	groupSize?: StoryboardGroupSize;
	shotStart?: number;
	shotEnd?: number;
	shotNo?: number;
	frameIndex?: number;
	title?: string;
	imageUrl?: string;
	sourceBookId?: string;
	materialChapter?: number;
	storyContext?: string;
	shotPrompt?: string;
	storyboardScript?: string;
	modelKey?: string;
	aspectRatio?: string;
	referenceBindings?: StoryboardReferenceBinding[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as UnknownRecord;
}

function normalizeBoundedString(
	value: unknown,
	options: { minLength?: number; maxLength: number },
): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	const minLength = options.minLength ?? 0;
	if (normalized.length < minLength || normalized.length > options.maxLength) return null;
	return normalized;
}

function normalizeOptionalBoundedString(
	value: unknown,
	options: { minLength?: number; maxLength: number },
): string | undefined {
	const normalized = normalizeBoundedString(value, options);
	return normalized ?? undefined;
}

function normalizeIntegerInRange(
	value: unknown,
	options: { min: number; max: number },
): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
	if (value < options.min || value > options.max) return undefined;
	return value;
}

function isStoryboardSelectionScope(value: string): value is StoryboardSelectionScope {
	return (STORYBOARD_SELECTION_SCOPES as readonly string[]).includes(value);
}

function isStoryboardReferenceBindingKind(
	value: string,
): value is StoryboardReferenceBindingKind {
	return (STORYBOARD_REFERENCE_BINDING_KINDS as readonly string[]).includes(value);
}

function isStoryboardGroupSize(value: number): value is StoryboardGroupSize {
	return (STORYBOARD_GROUP_SIZES as readonly number[]).includes(value);
}

export function normalizeStoryboardReferenceBinding(
	input: unknown,
): StoryboardReferenceBinding | null {
	const record = asRecord(input);
	if (!record) return null;

	const kindValue = normalizeBoundedString(record.kind, { minLength: 1, maxLength: 200 });
	if (!kindValue || !isStoryboardReferenceBindingKind(kindValue)) return null;

	const label = normalizeBoundedString(record.label, { minLength: 1, maxLength: 200 });
	if (!label) return null;

	const imageUrl = normalizeBoundedString(record.imageUrl, { minLength: 1, maxLength: 10_000 });
	if (!imageUrl) return null;

	const refId = normalizeOptionalBoundedString(record.refId, { minLength: 1, maxLength: 200 });

	return {
		kind: kindValue,
		label,
		imageUrl,
		...(refId ? { refId } : null),
	};
}

export function normalizeStoryboardReferenceBindings(
	input: unknown,
): StoryboardReferenceBinding[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const normalized: StoryboardReferenceBinding[] = [];
	for (const item of input) {
		const parsed = normalizeStoryboardReferenceBinding(item);
		if (!parsed) continue;
		const dedupeKey = [
			parsed.kind,
			parsed.refId || "",
			parsed.label,
			parsed.imageUrl,
		].join("::");
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		normalized.push(parsed);
		if (normalized.length >= 12) break;
	}
	return normalized;
}

export function normalizeStoryboardSelectionContext(
	input: unknown,
): StoryboardSelectionContext | null {
	const value = asRecord(input);
	if (!value) return null;

	const scopeValue = normalizeBoundedString(value.scope, { minLength: 1, maxLength: 40 });
	if (!scopeValue || !isStoryboardSelectionScope(scopeValue)) return null;

	const version = value.version;
	if (version !== STORYBOARD_SELECTION_PROTOCOL_VERSION) return null;

	const groupSizeValue = normalizeIntegerInRange(value.groupSize, { min: 1, max: 25 });
	const groupSize = groupSizeValue && isStoryboardGroupSize(groupSizeValue)
		? groupSizeValue
		: undefined;
	if (value.groupSize !== undefined && !groupSize) return null;

	const normalized: StoryboardSelectionContext = {
		version: STORYBOARD_SELECTION_PROTOCOL_VERSION,
		scope: scopeValue,
	};

	const taskId = normalizeOptionalBoundedString(value.taskId, { minLength: 1, maxLength: 200 });
	const planId = normalizeOptionalBoundedString(value.planId, { minLength: 1, maxLength: 200 });
	const chunkId = normalizeOptionalBoundedString(value.chunkId, { minLength: 1, maxLength: 200 });
	const chunkIndex = normalizeIntegerInRange(value.chunkIndex, { min: 0, max: 9_999 });
	const shotStart = normalizeIntegerInRange(value.shotStart, { min: 1, max: 5_000 });
	const shotEnd = normalizeIntegerInRange(value.shotEnd, { min: 1, max: 5_000 });
	const shotNo = normalizeIntegerInRange(value.shotNo, { min: 1, max: 5_000 });
	const frameIndex = normalizeIntegerInRange(value.frameIndex, { min: 0, max: 24 });
	const title = normalizeOptionalBoundedString(value.title, { minLength: 1, maxLength: 200 });
	const imageUrl = normalizeOptionalBoundedString(value.imageUrl, { minLength: 1, maxLength: 10_000 });
	const sourceBookId = normalizeOptionalBoundedString(value.sourceBookId, { minLength: 1, maxLength: 200 });
	const materialChapter = normalizeIntegerInRange(value.materialChapter, { min: 1, max: 9_999 });
	const storyContext = normalizeOptionalBoundedString(value.storyContext, { minLength: 1, maxLength: 4_000 });
	const shotPrompt = normalizeOptionalBoundedString(value.shotPrompt, { minLength: 1, maxLength: 12_000 });
	const storyboardScript = normalizeOptionalBoundedString(value.storyboardScript, { minLength: 1, maxLength: 20_000 });
	const modelKey = normalizeOptionalBoundedString(value.modelKey, { minLength: 1, maxLength: 200 });
	const aspectRatio = normalizeOptionalBoundedString(value.aspectRatio, { minLength: 1, maxLength: 40 });
	const referenceBindings = normalizeStoryboardReferenceBindings(value.referenceBindings);

	if (taskId) normalized.taskId = taskId;
	if (planId) normalized.planId = planId;
	if (chunkId) normalized.chunkId = chunkId;
	if (chunkIndex !== undefined) normalized.chunkIndex = chunkIndex;
	if (groupSize !== undefined) normalized.groupSize = groupSize;
	if (shotStart !== undefined) normalized.shotStart = shotStart;
	if (shotEnd !== undefined) normalized.shotEnd = shotEnd;
	if (shotNo !== undefined) normalized.shotNo = shotNo;
	if (frameIndex !== undefined) normalized.frameIndex = frameIndex;
	if (title) normalized.title = title;
	if (imageUrl) normalized.imageUrl = imageUrl;
	if (sourceBookId) normalized.sourceBookId = sourceBookId;
	if (materialChapter !== undefined) normalized.materialChapter = materialChapter;
	if (storyContext) normalized.storyContext = storyContext;
	if (shotPrompt) normalized.shotPrompt = shotPrompt;
	if (storyboardScript) normalized.storyboardScript = storyboardScript;
	if (modelKey) normalized.modelKey = modelKey;
	if (aspectRatio) normalized.aspectRatio = aspectRatio;
	if (referenceBindings.length > 0) normalized.referenceBindings = referenceBindings;

	return normalized;
}

export function collectStoryboardSelectionReferenceImageUrls(
	context: StoryboardSelectionContext | null | undefined,
): string[] {
	if (!context) return [];
	const urls: string[] = [];
	const seen = new Set<string>();
	for (const binding of context.referenceBindings || []) {
		const imageUrl = String(binding.imageUrl || "").trim();
		if (!imageUrl || seen.has(imageUrl)) continue;
		seen.add(imageUrl);
		urls.push(imageUrl);
		if (urls.length >= 12) break;
	}
	return urls;
}
