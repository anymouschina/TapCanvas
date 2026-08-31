import { describe, expect, it, vi } from "vitest";
import {
	buildWorkflowPluginExecutorRefV1,
	WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
	type WorkflowPluginRuntimeOwnerV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import {
	WorkflowPluginCatalogError,
	admitPersistedWorkflowPluginVersion,
	createPersistedWorkflowPluginVersion,
	decodeAdmittedWorkflowPluginCatalogRow,
	loadPersistedWorkflowPluginRuntimeRegistry,
	revokePersistedWorkflowPluginAdmission,
	type StoredWorkflowPluginCatalogRow,
} from "./execution.plugin-catalog";
import type { WorkflowPluginOwnerAdapter } from "./execution.plugin-runtime";

const runtimeOwner = {
	kind: "hono-api",
	ownerId: "tapcanvas.test-plugin-runtime",
	runtimeVersion: "1.0.0",
} as const satisfies WorkflowPluginRuntimeOwnerV1;

function closedObject(
	properties: Readonly<Record<string, unknown>> = {},
	required: readonly string[] = [],
): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

function manifest(): Record<string, unknown> {
	return {
		protocolVersion: WORKFLOW_PLUGIN_MANIFEST_PROTOCOL_VERSION,
		pluginId: "studio.catalog-test",
		pluginVersion: "1.2.0",
		displayName: "Catalog test",
		description: "Immutable test plugin catalog.",
		runtimeOwner,
		permissions: ["network:egress"],
		capabilities: [{
			capabilityId: "catalog.echo",
			capabilityVersion: 1,
			title: "Echo",
			description: "Echoes a structured value.",
			entrypoint: "catalog.echo/v1",
			requiredPermissions: ["network:egress"],
			inputSchema: closedObject({ value: { type: "string", minLength: 1 } }, ["value"]),
			outputSchema: closedObject({ value: { type: "string", minLength: 1 } }, ["value"]),
			execution: {
				sideEffect: "external_mutation",
				retrySafety: "safe",
				executionMode: "exclusive",
				idempotencyKeyInput: null,
				resultLookup: "none",
				resultLookupKeyOutput: null,
			},
		}],
		nodeDefinitions: [{
			nodeType: "catalog.echo",
			nodeVersion: 1,
			title: "Echo node",
			description: "Tests persisted admission.",
			category: "tool",
			capability: { capabilityId: "catalog.echo", capabilityVersion: 1 },
			requiredPermissions: ["network:egress"],
			configSchema: closedObject(),
			inputPorts: [{
				portId: "value",
				label: "Value",
				required: true,
				cardinality: "one",
				valueSchema: { type: "string", minLength: 1 },
			}],
			outputPorts: [{
				portId: "value",
				label: "Value",
				required: true,
				cardinality: "one",
				valueSchema: { type: "string", minLength: 1 },
			}],
		}],
	};
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function admittedRow(
	overrides: Partial<StoredWorkflowPluginCatalogRow> = {},
): Promise<StoredWorkflowPluginCatalogRow> {
	const manifestJson = JSON.stringify(manifest());
	return {
		id: "plugin-version-1",
		plugin_id: "studio.catalog-test",
		plugin_version: "1.2.0",
		publisher_kind: "user",
		publisher_id: "user-1",
		manifest_json: manifestJson,
		manifest_sha256: await sha256Hex(manifestJson),
		runtime_owner_kind: runtimeOwner.kind,
		runtime_owner_id: runtimeOwner.ownerId,
		runtime_version: runtimeOwner.runtimeVersion,
		created_by_actor: "user-1",
		created_at: "2026-08-14T12:00:00.000Z",
		admission: {
			id: "admission-1",
			plugin_version_id: "plugin-version-1",
			status: "admitted",
			granted_permissions_json: JSON.stringify(["network:egress"]),
			decision_revision: 1,
			decided_by_actor: "admin-1",
			reason: "reviewed",
			admitted_at: "2026-08-14T12:01:00.000Z",
			revoked_at: null,
			created_at: "2026-08-14T12:01:00.000Z",
			updated_at: "2026-08-14T12:01:00.000Z",
		},
		...overrides,
	};
}

function prismaClient(value: Record<string, unknown>): PrismaClient {
	return value as unknown as PrismaClient;
}

describe("persisted workflow plugin catalog", () => {
	it("decodes an admitted immutable row and rejects manifest tampering", async () => {
		await expect(decodeAdmittedWorkflowPluginCatalogRow(await admittedRow())).resolves.toMatchObject({
			manifest: { pluginId: "studio.catalog-test", pluginVersion: "1.2.0" },
			admission: { grantedPermissions: ["network:egress"] },
		});
		await expect(decodeAdmittedWorkflowPluginCatalogRow(await admittedRow({
			manifest_sha256: "0".repeat(64),
		}))).rejects.toMatchObject({ code: "plugin_catalog_manifest_hash_mismatch" });
	});

	it("rejects a storage identity that differs from the hashed manifest", async () => {
		await expect(decodeAdmittedWorkflowPluginCatalogRow(await admittedRow({
			plugin_version: "9.9.9",
		}))).rejects.toMatchObject({ code: "plugin_catalog_storage_identity_mismatch" });
	});

	it("persists a version once and maps unique conflicts without overwriting", async () => {
		const create = vi.fn(async () => ({}));
		const db = prismaClient({ workflow_plugin_versions: { create } });
		await expect(createPersistedWorkflowPluginVersion(db, {
			manifest: manifest(),
			publisherKind: "user",
			publisherId: "user-1",
			createdByActor: "user-1",
			nowIso: "2026-08-14T12:00:00.000Z",
		})).resolves.toMatchObject({ pluginId: "studio.catalog-test", pluginVersion: "1.2.0" });
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
			plugin_id: "studio.catalog-test",
			plugin_version: "1.2.0",
			manifest_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
		}) });

		create.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "P2002" }));
		await expect(createPersistedWorkflowPluginVersion(db, {
			manifest: manifest(),
			publisherKind: "user",
			publisherId: "user-1",
			createdByActor: "user-1",
			nowIso: "2026-08-14T12:00:00.000Z",
		})).rejects.toEqual(expect.objectContaining({ code: "plugin_catalog_version_exists" }));
	});

	it("requires an exact trusted runtime owner before admission", async () => {
		const row = await admittedRow({ admission: null });
		const create = vi.fn(async () => ({}));
		const db = prismaClient({
			workflow_plugin_versions: { findUnique: vi.fn(async () => row) },
			workflow_plugin_admissions: { create },
		});
		const request = {
			pluginId: "studio.catalog-test",
			pluginVersion: "1.2.0",
			grantedPermissions: ["network:egress"] as const,
			decidedByActor: "admin-1",
			nowIso: "2026-08-14T12:01:00.000Z",
		};
		await expect(admitPersistedWorkflowPluginVersion(db, {
			...request,
			trustedRuntimeOwners: [],
		})).rejects.toMatchObject({ code: "plugin_catalog_runtime_owner_untrusted" });
		expect(create).not.toHaveBeenCalled();
		await expect(admitPersistedWorkflowPluginVersion(db, {
			...request,
			trustedRuntimeOwners: [runtimeOwner],
		})).resolves.toBeUndefined();
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
			status: "admitted",
			decision_revision: 1,
			granted_permissions_json: JSON.stringify(["network:egress"]),
		}) });

		create.mockRejectedValueOnce(Object.assign(new Error("duplicate admission"), { code: "P2002" }));
		await expect(admitPersistedWorkflowPluginVersion(db, {
			...request,
			trustedRuntimeOwners: [runtimeOwner],
		})).rejects.toMatchObject({ code: "plugin_catalog_admission_conflict" });
	});

	it("uses revision CAS and reports a concurrent revocation explicitly", async () => {
		const updateMany = vi.fn(async () => ({ count: 0 }));
		const db = prismaClient({
			workflow_plugin_versions: { findUnique: vi.fn(async () => admittedRow()) },
			workflow_plugin_admissions: { updateMany },
		});
		await expect(revokePersistedWorkflowPluginAdmission(db, {
			pluginId: "studio.catalog-test",
			pluginVersion: "1.2.0",
			decidedByActor: "admin-2",
			reason: "security review",
			nowIso: "2026-08-14T12:02:00.000Z",
		})).rejects.toMatchObject({ code: "plugin_catalog_admission_conflict" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ decision_revision: 1, status: "admitted" }),
		}));
	});

	it("loads every admitted row atomically through a trusted adapter", async () => {
		const row = await admittedRow();
		const adapter: WorkflowPluginOwnerAdapter = {
			runtimeOwner,
			execute: async () => ({ status: "settled", output: { value: "ok" }, evidence: {} }),
		};
		const db = prismaClient({
			workflow_plugin_versions: { findMany: vi.fn(async () => [row]) },
		});
		const registry = await loadPersistedWorkflowPluginRuntimeRegistry(db, [adapter]);
		await expect(registry.execute({
			executorRef: buildWorkflowPluginExecutorRefV1({
				pluginId: "studio.catalog-test",
				pluginVersion: "1.2.0",
				nodeType: "catalog.echo",
				nodeVersion: 1,
				capabilityId: "catalog.echo",
				capabilityVersion: 1,
			}),
			executionId: "execution-1",
			nodeId: "node-1",
			ownerId: "user-1",
			flowId: "flow-1",
			projectId: "project-1",
			portInputs: { value: ["ok"] },
			config: {},
			previousEvidence: null,
		})).resolves.toMatchObject({ status: "settled", output: { value: "ok" } });

		const corruptDb = prismaClient({
			workflow_plugin_versions: { findMany: vi.fn(async () => [row, await admittedRow({ manifest_sha256: "f".repeat(64) })]) },
		});
		await expect(loadPersistedWorkflowPluginRuntimeRegistry(corruptDb, [adapter]))
			.rejects.toBeInstanceOf(WorkflowPluginCatalogError);
	});
});
