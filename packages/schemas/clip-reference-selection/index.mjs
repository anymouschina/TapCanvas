/** Shared by author submission schema, Agent validation and host validation. */
export const clipObjectStateFields = Object.freeze([
  "objectId", "referenceAssetIds", "referenceImageNodeIds", "startState",
  "spatialRelation", "driver", "stateChange", "endState",
]);

export const clipObjectStateSchema = {
  type: "object",
  properties: Object.fromEntries(clipObjectStateFields.map((field) => [field,
    field === "referenceAssetIds" || field === "referenceImageNodeIds"
      ? { type: "array", items: { type: "string", minLength: 1 } }
      : { type: "string", minLength: 1 },
  ])),
  required: [...clipObjectStateFields],
  additionalProperties: false,
};

/** A registry is a pool of identities, never an implicit per-clip selection. */
export function inspectClipReferenceSelection(state, registry, path) {
  let selectedCount = 0;
  let availableCount = 0;
  for (const field of ["referenceAssetIds", "referenceImageNodeIds"]) {
    const selected = state[field];
    const available = registry[field];
    if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string" || !id.trim())) {
      return `${path}.${field} must explicitly declare this clip's ordered image IDs (an empty array for an object without existing references); registry references are not inherited`;
    }
    if (new Set(selected).size !== selected.length) return `${path}.${field} must not contain duplicate IDs`;
    const allowed = new Set(Array.isArray(available) ? available : []);
    const unknown = selected.find((id) => !allowed.has(id));
    if (unknown !== undefined) return `${path}.${field} references an ID outside this object's registry: ${String(unknown)}`;
    selectedCount += selected.length;
    availableCount += allowed.size;
  }
  if (registry.referenceRole !== "none" && availableCount > 0 && selectedCount === 0) {
    return `${path} must select an existing reference for this visible reference-backed object; an empty selection cannot request a replacement image`;
  }
  return null;
}
