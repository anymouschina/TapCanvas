import { chapterAssetPlanSchema } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';

type Facts = Readonly<Record<string, unknown>>;
function record(value: unknown): value is Facts {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Compile the author's explicit source choice; generation references never become output references. */
export function projectChapterAssetSources(rawRegistry: unknown): {
  objectRegistry: Facts[];
  assetPlans: Facts[];
} {
  const properties = chapterAssetPlanSchema.properties;
  if (!record(properties) || !record(properties.objectRegistry)) throw new Error('Chapter asset registry schema is unavailable');
  const issues = validateWorkflowToolArguments(properties.objectRegistry, rawRegistry);
  if (issues.length > 0) throw new Error(`Chapter asset sources violate schema: ${JSON.stringify(issues)}`);
  if (!Array.isArray(rawRegistry)) throw new Error('Chapter asset sources require an object registry');
  const objectRegistry: Facts[] = [];
  const assetPlans: Facts[] = [];
  const objectIds = new Set<string>();
  for (const value of rawRegistry) {
    if (!record(value) || !record(value.imageSource) || typeof value.objectId !== 'string') {
      throw new Error('Chapter asset source requires an object identity and source');
    }
    if (objectIds.has(value.objectId)) throw new Error(`Duplicate chapter asset objectId ${value.objectId}`);
    objectIds.add(value.objectId);
    const { imageSource, ...object } = value;
    if (imageSource.mode !== 'reuse' && imageSource.mode !== 'generate') {
      throw new Error(`Object ${value.objectId} requires an explicit reuse or generate source`);
    }
    objectRegistry.push({ ...object,
      referenceAssetIds: imageSource.mode === 'reuse' ? [...imageSource.assetIds as string[]] : [],
      referenceImageNodeIds: [],
    });
    if (imageSource.mode === 'generate') {
      if (!record(imageSource.plan) || !Array.isArray(imageSource.referenceAssetBindings)) {
        throw new Error(`Object ${value.objectId} requires a generation plan and explicit input bindings`);
      }
      const references = imageSource.referenceAssetBindings.map(binding => {
        if (!record(binding)) throw new Error(`Object ${value.objectId} has an invalid input binding`);
        return { ...binding };
      });
      assetPlans.push({ ...imageSource.plan, objectId: value.objectId, referenceAssetBindings: references });
    }
  }
  return { objectRegistry, assetPlans };
}
