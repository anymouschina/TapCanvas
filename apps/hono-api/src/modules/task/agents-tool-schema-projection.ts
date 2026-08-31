export type ToolSchemaSelector = {
	field: string;
	value: string;
};

export type ToolSchemaOperationIndex = {
	field: string;
	values: string[];
};

export type ToolOperationExecution = {
	sideEffect: "none" | "local_mutation" | "external_mutation" | "paid_generation";
	retrySafety: "safe" | "unsafe" | "idempotency_key_required";
	executionMode: "parallel_safe" | "sequential" | "exclusive";
	idempotencyKeyField: string | null;
	resultLookupSupported: boolean;
};

type JsonObject = Record<string, unknown>;

function readObject(value: unknown): JsonObject | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function readStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function branchAcceptsSelector(branch: JsonObject, selector: ToolSchemaSelector): boolean {
	const properties = readObject(branch.properties);
	const discriminator = readObject(properties?.[selector.field]);
	if (!discriminator) return false;
	if (discriminator.const === selector.value) return true;
	return Array.isArray(discriminator.enum) && discriminator.enum.includes(selector.value);
}

function readEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
	return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

/**
 * Read execution semantics declared by the exact structural operation branch.
 *
 * Multi-operation tools can mix pure reads and mutations. Treating the whole
 * facade as mutating makes a durable ready-frontier incorrectly reject the
 * read nodes needed for revision-fenced repair. The metadata is declared next
 * to the operation schema and is never inferred from prompt text or intent.
 */
export function readToolOperationExecution(input: {
	parameters: JsonObject;
	selector: ToolSchemaSelector;
}): ToolOperationExecution | null {
	const branches = Array.isArray(input.parameters.oneOf)
		? input.parameters.oneOf.map(readObject).filter((branch): branch is JsonObject => branch !== null)
		: [];
	const branch = branches.find((candidate) => branchAcceptsSelector(candidate, input.selector));
	const execution = readObject(branch?.xExecution);
	if (!execution) return null;
	const sideEffect = readEnumValue(execution.sideEffect, ["none", "local_mutation", "external_mutation", "paid_generation"] as const);
	const retrySafety = readEnumValue(execution.retrySafety, ["safe", "unsafe", "idempotency_key_required"] as const);
	const executionMode = readEnumValue(execution.executionMode, ["parallel_safe", "sequential", "exclusive"] as const);
	if (!sideEffect || !retrySafety || !executionMode || typeof execution.resultLookupSupported !== "boolean") {
		throw new Error(
			`tool_operation_execution_invalid: ${input.selector.field}=${input.selector.value}`,
		);
	}
	const idempotencyKeyField = execution.idempotencyKeyField;
	if (idempotencyKeyField !== null && typeof idempotencyKeyField !== "string") {
		throw new Error(
			`tool_operation_execution_invalid: ${input.selector.field}=${input.selector.value}`,
		);
	}
	return {
		sideEffect,
		retrySafety,
		executionMode,
		idempotencyKeyField,
		resultLookupSupported: execution.resultLookupSupported,
	};
}

function readStringLiterals(value: unknown): string[] {
	const schema = readObject(value);
	if (!schema) return [];
	if (typeof schema.const === "string" && schema.const.trim()) return [schema.const.trim()];
	return readStrings(schema.enum);
}

/**
 * Discover a discriminator only from the schema's own branch literals.
 *
 * A valid operation discriminator must exist in every branch and expose at
 * least two distinct string literals. A branch may intentionally group several
 * operations under one shared structural contract, so values are not required
 * to be one-to-one with branches. This deliberately ignores tool names,
 * prompts, descriptions and business vocabulary.
 */
