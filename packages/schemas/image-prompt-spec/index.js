"use strict";

const IMAGE_PROMPT_SPEC_V2_VERSION = "v2";
const IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS = 12;
const IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH = 320;
const IMAGE_PROMPT_SPEC_ALLOWED_KEYS = new Set([
  "version",
  "shotIntent",
  "spatialLayout",
  "subjectRelations",
  "referenceBindings",
  "identityConstraints",
  "environmentObjects",
  "cameraPlan",
  "lightingPlan",
  "styleConstraints",
  "continuityConstraints",
  "negativeConstraints",
]);

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeBoundedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeStringList(value, maxItems, maxLength) {
  if (typeof value === "string") {
    const single = normalizeBoundedString(value, maxLength);
    return single ? [single] : [];
  }
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalizeBoundedString(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseRequiredString(value, fieldName) {
  const normalized = normalizeBoundedString(value, IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH);
  if (!normalized) {
    return {
      ok: false,
      error: `imagePromptSpecV2.${fieldName} must be a non-empty string`,
    };
  }
  return { ok: true, value: normalized };
}

function parseRequiredStringList(value, fieldName) {
  const normalized = normalizeStringList(
    value,
    IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS,
    IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH,
  );
  if (normalized === null || normalized.length === 0) {
    return {
      ok: false,
      error: `imagePromptSpecV2.${fieldName} must contain at least one non-empty string`,
    };
  }
  return { ok: true, value: normalized };
}

function parseOptionalStringList(value, fieldName) {
  if (typeof value === "undefined") return { ok: true, value: [] };
  const normalized = normalizeStringList(
    value,
    IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS,
    IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH,
  );
  if (normalized === null) {
    return {
      ok: false,
      error: `imagePromptSpecV2.${fieldName} must be a string or an array of strings`,
    };
  }
  return { ok: true, value: normalized };
}

function parseImagePromptSpecV2(input) {
  if (typeof input === "undefined" || input === null) {
    return { ok: true, value: null };
  }
  if (!isPlainRecord(input)) {
    return { ok: false, error: "imagePromptSpecV2 must be a plain object" };
  }

  const extraKeys = Object.keys(input).filter((key) => !IMAGE_PROMPT_SPEC_ALLOWED_KEYS.has(key));
  if (extraKeys.length > 0) {
    return {
      ok: false,
      error: `imagePromptSpecV2 contains unsupported keys: ${extraKeys.join(", ")}`,
    };
  }

  const version = normalizeBoundedString(input.version, 16);
  if (version !== IMAGE_PROMPT_SPEC_V2_VERSION) {
    return {
      ok: false,
      error: `imagePromptSpecV2.version must be ${IMAGE_PROMPT_SPEC_V2_VERSION}`,
    };
  }

  const shotIntent = parseRequiredString(input.shotIntent, "shotIntent");
  if (!shotIntent.ok) return shotIntent;

  const spatialLayout = parseRequiredStringList(input.spatialLayout, "spatialLayout");
  if (!spatialLayout.ok) return spatialLayout;

  const cameraPlan = parseRequiredStringList(input.cameraPlan, "cameraPlan");
  if (!cameraPlan.ok) return cameraPlan;

  const lightingPlan = parseRequiredStringList(input.lightingPlan, "lightingPlan");
  if (!lightingPlan.ok) return lightingPlan;

  const subjectRelations = parseOptionalStringList(input.subjectRelations, "subjectRelations");
  if (!subjectRelations.ok) return subjectRelations;

  const referenceBindings = parseOptionalStringList(
    input.referenceBindings,
    "referenceBindings",
  );
  if (!referenceBindings.ok) return referenceBindings;

  const identityConstraints = parseOptionalStringList(
    input.identityConstraints,
    "identityConstraints",
  );
  if (!identityConstraints.ok) return identityConstraints;

  const environmentObjects = parseOptionalStringList(
    input.environmentObjects,
    "environmentObjects",
  );
  if (!environmentObjects.ok) return environmentObjects;

  const styleConstraints = parseOptionalStringList(input.styleConstraints, "styleConstraints");
  if (!styleConstraints.ok) return styleConstraints;

  const continuityConstraints = parseOptionalStringList(
    input.continuityConstraints,
    "continuityConstraints",
  );
  if (!continuityConstraints.ok) return continuityConstraints;

  const negativeConstraints = parseOptionalStringList(
    input.negativeConstraints,
    "negativeConstraints",
  );
  if (!negativeConstraints.ok) return negativeConstraints;

  return {
    ok: true,
    value: {
      version: IMAGE_PROMPT_SPEC_V2_VERSION,
      shotIntent: shotIntent.value,
      spatialLayout: spatialLayout.value,
      subjectRelations: subjectRelations.value,
      referenceBindings: referenceBindings.value,
      identityConstraints: identityConstraints.value,
      environmentObjects: environmentObjects.value,
      cameraPlan: cameraPlan.value,
      lightingPlan: lightingPlan.value,
      styleConstraints: styleConstraints.value,
      continuityConstraints: continuityConstraints.value,
      negativeConstraints: negativeConstraints.value,
    },
  };
}

function joinPromptList(items) {
  return Array.isArray(items) && items.length > 0 ? items.join("；") : "";
}

function compileImagePromptSpecV2(spec) {
  if (!spec) return "";
  const subjectRelations = Array.isArray(spec.subjectRelations) ? spec.subjectRelations : [];
  const referenceBindings = Array.isArray(spec.referenceBindings) ? spec.referenceBindings : [];
  const identityConstraints = Array.isArray(spec.identityConstraints) ? spec.identityConstraints : [];
  const environmentObjects = Array.isArray(spec.environmentObjects) ? spec.environmentObjects : [];
  const styleConstraints = Array.isArray(spec.styleConstraints) ? spec.styleConstraints : [];
  const continuityConstraints = Array.isArray(spec.continuityConstraints) ? spec.continuityConstraints : [];
  const negativeConstraints = Array.isArray(spec.negativeConstraints) ? spec.negativeConstraints : [];
  const lines = [
    `画面目标：${spec.shotIntent}`,
    `空间布局：${joinPromptList(spec.spatialLayout)}`,
    subjectRelations.length > 0
      ? `主体关系：${joinPromptList(subjectRelations)}`
      : "",
    referenceBindings.length > 0
      ? `参考绑定：${joinPromptList(referenceBindings)}`
      : "",
    identityConstraints.length > 0
      ? `身份锁定：${joinPromptList(identityConstraints)}`
      : "",
    environmentObjects.length > 0
      ? `环境与物件：${joinPromptList(environmentObjects)}`
      : "",
    `镜头与构图：${joinPromptList(spec.cameraPlan)}`,
    `光线与材质：${joinPromptList(spec.lightingPlan)}`,
    styleConstraints.length > 0
      ? `风格约束：${joinPromptList(styleConstraints)}`
      : "",
    continuityConstraints.length > 0
      ? `连续性约束：${joinPromptList(continuityConstraints)}`
      : "",
    negativeConstraints.length > 0
      ? `禁止项：${joinPromptList(negativeConstraints)}`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

module.exports = {
  IMAGE_PROMPT_SPEC_V2_VERSION,
  IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS,
  IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH,
  parseImagePromptSpecV2,
  compileImagePromptSpecV2,
};
