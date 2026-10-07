export const FROZEN_REFERENCE_FACTS_KEYWORD = 'x-frozenReferenceFacts';
export const REFERENCE_FACT_EQUALITY_KEYWORD = 'x-referenceFactEquality';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const knownString = value => typeof value === 'string' && value.length > 0;
const pathValid = (value, allowEach = false) => Array.isArray(value) && value.length > 0
  && value.every(segment => knownString(segment) && (allowEach || segment !== '*'));
const own = (value, key) => record(value) && Object.hasOwn(value, key) ? value[key] : undefined;
const childPath = (path, key) => `${path}[${JSON.stringify(key)}]`;

function select(value, segments, path) {
  if (segments.length === 0) return [{ value, path }];
  const [key, ...rest] = segments;
  if (key === '*') return Array.isArray(value)
    ? value.flatMap((item, index) => select(item, rest, `${path}[${index}]`))
    : [{ value: undefined, path }];
  return select(own(value, key), rest, childPath(path, key));
}

function validRelation(relation) {
  if (!record(relation) || !knownString(relation.ownerField)
    || !pathValid(relation.referencePath, true) || !knownString(relation.catalog)
    || !knownString(relation.factField) || relation.unknownFact !== 'observe'
    || Object.keys(relation).some(key => !['ownerField', 'referencePath', 'referenceField', 'referenceWhen', 'catalog', 'factField', 'when', 'unknownFact'].includes(key))) return false;
  if (relation.referenceField !== undefined && !knownString(relation.referenceField)) return false;
  if (relation.referenceWhen !== undefined && (!record(relation.referenceWhen)
    || Object.keys(relation.referenceWhen).length !== 2 || !knownString(relation.referenceWhen.field)
    || !knownString(relation.referenceWhen.equals) || relation.referenceField === undefined)) return false;
  if (relation.when !== undefined && (!Array.isArray(relation.when)
    || relation.when.some(predicate => !record(predicate) || Object.keys(predicate).length !== 2
      || !pathValid(predicate.path) || !knownString(predicate.equals)))) return false;
  return true;
}

/** Compare explicit string facts only. No name inference, normalization or binding mutation.
 * The immutable catalog is supplied once from the root contract, not authored output.
 * Missing source facts remain observations and never become validation issues.
 */
export function inspectReferenceFactEquality(schema, value, path, referenceFacts) {
  const relations = record(schema) ? schema[REFERENCE_FACT_EQUALITY_KEYWORD] : undefined;
  const issues = [];
  const observations = [];
  if (relations === undefined) return { issues, observations };
  if (!Array.isArray(relations)) return { issues: [{ path, message: `${path} has an invalid reference-fact equality schema` }], observations };
  for (const relation of relations) {
    if (!validRelation(relation)) {
      issues.push({ path, message: `${path} has an invalid reference-fact equality relation` });
      continue;
    }
    if (relation.when?.some(predicate => select(value, predicate.path, path)[0]?.value !== predicate.equals)) continue;
    const ownerValue = own(value, relation.ownerField);
    // Owner field presence/type remains the ordinary output schema's authority.
    if (!knownString(ownerValue)) continue;
    const catalog = own(referenceFacts, relation.catalog);
    for (const selected of select(value, relation.referencePath, path)) {
      if (relation.referenceWhen && own(selected.value, relation.referenceWhen.field) !== relation.referenceWhen.equals) continue;
      const referenceId = relation.referenceField === undefined ? selected.value : own(selected.value, relation.referenceField);
      const referencePath = relation.referenceField === undefined ? selected.path : childPath(selected.path, relation.referenceField);
      // Exact handle shape/membership is checked by the existing reference schema.
      if (!knownString(referenceId)) continue;
      const facts = own(catalog, referenceId);
      const sourceValue = own(facts, relation.factField);
      if (!knownString(sourceValue)) {
        observations.push({ path: referencePath, code: 'reference_fact_unknown',
          message: `${referencePath}: frozen reference ${JSON.stringify(referenceId)} has no known non-empty ${JSON.stringify(relation.factField)} in catalog ${JSON.stringify(relation.catalog)}; equality with ${childPath(path, relation.ownerField)} is unverified, no identity was inferred` });
      } else if (sourceValue !== ownerValue) {
        issues.push({ path: referencePath,
          message: `${referencePath}: frozen reference ${JSON.stringify(referenceId)} declares ${JSON.stringify(relation.factField)}=${JSON.stringify(sourceValue)}, which must equal ${childPath(path, relation.ownerField)}=${JSON.stringify(ownerValue)}` });
      }
    }
  }
  return { issues, observations };
}
