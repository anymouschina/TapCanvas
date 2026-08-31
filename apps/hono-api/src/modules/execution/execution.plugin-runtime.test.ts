import { describe, expect, it } from "vitest";
import {
	buildWorkflowPluginExecutorRefV1,
	WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
	type WorkflowPluginAdmissionV1,
} from "@tapcanvas/workflow-kernel-protocol";
import {
	WorkflowPluginRuntimeError,
	WorkflowPluginRuntimeRegistry,
	createWorkflowPluginRuntimeRegistry,
	type WorkflowPluginOwnerAdapter,
	type WorkflowPluginOwnerExecutionResult,
} from "./execution.plugin-runtime";
import {
	executeRegisteredWorkflowNode,
	type WorkflowNodeExecutorDependencies,
} from "./execution.node-executors";
import type { WorkflowNodeSnapshot } from "./execution.node-runtime";

const runtimeOwner = {
	kind: "hono-api",
	ownerId: "tapcanvas.plugin-runtime",
	runtimeVersion: "1.0.0",
} as const;

function closedObject(
	properties: Readonly<Record<string, unknown>> = {},
	required: readonly string[] = [],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

function paidManifest(): Record<string, unknown> {
	return {
		protocolVersion: WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
		pluginId: "studio.media-export",
		pluginVersion: "3.1.0",
		displayName: "Media Export",
		description: "Test catalog for one paid, receipt-tracked capability.",
		runtimeOwner,
		permissions: ["network:egress", "media:generate:paid", "asset:write"],
		capabilities: [{
			capabilityId: "media.render",
			capabilityVersion: 4,
			title: "Render media",
			description: "Renders one media asset.",
			entrypoint: "media.render/v4",
			requiredPermissions: ["network:egress", "media:generate:paid", "asset:write"],
			inputSchema: closedObject({
				prompt: { type: "string", minLength: 1, maxLength: 1_000 },
				idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
			}, ["prompt", "idempotencyKey"]),
			outputSchema: closedObject({
				assetUrl: { type: "string", minLength: 1, maxLength: 2_000 },
				providerReceipt: { type: "string", minLength: 1, maxLength: 256 },
			}, ["assetUrl", "providerReceipt"]),
			execution: {
				sideEffect: "paid_generation",
				retrySafety: "idempotency_key_required",
				executionMode: "exclusive",
				idempotencyKeyInput: "idempotencyKey",
				resultLookup: "provider_receipt",
				resultLookupKeyOutput: "providerReceipt",
			},
		}],
		nodeDefinitions: [{
			nodeType: "media.export",
			nodeVersion: 2,
			title: "Media export",
			description: "Invokes the admitted media runtime.",
			category: "media",
			capability: { capabilityId: "media.render", capabilityVersion: 4 },
			requiredPermissions: ["network:egress", "media:generate:paid", "asset:write"],
			configSchema: closedObject({
				quality: { type: "string", enum: ["standard", "high"] },
			}, ["quality"]),
			inputPorts: [
				{
					portId: "prompt",
					label: "Prompt",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 1_000 },
				},
				{
					portId: "idempotencyKey",
					label: "Idempotency key",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 128 },
				},
			],
			outputPorts: [
				{
					portId: "assetUrl",
					label: "Asset URL",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 2_000 },
				},
				{
					portId: "providerReceipt",
					label: "Provider receipt",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 256 },
				},
			],
		}],
	};
}

const admission: WorkflowPluginAdmissionV1 = {
	pluginId: "studio.media-export",
	pluginVersion: "3.1.0",
	runtimeOwner,
	grantedPermissions: ["network:egress", "media:generate:paid", "asset:write"],
};

const executorRef = buildWorkflowPluginExecutorRefV1({
	pluginId: "studio.media-export",
	pluginVersion: "3.1.0",
	nodeType: "media.export",
	nodeVersion: 2,
	capabilityId: "media.render",
	capabilityVersion: 4,
});

function adapterReturning(result: WorkflowPluginOwnerExecutionResult): WorkflowPluginOwnerAdapter {
	return { runtimeOwner, execute: async () => result };
}

function registeredRegistry(result: WorkflowPluginOwnerExecutionResult): WorkflowPluginRuntimeRegistry {
	const registry = new WorkflowPluginRuntimeRegistry([adapterReturning(result)]);
	registry.registerTrustedCatalog(paidManifest(), admission);
	return registry;
}

