import { ASSET_OBJECT_KINDS, ASSET_REFERENCE_ROLES } from "../workflow-asset-registry/index.mjs";
import { sceneReferenceCardSchema } from "../scene-reference-contract/index.mjs";
const nonEmptyStringSchema = { type: "string", minLength: 1 };
const stringArraySchema = (minItems = 0) => ({ type: "array", minItems, items: nonEmptyStringSchema });
export function beatSheetObjectRegistrySchema(contract = {}) {
  const allProperties = {
    objectId: nonEmptyStringSchema,
    kind: {
      type: "string",
      enum: ASSET_OBJECT_KINDS,
    },
    name: nonEmptyStringSchema,
    physicalIdentityKey: {
      type: ["string", "null"],
      minLength: 1,
      description: "Use a stable non-empty physical-body key for character objects and null for every other kind.",
    },
    referenceImageNodeIds: { ...stringArraySchema(), items: { ...nonEmptyStringSchema, 'x-referenceSource': 'canvas_image_node' } },
    referenceAssetIds: {
      ...stringArraySchema(),
      items: { ...nonEmptyStringSchema, 'x-referenceSource': 'project_image' },
      description: "Exact IDs of existing images selected from the supplied project asset candidates for this object. Preserve all needed views of the same identity. Use [] only when no existing candidate applies; explicit user selections must still be covered.",
    },
    referenceRole: {
      type: "string",
      enum: ASSET_REFERENCE_ROLES,
    },
    forbiddenTransfer: nonEmptyStringSchema,
    identityInvariant: {
      ...nonEmptyStringSchema,
      description: "Canonical identity facts for this exact object, grounded in the source and user instructions. All assetPlans referencing this object must preserve these facts; do not invent an independent identity when writing the image prompt.",
    },
    scale: {
      ...nonEmptyStringSchema,
      description: "Optional creative scale/size note for this object. If present it must be a non-empty string; never emit a numeric scale.",
    },
  };
  const declaredFields = (contract.arrayItemAllowedFields?.objectRegistry
    ?? Object.keys(allProperties)).filter((field) => field in allProperties);
  // Strict provider schemas cannot represent optional object properties: every
  // exposed property must also be listed in `required`.  Do not expose fields
  // that are optional in the runtime contract, otherwise providers commonly
  // satisfy the strict schema with an empty placeholder (for example
  // `scale: ""`), which is correctly rejected by the authoritative verifier.
  // Existing project candidates may be reused without an explicit selection.
  // An empty reference array is valid; hiding it prevents Agent-owned reuse.
  const requiredFields = new Set([
    "objectId",
    "kind",
    "name",
    "physicalIdentityKey",
    "referenceImageNodeIds",
    "referenceAssetIds",
    "referenceRole",
    "identityInvariant",
  ]);
  const allowedFields = declaredFields.filter((field) => requiredFields.has(field));
  return {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      properties: Object.fromEntries(allowedFields.map((field) => [field, allProperties[field]])),
      required: [...allowedFields],
      additionalProperties: false,
    },
  };
}

export function beatSheetAssetPlansSchema() {
  const identityBoardSpec = {
    type: "object",
    properties: {
      layout: { type: "string", enum: ["identity_board_four_view"] },
      faceViews: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", enum: ["front", "profile"] } },
      fullBodyViews: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", enum: ["front", "back"] } },
      crossViewConsistency: { type: "boolean", enum: [true] },
      referenceRoleIsolation: { type: "boolean", enum: [true] },
      neutralReferenceBackground: { type: "boolean", enum: [true] },
      readableTextVisible: { type: "boolean", enum: [true] },
      brandingVisible: { type: "boolean", enum: [false] },
      neutralBaseState: { type: "boolean", enum: [true] },
      canonicalNameVisible: { type: "boolean", enum: [false] },
      ipSafeOriginal: { type: "boolean", enum: [true] },
    },
    required: [
      "layout", "faceViews", "fullBodyViews", "crossViewConsistency",
      "referenceRoleIsolation", "neutralReferenceBackground", "readableTextVisible",
      "brandingVisible", "neutralBaseState", "canonicalNameVisible", "ipSafeOriginal",
    ],
    additionalProperties: false,
  };
  const allProperties = {
    objectId: {
      ...nonEmptyStringSchema,
      description: "REQUIRED. Copy the exact objectRegistry[].objectId this plan generates imagery for. The runtime compiles the plan's role (kind://canonicalName) from that object; never author role or an identity string here.",
    },
    prompt: {
      ...nonEmptyStringSchema,
      description: "The complete executable image prompt for the exact referenced objectRegistry identity. This text is submitted intact, not reconstructed from identityAnchors. Before submission, reconcile the object's name, identityInvariant, identityAnchors, prompt and negativePrompt against the authoritative source in this same response. For identity cards describe the neutral reference asset, not the scene performance.",
    },
    negativePrompt: {
      ...nonEmptyStringSchema,
      description: "Restrictions for this same object's image only. Review against its positive prompt and canonical identity: never prohibit a confirmed identity characteristic. Correct contradictions in the current candidate before submitting it.",
    },
    identityBoardSpec,
    sceneCard: sceneReferenceCardSchema,
    identityAnchors: {
      ...stringArraySchema(1),
      description: "Stable facts of the same registered object, preserved in the full prompt. These are metadata, not an alternative prompt; do not copy another object's characteristics.",
    },
    prohibitedDrift: {
      ...stringArraySchema(1),
      description: "Evidence-grounded boundaries for the same canonical identity, consistent with both the positive and negative prompt.",
    },
  };
  const commonFields = ["objectId", "prompt", "negativePrompt", "identityAnchors", "prohibitedDrift"];
  const variant = (kind, extraFields) => {
    const fields = [...commonFields.filter(field => !extraFields.includes("sceneCard") || (field !== "prompt" && field !== "negativePrompt")), ...extraFields];
    return {
      type: "object",
      properties: {
        ...Object.fromEntries(fields.map((field) => [field, allProperties[field]])),
      },
      required: fields,
      additionalProperties: false,
    };
  };
  return {
    type: "array",
    minItems: 1,
    items: {
      anyOf: [
        variant("character", ["identityBoardSpec"]),
        variant("scene|environment", ["sceneCard"]),
        variant("prop|vfx|palette|composition|wardrobe", []),
      ],
    },
  };
}

