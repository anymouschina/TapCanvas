import {
  compileRuntimeDerivations,
  projectRuntimeDerivationOutputs,
  runtimeDerivationOutputPaths,
} from './runtime-derivations-schema.mjs';
import { materializeRuntimeDerivations } from './runtime-derivations-evaluator.mjs';
import { projectRuntimeBoundJsonOutputContractWith } from './contract-projection.mjs';

const TABLES_KEY = 'x-runtimeBindingTables';
const BINDINGS_KEY = 'x-runtimeBindings';
const DERIVATIONS_KEY = 'x-runtimeDerivations';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const schemaChildMapKeywords = ['properties'];
const unsupportedSchemaMapKeywords = ['patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const unsupportedSchemaSingleKeywords = [
  'additionalItems', 'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema',
  'not', 'if', 'then', 'else',
];
const unsupportedSchemaArrayKeywords = ['anyOf', 'oneOf'];

function pathForKey(path, key) {
  return `${path}[${JSON.stringify(key)}]`;
}

function schemaError(code, path, message) {
  throw new RuntimeBindingSchemaError(code, path, message);
}

function collectBindingOutputPaths(schema) {
  const paths = [];
  const visit = (node, dataPath = []) => {
    if (!isRecord(node)) return;
    if (hasOwn(node, BINDINGS_KEY)) {
      for (const field of Object.keys(node[BINDINGS_KEY].fields)) paths.push([...dataPath, field]);
    }
    if (isRecord(node.properties)) {
      for (const [field, child] of Object.entries(node.properties)) visit(child, [...dataPath, field]);
    }
    if (Array.isArray(node.items)) node.items.forEach(child => visit(child, [...dataPath, '*']));
    else if (isRecord(node.items)) visit(node.items, [...dataPath, '*']);
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach(child => visit(child, [...dataPath, '*']));
    if (Array.isArray(node.allOf)) node.allOf.forEach(child => visit(child, dataPath));
    if (isRecord(node.additionalProperties)) visit(node.additionalProperties, [...dataPath, '*']);
  };
  visit(schema);
  return paths;
}

function cloneJson(value, path, code = 'invalid_schema', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) schemaError(code, path, 'JSON data cannot contain a non-finite number');
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) schemaError(code, path, 'Cyclic values are not JSON-compatible');
    ancestors.add(value);
    const clone = value.map((child, index) => cloneJson(child, `${path}[${index}]`, code, ancestors));
    ancestors.delete(value);
    return clone;
  }
  if (!isRecord(value)) schemaError(code, path, 'Expected JSON-compatible data');
  if (ancestors.has(value)) schemaError(code, path, 'Cyclic values are not JSON-compatible');
  ancestors.add(value);
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    Object.defineProperty(clone, key, {
      value: cloneJson(child, pathForKey(path, key), code, ancestors),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  ancestors.delete(value);
  return clone;
}

function selectorKey(value, path, code = 'invalid_metadata') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  schemaError(code, path, 'Selector values must be strings, finite numbers, or booleans');
}

function parseTables(schema) {
  if (!hasOwn(schema, TABLES_KEY)) return {};
  const rawTables = schema[TABLES_KEY];
  if (!isRecord(rawTables)) schemaError('invalid_metadata', `$[${JSON.stringify(TABLES_KEY)}]`, 'Runtime binding tables must be an object');

  const tables = Object.create(null);
  for (const [tableId, rawRows] of Object.entries(rawTables)) {
    const tablePath = `$[${JSON.stringify(TABLES_KEY)}][${JSON.stringify(tableId)}]`;
    if (!tableId || !isRecord(rawRows) || Object.keys(rawRows).length === 0) {
      schemaError('invalid_metadata', tablePath, 'Each runtime binding table must contain at least one keyed row');
    }
    const rows = Object.create(null);
    for (const [key, rawRow] of Object.entries(rawRows)) {
      const rowPath = `${tablePath}[${JSON.stringify(key)}]`;
      if (!key || !isRecord(rawRow)) schemaError('invalid_metadata', rowPath, 'Runtime binding rows must be non-empty keyed objects');
      setOwn(rows, key, cloneJson(rawRow, rowPath, 'invalid_metadata'));
    }
    setOwn(tables, tableId, rows);
  }
  return tables;
}

