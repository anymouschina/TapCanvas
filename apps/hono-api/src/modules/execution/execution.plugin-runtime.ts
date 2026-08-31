import {
	authorizeWorkflowPluginManifestV1,
	parseWorkflowPluginExecutorRefV1,
	parseWorkflowPluginManifestV1,
	validateWorkflowPluginValueV1,
	type WorkflowPluginAdmissionV1,
	type WorkflowPluginCapabilityV1,
	type WorkflowPluginExecutorRefV1,
	type WorkflowPluginJsonValue,
	type WorkflowPluginManifestV1,
	type WorkflowPluginNodeDefinitionV1,
	type WorkflowPluginRuntimeOwnerV1,
} from "@tapcanvas/workflow-kernel-protocol";

export type WorkflowPluginRuntimeErrorCode =
	| "plugin_identity_mismatch"
	| "plugin_version_mismatch"
	| "runtime_owner_mismatch"
	| "permission_not_granted"
	| "plugin_owner_adapter_missing"
	| "plugin_catalog_already_registered"
	| "plugin_catalog_not_registered"
	| "plugin_catalog_version_mismatch"
	| "plugin_input_invalid"
	| "plugin_config_invalid"
	| "plugin_output_invalid"
	| "plugin_owner_result_invalid"
	| "plugin_receipt_missing";

export class WorkflowPluginRuntimeError extends Error {
	readonly code: WorkflowPluginRuntimeErrorCode;

	constructor(code: WorkflowPluginRuntimeErrorCode, message: string) {
		super(message);
		this.name = "WorkflowPluginRuntimeError";
		this.code = code;
	}
}

type WorkflowPluginEvidence = Readonly<Record<string, WorkflowPluginJsonValue>>;

export type WorkflowPluginOwnerExecutionRequest = Readonly<{
	executionId: string;
	nodeId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	executorRef: WorkflowPluginExecutorRefV1;
	manifest: WorkflowPluginManifestV1;
	capability: WorkflowPluginCapabilityV1;
	nodeDefinition: WorkflowPluginNodeDefinitionV1;
	input: Readonly<Record<string, WorkflowPluginJsonValue>>;
	config: Readonly<Record<string, WorkflowPluginJsonValue>>;
	idempotencyKey: string | null;
	previousEvidence: Readonly<Record<string, unknown>> | null;
	abortSignal?: AbortSignal;
}>;

export type WorkflowPluginOwnerExecutionResult =
	| Readonly<{
			status: "settled";
			output: unknown;
			evidence: WorkflowPluginEvidence;
	  }>
	| Readonly<{
			status: "accepted";
			providerReceipt: string | null;
			evidence: WorkflowPluginEvidence;
	  }>
	| Readonly<{
			status: "unknown_outcome";
			providerReceipt: string | null;
			reason: string;
			evidence: WorkflowPluginEvidence;
	  }>;

/** Adapter is owned and registered by trusted Hono bootstrap code, never selected by manifest URL. */
export type WorkflowPluginOwnerAdapter = Readonly<{
	runtimeOwner: WorkflowPluginRuntimeOwnerV1;
	execute: (request: WorkflowPluginOwnerExecutionRequest) => Promise<WorkflowPluginOwnerExecutionResult>;
}>;

export type WorkflowPluginRuntimeExecutionRequest = Readonly<{
	executorRef: string;
	executionId: string;
	nodeId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	portInputs: Readonly<Record<string, readonly unknown[]>>;
	config: unknown;
	previousEvidence: Readonly<Record<string, unknown>> | null;
	abortSignal?: AbortSignal;
}>;

type WorkflowPluginRuntimeResultBase = Readonly<{
	executorRef: WorkflowPluginExecutorRefV1;
	idempotencyKey: string | null;
	providerReceipt: string | null;
	evidence: WorkflowPluginEvidence;
}>;

export type WorkflowPluginRuntimeExecutionResult =
	| (WorkflowPluginRuntimeResultBase & Readonly<{
			status: "settled";
			output: Readonly<Record<string, WorkflowPluginJsonValue>>;
	  }>)
	| (WorkflowPluginRuntimeResultBase & Readonly<{ status: "accepted" }>)
	| (WorkflowPluginRuntimeResultBase & Readonly<{
			status: "unknown_outcome";
			reason: string;
	  }>);

type RegisteredWorkflowPluginCatalog = Readonly<{
	manifest: WorkflowPluginManifestV1;
	adapter: WorkflowPluginOwnerAdapter;
}>;

/** Durable catalog rows are decoded into this boundary before a runtime registry is exposed. */
export type WorkflowPluginCatalogRegistration = Readonly<{
	manifest: unknown;
	admission: WorkflowPluginAdmissionV1;
}>;

