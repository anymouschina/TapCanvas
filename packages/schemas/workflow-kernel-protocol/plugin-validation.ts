import {
	WORKFLOW_PLUGIN_PERMISSIONS,
	WORKFLOW_PLUGIN_SCHEMA_TYPES,
	type WorkflowPluginJsonValue,
	type WorkflowPluginPermission,
	type WorkflowPluginSchemaType,
	type WorkflowPluginValueSchemaV1,
} from "./plugin-types";

const MAX_SCHEMA_DEPTH = 16;
const MAX_SCHEMA_NODES = 512;
const MAX_SCHEMA_PROPERTIES = 128;
const MAX_VALUE_NODES = 4_096;
const MAX_TEXT_CHARS = 2_000;
const MAX_ID_CHARS = 128;

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const ENTRYPOINT_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type MutableSchemaBudget = { nodes: number };

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

export function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], field: string): void {
	const allowed = new Set(keys);
	const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
	if (unknownKey) throw new Error(`${field}.${unknownKey} is not supported`);
}

export function requireString(value: unknown, field: string, maxChars = MAX_TEXT_CHARS): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	const normalized = value.trim();
	if (normalized.length > maxChars) throw new Error(`${field} exceeds ${maxChars} characters`);
	return normalized;
}

export function requireIdentifier(value: unknown, field: string): string {
	const identifier = requireString(value, field, MAX_ID_CHARS);
	if (!IDENTIFIER_PATTERN.test(identifier)) throw new Error(`${field} must be a lowercase namespaced identifier`);
	return identifier;
}

export function requireFieldName(value: unknown, field: string): string {
	const name = requireString(value, field, MAX_ID_CHARS);
	if (!FIELD_NAME_PATTERN.test(name)) throw new Error(`${field} must be a JSON field or port identifier`);
	return name;
}

export function requireEntrypoint(value: unknown, field: string): string {
	const entrypoint = requireString(value, field, MAX_ID_CHARS);
	if (!ENTRYPOINT_PATTERN.test(entrypoint)) throw new Error(`${field} must be a registered runtime identifier, not a URL`);
	return entrypoint;
}

export function requireSemver(value: unknown, field: string): string {
	const version = requireString(value, field, 64);
	if (!SEMVER_PATTERN.test(version)) throw new Error(`${field} must be an exact semantic version`);
	return version;
}

export function requirePositiveInteger(value: unknown, field: string): number {
	if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive integer`);
	return Number(value);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
	if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`);
	return Number(value);
}

function requireFiniteNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
	return value;
}

export function uniqueStrings(values: readonly string[], field: string): readonly string[] {
	if (new Set(values).size !== values.length) throw new Error(`${field} must not contain duplicates`);
	return values;
}

function isPermission(value: unknown): value is WorkflowPluginPermission {
	return typeof value === "string" && WORKFLOW_PLUGIN_PERMISSIONS.some((permission) => permission === value);
}

export function parsePermissions(value: unknown, field: string): readonly WorkflowPluginPermission[] {
	if (!Array.isArray(value) || value.some((permission) => !isPermission(permission))) {
		throw new Error(`${field} must contain only supported workflow plugin permissions`);
	}
	return uniqueStrings(value, field) as readonly WorkflowPluginPermission[];
}

function parseJsonValue(value: unknown, field: string, depth = 0): WorkflowPluginJsonValue {
	if (depth > MAX_SCHEMA_DEPTH) throw new Error(`${field} exceeds maximum JSON depth`);
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${field} must contain finite JSON numbers`);
		return value;
	}
	if (Array.isArray(value)) return value.map((item, index) => parseJsonValue(item, `${field}[${index}]`, depth + 1));
	const record = requireRecord(value, field);
	const output: Record<string, WorkflowPluginJsonValue> = {};
	for (const [key, item] of Object.entries(record)) output[key] = parseJsonValue(item, `${field}.${key}`, depth + 1);
	return output;
}

function isSchemaType(value: unknown): value is WorkflowPluginSchemaType {
	return typeof value === "string" && WORKFLOW_PLUGIN_SCHEMA_TYPES.some((type) => type === value);
}

function jsonValueMatchesType(value: WorkflowPluginJsonValue, type: WorkflowPluginSchemaType): boolean {
	if (type === "null") return value === null;
	if (type === "boolean") return typeof value === "boolean";
	if (type === "number") return typeof value === "number";
	if (type === "integer") return typeof value === "number" && Number.isInteger(value);
	if (type === "string") return typeof value === "string";
	if (type === "array") return Array.isArray(value);
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJsonIdentity(value: WorkflowPluginJsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJsonIdentity).join(",")}]`;
	const record = value as Readonly<Record<string, WorkflowPluginJsonValue>>;
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJsonIdentity(record[key])}`).join(",")}}`;
}

function freezeJsonValue(value: WorkflowPluginJsonValue): WorkflowPluginJsonValue {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) freezeJsonValue(child);
	}
	return value;
}