export function readToolSchemaOperationIndex(parameters: JsonObject): ToolSchemaOperationIndex | null {
	const branches = Array.isArray(parameters.oneOf)
		? parameters.oneOf.map(readObject).filter((branch): branch is JsonObject => branch !== null)
		: [];
	if (branches.length < 2) return null;
	const firstProperties = readObject(branches[0]?.properties) ?? {};
	const candidateFields = Object.keys(firstProperties).sort((left, right) => left.localeCompare(right));
	for (const field of candidateFields) {
		const valuesByBranch = branches.map((branch) => {
			const properties = readObject(branch.properties) ?? {};
			return readStringLiterals(properties[field]);
		});
		if (valuesByBranch.some((values) => values.length === 0)) continue;
		const values = Array.from(new Set(valuesByBranch.flat()));
		if (values.length < 2) continue;
		return { field, values };
	}
	return null;
}

export function buildToolOperationIndexParameters(input: {
	parameters: JsonObject;
	index: ToolSchemaOperationIndex;
}): JsonObject {
	return {
		type: "object",
		description:
			`This tool has multiple structurally distinct operations. No executable operation schema is loaded yet. ` +
			`Call tapcanvas_get_tool_schema again with selector {field:'${input.index.field}',value:<one listed value>}; do not call the target tool before that exact schema is returned.`,
		properties: {},
		required: [],
		additionalProperties: false,
	};
}

/**
 * Project a multi-operation JSON schema to one discriminator branch.
 *
 * This is deliberately structural: it never infers user intent or inspects
 * prompt text. The caller supplies an exact field/value pair and unsupported
 * selectors fail explicitly. `xOptionalProperties` is a local schema extension
 * used only to retain operation-specific optional fields without duplicating
 * their full definitions in every `oneOf` branch.
 */
export function projectToolParametersBySelector(input: {
	parameters: JsonObject;
	selector?: ToolSchemaSelector;
}): JsonObject {
	if (!input.selector) return input.parameters;
	const field = input.selector.field.trim();
	const value = input.selector.value.trim();
	if (!field || !value) throw new Error("tool_schema_selector_invalid");

	const branches = Array.isArray(input.parameters.oneOf)
		? input.parameters.oneOf.map(readObject).filter((branch): branch is JsonObject => branch !== null)
		: [];
	const branch = branches.find((candidate) =>
		branchAcceptsSelector(candidate, { field, value }),
	);
	if (!branch) {
		const operationIndex = readToolSchemaOperationIndex(input.parameters);
		const available = operationIndex
			? `; operationIndex.field=${operationIndex.field}; operationIndex.values=[${operationIndex.values.join(",")}]`
			: "";
		throw new Error(
			`tool_schema_selector_not_found: ${field}=${value}${available}; ` +
			"first call tapcanvas_get_tool_schema without selector, then copy one exact returned field/value pair",
		);
	}

	const globalProperties = readObject(input.parameters.properties) ?? {};
	const branchProperties = readObject(branch.properties) ?? {};
	const required = Array.from(new Set([
		...readStrings(branch.required),
		field,
	]));
	const optional = readStrings(branch.xOptionalProperties);
	const propertyNames = Array.from(new Set([
		...required,
		...optional,
		...Object.keys(branchProperties),
	]));
	const properties: JsonObject = {};
	for (const propertyName of propertyNames) {
		if (propertyName === field) {
			properties[propertyName] = { type: "string", const: value };
			continue;
		}
		const property = branchProperties[propertyName] ?? globalProperties[propertyName];
		if (property !== undefined) properties[propertyName] = property;
	}

	const missingDefinitions = required.filter((propertyName) => properties[propertyName] === undefined);
	if (missingDefinitions.length > 0) {
		throw new Error(
			`tool_schema_selector_incomplete: ${field}=${value} missing=${missingDefinitions.join(",")}`,
		);
	}

	return {
		type: "object",
		description:
			typeof input.parameters.description === "string"
				? `${input.parameters.description} Selected operation: ${field}=${value}.`
				: `Selected operation: ${field}=${value}.`,
		properties,
		required,
		additionalProperties: false,
	};
}
