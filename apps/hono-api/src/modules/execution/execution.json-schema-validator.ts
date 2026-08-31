export type WorkflowJsonSchemaIssue = Readonly<{ path: string; message: string }>;

const WORKFLOW_SCHEMA_KEYWORDS = new Set([
	"$comment", "$defs", "$id", "$ref", "$schema",
	"additionalProperties", "allOf", "anyOf", "const", "contains", "contentEncoding", "contentMediaType", "contentSchema",
	"default", "definitions", "dependentRequired", "deprecated", "description", "else", "enum", "examples",
	"exclusiveMaximum", "exclusiveMinimum", "format", "if", "items", "maxContains", "maxItems", "maxLength", "maximum",
	"maxProperties", "minContains", "minItems", "minLength", "minimum", "minProperties", "multipleOf", "not", "oneOf",
	"pattern", "patternProperties", "prefixItems", "properties", "propertyNames", "readOnly", "required", "then", "title",
	"type", "uniqueItems", "writeOnly",
]);

const WORKFLOW_SCHEMA_BRANCH_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const WORKFLOW_SCHEMA_BRANCH_KEYS = ["not", "if", "then", "else", "items", "contains", "additionalProperties", "propertyNames", "contentSchema"] as const;
const WORKFLOW_SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"] as const;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function matchesType(value: unknown, expected: string): boolean {
	if (expected === "object") return record(value) !== null;
	if (expected === "array") return Array.isArray(value);
	if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
	if (expected === "number") return typeof value === "number" && Number.isFinite(value);
	if (expected === "null") return value === null;
	return typeof value === expected;
}

function equal(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left)
			&& Array.isArray(right)
			&& left.length === right.length
			&& left.every((item, index) => equal(item, right[index]));
	}
	const leftRecord = record(left);
	const rightRecord = record(right);
	if (!leftRecord || !rightRecord) return false;
	const leftKeys = Object.keys(leftRecord).sort();
	const rightKeys = Object.keys(rightRecord).sort();
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key, index) => key === rightKeys[index] && equal(leftRecord[key], rightRecord[key]));
}

function branchMatches(schema: unknown, value: unknown, path: string): boolean {
	const branchIssues: WorkflowJsonSchemaIssue[] = [];
	validate(schema, value, path, branchIssues);
	return branchIssues.length === 0;
}

function validPattern(value: string, pattern: string, path: string, issues: WorkflowJsonSchemaIssue[]): boolean {
	try {
		return new RegExp(pattern, "u").test(value);
	} catch {
		issues.push({ path, message: `${path} cannot be validated because the registered schema pattern is invalid` });
		return false;
	}
}

function collectUnsupportedKeywords(schemaValue: unknown, path: string, issues: WorkflowJsonSchemaIssue[]): void {
	if (schemaValue === true || schemaValue === false) return;
	const schema = record(schemaValue);
	if (!schema) return;
	for (const key of Object.keys(schema)) {
		if (!WORKFLOW_SCHEMA_KEYWORDS.has(key) && !key.startsWith("x-")) {
			issues.push({ path, message: `${path} uses unsupported registered schema keyword '${key}'` });
		}
	}
	for (const key of WORKFLOW_SCHEMA_BRANCH_ARRAY_KEYS) {
		const branches = schema[key];
		if (Array.isArray(branches)) branches.forEach((branch, index) => collectUnsupportedKeywords(branch, `${path}.${key}[${index}]`, issues));
	}
	for (const key of WORKFLOW_SCHEMA_BRANCH_KEYS) {
		const branch = schema[key];
		if (Array.isArray(branch) && key === "items") {
			branch.forEach((item, index) => collectUnsupportedKeywords(item, `${path}.${key}[${index}]`, issues));
		} else if (branch !== undefined && branch !== true && branch !== false) {
			collectUnsupportedKeywords(branch, `${path}.${key}`, issues);
		}
	}
	for (const key of WORKFLOW_SCHEMA_MAP_KEYS) {
		const branches = record(schema[key]) ?? {};
		for (const [name, branch] of Object.entries(branches)) collectUnsupportedKeywords(branch, `${path}.${key}.${name}`, issues);
	}
}

export function findUnsupportedWorkflowToolSchemaKeywords(schema: Record<string, unknown>): WorkflowJsonSchemaIssue[] {
	const issues: WorkflowJsonSchemaIssue[] = [];
	collectUnsupportedKeywords(schema, "$schema", issues);
	return issues;
}