function validateSelectorDomain(selectorSchema, rows, path) {
  if (!isRecord(selectorSchema)) schemaError('invalid_metadata', path, 'The selector field must have an object schema');
  const allowedValues = hasOwn(selectorSchema, 'enum')
    ? selectorSchema.enum
    : hasOwn(selectorSchema, 'const') ? [selectorSchema.const] : null;
  if (allowedValues === null) return;
  if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
    schemaError('invalid_metadata', path, 'Selector enum must be a non-empty array');
  }
  const keys = new Set();
  for (const [index, value] of allowedValues.entries()) {
    const key = selectorKey(value, `${path}[${index}]`);
    if (keys.has(key)) schemaError('invalid_metadata', `${path}[${index}]`, 'Selector enum values must map to distinct table keys');
    keys.add(key);
    if (!hasOwn(rows, key)) schemaError('invalid_metadata', `${path}[${index}]`, `Selector value has no frozen row in the referenced table`);
  }
}

function validateBindingNode(node, path, tables) {
  const binding = node[BINDINGS_KEY];
  if (!isRecord(binding)) schemaError('invalid_metadata', pathForKey(path, BINDINGS_KEY), 'Runtime binding metadata must be an object');
  const bindingFields = new Set(['table', 'selector', 'fields']);
  for (const key of Object.keys(binding)) {
    if (!bindingFields.has(key)) schemaError('invalid_metadata', pathForKey(pathForKey(path, BINDINGS_KEY), key), 'Unknown runtime binding metadata field');
  }
  const tableId = binding.table;
  const selector = binding.selector;
  const fields = binding.fields;
  if (typeof tableId !== 'string' || tableId.length === 0 || !hasOwn(tables, tableId)) {
    schemaError('invalid_metadata', pathForKey(pathForKey(path, BINDINGS_KEY), 'table'), 'Runtime binding references an unknown table');
  }
  if (typeof selector !== 'string' || selector.length === 0) {
    schemaError('invalid_metadata', pathForKey(pathForKey(path, BINDINGS_KEY), 'selector'), 'Runtime binding selector must be a non-empty field name');
  }
  if (!isRecord(node.properties) || !hasOwn(node.properties, selector)) {
    schemaError('invalid_metadata', pathForKey(pathForKey(path, BINDINGS_KEY), 'selector'), 'Runtime binding selector must name a declared object property');
  }
  if (!isRecord(fields) || Object.keys(fields).length === 0) {
    schemaError('invalid_metadata', pathForKey(pathForKey(path, BINDINGS_KEY), 'fields'), 'Runtime binding fields must be a non-empty output-to-column map');
  }
  for (const [outputField, column] of Object.entries(fields)) {
    const fieldPath = pathForKey(pathForKey(pathForKey(path, BINDINGS_KEY), 'fields'), outputField);
    if (!outputField || outputField === selector || typeof column !== 'string' || column.length === 0) {
      schemaError('invalid_metadata', fieldPath, 'Bound output fields must map distinct non-selector fields to non-empty table columns');
    }
    if (!hasOwn(node.properties, outputField)) {
      schemaError('invalid_metadata', fieldPath, 'Every bound output field must exist in the object schema');
    }
    for (const [rowKey, row] of Object.entries(tables[tableId])) {
      if (!hasOwn(row, column)) {
        schemaError('invalid_metadata', pathForKey(pathForKey(pathForKey(path, BINDINGS_KEY), 'fields'), outputField),
          `Frozen row ${JSON.stringify(rowKey)} is missing mapped column ${JSON.stringify(column)}`);
      }
    }
  }
  if (hasOwn(node, 'required') && (!Array.isArray(node.required) || !node.required.every(item => typeof item === 'string'))) {
    schemaError('invalid_schema', pathForKey(path, 'required'), 'Object required must be an array of strings');
  }
  const selectorSchema = node.properties[selector];
  validateSelectorDomain(selectorSchema, tables[tableId], pathForKey(pathForKey(path, 'properties'), selector));
}

