import {
	WORKFLOW_PLUGIN_EXECUTION_MODES,
	WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
	WORKFLOW_PLUGIN_NODE_CATEGORIES,
	WORKFLOW_PLUGIN_RESULT_LOOKUP_MODES,
	WORKFLOW_PLUGIN_RETRY_SAFETY,
	WORKFLOW_PLUGIN_RUNTIME_OWNER_KINDS,
	WORKFLOW_PLUGIN_SIDE_EFFECTS,
	type WorkflowPluginAdmissionV1,
	type WorkflowPluginAuthorizationResult,
	type WorkflowPluginCapabilityExecutionV1,
	type WorkflowPluginCapabilityRefV1,
	type WorkflowPluginCapabilityV1,
	type WorkflowPluginExecutionMode,
	type WorkflowPluginManifestV1,
	type WorkflowPluginNodeCategory,
	type WorkflowPluginNodeDefinitionV1,
	type WorkflowPluginPermission,
	type WorkflowPluginPortDefinitionV1,
	type WorkflowPluginResultLookupMode,
	type WorkflowPluginRetrySafety,
	type WorkflowPluginRuntimeOwnerKind,
	type WorkflowPluginRuntimeOwnerV1,
	type WorkflowPluginSideEffect,
	type WorkflowPluginExecutorRefV1,
	type InstantiateWorkflowPluginNodeDefinitionV1Input,
	WORKFLOW_PLUGIN_EXECUTOR_REF_PREFIX,
	WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION,
} from "./plugin-types";
import type { WorkflowNodeDefinitionV1, WorkflowPortDefinitionV1 } from "./index";
import {
	assertExactKeys,
	parseClosedObjectSchema,
	parsePermissions,
	parseValueSchema,
	requireEntrypoint,
	requireFieldName,
	requireIdentifier,
	requirePositiveInteger,
	requireRecord,
	requireSemver,
	requireString,
	uniqueStrings,
	validateWorkflowPluginValueV1,
	workflowPluginSchemasEqualV1,
} from "./plugin-validation";

export * from "./plugin-types";
export { validateWorkflowPluginValueV1 } from "./plugin-validation";

const MAX_MANIFEST_SERIALIZED_CHARS = 262_144;
const MAX_CAPABILITIES = 128;
const MAX_NODE_DEFINITIONS = 256;
const MAX_PORTS = 64;

function parseRuntimeOwner(value: unknown, field: string): WorkflowPluginRuntimeOwnerV1 {
	const record = requireRecord(value, field);
	assertExactKeys(record, ["kind", "ownerId", "runtimeVersion"], field);
	if (!WORKFLOW_PLUGIN_RUNTIME_OWNER_KINDS.some((kind) => kind === record.kind)) {
		throw new Error(`${field}.kind is not supported`);
	}
	return {
		kind: record.kind as WorkflowPluginRuntimeOwnerKind,
		ownerId: requireIdentifier(record.ownerId, `${field}.ownerId`),
		runtimeVersion: requireSemver(record.runtimeVersion, `${field}.runtimeVersion`),
	};
}

