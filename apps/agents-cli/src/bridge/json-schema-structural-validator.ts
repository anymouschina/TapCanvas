import { inspectFieldRelations, FIELD_RELATIONS_KEYWORD } from "../../../../packages/schemas/json-schema-relations/index.mjs";
import { inspectIndexReferences, INDEX_REFERENCES_KEYWORD } from "../../../../packages/schemas/json-schema-relations/index-references.mjs";
export type JsonSchemaStructuralIssue = {
  path: string;
  keyword: string;
  schemaPath?: string;
  message: string;
};

const MAX_ISSUES = 32;
const MAX_INLINE_ENUM_CHARACTERS = 1024;
function enumIssueMessage(path: string, schemaPath: string, values: readonly unknown[], actual: unknown): string {
  // The frozen schema is already present in the authoring contract. Repeating
  // a project-sized enum once per error amplifies repair context quadratically.
  const encoded = values.map(value => JSON.stringify(value)).join(", ");
  const observed = JSON.stringify(actual) ?? String(actual);
  const received = observed.length <= MAX_INLINE_ENUM_CHARACTERS ? observed
    : `${observed.slice(0, MAX_INLINE_ENUM_CHARACTERS)}… (${observed.length} characters; see retained candidate)`;
  return encoded.length <= MAX_INLINE_ENUM_CHARACTERS
    ? `${path} must be one of ${encoded}; received ${received}`
    : `${path} is outside the ${values.length}-value enum at ${schemaPath}.enum; received ${received}. Select an exact value from the frozen schema; do not shorten or invent an identifier.`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "null": return value === null;
    case "array": return Array.isArray(value);
    case "object": return readRecord(value) !== null;
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: return true;
  }
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function pushIssue(
  issues: JsonSchemaStructuralIssue[],
  issue: JsonSchemaStructuralIssue,
): void {
  if (issues.length < MAX_ISSUES) issues.push(issue);
}

function branchStructuralOverlap(schemaValue: unknown, value: unknown): number {
  const schema = readRecord(schemaValue);
  const record = readRecord(value);
  const properties = readRecord(schema?.properties);
  if (!record || !properties) return 0;
  return Object.keys(record).filter((key) => Object.prototype.hasOwnProperty.call(properties, key)).length;
}

function branchConstMatchScore(schemaValue: unknown, value: unknown): number {
  const schema = readRecord(schemaValue);
  const record = readRecord(value);
  const properties = readRecord(schema?.properties);
  if (!record || !properties) return 0;
  return Object.entries(properties).reduce((score, [key, propertySchemaValue]) => {
    const propertySchema = readRecord(propertySchemaValue);
    if (
      !propertySchema ||
      !Object.prototype.hasOwnProperty.call(propertySchema, "const") ||
      !Object.prototype.hasOwnProperty.call(record, key)
    ) return score;
    return jsonEqual(record[key], propertySchema.const) ? score + 1 : score - 1;
  }, 0);
}