function compileSchema(schema) {
  if (!isRecord(schema)) schemaError('invalid_schema', '$', 'Root JSON Schema must be an object');
  const tables = parseTables(schema);
  const walk = (node, path, root = false) => {
    if (typeof node === 'boolean') return;
    if (!isRecord(node)) schemaError('invalid_schema', path, 'Schema nodes must be objects or boolean schemas');
    if (!root && (hasOwn(node, TABLES_KEY) || hasOwn(node, DERIVATIONS_KEY))) {
      schemaError('invalid_metadata', pathForKey(path, hasOwn(node, TABLES_KEY) ? TABLES_KEY : DERIVATIONS_KEY), 'Runtime metadata is only allowed at the schema root');
    }
    if (hasOwn(node, BINDINGS_KEY)) {
      if (node.type !== undefined && node.type !== 'object' && !(Array.isArray(node.type) && node.type.includes('object'))) {
        schemaError('invalid_metadata', path, 'Runtime bindings can only be declared on object schemas');
      }
      validateBindingNode(node, path, tables);
    }
    const walkChild = (child, childPath) => walk(child, childPath);
    for (const keyword of schemaChildMapKeywords) {
      if (!hasOwn(node, keyword)) continue;
      const children = node[keyword];
      if (!isRecord(children)) schemaError('invalid_schema', pathForKey(path, keyword), `${keyword} must be an object`);
      for (const [key, child] of Object.entries(children)) walkChild(child, pathForKey(pathForKey(path, keyword), key));
    }
    if (hasOwn(node, 'items')) {
      const items = node.items;
      if (Array.isArray(items)) items.forEach((child, index) => walkChild(child, `${pathForKey(path, 'items')}[${index}]`));
      else if (isRecord(items) || typeof items === 'boolean') walkChild(items, pathForKey(path, 'items'));
      else schemaError('invalid_schema', pathForKey(path, 'items'), 'items must be a schema or an array of schemas');
    }
    for (const keyword of ['prefixItems', 'allOf']) {
      if (!hasOwn(node, keyword)) continue;
      const children = node[keyword];
      if (!Array.isArray(children)) schemaError('invalid_schema', pathForKey(path, keyword), `${keyword} must be an array`);
      children.forEach((child, index) => walkChild(child, `${pathForKey(path, keyword)}[${index}]`));
    }
    if (hasOwn(node, 'additionalProperties')) {
      const child = node.additionalProperties;
      if (isRecord(child) || typeof child === 'boolean') walkChild(child, pathForKey(path, 'additionalProperties'));
      else schemaError('invalid_schema', pathForKey(path, 'additionalProperties'), 'additionalProperties must be a schema or boolean');
    }
    for (const keyword of unsupportedSchemaMapKeywords) {
      if (!hasOwn(node, keyword)) continue;
      const childMap = node[keyword];
      if (isRecord(childMap) && Object.values(childMap).some(child => containsBindingMetadata(child))) {
        schemaError('invalid_metadata', pathForKey(path, keyword), `Runtime bindings inside ${keyword} are not supported`);
      }
    }
    for (const keyword of [...unsupportedSchemaArrayKeywords, ...unsupportedSchemaSingleKeywords]) {
      if (!hasOwn(node, keyword)) continue;
      if (containsBindingMetadata(node[keyword])) {
        schemaError('invalid_metadata', pathForKey(path, keyword), `Runtime bindings inside ${keyword} are not supported`);
      }
    }
  };
  walk(schema, '$', true);
  const derivations = compileRuntimeDerivations(schema, schemaError);
  const derivedPaths = runtimeDerivationOutputPaths(derivations);
  const bindingPaths = collectBindingOutputPaths(schema);
  for (const derivedPath of derivedPaths) {
    if (bindingPaths.some(bindingPath => JSON.stringify(bindingPath) === JSON.stringify(derivedPath))) {
      schemaError('invalid_metadata', `$[${JSON.stringify(DERIVATIONS_KEY)}]`, `Runtime derivation output ${JSON.stringify(derivedPath)} conflicts with a runtime binding`);
    }
  }
  return { tables, derivations, bindingPaths };
}

