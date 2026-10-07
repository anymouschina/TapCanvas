const DERIVATIONS_KEY = 'x-runtimeDerivations';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function fail(schemaError, path, message) {
  schemaError('invalid_metadata', path, message);
}

function parsePath(value, path, schemaError, allowWildcard = true) {
  if (!Array.isArray(value) || value.length === 0
    || value.some(segment => typeof segment !== 'string' || segment.length === 0
      || (!allowWildcard && segment === '*'))) {
    fail(schemaError, path, 'Runtime derivation paths must be non-empty string segment arrays');
  }
  return [...value];
}

function schemaTypes(node) {
  if (!isRecord(node)) return [];
  if (typeof node.type === 'string') return [node.type];
  return Array.isArray(node.type) ? node.type.filter(type => typeof type === 'string') : [];
}

function acceptsType(node, expected) {
  const types = schemaTypes(node);
  if (types.length === 0) return true;
  if (expected === 'number') return types.includes('number') || types.includes('integer');
  return types.includes(expected);
}

function childSchemaNodes(schema, path, schemaError, options = {}) {
  let nodes = [schema];
  for (const [index, segment] of path.entries()) {
    const next = [];
    for (const node of nodes) {
      if (!isRecord(node)) fail(schemaError, `$[${JSON.stringify(path.slice(0, index).join('.'))}]`, 'Runtime derivation path crosses a non-object schema');
      if (segment === '*') {
        if (!schemaTypes(node).includes('array') && node.items === undefined) {
          fail(schemaError, `$[${JSON.stringify(path.slice(0, index).join('.'))}]`, 'Runtime derivation wildcard must follow an array schema');
        }
        if (Array.isArray(node.items)) next.push(...node.items);
        else if (isRecord(node.items) || typeof node.items === 'boolean') next.push(node.items);
        else fail(schemaError, `$[${JSON.stringify(path.slice(0, index).join('.'))}]`, 'Runtime derivation array requires item schemas');
        continue;
      }
      if (!isRecord(node.properties) || !hasOwn(node.properties, segment)) {
        fail(schemaError, `$[${JSON.stringify(path.slice(0, index + 1).join('.'))}]`, `Runtime derivation path field ${JSON.stringify(segment)} is not declared`);
      }
      next.push(node.properties[segment]);
    }
    nodes = next;
    if (nodes.length === 0) fail(schemaError, `$[${JSON.stringify(path.slice(0, index + 1).join('.'))}]`, 'Runtime derivation path has no schema target');
  }
  return nodes;
}

function requireArrayItemSchemas(schema, path, label, schemaError) {
  const nodes = childSchemaNodes(schema, path, schemaError);
  const itemSchemas = [];
  for (const node of nodes) {
    if (!isRecord(node) || (!schemaTypes(node).includes('array') && node.items === undefined)) {
      fail(schemaError, label, 'Runtime derivation collection path must resolve to an array schema');
    }
    if (Array.isArray(node.items)) itemSchemas.push(...node.items);
    else if (isRecord(node.items) || typeof node.items === 'boolean') itemSchemas.push(node.items);
    else fail(schemaError, label, 'Runtime derivation collection requires item schemas');
  }
  return itemSchemas;
}

function requireDeclaredField(schema, collectionPath, field, expectedType, label, schemaError) {
  const itemSchemas = requireArrayItemSchemas(schema, collectionPath, label, schemaError);
  for (const item of itemSchemas) {
    if (!isRecord(item) || !isRecord(item.properties) || !hasOwn(item.properties, field)) {
      fail(schemaError, label, `Runtime derivation field ${JSON.stringify(field)} is not declared on collection items`);
    }
    if (!acceptsType(item.properties[field], expectedType)) {
      fail(schemaError, label, `Runtime derivation field ${JSON.stringify(field)} must accept ${expectedType}`);
    }
  }
  return itemSchemas;
}

function requirePathType(schema, path, expectedType, label, schemaError) {
  const nodes = childSchemaNodes(schema, path, schemaError);
  for (const node of nodes) {
    if (!acceptsType(node, expectedType)) {
      fail(schemaError, label, `Runtime derivation output must accept ${expectedType}`);
    }
  }
}

function requireRecordKeys(value, allowed, required, path, schemaError) {
  if (!isRecord(value)) fail(schemaError, path, 'Runtime derivation declaration must be an object');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(schemaError, `${path}[${JSON.stringify(key)}]`, 'Unknown runtime derivation field');
  }
  for (const key of required) {
    if (!hasOwn(value, key)) fail(schemaError, `${path}[${JSON.stringify(key)}]`, 'Required runtime derivation field is missing');
  }
}