function runtimeOwnerKey(owner: WorkflowPluginRuntimeOwnerV1): string {
	return `${owner.kind}/${owner.ownerId}@${owner.runtimeVersion}`;
}

function catalogKey(pluginId: string, pluginVersion: string): string {
	return `${pluginId}@${pluginVersion}`;
}

function recordValue(value: WorkflowPluginJsonValue, field: string): Readonly<Record<string, WorkflowPluginJsonValue>> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as Readonly<Record<string, WorkflowPluginJsonValue>>;
}

function readNonEmptyString(
	value: unknown,
	field: string,
	code: WorkflowPluginRuntimeErrorCode,
): string {
	if (typeof value !== "string" || !value.trim()) throw new WorkflowPluginRuntimeError(code, `${field} must be a non-empty string`);
	return value.trim();
}

function freezeResult<T extends WorkflowPluginRuntimeExecutionResult>(value: T): T {
	Object.freeze(value);
	Object.freeze(value.evidence);
	if (value.status === "settled") Object.freeze(value.output);
	return value;
}

function buildCapabilityInput(
	node: WorkflowPluginNodeDefinitionV1,
	portInputs: Readonly<Record<string, readonly unknown[]>>,
): Readonly<Record<string, unknown>> {
	const portIds = new Set(node.inputPorts.map((port) => port.portId));
	const unknownPort = Object.keys(portInputs).find((portId) => !portIds.has(portId) && (portInputs[portId]?.length ?? 0) > 0);
	if (unknownPort) throw new Error(`input port ${unknownPort} is not declared`);
	const input: Record<string, unknown> = {};
	for (const port of node.inputPorts) {
		const values = portInputs[port.portId] ?? [];
		if (port.cardinality === "one") {
			if (values.length > 1) throw new Error(`input port ${port.portId} accepts one value`);
			if (values.length === 1) input[port.portId] = values[0];
			continue;
		}
		if (values.length > 0 || port.required) input[port.portId] = [...values];
	}
	return input;
}

/** Process-local catalog: admission is explicit, identities are version-pinned, entries cannot be replaced. */
export class WorkflowPluginRuntimeRegistry {
	readonly #adapters: ReadonlyMap<string, WorkflowPluginOwnerAdapter>;
	readonly #catalogs = new Map<string, RegisteredWorkflowPluginCatalog>();

	constructor(adapters: readonly WorkflowPluginOwnerAdapter[]) {
		const byOwner = new Map<string, WorkflowPluginOwnerAdapter>();
		for (const adapter of adapters) {
			const key = runtimeOwnerKey(adapter.runtimeOwner);
			if (byOwner.has(key)) throw new Error(`Workflow plugin owner adapter ${key} is duplicated`);
			byOwner.set(key, Object.freeze({
				runtimeOwner: Object.freeze({ ...adapter.runtimeOwner }),
				execute: adapter.execute,
			}));
		}
		this.#adapters = byOwner;
	}

	registerTrustedCatalog(manifestValue: unknown, admission: WorkflowPluginAdmissionV1): WorkflowPluginManifestV1 {
		const manifest = parseWorkflowPluginManifestV1(manifestValue);
		const authorization = authorizeWorkflowPluginManifestV1(manifest, admission);
		if (!authorization.authorized) {
			throw new WorkflowPluginRuntimeError(authorization.code, authorization.message);
		}
		const adapter = this.#adapters.get(runtimeOwnerKey(manifest.runtimeOwner));
		if (!adapter) {
			throw new WorkflowPluginRuntimeError("plugin_owner_adapter_missing", "No trusted adapter owns the admitted plugin runtime");
		}
		const key = catalogKey(manifest.pluginId, manifest.pluginVersion);
		if (this.#catalogs.has(key)) {
			throw new WorkflowPluginRuntimeError("plugin_catalog_already_registered", `Workflow plugin catalog ${key} is already registered`);
		}
		this.#catalogs.set(key, Object.freeze({ manifest, adapter }));
		return manifest;
	}