function containsBindingMetadata(value, visited = new WeakSet()) {
  if (Array.isArray(value)) {
    if (visited.has(value)) return false;
    visited.add(value);
    return value.some(child => containsBindingMetadata(child, visited));
  }
  if (!isRecord(value)) return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (hasOwn(value, BINDINGS_KEY) || hasOwn(value, TABLES_KEY) || hasOwn(value, DERIVATIONS_KEY)) return true;
  for (const keyword of ['properties', ...unsupportedSchemaMapKeywords]) {
    if (isRecord(value[keyword]) && Object.values(value[keyword]).some(child => containsBindingMetadata(child, visited))) return true;
  }
  for (const keyword of ['items', 'additionalProperties', ...unsupportedSchemaSingleKeywords]) {
    const child = value[keyword];
    if ((isRecord(child) || typeof child === 'boolean' || Array.isArray(child))
      && containsBindingMetadata(child, visited)) return true;
  }
  for (const keyword of ['prefixItems', 'allOf', ...unsupportedSchemaArrayKeywords]) {
    if (Array.isArray(value[keyword]) && containsBindingMetadata(value[keyword], visited)) return true;
  }
  return false;
}

function projectNode(node, path) {
  if (typeof node === 'boolean') return node;
  const projected = cloneJson(node, path);
  const runtimeOnlyKeywords = projected['x-runtimeOnlyKeywords'];
  if (runtimeOnlyKeywords !== undefined) {
    if (!Array.isArray(runtimeOnlyKeywords)
      || runtimeOnlyKeywords.some(key => typeof key !== 'string' || !key.length)
      || new Set(runtimeOnlyKeywords).size !== runtimeOnlyKeywords.length) {
      schemaError('invalid_metadata', pathForKey(path, 'x-runtimeOnlyKeywords'), 'Runtime-only schema keywords must be unique non-empty strings');
    }
    for (const key of runtimeOnlyKeywords) delete projected[key];
    delete projected['x-runtimeOnlyKeywords'];
  }
  if (hasOwn(projected, BINDINGS_KEY)) {
    const binding = projected[BINDINGS_KEY];
    for (const outputField of Object.keys(binding.fields)) delete projected.properties[outputField];
    if (Array.isArray(projected.required)) {
      projected.required = projected.required.filter(field => !hasOwn(binding.fields, field));
      if (projected.required.length === 0) delete projected.required;
    }
    delete projected[BINDINGS_KEY];
  }
  if (path === '$') {
    delete projected[TABLES_KEY];
    delete projected[DERIVATIONS_KEY];
  }
  for (const keyword of [...schemaChildMapKeywords, ...unsupportedSchemaMapKeywords]) {
    if (!isRecord(projected[keyword])) continue;
    for (const [key, child] of Object.entries(projected[keyword])) {
      setOwn(projected[keyword], key, projectNode(child, pathForKey(pathForKey(path, keyword), key)));
    }
  }
  if (hasOwn(projected, 'items')) {
    if (Array.isArray(projected.items)) {
      projected.items = projected.items.map((child, index) => projectNode(child, `${pathForKey(path, 'items')}[${index}]`));
    } else if (isRecord(projected.items) || typeof projected.items === 'boolean') {
      projected.items = projectNode(projected.items, pathForKey(path, 'items'));
    }
  }
  for (const keyword of ['prefixItems', 'allOf', ...unsupportedSchemaArrayKeywords]) {
    if (Array.isArray(projected[keyword])) {
      projected[keyword] = projected[keyword].map((child, index) => projectNode(child, `${pathForKey(path, keyword)}[${index}]`));
    }
  }
  if (isRecord(projected.additionalProperties) || typeof projected.additionalProperties === 'boolean') {
    projected.additionalProperties = projectNode(projected.additionalProperties, pathForKey(path, 'additionalProperties'));
  }
  for (const keyword of unsupportedSchemaSingleKeywords) {
    if (isRecord(projected[keyword]) || typeof projected[keyword] === 'boolean') {
      projected[keyword] = projectNode(projected[keyword], pathForKey(path, keyword));
    }
  }
  return projected;
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => hasOwn(right, key) && deepEqual(left[key], right[key]));
}