function optionalString(record: Record<string, unknown>, key: string, field: string): string | undefined {
	return record[key] === undefined ? undefined : requireString(record[key], `${field}.${key}`);
}

export function parseValueSchema(
	value: unknown,
	field: string,
	budget: MutableSchemaBudget = { nodes: 0 },
	depth = 0,
	requireClosedObject = false,
): WorkflowPluginValueSchemaV1 {
	if (depth > MAX_SCHEMA_DEPTH) throw new Error(`${field} exceeds maximum schema depth`);
	budget.nodes += 1;
	if (budget.nodes > MAX_SCHEMA_NODES) throw new Error(`${field} exceeds maximum schema node count`);
	const record = requireRecord(value, field);
	assertExactKeys(record, [
		"type", "title", "description", "enum", "properties", "required", "additionalProperties",
		"items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
	], field);
	if (!isSchemaType(record.type)) throw new Error(`${field}.type is not supported`);
	const type = record.type;
	const schema: {
		type: WorkflowPluginSchemaType;
		title?: string;
		description?: string;
		enum?: readonly WorkflowPluginJsonValue[];
		properties?: Readonly<Record<string, WorkflowPluginValueSchemaV1>>;
		required?: readonly string[];
		additionalProperties?: false;
		items?: WorkflowPluginValueSchemaV1;
		minItems?: number;
		maxItems?: number;
		minLength?: number;
		maxLength?: number;
		minimum?: number;
		maximum?: number;
	} = { type };
	const title = optionalString(record, "title", field);
	const description = optionalString(record, "description", field);
	if (title !== undefined) schema.title = title;
	if (description !== undefined) schema.description = description;
	if (record.enum !== undefined) {
		if (!Array.isArray(record.enum) || record.enum.length < 1 || record.enum.length > 128) {
			throw new Error(`${field}.enum must contain 1..128 JSON values`);
		}
		const parsedEnum = record.enum.map((item, index) => parseJsonValue(item, `${field}.enum[${index}]`));
		if (parsedEnum.some((item) => !jsonValueMatchesType(item, type))) {
			throw new Error(`${field}.enum contains a value outside schema type ${type}`);
		}
		const identities = parsedEnum.map(stableJsonIdentity);
		if (new Set(identities).size !== identities.length) throw new Error(`${field}.enum must not contain duplicates`);
		schema.enum = parsedEnum;
	}
	if (type === "object") {
		const entries = Object.entries(requireRecord(record.properties, `${field}.properties`));
		if (entries.length > MAX_SCHEMA_PROPERTIES) throw new Error(`${field}.properties exceeds ${MAX_SCHEMA_PROPERTIES} entries`);
		const properties: Record<string, WorkflowPluginValueSchemaV1> = {};
		for (const [key, item] of entries) {
			const propertyName = requireFieldName(key, `${field}.properties key`);
			properties[propertyName] = parseValueSchema(item, `${field}.properties.${propertyName}`, budget, depth + 1);
		}
		if (!Array.isArray(record.required) || record.required.some((item) => typeof item !== "string")) {
			throw new Error(`${field}.required must be a string array`);
		}
		const required = uniqueStrings(record.required.map((item) => requireFieldName(item, `${field}.required`)), `${field}.required`);
		const missingProperty = required.find((property) => !Object.prototype.hasOwnProperty.call(properties, property));
		if (missingProperty) throw new Error(`${field}.required references undeclared property ${missingProperty}`);
		if (record.additionalProperties !== false) throw new Error(`${field}.additionalProperties must be false`);
		schema.properties = properties;
		schema.required = required;
		schema.additionalProperties = false;
	} else {
		if (record.properties !== undefined || record.required !== undefined || record.additionalProperties !== undefined) {
			throw new Error(`${field} uses object-only schema fields`);
		}
		if (requireClosedObject) throw new Error(`${field} must be a closed object schema`);
	}
	if (type === "array") {
		schema.items = parseValueSchema(record.items, `${field}.items`, budget, depth + 1);
		const minItems = record.minItems === undefined ? 0 : requireNonNegativeInteger(record.minItems, `${field}.minItems`);
		const maxItems = record.maxItems === undefined ? 1_000 : requireNonNegativeInteger(record.maxItems, `${field}.maxItems`);
		if (maxItems < minItems || maxItems > 1_000) throw new Error(`${field} has invalid item bounds`);
		schema.minItems = minItems;
		schema.maxItems = maxItems;
	} else if (record.items !== undefined || record.minItems !== undefined || record.maxItems !== undefined) {
		throw new Error(`${field} uses array-only schema fields`);
	}
	if (type === "string") {
		const minLength = record.minLength === undefined ? 0 : requireNonNegativeInteger(record.minLength, `${field}.minLength`);
		const maxLength = record.maxLength === undefined ? 65_536 : requireNonNegativeInteger(record.maxLength, `${field}.maxLength`);
		if (maxLength < minLength || maxLength > 65_536) throw new Error(`${field} has invalid string bounds`);
		schema.minLength = minLength;
		schema.maxLength = maxLength;
	} else if (record.minLength !== undefined || record.maxLength !== undefined) {
		throw new Error(`${field} uses string-only schema fields`);
	}
	if (type === "number" || type === "integer") {
		const minimum = record.minimum === undefined ? undefined : requireFiniteNumber(record.minimum, `${field}.minimum`);
		const maximum = record.maximum === undefined ? undefined : requireFiniteNumber(record.maximum, `${field}.maximum`);
		if (minimum !== undefined && maximum !== undefined && maximum < minimum) throw new Error(`${field} has invalid numeric bounds`);
		if (minimum !== undefined) schema.minimum = minimum;
		if (maximum !== undefined) schema.maximum = maximum;
	} else if (record.minimum !== undefined || record.maximum !== undefined) {
		throw new Error(`${field} uses numeric-only schema fields`);
	}
	return schema;
}