function compileOne(schema, raw, index, schemaError) {
  const path = `$[${JSON.stringify(DERIVATIONS_KEY)}][${index}]`;
  if (!isRecord(raw) || typeof raw.op !== 'string') fail(schemaError, path, 'Runtime derivation requires an operation');

  if (raw.op === 'sum') {
    requireRecordKeys(raw, ['op', 'valuesPath', 'outputPath'], ['op', 'valuesPath', 'outputPath'], path, schemaError);
    const valuesPath = parsePath(raw.valuesPath, `${path}.valuesPath`, schemaError);
    const outputPath = parsePath(raw.outputPath, `${path}.outputPath`, schemaError);
    if (!valuesPath.includes('*')) fail(schemaError, `${path}.valuesPath`, 'Sum values path must include an array item wildcard');
    if (outputPath.includes('*')) fail(schemaError, `${path}.outputPath`, 'Sum output path must target one object field');
    requirePathType(schema, valuesPath, 'number', `${path}.valuesPath`, schemaError);
    requirePathType(schema, outputPath, 'number', `${path}.outputPath`, schemaError);
    return { op: raw.op, valuesPath, outputPath };
  }

  if (raw.op === 'prefixSums') {
    requireRecordKeys(raw, ['op', 'valuesPath', 'outputPath', 'initial', 'includeTerminal'], ['op', 'valuesPath', 'outputPath', 'initial', 'includeTerminal'], path, schemaError);
    const valuesPath = parsePath(raw.valuesPath, `${path}.valuesPath`, schemaError);
    const outputPath = parsePath(raw.outputPath, `${path}.outputPath`, schemaError);
    if (!valuesPath.includes('*')) fail(schemaError, `${path}.valuesPath`, 'Prefix-sum values path must include an array item wildcard');
    if (outputPath.at(-2) !== '*' || outputPath.filter(segment => segment === '*').length !== 1) {
      fail(schemaError, `${path}.outputPath`, 'Prefix-sum output path must select one array item field');
    }
    if (typeof raw.initial !== 'number' || !Number.isFinite(raw.initial)) fail(schemaError, `${path}.initial`, 'Prefix-sum initial value must be finite');
    if (typeof raw.includeTerminal !== 'boolean') fail(schemaError, `${path}.includeTerminal`, 'Prefix-sum includeTerminal must be boolean');
    requirePathType(schema, valuesPath, 'number', `${path}.valuesPath`, schemaError);
    requirePathType(schema, outputPath, 'number', `${path}.outputPath`, schemaError);
    return { op: raw.op, valuesPath, outputPath, initial: raw.initial, includeTerminal: raw.includeTerminal };
  }

  if (raw.op === 'indexReference') {
    requireRecordKeys(raw,
      ['op', 'targetPath', 'outputField', 'sourcePath', 'sourceIdField', 'offset'],
      ['op', 'targetPath', 'outputField', 'sourcePath', 'sourceIdField', 'offset'], path, schemaError);
    const targetPath = parsePath(raw.targetPath, `${path}.targetPath`, schemaError, false);
    const sourcePath = parsePath(raw.sourcePath, `${path}.sourcePath`, schemaError, false);
    if (typeof raw.outputField !== 'string' || raw.outputField.length === 0) fail(schemaError, `${path}.outputField`, 'Index reference outputField must be a non-empty string');
    if (typeof raw.sourceIdField !== 'string' || raw.sourceIdField.length === 0) fail(schemaError, `${path}.sourceIdField`, 'Index reference sourceIdField must be a non-empty string');
    if (!Number.isSafeInteger(raw.offset)) fail(schemaError, `${path}.offset`, 'Index reference offset must be a safe integer');
    requireDeclaredField(schema, sourcePath, raw.sourceIdField, 'string', `${path}.sourceIdField`, schemaError);
    requireDeclaredField(schema, targetPath, raw.outputField, 'string', `${path}.outputField`, schemaError);
    return { op: raw.op, targetPath, outputField: raw.outputField, sourcePath, sourceIdField: raw.sourceIdField, offset: raw.offset };
  }

  if (raw.op === 'intervalReferences') {
    requireRecordKeys(raw,
      ['op', 'targetPath', 'outputField', 'eventsPath', 'eventIdField', 'startField', 'endField', 'durationField', 'match'],
      ['op', 'targetPath', 'outputField', 'eventsPath', 'eventIdField', 'startField', 'endField', 'durationField', 'match'], path, schemaError);
    const targetPath = parsePath(raw.targetPath, `${path}.targetPath`, schemaError, false);
    const eventsPath = parsePath(raw.eventsPath, `${path}.eventsPath`, schemaError, false);
    if (typeof raw.outputField !== 'string' || raw.outputField.length === 0) fail(schemaError, `${path}.outputField`, 'Interval reference outputField must be a non-empty string');
    for (const field of ['eventIdField', 'startField', 'endField', 'durationField']) {
      if (typeof raw[field] !== 'string' || raw[field].length === 0) fail(schemaError, `${path}.${field}`, `Interval reference ${field} must be a non-empty string`);
    }
    if (raw.match !== 'overlap' && raw.match !== 'containedByExactlyOne') {
      fail(schemaError, `${path}.match`, 'Interval reference match must be overlap or containedByExactlyOne');
    }
    requireDeclaredField(schema, targetPath, raw.durationField, 'number', `${path}.durationField`, schemaError);
    requireDeclaredField(schema, eventsPath, raw.eventIdField, 'string', `${path}.eventIdField`, schemaError);
    requireDeclaredField(schema, eventsPath, raw.startField, 'number', `${path}.startField`, schemaError);
    requireDeclaredField(schema, eventsPath, raw.endField, 'number', `${path}.endField`, schemaError);
    const outputNodes = requireDeclaredField(schema, targetPath, raw.outputField, 'array', `${path}.outputField`, schemaError);
    for (const item of outputNodes) {
      const arrayNode = item.properties[raw.outputField];
      if (!isRecord(arrayNode) || !isRecord(arrayNode.items) || !acceptsType(arrayNode.items, 'string')) {
        fail(schemaError, `${path}.outputField`, 'Interval reference output must be an array of strings');
      }
    }
    return {
      op: raw.op, targetPath, outputField: raw.outputField, eventsPath,
      eventIdField: raw.eventIdField, startField: raw.startField, endField: raw.endField,
      durationField: raw.durationField, match: raw.match,
    };
  }

  fail(schemaError, `${path}.op`, `Unsupported runtime derivation operation ${JSON.stringify(raw.op)}`);
}

