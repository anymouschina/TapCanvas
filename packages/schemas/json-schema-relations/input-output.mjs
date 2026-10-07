export const INPUT_OUTPUT_RELATIONS_KEYWORD = 'x-inputOutputRelations';

const MAX_RELATIONS = 64;
const MAX_PATH_SEGMENTS = 32;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function validPath(value) {
  return Array.isArray(value) && value.length <= MAX_PATH_SEGMENTS
    && value.every(segment => typeof segment === 'string'
      || (Number.isSafeInteger(segment) && segment >= 0));
}

function readPath(value, path) {
  let current = value;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return { found: false };
      current = current[segment];
    } else {
      if (!record(current) || !Object.hasOwn(current, segment)) return { found: false };
      current = current[segment];
    }
  }
  return { found: true, value: current };
}

function cloneJsonValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, `${path}.${key}`)]));
  throw new Error(`${path} must resolve to a JSON value`);
}

function validDeclaration(value) {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => ['inputPort', 'inputIndex', 'inputPath', 'outputPath', 'optional'].includes(key))
    && typeof value.inputPort === 'string' && value.inputPort.length > 0
    && Number.isSafeInteger(value.inputIndex) && value.inputIndex >= 0
    && validPath(value.inputPath) && validPath(value.outputPath)
    && (value.optional === undefined || typeof value.optional === 'boolean');
}

/** Resolve declarative input/output relations against the current immutable input ports. */
export function bindInputOutputRelations(schema, inputPorts) {
  if (!record(schema) || !record(inputPorts)) throw new TypeError('Input/output relation binding requires object schema and input ports');
  const declarations = schema[INPUT_OUTPUT_RELATIONS_KEYWORD];
  if (declarations === undefined) return schema;
  if (!Array.isArray(declarations) || declarations.length > MAX_RELATIONS) {
    throw new Error(`${INPUT_OUTPUT_RELATIONS_KEYWORD} must be an array with at most ${MAX_RELATIONS} relations`);
  }

  const bound = [];
  declarations.forEach((declaration, relationIndex) => {
    if (!validDeclaration(declaration)) throw new Error(`${INPUT_OUTPUT_RELATIONS_KEYWORD}[${relationIndex}] has an invalid declaration`);
    const { inputPort, inputIndex, inputPath, outputPath, optional } = declaration;
    if (!Object.hasOwn(inputPorts, inputPort)) {
      if (optional === true) return;
      throw new Error(`${INPUT_OUTPUT_RELATIONS_KEYWORD}[${relationIndex}] requires input port ${JSON.stringify(inputPort)}`);
    }
    const values = inputPorts[inputPort];
    if (!Array.isArray(values)) throw new Error(`Input port ${JSON.stringify(inputPort)} must be an array`);
    if (inputIndex >= values.length) throw new Error(`Input port ${JSON.stringify(inputPort)} has no item at index ${inputIndex}`);
    const expected = readPath(values[inputIndex], inputPath);
    if (!expected.found) {
      throw new Error(`Input port ${JSON.stringify(inputPort)}[${inputIndex}] is missing declared relation path`);
    }
    bound.push({
      inputPort,
      inputIndex,
      inputPath: [...inputPath],
      outputPath: [...outputPath],
      expectedValue: cloneJsonValue(expected.value, `${inputPort}[${inputIndex}]`),
    });
  });
  return { ...schema, [INPUT_OUTPUT_RELATIONS_KEYWORD]: bound };
}

function equalJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equalJson(left[key], right[key]));
}

function displayPath(base, path) {
  return path.reduce((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(segment)
      ? `${result}.${segment}`
      : `${result}[${JSON.stringify(segment)}]`;
  }, base);
}

/** Validate bound relations using only exact JSON structure; never rewrites candidate values. */
export function inspectInputOutputRelations(schema, value, path = '$') {
  if (!record(schema) || !Object.hasOwn(schema, INPUT_OUTPUT_RELATIONS_KEYWORD)) return [];
  const relations = schema[INPUT_OUTPUT_RELATIONS_KEYWORD];
  if (!Array.isArray(relations) || relations.length > MAX_RELATIONS) {
    return [{ path, message: `${path} has an invalid ${INPUT_OUTPUT_RELATIONS_KEYWORD} schema` }];
  }

  const issues = [];
  relations.forEach((relation, index) => {
    if (!record(relation)
      || Object.keys(relation).some(key => !['inputPort', 'inputIndex', 'inputPath', 'outputPath', 'expectedValue'].includes(key))
      || typeof relation.inputPort !== 'string' || relation.inputPort.length === 0
      || !Number.isSafeInteger(relation.inputIndex) || relation.inputIndex < 0
      || !validPath(relation.inputPath) || !validPath(relation.outputPath)
      || !Object.hasOwn(relation, 'expectedValue')) {
      issues.push({ path, message: `${path} has an invalid or unbound input/output relation at index ${index}` });
      return;
    }
    const actual = readPath(value, relation.outputPath);
    if (!actual.found || !equalJson(actual.value, relation.expectedValue)) {
      issues.push({
        path: displayPath(path, relation.outputPath),
        message: `${displayPath(path, relation.outputPath)} must structurally equal frozen input ${relation.inputPort}[${relation.inputIndex}]${displayPath('', relation.inputPath)}`,
      });
    }
  });
  return issues;
}