function parseExecution(value: unknown, field: string): WorkflowPluginCapabilityExecutionV1 {
	const record = requireRecord(value, field);
	assertExactKeys(record, [
		"sideEffect",
		"retrySafety",
		"executionMode",
		"idempotencyKeyInput",
		"resultLookup",
		"resultLookupKeyOutput",
	], field);
	if (!WORKFLOW_PLUGIN_SIDE_EFFECTS.some((item) => item === record.sideEffect)) throw new Error(`${field}.sideEffect is invalid`);
	if (!WORKFLOW_PLUGIN_RETRY_SAFETY.some((item) => item === record.retrySafety)) throw new Error(`${field}.retrySafety is invalid`);
	if (!WORKFLOW_PLUGIN_EXECUTION_MODES.some((item) => item === record.executionMode)) throw new Error(`${field}.executionMode is invalid`);
	if (!WORKFLOW_PLUGIN_RESULT_LOOKUP_MODES.some((item) => item === record.resultLookup)) throw new Error(`${field}.resultLookup is invalid`);
	const idempotencyKeyInput = record.idempotencyKeyInput === null
		? null
		: requireFieldName(record.idempotencyKeyInput, `${field}.idempotencyKeyInput`);
	const resultLookupKeyOutput = record.resultLookupKeyOutput === null
		? null
		: requireFieldName(record.resultLookupKeyOutput, `${field}.resultLookupKeyOutput`);
	if (record.retrySafety === "idempotency_key_required" && idempotencyKeyInput === null) {
		throw new Error(`${field} requires an idempotency key input`);
	}
	if (record.retrySafety !== "idempotency_key_required" && idempotencyKeyInput !== null) {
		throw new Error(`${field} declares an idempotency key without idempotency-key retry safety`);
	}
	if (record.resultLookup === "idempotency_key" && idempotencyKeyInput === null) {
		throw new Error(`${field} idempotency-key result lookup requires an idempotency key input`);
	}
	if ((record.resultLookup === "provider_receipt") !== (resultLookupKeyOutput !== null)) {
		throw new Error(`${field} provider-receipt lookup requires exactly one result lookup key output`);
	}
	return {
		sideEffect: record.sideEffect as WorkflowPluginSideEffect,
		retrySafety: record.retrySafety as WorkflowPluginRetrySafety,
		executionMode: record.executionMode as WorkflowPluginExecutionMode,
		idempotencyKeyInput,
		resultLookup: record.resultLookup as WorkflowPluginResultLookupMode,
		resultLookupKeyOutput,
	};
}

function parseCapability(value: unknown, index: number): WorkflowPluginCapabilityV1 {
	const field = `workflow plugin capabilities[${index}]`;
	const record = requireRecord(value, field);
	assertExactKeys(record, [
		"capabilityId",
		"capabilityVersion",
		"title",
		"description",
		"entrypoint",
		"requiredPermissions",
		"inputSchema",
		"outputSchema",
		"execution",
	], field);
	const inputSchema = parseClosedObjectSchema(record.inputSchema, `${field}.inputSchema`);
	const outputSchema = parseClosedObjectSchema(record.outputSchema, `${field}.outputSchema`);
	const execution = parseExecution(record.execution, `${field}.execution`);
	const requiredPermissions = parsePermissions(record.requiredPermissions, `${field}.requiredPermissions`);
	const idempotencyKeyInput = execution.idempotencyKeyInput;
	const idempotencyKeySchema = idempotencyKeyInput ? inputSchema.properties?.[idempotencyKeyInput] : undefined;
	if (idempotencyKeyInput && !idempotencyKeySchema) {
		throw new Error(`${field} idempotency key input is not declared by inputSchema`);
	}
	if (idempotencyKeyInput && (idempotencyKeySchema?.type !== "string"
		|| (idempotencyKeySchema.minLength ?? 0) < 1
		|| !inputSchema.required?.includes(idempotencyKeyInput))) {
		throw new Error(`${field} idempotency key input must be a required non-empty string`);
	}
	const resultLookupKeyOutput = execution.resultLookupKeyOutput;
	const resultLookupKeySchema = resultLookupKeyOutput ? outputSchema.properties?.[resultLookupKeyOutput] : undefined;
	if (resultLookupKeyOutput && !resultLookupKeySchema) {
		throw new Error(`${field} result lookup key output is not declared by outputSchema`);
	}
	if (resultLookupKeyOutput && (resultLookupKeySchema?.type !== "string"
		|| (resultLookupKeySchema.minLength ?? 0) < 1
		|| !outputSchema.required?.includes(resultLookupKeyOutput))) {
		throw new Error(`${field} result lookup key output must be a required non-empty string`);
	}
	if (execution.sideEffect === "paid_generation") {
		if (execution.retrySafety !== "idempotency_key_required" || execution.resultLookup !== "provider_receipt") {
			throw new Error(`${field} paid generation requires idempotency and provider-receipt lookup`);
		}
		if (!requiredPermissions.includes("media:generate:paid") || !requiredPermissions.includes("network:egress")) {
			throw new Error(`${field} paid generation requires media:generate:paid and network:egress permissions`);
		}
	}
	return {
		capabilityId: requireIdentifier(record.capabilityId, `${field}.capabilityId`),
		capabilityVersion: requirePositiveInteger(record.capabilityVersion, `${field}.capabilityVersion`),
		title: requireString(record.title, `${field}.title`, 200),
		description: requireString(record.description, `${field}.description`),
		entrypoint: requireEntrypoint(record.entrypoint, `${field}.entrypoint`),
		requiredPermissions,
		inputSchema,
		outputSchema,
		execution,
	};
}

