const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const maps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const singles = ['items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'additionalProperties', 'unevaluatedProperties', 'contentSchema'];
const lists = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

/** Traverse schema positions only: enum/const/default/examples are instance data. */
function mapChildren(schema, visit) {
  const result = { ...schema };
  for (const key of maps) if (record(schema[key])) result[key] = Object.fromEntries(Object.entries(schema[key]).map(([name, child]) => [name, visit(child)]));
  for (const key of singles) {
    if (record(schema[key]) || typeof schema[key] === 'boolean') result[key] = visit(schema[key]);
    else if (key === 'items' && Array.isArray(schema[key])) result[key] = schema[key].map(visit);
  }
  for (const key of lists) if (Array.isArray(schema[key])) result[key] = schema[key].map(visit);
  return result;
}

/** Share identical enums only when doing so makes the wire schema smaller. */
export function compactRepeatedJsonSchemaEnums(schema) {
  const counts = new Map();
  const count = node => {
    if (!record(node)) return node;
    if (Array.isArray(node.enum)) {
      const key = JSON.stringify(node.enum);
      const entry = counts.get(key);
      counts.set(key, { count: (entry?.count ?? 0) + 1, values: node.enum });
    }
    mapChildren(node, count);
    return node;
  };
  count(schema);
  const definitions = { ...(record(schema.$defs) ? schema.$defs : {}) };
  const names = new Map();
  for (const [key, entry] of counts) {
    if (entry.count < 2) continue;
    let ordinal = names.size + 1;
    while (Object.hasOwn(definitions, `sharedEnum${ordinal}`)) ordinal += 1;
    const name = `sharedEnum${ordinal}`;
    const reference = { $ref: `#/$defs/${name}` };
    const originalCost = (key.length + 9) * entry.count;
    const sharedCost = key.length + name.length + 15 + (JSON.stringify(reference).length + 12) * entry.count;
    if (sharedCost >= originalCost) continue;
    names.set(key, name);
    definitions[name] = { enum: entry.values };
  }
  if (!names.size) return schema;
  const compact = node => {
    if (!record(node)) return node;
    const result = mapChildren(node, compact);
    const name = Array.isArray(node.enum) ? names.get(JSON.stringify(node.enum)) : undefined;
    if (name) {
      delete result.enum;
      result.allOf = [...(Array.isArray(result.allOf) ? result.allOf : []), { $ref: `#/$defs/${name}` }];
    }
    return result;
  };
  const result = compact(schema);
  // Existing definitions were compacted with the rest; append new definitions
  // afterwards so their one authoritative enum is never replaced by itself.
  result.$defs = { ...(record(result.$defs) ? result.$defs : {}),
    ...Object.fromEntries([...names.values()].map(name => [name, definitions[name]])) };
  return result;
}

/** Local validation view only. The compact wire schema remains unchanged.
 * Targets are memoized, so repeated references share one value in memory.
 * Remote, dangling and cyclic schemas are explicit protocol errors. */
export function resolveLocalJsonSchemaReferences(root) {
  const resolved = new Map();
  const visiting = new Set();
  const resolve = reference => {
    if (typeof reference !== 'string' || !reference.startsWith('#/')) throw new Error('Only local JSON Schema pointer references are supported');
    if (resolved.has(reference)) return resolved.get(reference);
    if (visiting.has(reference)) throw new Error(`Cyclic JSON Schema reference: ${reference}`);
    const pointer = decodeURIComponent(reference.slice(2));
    let target = root;
    for (const encoded of pointer.split('/')) {
      if (/~(?:[^01]|$)/.test(encoded)) throw new Error(`Invalid JSON Schema pointer escape: ${reference}`);
      const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
      if ((!record(target) && !Array.isArray(target)) || !Object.hasOwn(target, key)) throw new Error(`Unresolved JSON Schema reference: ${reference}`);
      target = target[key];
    }
    if (!record(target) && typeof target !== 'boolean') throw new Error(`JSON Schema reference target is not a schema: ${reference}`);
    visiting.add(reference);
    const value = visit(target);
    visiting.delete(reference);
    resolved.set(reference, value);
    return value;
  };
  const visit = node => {
    if (!record(node)) return node;
    const { $ref: reference, ...siblings } = node;
    const result = mapChildren(siblings, visit);
    if (reference === undefined) return result;
    const target = resolve(reference);
    return Object.keys(result).length === 0 ? target : { allOf: [target, result] };
  };
  return visit(root);
}
