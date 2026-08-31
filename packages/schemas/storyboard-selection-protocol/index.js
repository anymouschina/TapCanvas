"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORYBOARD_GROUP_SIZES = exports.STORYBOARD_REFERENCE_BINDING_KINDS = exports.STORYBOARD_SELECTION_SCOPES = exports.STORYBOARD_SELECTION_PROTOCOL_VERSION = void 0;
exports.normalizeStoryboardReferenceBinding = normalizeStoryboardReferenceBinding;
exports.normalizeStoryboardReferenceBindings = normalizeStoryboardReferenceBindings;
exports.normalizeStoryboardSelectionContext = normalizeStoryboardSelectionContext;
exports.collectStoryboardSelectionReferenceImageUrls = collectStoryboardSelectionReferenceImageUrls;
exports.STORYBOARD_SELECTION_PROTOCOL_VERSION = 1;
exports.STORYBOARD_SELECTION_SCOPES = ["chunk", "frame"];
exports.STORYBOARD_REFERENCE_BINDING_KINDS = [
    "continuity_tail",
    "role",
    "reference",
    "scene_prop",
    "spell_fx",
];
exports.STORYBOARD_GROUP_SIZES = [1, 4, 9, 25];
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function normalizeBoundedString(value, options) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    const minLength = options.minLength ?? 0;
    if (normalized.length < minLength || normalized.length > options.maxLength)
        return null;
    return normalized;
}
function normalizeOptionalBoundedString(value, options) {
    const normalized = normalizeBoundedString(value, options);
    return normalized ?? undefined;
}
function normalizeIntegerInRange(value, options) {
    if (typeof value !== "number" || !Number.isInteger(value))
        return undefined;
    if (value < options.min || value > options.max)
        return undefined;
    return value;
}
function isStoryboardSelectionScope(value) {
    return exports.STORYBOARD_SELECTION_SCOPES.includes(value);
}
function isStoryboardReferenceBindingKind(value) {
    return exports.STORYBOARD_REFERENCE_BINDING_KINDS.includes(value);
}
function isStoryboardGroupSize(value) {
    return exports.STORYBOARD_GROUP_SIZES.includes(value);
}
function normalizeStoryboardReferenceBinding(input) {
    const record = asRecord(input);
    if (!record)
        return null;
    const kindValue = normalizeBoundedString(record.kind, { minLength: 1, maxLength: 200 });
    if (!kindValue || !isStoryboardReferenceBindingKind(kindValue))
        return null;
    const label = normalizeBoundedString(record.label, { minLength: 1, maxLength: 200 });
    if (!label)
        return null;
    const imageUrl = normalizeBoundedString(record.imageUrl, { minLength: 1, maxLength: 10_000 });
    if (!imageUrl)
        return null;
    const refId = normalizeOptionalBoundedString(record.refId, { minLength: 1, maxLength: 200 });
    return {
        kind: kindValue,
        label,
        imageUrl,
        ...(refId ? { refId } : null),
    };
}
function normalizeStoryboardReferenceBindings(input) {
    if (!Array.isArray(input))
        return [];
    const seen = new Set();
    const normalized = [];
    for (const item of input) {
        const parsed = normalizeStoryboardReferenceBinding(item);
        if (!parsed)
            continue;
        const dedupeKey = [
            parsed.kind,
            parsed.refId || "",
            parsed.label,
            parsed.imageUrl,
        ].join("::");
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        normalized.push(parsed);
        if (normalized.length >= 12)
            break;
    }
    return normalized;
}
function normalizeStoryboardSelectionContext(input) {
    const value = asRecord(input);
    if (!value)
        return null;
    const scopeValue = normalizeBoundedString(value.scope, { minLength: 1, maxLength: 40 });
    if (!scopeValue || !isStoryboardSelectionScope(scopeValue))
        return null;
    const version = value.version;
    if (version !== exports.STORYBOARD_SELECTION_PROTOCOL_VERSION)
        return null;
    const groupSizeValue = normalizeIntegerInRange(value.groupSize, { min: 1, max: 25 });
    const groupSize = groupSizeValue && isStoryboardGroupSize(groupSizeValue)
        ? groupSizeValue
        : undefined;
    if (value.groupSize !== undefined && !groupSize)
        return null;
    const normalized = {
        version: exports.STORYBOARD_SELECTION_PROTOCOL_VERSION,
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
    if (taskId)
        normalized.taskId = taskId;
    if (planId)
        normalized.planId = planId;
    if (chunkId)
        normalized.chunkId = chunkId;
    if (chunkIndex !== undefined)
        normalized.chunkIndex = chunkIndex;
    if (groupSize !== undefined)
        normalized.groupSize = groupSize;
    if (shotStart !== undefined)
        normalized.shotStart = shotStart;
    if (shotEnd !== undefined)
        normalized.shotEnd = shotEnd;
    if (shotNo !== undefined)
        normalized.shotNo = shotNo;
    if (frameIndex !== undefined)
        normalized.frameIndex = frameIndex;
    if (title)
        normalized.title = title;
    if (imageUrl)
        normalized.imageUrl = imageUrl;
    if (sourceBookId)
        normalized.sourceBookId = sourceBookId;
    if (materialChapter !== undefined)
        normalized.materialChapter = materialChapter;
    if (storyContext)
        normalized.storyContext = storyContext;
    if (shotPrompt)
        normalized.shotPrompt = shotPrompt;
    if (storyboardScript)
        normalized.storyboardScript = storyboardScript;
    if (modelKey)
        normalized.modelKey = modelKey;
    if (aspectRatio)
        normalized.aspectRatio = aspectRatio;
    if (referenceBindings.length > 0)
        normalized.referenceBindings = referenceBindings;
    return normalized;
}
function collectStoryboardSelectionReferenceImageUrls(context) {
    if (!context)
        return [];
    const urls = [];
    const seen = new Set();
    for (const binding of context.referenceBindings || []) {
        const imageUrl = String(binding.imageUrl || "").trim();
        if (!imageUrl || seen.has(imageUrl))
            continue;
        seen.add(imageUrl);
        urls.push(imageUrl);
        if (urls.length >= 12)
            break;
    }
    return urls;
}
