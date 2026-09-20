export const INDEX_REFERENCES_KEYWORD = 'x-indexReferences';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPath = value => Array.isArray(value) && value.length > 0
  && value.every(segment => typeof segment === 'string' && segment.length > 0);

function select(value, segments, path) {
  if (segments.length === 0) return [{ value, path }];
  const [key, ...rest] = segments;
  if (key === '*') return Array.isArray(value)
    ? value.flatMap((item, index) => select(item, rest, `${path}[${index}]`))
    : [{ value: undefined, path }];
  return select(record(value) && Object.hasOwn(value, key) ? value[key] : undefined, rest, `${path}.${key}`);
}

/** Same-object collection references, checked by both author and consumer. No value repair. */
export function inspectIndexReferences(schema, value, path) {
  const relations = schema[INDEX_REFERENCES_KEYWORD];
  if (relations === undefined) return [];
  if (!Array.isArray(relations)) return [{ path, message: `${path} has an invalid index-references schema` }];
  const issues = [];
  for (const relation of relations) {
    if (!record(relation) || !validPath(relation.values) || !validPath(relation.collection)
      || relation.collection.includes('*')
      || Object.keys(relation).some(key => !['values', 'collection'].includes(key))) {
      issues.push({ path, message: `${path} has an invalid index reference` });
      continue;
    }
    const [target] = select(value, relation.collection, path);
    if (!Array.isArray(target.value)) {
      issues.push({ path: target.path, message: `${target.path} must be an array for index references` });
      continue;
    }
    for (const source of select(value, relation.values, path)) {
      if (!Number.isInteger(source.value) || source.value < 0 || source.value >= target.value.length) {
        issues.push({ path: source.path,
          message: `${source.path} must reference an existing zero-based index in ${target.path} (length ${target.value.length}); received ${String(source.value)}` });
      }
    }
  }
  return issues;
}