function runtimeRequest(overrides: Partial<{
	executorRef: string;
	portInputs: Readonly<Record<string, readonly unknown[]>>;
	config: unknown;
}> = {}) {
	return {
		executorRef: overrides.executorRef ?? executorRef,
		executionId: "execution-plugin-1",
		executionFamilyId: "execution-family-plugin-1",
		nodeId: "plugin-node-1",
		ownerId: "user-1",
		flowId: "flow-1",
		projectId: "project-1",
		portInputs: overrides.portInputs ?? { prompt: ["render"], idempotencyKey: ["idem-1"] },
		config: overrides.config ?? { quality: "high" },
		previousEvidence: null,
	};
}

describe("WorkflowPluginRuntimeRegistry", () => {
	it("loads an admitted catalog atomically and rejects a silently partial runtime view", async () => {
		const result: WorkflowPluginOwnerExecutionResult = {
			status: "accepted",
			providerReceipt: "receipt-atomic",
			evidence: {},
		};
		const registry = createWorkflowPluginRuntimeRegistry({
			adapters: [adapterReturning(result)],
			registrations: [{ manifest: paidManifest(), admission }],
		});
		await expect(registry.execute(runtimeRequest())).resolves.toMatchObject({
			status: "accepted",
			providerReceipt: "receipt-atomic",
		});
		expect(() => createWorkflowPluginRuntimeRegistry({
			adapters: [adapterReturning(result)],
			registrations: [
				{ manifest: paidManifest(), admission },
				{ manifest: paidManifest(), admission: { ...admission, grantedPermissions: [] } },
			],
		})).toThrowError(expect.objectContaining({ code: "permission_not_granted" }));
	});

	it("rejects unauthorized, owner-mismatched and version-mismatched admission", () => {
		const registry = new WorkflowPluginRuntimeRegistry([adapterReturning({
			status: "accepted",
			providerReceipt: "receipt-1",
			evidence: {},
		})]);
		expect(() => registry.registerTrustedCatalog(paidManifest(), { ...admission, grantedPermissions: [] }))
			.toThrowError(expect.objectContaining({ code: "permission_not_granted" }));
		expect(() => registry.registerTrustedCatalog(paidManifest(), {
			...admission,
			runtimeOwner: { ...runtimeOwner, ownerId: "different.owner" },
		})).toThrowError(expect.objectContaining({ code: "runtime_owner_mismatch" }));
		expect(() => registry.registerTrustedCatalog(paidManifest(), { ...admission, pluginVersion: "3.2.0" }))
			.toThrowError(expect.objectContaining({ code: "plugin_version_mismatch" }));
		expect(() => new WorkflowPluginRuntimeRegistry([]).registerTrustedCatalog(paidManifest(), admission))
			.toThrowError(expect.objectContaining({ code: "plugin_owner_adapter_missing" }));
	});

	it("rejects an executorRef whose pinned plugin or catalog versions do not match", async () => {
		const registry = registeredRegistry({ status: "accepted", providerReceipt: "receipt-1", evidence: {} });
		await expect(registry.execute(runtimeRequest({
			executorRef: executorRef.replace("/3.1.0/", "/3.2.0/"),
		}))).rejects.toMatchObject({ code: "plugin_version_mismatch" });
		await expect(registry.execute(runtimeRequest({
			executorRef: executorRef.replace("/media.export/2/", "/media.export/3/"),
		}))).rejects.toMatchObject({ code: "plugin_catalog_version_mismatch" });
	});

	it("validates input, config and settled output before crossing the boundary", async () => {
		const invalidOutputRegistry = registeredRegistry({
			status: "settled",
			output: { assetUrl: "https://assets.example/media.mp4" },
			evidence: {},
		});
		await expect(invalidOutputRegistry.execute(runtimeRequest({
			portInputs: { prompt: [42], idempotencyKey: ["idem-1"] },
		}))).rejects.toMatchObject({ code: "plugin_input_invalid" });
		await expect(invalidOutputRegistry.execute(runtimeRequest({ config: { quality: "ultra" } })))
			.rejects.toMatchObject({ code: "plugin_config_invalid" });
		await expect(invalidOutputRegistry.execute(runtimeRequest()))
			.rejects.toMatchObject({ code: "plugin_output_invalid" });
	});

	it("normalizes settled, accepted and unknown outcomes while retaining idempotency and receipt", async () => {
		const settled = await registeredRegistry({
			status: "settled",
			output: { assetUrl: "https://assets.example/media.mp4", providerReceipt: "receipt-settled" },
			evidence: { provider: "test" },
		}).execute(runtimeRequest());
		const accepted = await registeredRegistry({
			status: "accepted",
			providerReceipt: "receipt-accepted",
			evidence: { provider: "test" },
		}).execute(runtimeRequest());
		const unknown = await registeredRegistry({
			status: "unknown_outcome",
			providerReceipt: "receipt-unknown",
			reason: "provider connection closed after acceptance",
			evidence: { provider: "test" },
		}).execute(runtimeRequest());
		expect(settled).toMatchObject({ status: "settled", idempotencyKey: "idem-1", providerReceipt: "receipt-settled" });
		expect(accepted).toMatchObject({ status: "accepted", idempotencyKey: "idem-1", providerReceipt: "receipt-accepted" });
		expect(unknown).toMatchObject({ status: "unknown_outcome", idempotencyKey: "idem-1", providerReceipt: "receipt-unknown" });
		expect(Object.isFrozen(settled)).toBe(true);
	});

	it("requires the trusted owner adapter to preserve paid provider receipts", async () => {
		const registry = registeredRegistry({ status: "accepted", providerReceipt: null, evidence: {} });
		const execution = registry.execute(runtimeRequest());
		await expect(execution).rejects.toBeInstanceOf(WorkflowPluginRuntimeError);
		await expect(execution).rejects.toMatchObject({ code: "plugin_receipt_missing" });
	});
});