function parseCapabilityRef(value: unknown, field: string): WorkflowPluginCapabilityRefV1 {
	const record = requireRecord(value, field);
	assertExactKeys(record, ["capabilityId", "capabilityVersion"], field);
	return {
		capabilityId: requireIdentifier(record.capabilityId, `${field}.capabilityId`),
		capabilityVersion: requirePositiveInteger(record.capabilityVersion, `${field}.capabilityVersion`),
	};
}

function parsePort(value: unknown, field: string): WorkflowPluginPortDefinitionV1 {
	const record = requireRecord(value, field);
	assertExactKeys(record, ["portId", "label", "required", "cardinality", "valueSchema"], field);
	if (typeof record.required !== "boolean") throw new Error(`${field}.required must be boolean`);
	if (record.cardinality !== "one" && record.cardinality !== "many") throw new Error(`${field}.cardinality is invalid`);
	return {
		portId: requireFieldName(record.portId, `${field}.portId`),
		label: requireString(record.label, `${field}.label`, 200),
		required: record.required,
		cardinality: record.cardinality,
		valueSchema: parseValueSchema(record.valueSchema, `${field}.valueSchema`, { nodes: 0 }),
	};
}

function parsePorts(value: unknown, field: string): readonly WorkflowPluginPortDefinitionV1[] {
	if (!Array.isArray(value) || value.length > MAX_PORTS) throw new Error(`${field} must contain at most ${MAX_PORTS} ports`);
	const ports = value.map((port, index) => parsePort(port, `${field}[${index}]`));
	uniqueStrings(ports.map((port) => port.portId), `${field} port IDs`);
	return ports;
}

function parseNodeDefinition(value: unknown, index: number): WorkflowPluginNodeDefinitionV1 {
	const field = `workflow plugin nodeDefinitions[${index}]`;
	const record = requireRecord(value, field);
	assertExactKeys(record, [
		"nodeType",
		"nodeVersion",
		"title",
		"description",
		"category",
		"capability",
		"requiredPermissions",
		"configSchema",
		"inputPorts",
		"outputPorts",
	], field);
	if (!WORKFLOW_PLUGIN_NODE_CATEGORIES.some((category) => category === record.category)) {
		throw new Error(`${field}.category is invalid`);
	}
	return {
		nodeType: requireIdentifier(record.nodeType, `${field}.nodeType`),
		nodeVersion: requirePositiveInteger(record.nodeVersion, `${field}.nodeVersion`),
		title: requireString(record.title, `${field}.title`, 200),
		description: requireString(record.description, `${field}.description`),
		category: record.category as WorkflowPluginNodeCategory,
		capability: parseCapabilityRef(record.capability, `${field}.capability`),
		requiredPermissions: parsePermissions(record.requiredPermissions, `${field}.requiredPermissions`),
		configSchema: parseClosedObjectSchema(record.configSchema, `${field}.configSchema`),
		inputPorts: parsePorts(record.inputPorts, `${field}.inputPorts`),
		outputPorts: parsePorts(record.outputPorts, `${field}.outputPorts`),
	};
}

function assertPermissionSubset(
	required: readonly WorkflowPluginPermission[],
	available: ReadonlySet<WorkflowPluginPermission>,
	field: string,
): void {
	const missing = required.find((permission) => !available.has(permission));
	if (missing) throw new Error(`${field} requires undeclared permission ${missing}`);
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	}
	return value;
}