function validateNode(
  schemaValue: unknown,
  value: unknown,
  path: string,
  issues: JsonSchemaStructuralIssue[],
  schemaPath = "$",
): void {
  if (schemaValue === true || issues.length >= MAX_ISSUES) return;
  if (schemaValue === false) {
    pushIssue(issues, { path, keyword: "falseSchema", message: `${path} is not allowed` });
    return;
  }
  const schema = readRecord(schemaValue);
  if (!schema) return;

  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((branch, index) => validateNode(branch, value, path, issues, `${schemaPath}.allOf[${index}]`));
  }
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const branches = Array.isArray(schema[keyword]) ? schema[keyword] : [];
    if (branches.length === 0) continue;
    const results = branches.map((branch, index) => {
      const branchIssues: JsonSchemaStructuralIssue[] = [];
      validateNode(branch, value, path, branchIssues, `${schemaPath}.${keyword}[${index}]`);
      return branchIssues;
    });
    const matches = results.filter((result) => result.length === 0).length;
    if ((keyword === "anyOf" && matches === 0) || (keyword === "oneOf" && matches !== 1)) {
      const best = results
        .map((branchIssues, index) => ({
          branchIssues,
          constMatchScore: branchConstMatchScore(branches[index], value),
          overlap: branchStructuralOverlap(branches[index], value),
        }))
        .sort((left, right) =>
          right.constMatchScore - left.constMatchScore ||
          right.overlap - left.overlap ||
          left.branchIssues.length - right.branchIssues.length,
        )[0]?.branchIssues ?? [];
      pushIssue(issues, {
        path,
        keyword,
        message: keyword === "anyOf"
          ? `${path} must match at least one allowed schema branch`
          : `${path} must match exactly one allowed schema branch`,
      });
      for (const issue of best) pushIssue(issues, issue);
      return;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && !jsonEqual(value, schema.const)) {
    pushIssue(issues, {
      path,
      keyword: "const",
      message: `${path} must equal ${JSON.stringify(schema.const)}`,
    });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonEqual(value, candidate))) {
    pushIssue(issues, {
      path,
      keyword: "enum",
      schemaPath: `${schemaPath}.enum`,
      message: enumIssueMessage(path, schemaPath, schema.enum, value),
    });
  }

  const expectedTypes = typeof schema.type === "string"
    ? [schema.type]
    : Array.isArray(schema.type)
      ? schema.type.filter((item): item is string => typeof item === "string")
      : [];
  if (expectedTypes.length > 0 && !expectedTypes.some((expected) => matchesType(value, expected))) {
    pushIssue(issues, {
      path,
      keyword: "type",
      message: `${path} must be ${expectedTypes.join(" | ")}; received ${valueType(value)}`,
    });
    return;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      pushIssue(issues, { path, keyword: "minLength", message: `${path} must contain at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      pushIssue(issues, { path, keyword: "maxLength", message: `${path} must contain at most ${schema.maxLength} characters` });
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      pushIssue(issues, { path, keyword: "minimum", message: `${path} must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      pushIssue(issues, { path, keyword: "maximum", message: `${path} must be <= ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      pushIssue(issues, {
        path,
        keyword: "exclusiveMinimum",
        message: `${path} must be > ${schema.exclusiveMinimum}`,
      });
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      pushIssue(issues, {
        path,
        keyword: "exclusiveMaximum",
        message: `${path} must be < ${schema.exclusiveMaximum}`,
      });
    }
  }

  if (Array.isArray(value)) {
    if (schema.contains !== undefined) {
      const matches = value.filter((item, index) => {
        const candidateIssues: JsonSchemaStructuralIssue[] = [];
        validateNode(schema.contains, item, `${path}[${index}]`, candidateIssues, `${schemaPath}.contains`);
        return candidateIssues.length === 0;
      }).length;
      const minimum = typeof schema.minContains === "number" ? schema.minContains : 1;
      const maximum = typeof schema.maxContains === "number" ? schema.maxContains : Infinity;
      if (matches < minimum || matches > maximum) pushIssue(issues, {
        path, schemaPath: `${schemaPath}.contains`, keyword: "contains",
        message: `${path} has ${matches} matching items; requires at least ${minimum}${Number.isFinite(maximum) ? ` and at most ${maximum}` : ""} matching ${schemaPath}.contains`,
      });
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      pushIssue(issues, { path, keyword: "minItems", message: `${path} must contain at least ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      pushIssue(issues, { path, keyword: "maxItems", message: `${path} must contain at most ${schema.maxItems} items` });
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, issues, `${schemaPath}.items`));
    }
    return;
  }

  const record = readRecord(value);
  if (!record) return;
  for (const issue of inspectFieldRelations(schema, record, path)) pushIssue(issues, { ...issue, keyword: FIELD_RELATIONS_KEYWORD, schemaPath });
  for (const issue of inspectIndexReferences(schema, record, path)) pushIssue(issues, { ...issue, keyword: INDEX_REFERENCES_KEYWORD, schemaPath });
  const properties = readRecord(schema.properties) ?? {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      const requiredPath = childPath(path, key);
      pushIssue(issues, {
        path: requiredPath,
        keyword: "required",
        message: `${requiredPath} is required`,
      });
    }
  }
  for (const [key, childValue] of Object.entries(record)) {
    const propertySchema = properties[key];
    if (propertySchema !== undefined) {
      validateNode(propertySchema, childValue, childPath(path, key), issues, childPath(`${schemaPath}.properties`, key));
      continue;
    }
    if (schema.additionalProperties === false) {
      pushIssue(issues, {
        path: childPath(path, key),
        keyword: "additionalProperties",
        message: `${childPath(path, key)} is not allowed; expected fields: ${Object.keys(properties).join(", ") || "none"}`,
      });
    } else if (readRecord(schema.additionalProperties)) {
      validateNode(schema.additionalProperties, childValue, childPath(path, key), issues, `${schemaPath}.additionalProperties`);
    }
  }
}

export function validateJsonSchemaStructure(input: {
  schema: Record<string, unknown>;
  value: unknown;
}): JsonSchemaStructuralIssue[] {
  const issues: JsonSchemaStructuralIssue[] = [];
  validateNode(input.schema, input.value, "$", issues);
  return issues;
}

