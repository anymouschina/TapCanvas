export const FIELD_RELATIONS_KEYWORD = 'x-fieldRelations';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const comparisons = Object.freeze({ gt: (a,b) => a > b, gte: (a,b) => a >= b, lt: (a,b) => a < b, lte: (a,b) => a <= b });
/** Deterministic relations between finite numeric sibling fields; never rewrites values. */
export function inspectFieldRelations(schema, value, path) {
  const relations = schema[FIELD_RELATIONS_KEYWORD];
  if (relations === undefined) return [];
  if (!Array.isArray(relations)) return [{ path, message: `${path} has an invalid field-relations schema` }];
  const issues = [];
  for (const relation of relations) {
    if (!record(relation) || typeof relation.left !== 'string' || !relation.left || typeof relation.right !== 'string' || !relation.right
      || !Object.hasOwn(comparisons, relation.operator) || Object.keys(relation).some(key => !['left','right','operator'].includes(key))) {
      issues.push({ path, message: `${path} has an invalid field relation` }); continue;
    }
    const left = value[relation.left], right = value[relation.right];
    if (typeof left !== 'number' || !Number.isFinite(left) || typeof right !== 'number' || !Number.isFinite(right)) {
      issues.push({ path, message: `${path}.${relation.left} and ${path}.${relation.right} must be finite numeric fields` }); continue;
    }
    if (!comparisons[relation.operator](left, right)) issues.push({ path: `${path}.${relation.left}`,
      message: `${path}.${relation.left} must satisfy ${relation.operator} ${path}.${relation.right}; received ${left} and ${right}` });
  }
  return issues;
}