function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function materializeNode(value, schema, tables, path, issues) {
  if (typeof schema === 'boolean' || !isRecord(schema)) return value;
  let current = value;
  if (current === null && Array.isArray(schema.type) && schema.type.includes('null')) return current;
  if (hasOwn(schema, BINDINGS_KEY)) {
    const binding = schema[BINDINGS_KEY];
    if (!isRecord(current)) {
      issues.push({ path, message: 'Runtime-bound schema expected an object candidate' });
      return current;
    }
    const selectorPath = pathForKey(path, binding.selector);
    if (!hasOwn(current, binding.selector)) {
      issues.push({ path: selectorPath, message: 'Runtime binding selector is missing' });
      return current;
    }
    let key;
    try {
      key = selectorKey(current[binding.selector], selectorPath, 'invalid_metadata');
    } catch {
      issues.push({ path: selectorPath, message: 'Runtime binding selector must be a string, finite number, or boolean' });
      return current;
    }
    const rows = tables[binding.table];
    if (!hasOwn(rows, key)) {
      issues.push({ path: selectorPath, message: `Unknown runtime binding selector ${JSON.stringify(current[binding.selector])}` });
      return current;
    }
    const row = rows[key];
    const resolved = Object.entries(binding.fields).map(([outputField, column]) => ({
      outputField,
      value: row[column],
    }));
    const conflicts = resolved.filter(({ outputField, value: expected }) => (
      hasOwn(current, outputField) && !deepEqual(current[outputField], expected)
    ));
    if (conflicts.length > 0) {
      for (const { outputField } of conflicts) {
        issues.push({ path: pathForKey(path, outputField), message: 'Candidate value conflicts with the frozen runtime binding' });
      }
      return current;
    }
    for (const { outputField, value: expected } of resolved) {
      if (!hasOwn(current, outputField)) setOwn(current, outputField, cloneJson(expected, pathForKey(path, outputField), 'invalid_metadata'));
    }
  }

  for (const branch of Array.isArray(schema.allOf) ? schema.allOf : []) {
    current = materializeNode(current, branch, tables, path, issues);
  }

  if (Array.isArray(current)) {
    if (Array.isArray(schema.prefixItems)) {
      for (let index = 0; index < Math.min(current.length, schema.prefixItems.length); index += 1) {
        current[index] = materializeNode(current[index], schema.prefixItems[index], tables, `${path}[${index}]`, issues);
      }
    }
    if (Array.isArray(schema.items)) {
      for (let index = 0; index < Math.min(current.length, schema.items.length); index += 1) {
        const itemSchema = schema.items[index];
        if (itemSchema !== undefined) current[index] = materializeNode(current[index], itemSchema, tables, `${path}[${index}]`, issues);
      }
    } else if (isRecord(schema.items) || typeof schema.items === 'boolean') {
      const startIndex = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
      for (let index = startIndex; index < current.length; index += 1) {
        current[index] = materializeNode(current[index], schema.items, tables, `${path}[${index}]`, issues);
      }
    }
    return current;
  }

  if (!isRecord(current)) return current;
  const declaredProperties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, childSchema] of Object.entries(declaredProperties)) {
    if (hasOwn(current, key)) current[key] = materializeNode(current[key], childSchema, tables, pathForKey(path, key), issues);
  }
  const childSchema = schema.additionalProperties;
  if (isRecord(childSchema) || typeof childSchema === 'boolean') {
    for (const [key, childValue] of Object.entries(current)) {
      if (!hasOwn(declaredProperties, key)) current[key] = materializeNode(childValue, childSchema, tables, pathForKey(path, key), issues);
    }
  }
  return current;
}

export class RuntimeBindingSchemaError extends Error {
  constructor(code, path, message) {
    super(`${message} at ${path}`);
    this.name = 'RuntimeBindingSchemaError';
    this.code = code;
    this.path = path;
  }
}