function pluginNode(config: unknown): WorkflowNodeSnapshot {
	return {
		id: "plugin-node-1",
		type: "taskNode",
		kind: "workflowStage",
		data: {
			workflowPluginConfig: config,
			workflowAtomicSpec: {
				version: 1,
				category: "media",
				operation: "plugin",
				executorRef,
				executionMode: "once",
				inputPorts: ["prompt", "idempotencyKey"],
				outputPorts: ["assetUrl", "providerReceipt"],
			},
		},
	};
}

function executorDependencies(registry: WorkflowPluginRuntimeRegistry): WorkflowNodeExecutorDependencies {
	return {
		pluginRuntimeRegistry: registry,
		runAgent: async () => { throw new Error("not called"); },
		runJavascript: async () => { throw new Error("not called"); },
		runVideo: async () => { throw new Error("not called"); },
	};
}

describe("generic workflow plugin executor seam", () => {
	it("maps settled to success and accepted/unknown outcomes to durable external waiting", async () => {
		const settled = await executeRegisteredWorkflowNode({
			...runtimeRequest(),
			workflowKey: "plugin-workflow/v1",
			node: pluginNode({ quality: "high" }),
			inputs: { prompt: ["render"], idempotencyKey: ["idem-1"] },
		}, executorDependencies(registeredRegistry({
			status: "settled",
			output: { assetUrl: "https://assets.example/media.mp4", providerReceipt: "receipt-settled" },
			evidence: {},
		})));
		const accepted = await executeRegisteredWorkflowNode({
			...runtimeRequest(),
			workflowKey: "plugin-workflow/v1",
			node: pluginNode({ quality: "high" }),
			inputs: { prompt: ["render"], idempotencyKey: ["idem-1"] },
		}, executorDependencies(registeredRegistry({
			status: "accepted",
			providerReceipt: "receipt-accepted",
			evidence: {},
		})));
		const unknown = await executeRegisteredWorkflowNode({
			...runtimeRequest(),
			workflowKey: "plugin-workflow/v1",
			node: pluginNode({ quality: "high" }),
			inputs: { prompt: ["render"], idempotencyKey: ["idem-1"] },
		}, executorDependencies(registeredRegistry({
			status: "unknown_outcome",
			providerReceipt: "receipt-unknown",
			reason: "ambiguous provider response",
			evidence: {},
		})));
		expect(settled).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { assetUrl: "https://assets.example/media.mp4", providerReceipt: "receipt-settled" },
				evidence: { pluginExecutionStatus: "settled", pluginIdempotencyKey: "idem-1" },
			},
		});
		expect(accepted).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: { evidence: { executorCompleted: false, pluginExecutionStatus: "accepted" } },
		});
		expect(unknown).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: { evidence: { pluginExecutionStatus: "unknown_outcome", pluginUnknownOutcomeReason: "ambiguous provider response" } },
		});
	});
});