function derivationOutputPath(derivation) {
  if (derivation.op === 'sum' || derivation.op === 'prefixSums') return derivation.outputPath;
  return [...derivation.targetPath, '*', derivation.outputField];
}

export function compileRuntimeDerivations(schema, schemaError) {
  if (!hasOwn(schema, DERIVATIONS_KEY)) return [];
  const declarations = schema[DERIVATIONS_KEY];
  if (!Array.isArray(declarations)) fail(schemaError, `$[${JSON.stringify(DERIVATIONS_KEY)}]`, 'Runtime derivations must be an array');
  const derivations = declarations.map((raw, index) => compileOne(schema, raw, index, schemaError));
  const outputPaths = new Set();
  for (const derivation of derivations) {
    const outputPath = derivationOutputPath(derivation);
    const key = JSON.stringify(outputPath);
    if (outputPaths.has(key)) fail(schemaError, `$[${JSON.stringify(DERIVATIONS_KEY)}]`, 'Runtime derivations cannot declare the same output path twice');
    outputPaths.add(key);
  }
  return derivations;
}

export function runtimeDerivationOutputPaths(derivations) {
  return derivations.map(derivationOutputPath).map(path => [...path]);
}

function schemaPathError(schemaError, path, message) {
  schemaError('invalid_metadata', path, message);
}

function removeOutputPath(node, outputPath, schemaError, path = '$') {
  if (outputPath.length === 0 || !isRecord(node)) schemaPathError(schemaError, path, 'Runtime derivation output path cannot target the schema root');
  const [segment, ...remaining] = outputPath;
  if (segment === '*') {
    if (!hasOwn(node, 'items')) schemaPathError(schemaError, path, 'Runtime derivation output wildcard requires an array item schema');
    if (Array.isArray(node.items)) {
      node.items.forEach((item, index) => removeOutputPath(item, remaining, schemaError, `${path}.items[${index}]`));
      return;
    }
    if (isRecord(node.items)) {
      removeOutputPath(node.items, remaining, schemaError, `${path}.items`);
      return;
    }
    schemaPathError(schemaError, `${path}.items`, 'Runtime derivation output wildcard requires object item schemas');
  }
  if (!isRecord(node.properties) || !hasOwn(node.properties, segment)) {
    schemaPathError(schemaError, `${path}.properties`, `Runtime derivation output field ${JSON.stringify(segment)} is not declared`);
  }
  if (remaining.length > 0) {
    removeOutputPath(node.properties[segment], remaining, schemaError, `${path}.properties[${JSON.stringify(segment)}]`);
    return;
  }
  delete node.properties[segment];
  if (Array.isArray(node.required)) {
    node.required = node.required.filter(field => field !== segment);
    if (node.required.length === 0) delete node.required;
  }
}

export function projectRuntimeDerivationOutputs(schema, derivations, schemaError) {
  for (const outputPath of runtimeDerivationOutputPaths(derivations)) removeOutputPath(schema, outputPath, schemaError);
}
