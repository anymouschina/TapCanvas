export const WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION = "workflow.plugin-manifest/v1" as const;

export const WORKFLOW_PLUGIN_RUNTIME_OWNER_KINDS = ["host", "agents-cli", "hono-api", "isolated-worker"] as const;
export type WorkflowPluginRuntimeOwnerKind = (typeof WORKFLOW_PLUGIN_RUNTIME_OWNER_KINDS)[number];

export const WORKFLOW_PLUGIN_PERMISSIONS = [
	"project:read",
	"project:write",
	"canvas:read",
	"canvas:write",
	"asset:read",
	"asset:write",
	"network:egress",
	"media:generate:paid",
	"user:interaction",
	"workflow:invoke",
] as const;
export type WorkflowPluginPermission = (typeof WORKFLOW_PLUGIN_PERMISSIONS)[number];

export const WORKFLOW_PLUGIN_NODE_CATEGORIES = [
	"trigger",
	"source",
	"agent",
	"media",
	"skill",
	"tool",
	"control",
	"artifact",
	"delivery",
	"subworkflow",
] as const;
export type WorkflowPluginNodeCategory = (typeof WORKFLOW_PLUGIN_NODE_CATEGORIES)[number];

export const WORKFLOW_PLUGIN_SIDE_EFFECTS = ["none", "local_mutation", "external_mutation", "paid_generation"] as const;
export type WorkflowPluginSideEffect = (typeof WORKFLOW_PLUGIN_SIDE_EFFECTS)[number];

export const WORKFLOW_PLUGIN_RETRY_SAFETY = ["safe", "idempotency_key_required", "unsafe"] as const;
export type WorkflowPluginRetrySafety = (typeof WORKFLOW_PLUGIN_RETRY_SAFETY)[number];

export const WORKFLOW_PLUGIN_EXECUTION_MODES = ["parallel_safe", "sequential", "exclusive"] as const;
export type WorkflowPluginExecutionMode = (typeof WORKFLOW_PLUGIN_EXECUTION_MODES)[number];

export const WORKFLOW_PLUGIN_RESULT_LOOKUP_MODES = ["none", "idempotency_key", "provider_receipt"] as const;
export type WorkflowPluginResultLookupMode = (typeof WORKFLOW_PLUGIN_RESULT_LOOKUP_MODES)[number];

export const WORKFLOW_PLUGIN_SCHEMA_TYPES = ["null", "boolean", "number", "integer", "string", "array", "object"] as const;
export type WorkflowPluginSchemaType = (typeof WORKFLOW_PLUGIN_SCHEMA_TYPES)[number];

export type WorkflowPluginJsonValue =
	| string
	| number
	| boolean
	| null
	| readonly WorkflowPluginJsonValue[]
	| Readonly<{ [key: string]: WorkflowPluginJsonValue }>;

/** Bounded JSON Schema subset: no references, custom keywords or regular expressions. */
export type WorkflowPluginValueSchemaV1 = Readonly<{
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
}>;

export type WorkflowPluginRuntimeOwnerV1 = Readonly<{
	kind: WorkflowPluginRuntimeOwnerKind;
	/** Trusted runtime registration identity. It is not a URL and cannot select a transport. */
	ownerId: string;
	runtimeVersion: string;
}>;

export type WorkflowPluginCapabilityExecutionV1 = Readonly<{
	sideEffect: WorkflowPluginSideEffect;
	retrySafety: WorkflowPluginRetrySafety;
	executionMode: WorkflowPluginExecutionMode;
	idempotencyKeyInput: string | null;
	resultLookup: WorkflowPluginResultLookupMode;
	/** Required output field when resultLookup is provider_receipt; otherwise null. */
	resultLookupKeyOutput: string | null;
}>;

export type WorkflowPluginCapabilityV1 = Readonly<{
	capabilityId: string;
	capabilityVersion: number;
	title: string;
	description: string;
	/** Runtime-owned identifier, resolved only inside the admitted runtime owner. */
	entrypoint: string;
	requiredPermissions: readonly WorkflowPluginPermission[];
	inputSchema: WorkflowPluginValueSchemaV1;
	outputSchema: WorkflowPluginValueSchemaV1;
	execution: WorkflowPluginCapabilityExecutionV1;
}>;

export type WorkflowPluginCapabilityRefV1 = Readonly<{
	capabilityId: string;
	capabilityVersion: number;
}>;

export type WorkflowPluginPortDefinitionV1 = Readonly<{
	portId: string;
	label: string;
	required: boolean;
	cardinality: "one" | "many";
	valueSchema: WorkflowPluginValueSchemaV1;
}>;

export type WorkflowPluginNodeDefinitionV1 = Readonly<{
	/** Catalog identity. A workflow instance still carries its own nodeId and frozen config. */
	nodeType: string;
	nodeVersion: number;
	title: string;
	description: string;
	category: WorkflowPluginNodeCategory;
	capability: WorkflowPluginCapabilityRefV1;
	requiredPermissions: readonly WorkflowPluginPermission[];
	configSchema: WorkflowPluginValueSchemaV1;
	inputPorts: readonly WorkflowPluginPortDefinitionV1[];
	outputPorts: readonly WorkflowPluginPortDefinitionV1[];
}>;

export type WorkflowPluginManifestV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION;
	pluginId: string;
	pluginVersion: string;
	displayName: string;
	description: string;
	runtimeOwner: WorkflowPluginRuntimeOwnerV1;
	permissions: readonly WorkflowPluginPermission[];
	capabilities: readonly WorkflowPluginCapabilityV1[];
	nodeDefinitions: readonly WorkflowPluginNodeDefinitionV1[];
}>;

export type WorkflowPluginAdmissionV1 = Readonly<{
	pluginId: string;
	pluginVersion: string;
	runtimeOwner: WorkflowPluginRuntimeOwnerV1;
	grantedPermissions: readonly WorkflowPluginPermission[];
}>;

export type WorkflowPluginAuthorizationResult =
	| Readonly<{ authorized: true }>
	| Readonly<{
		authorized: false;
		code:
			| "plugin_identity_mismatch"
			| "plugin_version_mismatch"
			| "runtime_owner_mismatch"
			| "permission_not_granted";
		message: string;
	}>;

export const WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION = "workflow.plugin-executor/v1" as const;
export const WORKFLOW_PLUGIN_EXECUTOR_REF_PREFIX = `${WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION}/` as const;

/** Fully pinned identity stored by every instantiated plugin workflow node. */
export type WorkflowPluginExecutorRefV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_PLUGIN_EXECUTOR_REF_PROTOCOL_VERSION;
	pluginId: string;
	pluginVersion: string;
	nodeType: string;
	nodeVersion: number;
	capabilityId: string;
	capabilityVersion: number;
}>;

export type InstantiateWorkflowPluginNodeDefinitionV1Input = Readonly<{
	manifest: WorkflowPluginManifestV1;
	nodeId: string;
	nodeType: string;
	nodeVersion: number;
	config: unknown;
}>;