/** Parse, normalize and freeze one untrusted plugin manifest. Unknown fields fail closed. */
export function parseWorkflowPluginManifestV1(value: unknown): WorkflowPluginManifestV1 {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch (error: unknown) {
		throw new Error(`Workflow plugin manifest must be JSON-compatible: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof serialized !== "string" || serialized.length > MAX_MANIFEST_SERIALIZED_CHARS) {
		throw new Error(`Workflow plugin manifest exceeds ${MAX_MANIFEST_SERIALIZED_CHARS} serialized characters`);
	}
	const record = requireRecord(value, "workflow plugin manifest");
	assertExactKeys(record, [
		"protocolVersion",
		"pluginId",
		"pluginVersion",
		"displayName",
		"description",
		"runtimeOwner",
		"permissions",
		"capabilities",
		"nodeDefinitions",
	], "workflow plugin manifest");
	if (record.protocolVersion !== WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION) {
		throw new Error(`workflow plugin manifest protocolVersion must be ${WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION}`);
	}
	if (!Array.isArray(record.capabilities) || record.capabilities.length < 1 || record.capabilities.length > MAX_CAPABILITIES) {
		throw new Error(`workflow plugin manifest capabilities must contain 1..${MAX_CAPABILITIES} entries`);
	}
	if (!Array.isArray(record.nodeDefinitions) || record.nodeDefinitions.length < 1 || record.nodeDefinitions.length > MAX_NODE_DEFINITIONS) {
		throw new Error(`workflow plugin manifest nodeDefinitions must contain 1..${MAX_NODE_DEFINITIONS} entries`);
	}
	const permissions = parsePermissions(record.permissions, "workflow plugin manifest.permissions");
	const permissionSet = new Set(permissions);
	const capabilities = record.capabilities.map(parseCapability);
	const nodeDefinitions = record.nodeDefinitions.map(parseNodeDefinition);
	uniqueStrings(capabilities.map((capability) => `${capability.capabilityId}@${capability.capabilityVersion}`), "workflow plugin capability identities");
	uniqueStrings(nodeDefinitions.map((node) => `${node.nodeType}@${node.nodeVersion}`), "workflow plugin node definition identities");
	for (const capability of capabilities) {
		assertPermissionSubset(capability.requiredPermissions, permissionSet, `workflow plugin capability ${capability.capabilityId}`);
	}
	for (const node of nodeDefinitions) {
		assertPermissionSubset(node.requiredPermissions, permissionSet, `workflow plugin node ${node.nodeType}`);
		const capability = capabilities.find((candidate) =>
			candidate.capabilityId === node.capability.capabilityId
			&& candidate.capabilityVersion === node.capability.capabilityVersion);
		if (!capability) {
			throw new Error(`workflow plugin node ${node.nodeType} references an undeclared capability version`);
		}
		assertPermissionSubset(node.requiredPermissions, new Set(capability.requiredPermissions), `workflow plugin node ${node.nodeType}`);
		const inputProperties = capability.inputSchema.properties ?? {};
		const outputProperties = capability.outputSchema.properties ?? {};
		for (const [direction, ports, properties, required] of [
			["input", node.inputPorts, inputProperties, capability.inputSchema.required ?? []],
			["output", node.outputPorts, outputProperties, capability.outputSchema.required ?? []],
		] as const) {
			const propertyNames = Object.keys(properties);
			if (ports.length !== propertyNames.length || propertyNames.some((name) => !ports.some((port) => port.portId === name))) {
				throw new Error(`workflow plugin node ${node.nodeType} ${direction} ports must exactly match capability schema properties`);
			}
			for (const port of ports) {
				const propertySchema = properties[port.portId];
				if (!propertySchema || !workflowPluginSchemasEqualV1(port.valueSchema, propertySchema)) {
					throw new Error(`workflow plugin node ${node.nodeType} ${direction} port ${port.portId} schema differs from capability schema`);
				}
				if (port.required !== required.includes(port.portId)) {
					throw new Error(`workflow plugin node ${node.nodeType} ${direction} port ${port.portId} required flag differs from capability schema`);
				}
				if ((port.cardinality === "many") !== (propertySchema.type === "array")) {
					throw new Error(`workflow plugin node ${node.nodeType} ${direction} port ${port.portId} cardinality differs from capability schema`);
				}
			}
		}
	}
	return deepFreeze({
		protocolVersion: WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
		pluginId: requireIdentifier(record.pluginId, "workflow plugin manifest.pluginId"),
		pluginVersion: requireSemver(record.pluginVersion, "workflow plugin manifest.pluginVersion"),
		displayName: requireString(record.displayName, "workflow plugin manifest.displayName", 200),
		description: requireString(record.description, "workflow plugin manifest.description"),
		runtimeOwner: parseRuntimeOwner(record.runtimeOwner, "workflow plugin manifest.runtimeOwner"),
		permissions,
		capabilities,
		nodeDefinitions,
	});
}

/**
 * Admission is separate from parsing: a manifest's self-declared owner and permissions never
 * grant authority. The host must match them against one trusted, version-pinned registration.
 */
export function authorizeWorkflowPluginManifestV1(
	manifest: WorkflowPluginManifestV1,
	admission: WorkflowPluginAdmissionV1,
): WorkflowPluginAuthorizationResult {
	if (manifest.pluginId !== admission.pluginId) {
		return { authorized: false, code: "plugin_identity_mismatch", message: "Plugin identity is not admitted" };
	}
	if (manifest.pluginVersion !== admission.pluginVersion) {
		return { authorized: false, code: "plugin_version_mismatch", message: "Plugin version is not admitted" };
	}
	const owner = manifest.runtimeOwner;
	const expectedOwner = admission.runtimeOwner;
	if (owner.kind !== expectedOwner.kind || owner.ownerId !== expectedOwner.ownerId || owner.runtimeVersion !== expectedOwner.runtimeVersion) {
		return { authorized: false, code: "runtime_owner_mismatch", message: "Plugin runtime owner is not admitted" };
	}
	const grants = new Set(admission.grantedPermissions);
	const missingPermission = manifest.permissions.find((permission) => !grants.has(permission));
	if (missingPermission) {
		return {
			authorized: false,
			code: "permission_not_granted",
			message: `Plugin permission ${missingPermission} is not granted`,
		};
	}
	return { authorized: true };
}

export function buildWorkflowPluginExecutorRefV1(
	identity: Omit<WorkflowPluginExecutorRefV1, "protocolVersion">,
): string {
	const pluginId = requireIdentifier(identity.pluginId, "workflow plugin executorRef.pluginId");
	const pluginVersion = requireSemver(identity.pluginVersion, "workflow plugin executorRef.pluginVersion");
	const nodeType = requireIdentifier(identity.nodeType, "workflow plugin executorRef.nodeType");
	const nodeVersion = requirePositiveInteger(identity.nodeVersion, "workflow plugin executorRef.nodeVersion");
	const capabilityId = requireIdentifier(identity.capabilityId, "workflow plugin executorRef.capabilityId");
	const capabilityVersion = requirePositiveInteger(identity.capabilityVersion, "workflow plugin executorRef.capabilityVersion");
	return `${WORKFLOW_PLUGIN_EXECUTOR_REF_PREFIX}${pluginId}/${pluginVersion}/${nodeType}/${nodeVersion}/${capabilityId}/${capabilityVersion}`;
}

/** Strict parsing rejects unknown versions, missing segments and non-canonical encodings. */
export function parseWorkflowPluginExecutorRefV1(value: unknown): WorkflowPluginExecutorRefV1 {
	const executorRef = requireString(value, "workflow plugin executorRef", 768);
	const segments = executorRef.split("/");
	if (segments.length !== 8 || `${segments[0]}/${segments[1]}` !== WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION) {
		throw new Error(`workflow plugin executorRef must use ${WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION}`);
	}
	const parsed: WorkflowPluginExecutorRefV1 = {
		protocolVersion: WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION,
		pluginId: requireIdentifier(segments[2], "workflow plugin executorRef.pluginId"),
		pluginVersion: requireSemver(segments[3], "workflow plugin executorRef.pluginVersion"),
		nodeType: requireIdentifier(segments[4], "workflow plugin executorRef.nodeType"),
		nodeVersion: requirePositiveInteger(Number(segments[5]), "workflow plugin executorRef.nodeVersion"),
		capabilityId: requireIdentifier(segments[6], "workflow plugin executorRef.capabilityId"),
		capabilityVersion: requirePositiveInteger(Number(segments[7]), "workflow plugin executorRef.capabilityVersion"),
	};
	if (buildWorkflowPluginExecutorRefV1(parsed) !== executorRef) throw new Error("workflow plugin executorRef is not canonical");
	return Object.freeze(parsed);
}

export function hasWorkflowPluginExecutorRefPrefix(value: string): boolean {
	return value.startsWith(WORKFLOW_PLUGIN_EXECUTOR_REF_PREFIX);
}

function workflowPluginPortDataType(executorRef: string, direction: "input" | "output", portId: string): string {
	return `${executorRef}#${direction}/${portId}`;
}

function instantiatePorts(
	executorRef: string,
	direction: "input" | "output",
	ports: readonly WorkflowPluginPortDefinitionV1[],
): readonly WorkflowPortDefinitionV1[] {
	return ports.map((port) => Object.freeze({
		id: port.portId,
		dataType: workflowPluginPortDataType(executorRef, direction, port.portId),
		required: port.required,
		cardinality: port.cardinality,
	}));
}

/** Instantiate one exact catalog version into a persistable workflow node definition. */
export function instantiateWorkflowPluginNodeDefinitionV1(
	input: InstantiateWorkflowPluginNodeDefinitionV1Input,
): WorkflowNodeDefinitionV1 {
	const nodeId = requireString(input.nodeId, "workflow plugin node instance.nodeId", 256);
	const nodeType = requireIdentifier(input.nodeType, "workflow plugin node instance.nodeType");
	const nodeVersion = requirePositiveInteger(input.nodeVersion, "workflow plugin node instance.nodeVersion");
	const definition = input.manifest.nodeDefinitions.find((candidate) =>
		candidate.nodeType === nodeType && candidate.nodeVersion === nodeVersion);
	if (!definition) throw new Error(`workflow plugin catalog does not contain ${nodeType}@${nodeVersion}`);
	const capability = input.manifest.capabilities.find((candidate) =>
		candidate.capabilityId === definition.capability.capabilityId
		&& candidate.capabilityVersion === definition.capability.capabilityVersion);
	if (!capability) throw new Error(`workflow plugin catalog capability is missing for ${nodeType}@${nodeVersion}`);
	const executorRef = buildWorkflowPluginExecutorRefV1({
		pluginId: input.manifest.pluginId,
		pluginVersion: input.manifest.pluginVersion,
		nodeType: definition.nodeType,
		nodeVersion: definition.nodeVersion,
		capabilityId: capability.capabilityId,
		capabilityVersion: capability.capabilityVersion,
	});
	const configValue = validateWorkflowPluginValueV1(definition.configSchema, input.config, "workflow plugin node instance.config");
	if (configValue === null || typeof configValue !== "object" || Array.isArray(configValue)) {
		throw new Error("workflow plugin node instance.config must be an object");
	}
	const config = configValue as Readonly<Record<string, unknown>>;
	return deepFreeze({
		nodeId,
		nodeType: definition.nodeType,
		nodeVersion: definition.nodeVersion,
		label: definition.title,
		category: definition.category,
		inputPorts: instantiatePorts(executorRef, "input", definition.inputPorts),
		outputPorts: instantiatePorts(executorRef, "output", definition.outputPorts),
		executorRef,
		permission: {
			visibilityRoles: ["admin"],
			editRoles: ["admin"],
			runRoles: ["admin"],
		},
		config,
	});
}