export function parseClosedObjectSchema(value: unknown, field: string): WorkflowPluginValueSchemaV1 {
	return parseValueSchema(value, field, { nodes: 0 }, 0, true);
}

export function workflowPluginSchemasEqualV1(
	left: WorkflowPluginValueSchemaV1,
	right: WorkflowPluginValueSchemaV1,
): boolean {
	return stableJsonIdentity(parseJsonValue(left, "left workflow plugin schema"))
		=== stableJsonIdentity(parseJsonValue(right, "right workflow plugin schema"));
}

function validateWorkflowPluginValue(
	schema: WorkflowPluginValueSchemaV1,
	value: unknown,
	field: string,
	depth: number,
	budget: MutableSchemaBudget,
): WorkflowPluginJsonValue {
	if (depth > MAX_SCHEMA_DEPTH) throw new Error(`${field} exceeds maximum value depth`);
	budget.nodes += 1;
	if (budget.nodes > MAX_VALUE_NODES) throw new Error(`${field} exceeds maximum value node count`);
	let parsed: WorkflowPluginJsonValue;
	if (schema.type === "null") {
		if (value !== null) throw new Error(`${field} must be null`);
		parsed = null;
	} else if (schema.type === "boolean") {
		if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
		parsed = value;
	} else if (schema.type === "number" || schema.type === "integer") {
		if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
			throw new Error(`${field} must be ${schema.type}`);
		}
		parsed = value;
	} else if (schema.type === "string") {
		if (typeof value !== "string") throw new Error(`${field} must be string`);
		parsed = value;
	} else if (schema.type === "array") {
		if (!Array.isArray(value)) throw new Error(`${field} must be array`);
		if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${field} has fewer than ${schema.minItems} items`);
		if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${field} has more than ${schema.maxItems} items`);
		const itemSchema = schema.items;
		if (!itemSchema) throw new Error(`${field} schema is missing items`);
		parsed = value.map((item, index) => validateWorkflowPluginValue(itemSchema, item, `${field}[${index}]`, depth + 1, budget));
	} else {
		const record = requireRecord(value, field);
		const properties = schema.properties ?? {};
		const keys = Object.keys(record);
		if (keys.length > MAX_SCHEMA_PROPERTIES) throw new Error(`${field} exceeds maximum object field count`);
		const unknownKey = keys.find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
		if (unknownKey) throw new Error(`${field}.${unknownKey} is not declared`);
		const missingKey = (schema.required ?? []).find((key) => !Object.prototype.hasOwnProperty.call(record, key));
		if (missingKey) throw new Error(`${field}.${missingKey} is required`);
		const output: Record<string, WorkflowPluginJsonValue> = {};
		for (const key of keys) {
			const propertySchema = properties[key];
			if (!propertySchema) throw new Error(`${field}.${key} is not declared`);
			output[key] = validateWorkflowPluginValue(propertySchema, record[key], `${field}.${key}`, depth + 1, budget);
		}
		parsed = output;
	}
	if (schema.type === "string") {
		const text = parsed as string;
		if (schema.minLength !== undefined && text.length < schema.minLength) throw new Error(`${field} is shorter than ${schema.minLength}`);
		if (schema.maxLength !== undefined && text.length > schema.maxLength) throw new Error(`${field} is longer than ${schema.maxLength}`);
	}
	if (schema.type === "number" || schema.type === "integer") {
		const number = parsed as number;
		if (schema.minimum !== undefined && number < schema.minimum) throw new Error(`${field} is below ${schema.minimum}`);
		if (schema.maximum !== undefined && number > schema.maximum) throw new Error(`${field} is above ${schema.maximum}`);
	}
	if (schema.enum && !schema.enum.some((candidate) => stableJsonIdentity(candidate) === stableJsonIdentity(parsed))) {
		throw new Error(`${field} is not an allowed enum value`);
	}
	return freezeJsonValue(parsed);
}

/** Validate and defensively copy an invocation value against the admitted bounded schema. */
export function validateWorkflowPluginValueV1(
	schema: WorkflowPluginValueSchemaV1,
	value: unknown,
	field = "workflow plugin value",
): WorkflowPluginJsonValue {
	return validateWorkflowPluginValue(schema, value, field, 0, { nodes: 0 });
}