/** Return the Agent-facing schema with host-owned binding columns removed. */
export function projectRuntimeBoundJsonSchema(schema) {
  const compiled = compileSchema(schema);
  const projected = projectNode(schema, '$');
  projectRuntimeDerivationOutputs(projected, compiled.derivations, schemaError);
  return projected;
}

/** Return all schema-declared host-owned output paths, including array wildcards. */
export function runtimeDerivedOutputPaths(schema) {
  const compiled = compileSchema(schema);
  return runtimeDerivationOutputPaths(compiled.derivations);
}

/** Return all host-owned schema outputs, including frozen binding columns. */
export function runtimeOwnedOutputPaths(schema) {
  const compiled = compileSchema(schema);
  return [...compiled.bindingPaths.map(path => [...path]), ...runtimeDerivationOutputPaths(compiled.derivations)];
}

/** Project a delivered value to editable author fields, without inferring authored content. */
export function projectRuntimeBoundJsonValueForAuthor(value, schema) {
  const compiled = compileSchema(schema);
  const projected = cloneJson(value, '$', 'invalid_candidate');
  // Binding ownership is location-specific for heterogeneous tuples and prefix items.
  // The catalog's wildcard paths describe schemas; they must not erase a different item's author field.
  const removeBindings = (node, nodeSchema) => {
    if (!isRecord(nodeSchema) || node === null || typeof node !== 'object') return;
    if (isRecord(node) && hasOwn(nodeSchema, BINDINGS_KEY)) {
      for (const field of Object.keys(nodeSchema[BINDINGS_KEY].fields)) delete node[field];
    }
    for (const branch of Array.isArray(nodeSchema.allOf) ? nodeSchema.allOf : []) removeBindings(node, branch);
    if (Array.isArray(node)) {
      if (Array.isArray(nodeSchema.prefixItems)) nodeSchema.prefixItems.forEach((child, index) => removeBindings(node[index], child));
      if (Array.isArray(nodeSchema.items)) nodeSchema.items.forEach((child, index) => removeBindings(node[index], child));
      else if (isRecord(nodeSchema.items)) {
        const startIndex = Array.isArray(nodeSchema.prefixItems) ? nodeSchema.prefixItems.length : 0;
        for (let index = startIndex; index < node.length; index += 1) removeBindings(node[index], nodeSchema.items);
      }
    } else {
      for (const [field, child] of Object.entries(node)) {
        const childSchema = isRecord(nodeSchema.properties) && hasOwn(nodeSchema.properties, field)
          ? nodeSchema.properties[field] : nodeSchema.additionalProperties;
        removeBindings(child, childSchema);
      }
    }
  };
  const remove = (node, path, offset) => {
    if (node === null || typeof node !== 'object') return;
    const segment = path[offset];
    if (segment === '*') {
      for (const child of Object.values(node)) remove(child, path, offset + 1);
    } else if (offset === path.length - 1) {
      if (hasOwn(node, segment)) delete node[segment];
    } else if (hasOwn(node, segment)) {
      remove(node[segment], path, offset + 1);
    }
  };
  removeBindings(projected, schema);
  for (const path of runtimeDerivationOutputPaths(compiled.derivations)) remove(projected, path, 0);
  return projected;
}

/** Project JSON Schema and matching auxiliary output-contract constraints together. */
export function projectRuntimeBoundJsonOutputContract(contract) {
  return projectRuntimeBoundJsonOutputContractWith(contract, {
    outputPaths: runtimeOwnedOutputPaths,
    projectSchema: projectRuntimeBoundJsonSchema,
  });
}

/** Materialize host-owned columns without changing author-provided fields. */
export function materializeRuntimeBoundJson(value, schema) {
  const { tables, derivations } = compileSchema(schema);
  let clone;
  try {
    clone = cloneJson(value, '$', 'invalid_candidate');
  } catch (error) {
    if (!(error instanceof RuntimeBindingSchemaError)) throw error;
    return { value, issues: [{ path: error.path, message: error.message }] };
  }
  const issues = [];
  const materialized = materializeNode(clone, schema, tables, '$', issues);
  materializeRuntimeDerivations(materialized, derivations, issues);
  return { value: materialized, issues };
}
