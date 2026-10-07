export const UNIQUE_BY_KEYWORD = 'x-uniqueBy';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Exact string-field tuples; no normalization, semantic equivalence or value rewriting. */
export function inspectUniqueBy(schema, values, path) {
  const fields = schema[UNIQUE_BY_KEYWORD];
  if (fields === undefined) return [];
  if (!Array.isArray(fields) || fields.length === 0
    || fields.some(field => typeof field !== 'string' || !field)
    || new Set(fields).size !== fields.length) {
    return [{ path, message: `${path} has an invalid ${UNIQUE_BY_KEYWORD} string-field tuple` }];
  }
  const seen = new Map();
  const issues = [];
  values.forEach((value, index) => {
    const missing = fields.find(field => !record(value) || !Object.hasOwn(value, field) || typeof value[field] !== 'string');
    if (missing !== undefined) {
      issues.push({ path: `${path}[${index}].${missing}`, message: `${path}[${index}].${missing} must be a string for ${UNIQUE_BY_KEYWORD}` });
      return;
    }
    const key = JSON.stringify(fields.map(field => value[field]));
    const first = seen.get(key);
    if (first !== undefined) issues.push({ path: `${path}[${index}]`,
      message: `${path}[${index}] duplicates string-field tuple ${JSON.stringify(fields)} from ${path}[${first}]` });
    else seen.set(key, index);
  });
  return issues;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** JSON Schema equality ignores object property order and retains array order. */
export function inspectUniqueItems(schema, values, path) {
  if (schema.uniqueItems !== true) return [];
  const seen = new Map();
  const issues = [];
  values.forEach((value, index) => {
    const key = canonicalJson(value);
    const first = seen.get(key);
    if (first !== undefined) issues.push({ path: `${path}[${index}]`, message: `${path}[${index}] must be unique; duplicates ${path}[${first}]` });
    else seen.set(key, index);
  });
  return issues;
}
