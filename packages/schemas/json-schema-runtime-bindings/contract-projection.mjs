const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function parseContractPath(path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  const parts = path.split('.').filter(Boolean).map(part => part.endsWith('[]')
    ? [part.slice(0, -2), '*']
    : [part]).flat();
  return parts.length > 0 && parts.every(part => part.length > 0) ? parts : null;
}

function pathIsRuntimeOwned(path, ownedPath) {
  return ownedPath.length <= path.length
    && ownedPath.every((segment, index) => segment === '*' || path[index] === segment);
}

function ownedRootFields(paths) {
  return new Set(paths.filter(path => path.length === 1).map(path => path[0]));
}

function ownedArrayFields(paths) {
  const fields = new Map();
  for (const path of paths) {
    if (path.length !== 3 || path[1] !== '*') continue;
    const current = fields.get(path[0]) ?? new Set();
    current.add(path[2]);
    fields.set(path[0], current);
  }
  return fields;
}

function filterStringList(contract, key, removed) {
  if (!Array.isArray(contract[key])) return;
  const filtered = contract[key].filter(value => typeof value !== 'string' || !removed.has(value));
  if (filtered.length === 0) delete contract[key];
  else contract[key] = filtered;
}

function filterRootMap(contract, key, removed) {
  if (!isRecord(contract[key])) return;
  const map = { ...contract[key] };
  for (const field of removed) delete map[field];
  if (Object.keys(map).length === 0) delete contract[key];
  else contract[key] = map;
}

function filterPathMap(contract, key, paths) {
  if (!isRecord(contract[key])) return;
  const map = { ...contract[key] };
  for (const path of Object.keys(map)) {
    const segments = parseContractPath(path);
    if (segments && paths.some(owned => pathIsRuntimeOwned(segments, owned))) delete map[path];
  }
  if (Object.keys(map).length === 0) delete contract[key];
  else contract[key] = map;
}

function filterPathList(contract, key, paths) {
  if (!Array.isArray(contract[key])) return;
  const filtered = contract[key].filter(path => {
    const segments = parseContractPath(path);
    return !segments || !paths.some(owned => pathIsRuntimeOwned(segments, owned));
  });
  if (filtered.length === 0) delete contract[key];
  else contract[key] = filtered;
}

function filterArrayFieldLists(contract, key, fieldsByArray) {
  if (!isRecord(contract[key])) return;
  const map = { ...contract[key] };
  for (const [arrayField, derivedFields] of fieldsByArray) {
    const fields = map[arrayField];
    if (!Array.isArray(fields)) continue;
    const filtered = fields.filter(field => typeof field !== 'string' || !derivedFields.has(field));
    if (filtered.length === 0) delete map[arrayField];
    else map[arrayField] = filtered;
  }
  if (Object.keys(map).length === 0) delete contract[key];
  else contract[key] = map;
}

function filterArrayFieldMaps(contract, key, fieldsByArray) {
  if (!isRecord(contract[key])) return;
  const map = { ...contract[key] };
  for (const [arrayField, derivedFields] of fieldsByArray) {
    const value = map[arrayField];
    if (Array.isArray(value)) {
      const filtered = value.map(item => {
        if (!isRecord(item)) return item;
        const row = { ...item };
        for (const field of derivedFields) delete row[field];
        return row;
      });
      if (filtered.length === 0 || filtered.every(item => isRecord(item) && Object.keys(item).length === 0)) delete map[arrayField];
      else map[arrayField] = filtered;
      continue;
    }
    if (isRecord(value)) {
      const row = { ...value };
      for (const field of derivedFields) delete row[field];
      if (Object.keys(row).length === 0) delete map[arrayField];
      else map[arrayField] = row;
    }
  }
  if (Object.keys(map).length === 0) delete contract[key];
  else contract[key] = map;
}

function removeDerivedContractFields(contract, paths) {
  const rootFields = ownedRootFields(paths);
  const fieldsByArray = ownedArrayFields(paths);
  for (const key of [
    'requiredStringFields', 'requiredNumberFields', 'requiredObjectFields', 'requiredObjectArrayFields',
    'requiredArrayFields', 'allowedFields', 'allowedTopLevelFields', 'requiredArrayObjectFields',
  ]) filterStringList(contract, key, rootFields);
  for (const key of ['exactStringFields', 'expectedArrayLengths']) filterRootMap(contract, key, rootFields);
  for (const key of [
    'requiredNonEmptyStringPaths', 'requiredObjectPaths', 'requiredArrayPaths', 'optionalNonEmptyStringPaths',
  ]) filterPathList(contract, key, paths);
  filterPathMap(contract, 'exactStringPaths', paths);
  for (const key of [
    'arrayItemRequiredStringFields', 'arrayItemRequiredStringArrayFields',
    'arrayItemRequiredNonEmptyStringArrayFields', 'arrayItemAllowedFields', 'arrayItemRequiredObjectFields',
  ]) filterArrayFieldLists(contract, key, fieldsByArray);
  for (const key of [
    'arrayItemStringFormats', 'arrayItemExactNumberFields', 'arrayItemNumberAllowedValues',
    'arrayItemExactStringFields', 'arrayItemExactStringArrayFields',
  ]) filterArrayFieldMaps(contract, key, fieldsByArray);
}

export function projectRuntimeBoundJsonOutputContractWith(contract, dependencies) {
  if (!isRecord(contract)) throw new TypeError('Runtime-bound output contract must be an object');
  const projected = structuredClone(contract);
  const schema = projected.jsonSchema;
  if (isRecord(schema)) {
    const derivedPaths = dependencies.outputPaths(schema);
    projected.jsonSchema = dependencies.projectSchema(schema);
    removeDerivedContractFields(projected, derivedPaths);
  }
  return projected;
}
