import type { WorkflowProjectContext } from './execution.project-context';
import { frozenReadyProjectImages } from './execution.project-image-references';
import { FROZEN_REFERENCE_FACTS_KEYWORD, REFERENCE_FACT_EQUALITY_KEYWORD } from '../../../../../packages/schemas/json-schema-relations/reference-facts.mjs';
import { FROZEN_REFERENCE_CATALOGS_KEYWORD, REFERENCE_SOURCE_KEYWORD } from '../../../../../packages/schemas/json-schema-relations/reference-membership.mjs';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Bind reference handles to frozen permissions before author dispatch.
 * This restricts identifiers, never semantic asset selection.
 */
export function bindRegisteredAssetReferenceSchema(
  schema: Record<string, unknown>,
  context: WorkflowProjectContext,
): Record<string, unknown> {
  const ready = frozenReadyProjectImages(context);
  const sources: Readonly<Record<string, readonly string[]>> = {
    project_image: [...new Set(ready.map(asset => asset.assetId))],
    canvas_image_node: [...new Set(ready.flatMap(asset => asset.flowId === context.canvasId && asset.nodeId ? [asset.nodeId] : []))],
  };
  const requestedFacts = new Map<string, Set<string>>();
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (!isRecord(value)) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bind(child)]));
    const relations = result[REFERENCE_FACT_EQUALITY_KEYWORD];
    if (Array.isArray(relations)) for (const relation of relations) {
      if (!isRecord(relation) || typeof relation.catalog !== 'string' || typeof relation.factField !== 'string') continue;
      const fields = requestedFacts.get(relation.catalog) ?? new Set<string>();
      fields.add(relation.factField);
      requestedFacts.set(relation.catalog, fields);
    }
    const source = result[REFERENCE_SOURCE_KEYWORD];
    if (source !== undefined) {
      if (typeof source !== 'string' || !Object.hasOwn(sources, source)) {
        throw new Error(`Unknown workflow reference source: ${String(source)}`);
      }
      return result;
    }
    if (result.type === 'array' && result.items === false) result.maxItems = 0;
    return result;
  };
  const result = bind(schema);
  if (!isRecord(result)) throw new Error('Workflow output schema must remain an object schema');
  result[FROZEN_REFERENCE_CATALOGS_KEYWORD] = sources;
  const hiddenKeywords = result['x-runtimeOnlyKeywords'];
  if (hiddenKeywords !== undefined && (!Array.isArray(hiddenKeywords)
    || hiddenKeywords.some(keyword => typeof keyword !== 'string' || !keyword.length))) {
    throw new Error('Workflow output schema runtime-only keywords must be non-empty strings');
  }
  result['x-runtimeOnlyKeywords'] = [...new Set([
    ...(Array.isArray(hiddenKeywords) ? hiddenKeywords : []),
    FROZEN_REFERENCE_CATALOGS_KEYWORD, FROZEN_REFERENCE_FACTS_KEYWORD,
  ])];
  if (requestedFacts.size > 0) {
    result[FROZEN_REFERENCE_FACTS_KEYWORD] = Object.fromEntries([...requestedFacts].map(([catalog, fields]) => {
      if (catalog !== 'project_image') throw new Error(`Unknown frozen reference fact catalog: ${catalog}`);
      return [catalog, Object.fromEntries(ready.flatMap(asset => {
        const facts: Record<string, unknown> = { ...asset.sourceFacts };
        const knownFacts = Object.fromEntries([...fields].flatMap(field => {
          const fact = facts[field];
          return typeof fact === 'string' && fact.length > 0 ? [[field, fact]] : [];
        }));
        // Absence and null are both explicitly unknown to the relation checker.
        // Preserve all handles in their permission catalog; do not repeat unknown facts.
        return Object.keys(knownFacts).length ? [[asset.assetId, knownFacts]] : [];
      }))];
    }));
  }
  return result;
}
