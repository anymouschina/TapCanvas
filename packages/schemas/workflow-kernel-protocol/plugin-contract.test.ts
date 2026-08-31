import { describe, expect, it } from "vitest";

import {
	authorizeWorkflowPluginManifestV1,
	buildWorkflowPluginExecutorRefV1,
	instantiateWorkflowPluginNodeDefinitionV1,
	parseWorkflowPluginManifestV1,
	parseWorkflowPluginExecutorRefV1,
	validateWorkflowPluginValueV1,
	WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
} from "./index";

function closedObject(
	properties: Readonly<Record<string, unknown>> = {},
	required: readonly string[] = [],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

function manifest(): Record<string, unknown> {
	return {
		protocolVersion: WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
		pluginId: "studio.canvas-notes",
		pluginVersion: "1.2.0",
		displayName: "Canvas Notes",
		description: "Adds one explicitly authorized note node.",
		runtimeOwner: {
			kind: "host",
			ownerId: "studio.runtime",
			runtimeVersion: "2.0.0",
		},
		permissions: ["canvas:write"],
		capabilities: [{
			capabilityId: "note.create",
			capabilityVersion: 1,
			title: "Create note",
			description: "Creates a note in the owning host runtime.",
			entrypoint: "note.create/v1",
			requiredPermissions: ["canvas:write"],
			inputSchema: closedObject({
				text: { type: "string", minLength: 1, maxLength: 2_000 },
			}, ["text"]),
			outputSchema: closedObject({
				nodeId: { type: "string", minLength: 1, maxLength: 128 },
			}, ["nodeId"]),
			execution: {
				sideEffect: "local_mutation",
				retrySafety: "unsafe",
				executionMode: "exclusive",
				idempotencyKeyInput: null,
				resultLookup: "none",
				resultLookupKeyOutput: null,
			},
		}],
		nodeDefinitions: [{
			nodeType: "note.card",
			nodeVersion: 1,
			title: "Note",
			description: "A host-owned note node.",
			category: "artifact",
			capability: { capabilityId: "note.create", capabilityVersion: 1 },
			requiredPermissions: ["canvas:write"],
			configSchema: closedObject({
				color: { type: "string", enum: ["yellow", "blue"] },
			}),
			inputPorts: [{
				portId: "text",
				label: "Text",
				required: true,
				cardinality: "one",
				valueSchema: { type: "string", minLength: 1, maxLength: 2_000 },
			}],
			outputPorts: [{
				portId: "nodeId",
				label: "Node",
				required: true,
				cardinality: "one",
				valueSchema: { type: "string", minLength: 1, maxLength: 128 },
			}],
		}],
	};
}

describe("workflow plugin manifest contract", () => {
	it("parses and freezes an exact owner, capability and node definition contract", () => {
		const parsed = parseWorkflowPluginManifestV1(manifest());
		expect(parsed.pluginId).toBe("studio.canvas-notes");
		expect(parsed.capabilities[0].execution.sideEffect).toBe("local_mutation");
		expect(parsed.nodeDefinitions[0].capability).toEqual({
			capabilityId: "note.create",
			capabilityVersion: 1,
		});
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.capabilities[0].inputSchema)).toBe(true);
	});

	it("fails closed on unknown manifest and schema fields", () => {
		expect(() => parseWorkflowPluginManifestV1({ ...manifest(), installScript: "curl attacker" }))
			.toThrow("installScript is not supported");
		const withReference = manifest();
		const capabilities = withReference.capabilities as Array<Record<string, unknown>>;
		capabilities[0] = {
			...capabilities[0],
			inputSchema: { ...closedObject(), $ref: "https://attacker.invalid/schema" },
		};
		expect(() => parseWorkflowPluginManifestV1(withReference)).toThrow("$ref is not supported");
	});

	it("requires closed object schemas at every invocation boundary", () => {
		const open = manifest();
		const capabilities = open.capabilities as Array<Record<string, unknown>>;
		capabilities[0] = {
			...capabilities[0],
			inputSchema: { type: "object", properties: {}, required: [], additionalProperties: true },
		};
		expect(() => parseWorkflowPluginManifestV1(open)).toThrow("additionalProperties must be false");
	});

	it("rejects schema enums whose values do not match their declared type", () => {
		const invalidEnum = manifest();
		const nodes = invalidEnum.nodeDefinitions as Array<Record<string, unknown>>;
		const node = nodes[0];
		nodes[0] = {
			...node,
			configSchema: closedObject({ color: { type: "string", enum: [1] } }),
		};
		expect(() => parseWorkflowPluginManifestV1(invalidEnum)).toThrow(
			"enum contains a value outside schema type string",
		);
	});

	it("rejects permissions and capability versions that the manifest did not declare", () => {
		const undeclaredPermission = manifest();
		const capabilities = undeclaredPermission.capabilities as Array<Record<string, unknown>>;
		capabilities[0] = { ...capabilities[0], requiredPermissions: ["canvas:write", "network:egress"] };
		expect(() => parseWorkflowPluginManifestV1(undeclaredPermission)).toThrow(
			"requires undeclared permission network:egress",
		);

		const missingCapability = manifest();
		const nodes = missingCapability.nodeDefinitions as Array<Record<string, unknown>>;
		nodes[0] = { ...nodes[0], capability: { capabilityId: "note.create", capabilityVersion: 2 } };
		expect(() => parseWorkflowPluginManifestV1(missingCapability)).toThrow(
			"references an undeclared capability version",
		);
	});

	it("requires paid generation to be idempotent, queryable and explicitly permitted", () => {
		const paid = manifest();
		paid.permissions = ["canvas:write", "network:egress", "media:generate:paid"];
		const capabilities = paid.capabilities as Array<Record<string, unknown>>;
		capabilities[0] = {
			...capabilities[0],
			requiredPermissions: ["canvas:write", "network:egress", "media:generate:paid"],
			execution: {
				sideEffect: "paid_generation",
				retrySafety: "unsafe",
				executionMode: "exclusive",
				idempotencyKeyInput: null,
				resultLookup: "none",
				resultLookupKeyOutput: null,
			},
		};
		expect(() => parseWorkflowPluginManifestV1(paid)).toThrow(
			"paid generation requires idempotency and provider-receipt lookup",
		);
	});

	it("accepts paid generation only with durable retry and receipt lookup fields", () => {
		const paid = manifest();
		paid.permissions = ["canvas:write", "network:egress", "media:generate:paid"];
		const capabilities = paid.capabilities as Array<Record<string, unknown>>;
		capabilities[0] = {
			...capabilities[0],
			requiredPermissions: ["canvas:write", "network:egress", "media:generate:paid"],
			inputSchema: closedObject({
				text: { type: "string", minLength: 1, maxLength: 2_000 },
				idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
			}, ["text", "idempotencyKey"]),
			outputSchema: closedObject({
				nodeId: { type: "string", minLength: 1, maxLength: 128 },
				providerReceipt: { type: "string", minLength: 1, maxLength: 256 },
			}, ["nodeId", "providerReceipt"]),
			execution: {
				sideEffect: "paid_generation",
				retrySafety: "idempotency_key_required",
				executionMode: "exclusive",
				idempotencyKeyInput: "idempotencyKey",
				resultLookup: "provider_receipt",
				resultLookupKeyOutput: "providerReceipt",
			},
		};
		const nodes = paid.nodeDefinitions as Array<Record<string, unknown>>;
		nodes[0] = {
			...nodes[0],
			inputPorts: [
				{
					portId: "text",
					label: "Text",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 2_000 },
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
					portId: "nodeId",
					label: "Node",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 128 },
				},
				{
					portId: "providerReceipt",
					label: "Provider receipt",
					required: true,
					cardinality: "one",
					valueSchema: { type: "string", minLength: 1, maxLength: 256 },
				},
			],
		};
		const parsed = parseWorkflowPluginManifestV1(paid);
		expect(parsed.capabilities[0].execution).toMatchObject({
			retrySafety: "idempotency_key_required",
			resultLookup: "provider_receipt",
			resultLookupKeyOutput: "providerReceipt",
		});
	});

	it("keeps parsing separate from trusted admission", () => {
		const parsed = parseWorkflowPluginManifestV1(manifest());
		const admitted = {
			pluginId: parsed.pluginId,
			pluginVersion: parsed.pluginVersion,
			runtimeOwner: parsed.runtimeOwner,
			grantedPermissions: ["canvas:write"] as const,
		};
		expect(authorizeWorkflowPluginManifestV1(parsed, admitted)).toEqual({ authorized: true });
		expect(authorizeWorkflowPluginManifestV1(parsed, {
			...admitted,
			runtimeOwner: { ...parsed.runtimeOwner, ownerId: "untrusted.runtime" },
		})).toMatchObject({ authorized: false, code: "runtime_owner_mismatch" });
		expect(authorizeWorkflowPluginManifestV1(parsed, {
			...admitted,
			grantedPermissions: [],
		})).toMatchObject({ authorized: false, code: "permission_not_granted" });
	});

	it("builds and strictly parses one canonical, fully versioned executorRef", () => {
		const executorRef = buildWorkflowPluginExecutorRefV1({
			pluginId: "studio.canvas-notes",
			pluginVersion: "1.2.0",
			nodeType: "note.card",
			nodeVersion: 1,
			capabilityId: "note.create",
			capabilityVersion: 1,
		});
		expect(executorRef).toBe("workflow.plugin-executor/v1/studio.canvas-notes/1.2.0/note.card/1/note.create/1");
		expect(parseWorkflowPluginExecutorRefV1(executorRef)).toMatchObject({
			pluginId: "studio.canvas-notes",
			pluginVersion: "1.2.0",
			nodeType: "note.card",
			nodeVersion: 1,
			capabilityId: "note.create",
			capabilityVersion: 1,
		});
		expect(() => parseWorkflowPluginExecutorRefV1(executorRef.replace("/v1/", "/v2/")))
			.toThrow("must use workflow.plugin-executor/v1");
		expect(() => parseWorkflowPluginExecutorRefV1(`${executorRef}/unexpected`))
			.toThrow("must use workflow.plugin-executor/v1");
	});

	it("instantiates a catalog node with exact plugin, node and capability versions", () => {
		const parsed = parseWorkflowPluginManifestV1(manifest());
		const instance = instantiateWorkflowPluginNodeDefinitionV1({
			manifest: parsed,
			nodeId: "node-custom-1",
			nodeType: "note.card",
			nodeVersion: 1,
			config: { color: "yellow" },
		});
		expect(instance).toMatchObject({
			nodeId: "node-custom-1",
			nodeType: "note.card",
			nodeVersion: 1,
			executorRef: "workflow.plugin-executor/v1/studio.canvas-notes/1.2.0/note.card/1/note.create/1",
			config: { color: "yellow" },
		});
		expect(instance.inputPorts[0].dataType).toContain("studio.canvas-notes/1.2.0/note.card/1/note.create/1#input/text");
		expect(Object.isFrozen(instance)).toBe(true);
		expect(() => instantiateWorkflowPluginNodeDefinitionV1({
			manifest: parsed,
			nodeId: "node-custom-2",
			nodeType: "note.card",
			nodeVersion: 2,
			config: {},
		})).toThrow("catalog does not contain note.card@2");
	});

	it("validates bounded invocation values without accepting unknown fields", () => {
		const parsed = parseWorkflowPluginManifestV1(manifest());
		const schema = parsed.capabilities[0].inputSchema;
		expect(validateWorkflowPluginValueV1(schema, { text: "hello" })).toEqual({ text: "hello" });
		expect(() => validateWorkflowPluginValueV1(schema, { text: "hello", hidden: true }))
			.toThrow("hidden is not declared");
		expect(() => validateWorkflowPluginValueV1(schema, { text: "" }))
			.toThrow("shorter than 1");
	});
});