function validate(schemaValue: unknown, value: unknown, path: string, issues: WorkflowJsonSchemaIssue[]): void {
	if (issues.length >= 32 || schemaValue === true) return;
	if (schemaValue === false) {
		issues.push({ path, message: `${path} is not allowed` });
		return;
	}
	const schema = record(schemaValue);
	if (!schema) return;
	if (schema.$ref !== undefined) {
		issues.push({ path, message: `${path} cannot be validated because registered schema references are not supported` });
		return;
	}
	if (Array.isArray(schema.allOf)) schema.allOf.forEach((branch) => validate(branch, value, path, issues));
	for (const keyword of ["anyOf", "oneOf"] as const) {
		const branches = Array.isArray(schema[keyword]) ? schema[keyword] : [];
		if (branches.length === 0) continue;
		const matches = branches.filter((branch) => branchMatches(branch, value, path)).length;
		if ((keyword === "anyOf" && matches === 0) || (keyword === "oneOf" && matches !== 1)) {
			issues.push({ path, message: `${path} must match ${keyword === "anyOf" ? "at least" : "exactly"} one schema branch` });
			return;
		}
	}
	if (schema.not !== undefined && branchMatches(schema.not, value, path)) {
		issues.push({ path, message: `${path} must not match the excluded schema` });
	}
	if (schema.if !== undefined) {
		const selected = branchMatches(schema.if, value, path) ? schema.then : schema.else;
		if (selected !== undefined) validate(selected, value, path, issues);
	}
	if (Object.prototype.hasOwnProperty.call(schema, "const") && !equal(value, schema.const)) {
		issues.push({ path, message: `${path} must equal ${JSON.stringify(schema.const)}` });
	}
	if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => equal(candidate, value))) {
		issues.push({ path, message: `${path} is outside the allowed enum` });
	}
	const types = typeof schema.type === "string" ? [schema.type] : Array.isArray(schema.type)
		? schema.type.filter((item): item is string => typeof item === "string") : [];
	if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
		issues.push({ path, message: `${path} must be ${types.join(" | ")}` });
		return;
	}
	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push({ path, message: `${path} is shorter than ${schema.minLength}` });
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) issues.push({ path, message: `${path} is longer than ${schema.maxLength}` });
		if (typeof schema.pattern === "string" && !validPattern(value, schema.pattern, path, issues)) {
			issues.push({ path, message: `${path} does not match the required pattern` });
		}
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path, message: `${path} must be >= ${schema.minimum}` });
		if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path, message: `${path} must be <= ${schema.maximum}` });
		if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) issues.push({ path, message: `${path} must be > ${schema.exclusiveMinimum}` });
		if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) issues.push({ path, message: `${path} must be < ${schema.exclusiveMaximum}` });
		if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
			const quotient = value / schema.multipleOf;
			if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8) {
				issues.push({ path, message: `${path} must be a multiple of ${schema.multipleOf}` });
			}
		}
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push({ path, message: `${path} has too few items` });
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems) issues.push({ path, message: `${path} has too many items` });
		if (schema.uniqueItems === true) {
			for (let index = 0; index < value.length; index += 1) {
				if (value.slice(0, index).some((candidate) => equal(candidate, value[index]))) {
					issues.push({ path: `${path}[${index}]`, message: `${path}[${index}] must be unique` });
				}
			}
		}
		const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
		prefixItems.forEach((itemSchema, index) => {
			if (index < value.length) validate(itemSchema, value[index], `${path}[${index}]`, issues);
		});
		if (Array.isArray(schema.items)) {
			schema.items.forEach((itemSchema, index) => {
				if (index < value.length) validate(itemSchema, value[index], `${path}[${index}]`, issues);
			});
		} else if (schema.items !== undefined) {
			value.slice(prefixItems.length).forEach((item, offset) => validate(schema.items, item, `${path}[${offset + prefixItems.length}]`, issues));
		}
		if (schema.contains !== undefined) {
			const matchingItems = value.filter((item, index) => branchMatches(schema.contains, item, `${path}[${index}]`)).length;
			const minimumMatches = typeof schema.minContains === "number" ? schema.minContains : 1;
			const maximumMatches = typeof schema.maxContains === "number" ? schema.maxContains : Number.POSITIVE_INFINITY;
			if (matchingItems < minimumMatches || matchingItems > maximumMatches) {
				issues.push({ path, message: `${path} must contain between ${minimumMatches} and ${maximumMatches} matching items` });
			}
		}
		return;
	}
	const objectValue = record(value);
	if (!objectValue) return;
	const objectKeys = Object.keys(objectValue);
	if (typeof schema.minProperties === "number" && objectKeys.length < schema.minProperties) issues.push({ path, message: `${path} has too few properties` });
	if (typeof schema.maxProperties === "number" && objectKeys.length > schema.maxProperties) issues.push({ path, message: `${path} has too many properties` });
	const properties = record(schema.properties) ?? {};
	const patternProperties = record(schema.patternProperties) ?? {};
	const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(objectValue, key)) issues.push({ path: `${path}.${key}`, message: `${path}.${key} is required` });
	}
	const dependentRequired = record(schema.dependentRequired) ?? {};
	for (const [key, dependencies] of Object.entries(dependentRequired)) {
		if (!Object.prototype.hasOwnProperty.call(objectValue, key) || !Array.isArray(dependencies)) continue;
		for (const dependency of dependencies) {
			if (typeof dependency === "string" && !Object.prototype.hasOwnProperty.call(objectValue, dependency)) {
				issues.push({ path: `${path}.${dependency}`, message: `${path}.${dependency} is required when ${path}.${key} is present` });
			}
		}
	}
	for (const [key, child] of Object.entries(objectValue)) {
		if (schema.propertyNames !== undefined) validate(schema.propertyNames, key, `${path}.${key}`, issues);
		const matchingPatterns = Object.entries(patternProperties).filter(([pattern]) => validPattern(key, pattern, `${path}.${key}`, issues));
		if (properties[key] !== undefined) validate(properties[key], child, `${path}.${key}`, issues);
		matchingPatterns.forEach(([, childSchema]) => validate(childSchema, child, `${path}.${key}`, issues));
		if (properties[key] === undefined && matchingPatterns.length === 0) {
			if (schema.additionalProperties === false) issues.push({ path: `${path}.${key}`, message: `${path}.${key} is not allowed` });
			else if (record(schema.additionalProperties)) validate(schema.additionalProperties, child, `${path}.${key}`, issues);
		}
	}
}

export function validateWorkflowToolArguments(schema: Record<string, unknown>, value: unknown): WorkflowJsonSchemaIssue[] {
	const issues = findUnsupportedWorkflowToolSchemaKeywords(schema);
	if (issues.length > 0) return issues;
	validate(schema, value, "$", issues);
	return issues;
}