	async execute(request: WorkflowPluginRuntimeExecutionRequest): Promise<WorkflowPluginRuntimeExecutionResult> {
		const executorRef = parseWorkflowPluginExecutorRefV1(request.executorRef);
		const registration = this.#catalogs.get(catalogKey(executorRef.pluginId, executorRef.pluginVersion));
		if (!registration) {
			const samePlugin = [...this.#catalogs.values()].some((entry) => entry.manifest.pluginId === executorRef.pluginId);
			throw new WorkflowPluginRuntimeError(
				samePlugin ? "plugin_version_mismatch" : "plugin_catalog_not_registered",
				samePlugin ? "Workflow plugin executor version is not registered" : "Workflow plugin catalog is not registered",
			);
		}
		const nodeDefinition = registration.manifest.nodeDefinitions.find((node) =>
			node.nodeType === executorRef.nodeType && node.nodeVersion === executorRef.nodeVersion);
		const capability = registration.manifest.capabilities.find((candidate) =>
			candidate.capabilityId === executorRef.capabilityId
			&& candidate.capabilityVersion === executorRef.capabilityVersion);
		if (!nodeDefinition || !capability
			|| nodeDefinition.capability.capabilityId !== executorRef.capabilityId
			|| nodeDefinition.capability.capabilityVersion !== executorRef.capabilityVersion) {
			throw new WorkflowPluginRuntimeError("plugin_catalog_version_mismatch", "Workflow plugin executorRef does not match the immutable catalog");
		}
		let input: Readonly<Record<string, WorkflowPluginJsonValue>>;
		try {
			input = recordValue(validateWorkflowPluginValueV1(
				capability.inputSchema,
				buildCapabilityInput(nodeDefinition, request.portInputs),
				"workflow plugin input",
			), "workflow plugin input");
		} catch (error: unknown) {
			throw new WorkflowPluginRuntimeError("plugin_input_invalid", error instanceof Error ? error.message : String(error));
		}
		let config: Readonly<Record<string, WorkflowPluginJsonValue>>;
		try {
			config = recordValue(validateWorkflowPluginValueV1(nodeDefinition.configSchema, request.config, "workflow plugin config"), "workflow plugin config");
		} catch (error: unknown) {
			throw new WorkflowPluginRuntimeError("plugin_config_invalid", error instanceof Error ? error.message : String(error));
		}
		const idempotencyField = capability.execution.idempotencyKeyInput;
		const idempotencyKey = idempotencyField === null ? null : readNonEmptyString(
			input[idempotencyField],
			"Workflow plugin idempotency key",
			"plugin_input_invalid",
		);
		const ownerResult = await registration.adapter.execute({
			executionId: request.executionId,
			nodeId: request.nodeId,
			ownerId: request.ownerId,
			flowId: request.flowId,
			projectId: request.projectId,
			executorRef,
			manifest: registration.manifest,
			capability,
			nodeDefinition,
			input,
			config,
			idempotencyKey,
			previousEvidence: request.previousEvidence,
			...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
		});
		if (ownerResult.status === "settled") {
			let output: Readonly<Record<string, WorkflowPluginJsonValue>>;
			try {
				output = recordValue(validateWorkflowPluginValueV1(capability.outputSchema, ownerResult.output, "workflow plugin output"), "workflow plugin output");
			} catch (error: unknown) {
				throw new WorkflowPluginRuntimeError("plugin_output_invalid", error instanceof Error ? error.message : String(error));
			}
			const receiptField = capability.execution.resultLookupKeyOutput;
			const providerReceipt = receiptField === null ? null : readNonEmptyString(
				output[receiptField],
				"Workflow plugin provider receipt",
				"plugin_receipt_missing",
			);
			return freezeResult({ status: "settled", executorRef, output, idempotencyKey, providerReceipt, evidence: ownerResult.evidence });
		}
		const providerReceipt = capability.execution.resultLookup === "provider_receipt"
			? readNonEmptyString(ownerResult.providerReceipt, "Workflow plugin provider receipt", "plugin_receipt_missing")
			: ownerResult.providerReceipt;
		if (ownerResult.status === "accepted") {
			return freezeResult({ status: "accepted", executorRef, idempotencyKey, providerReceipt, evidence: ownerResult.evidence });
		}
		return freezeResult({
			status: "unknown_outcome",
			executorRef,
			idempotencyKey,
			providerReceipt,
			reason: readNonEmptyString(ownerResult.reason, "Workflow plugin unknown outcome reason", "plugin_owner_result_invalid"),
			evidence: ownerResult.evidence,
		});
	}
}

/**
 * Builds one all-or-nothing runtime view from trusted adapters and admitted catalog rows.
 * A malformed, unauthorized, duplicated, or adapter-less row aborts the whole load so a
 * worker never starts with a silently partial plugin catalog.
 */
export function createWorkflowPluginRuntimeRegistry(input: Readonly<{
	adapters: readonly WorkflowPluginOwnerAdapter[];
	registrations: readonly WorkflowPluginCatalogRegistration[];
}>): WorkflowPluginRuntimeRegistry {
	const registry = new WorkflowPluginRuntimeRegistry(input.adapters);
	for (const registration of input.registrations) {
		registry.registerTrustedCatalog(registration.manifest, registration.admission);
	}
	return registry;
}
