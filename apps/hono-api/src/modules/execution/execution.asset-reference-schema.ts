import type { WorkflowProjectContext } from './execution.project-context';
import { frozenReadyProjectImages } from './execution.project-image-references';

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
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (!isRecord(value)) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, bind(child)]));
    const source = result['x-referenceSource'];
    if (source !== undefined) {
      if (typeof source !== 'string' || !Object.hasOwn(sources, source)) {
        throw new Error(`Unknown workflow reference source: ${String(source)}`);
      }
      delete result['x-referenceSource'];
      const ids = sources[source]!;
      if (ids.length === 0) return false;
      return { ...result, enum: ids };
    }
    if (result.type === 'array' && result.items === false) result.maxItems = 0;
    return result;
  };
  const result = bind(schema);
  if (!isRecord(result)) throw new Error('Workflow output schema must remain an object schema');
  return result;
}
