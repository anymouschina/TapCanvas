import { IMAGE_REFERENCE_ROLES } from './index.mjs';

export const generationReferenceBindingsSchema = {
  type: 'array',
  'x-uniqueBy': ['assetId'],
  items: {
    type: 'object',
    properties: {
      assetId: { type: 'string', minLength: 1, 'x-referenceSource': 'project_image' },
      role: { type: 'string', enum: IMAGE_REFERENCE_ROLES },
      strength: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['assetId', 'role'],
    additionalProperties: false,
  },
};

/** Validate generation inputs without converting them into generated outputs. */
export function inspectGenerationReferenceBindings(value, path = 'referenceAssetBindings') {
  if (!Array.isArray(value)) return `${path} must be an array`;
  const seen = new Set();
  for (const [index, binding] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) return `${itemPath} must be an object`;
    const unexpected = Object.keys(binding).find(key => !Object.hasOwn(generationReferenceBindingsSchema.items.properties, key));
    if (unexpected) return `${itemPath} contains unexpected field ${unexpected}`;
    if (typeof binding.assetId !== 'string' || !binding.assetId.trim()) return `${itemPath}.assetId must be non-empty`;
    if (!IMAGE_REFERENCE_ROLES.includes(binding.role)) return `${itemPath}.role must use a supported image reference role`;
    if (binding.strength !== undefined && (typeof binding.strength !== 'number' || !Number.isFinite(binding.strength) || binding.strength < 0 || binding.strength > 1)) return `${itemPath}.strength must be between 0 and 1`;
    if (seen.has(binding.assetId)) return `${itemPath}.assetId duplicates an existing input reference`;
    seen.add(binding.assetId);
  }
  return null;
}
