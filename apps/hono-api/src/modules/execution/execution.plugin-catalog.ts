import {
	WORKFLOW_PLUGIN_PERMISSIONS,
	authorizeWorkflowPluginManifestV1,
	parseWorkflowPluginManifestV1,
	type WorkflowPluginAdmissionV1,
	type WorkflowPluginManifestV1,
	type WorkflowPluginPermission,
	type WorkflowPluginRuntimeOwnerV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import {
	createWorkflowPluginRuntimeRegistry,
	type WorkflowPluginCatalogRegistration,
	type WorkflowPluginOwnerAdapter,
	type WorkflowPluginRuntimeRegistry,
} from "./execution.plugin-runtime";

export const WORKFLOW_PLUGIN_PUBLISHER_KINDS = ["platform", "user", "team"] as const;
export type WorkflowPluginPublisherKind = (typeof WORKFLOW_PLUGIN_PUBLISHER_KINDS)[number];

export type WorkflowPluginCatalogErrorCode =
	| "plugin_catalog_version_exists"
	| "plugin_catalog_version_not_found"
	| "plugin_catalog_manifest_corrupt"
	| "plugin_catalog_manifest_hash_mismatch"
	| "plugin_catalog_storage_identity_mismatch"
	| "plugin_catalog_admission_invalid"
	| "plugin_catalog_admission_exists"
	| "plugin_catalog_admission_missing"
	| "plugin_catalog_admission_conflict"
	| "plugin_catalog_runtime_owner_untrusted";

export class WorkflowPluginCatalogError extends Error {
	readonly code: WorkflowPluginCatalogErrorCode;

	constructor(code: WorkflowPluginCatalogErrorCode, message: string) {
		super(message);
		this.name = "WorkflowPluginCatalogError";
		this.code = code;
	}
}

type StoredWorkflowPluginAdmission = Readonly<{
	id: string;
	plugin_version_id: string;
	status: string;
	granted_permissions_json: string;
	decision_revision: number;
	decided_by_actor: string;
	reason: string | null;
	admitted_at: string;
	revoked_at: string | null;
	created_at: string;
	updated_at: string;
}>;

export type StoredWorkflowPluginCatalogRow = Readonly<{
	id: string;
	plugin_id: string;
	plugin_version: string;
	publisher_kind: string;
	publisher_id: string;
	manifest_json: string;
	manifest_sha256: string;
	runtime_owner_kind: string;
	runtime_owner_id: string;
	runtime_version: string;
	created_by_actor: string;
	created_at: string;
	admission: StoredWorkflowPluginAdmission | null;
}>;

const PERMISSION_SET = new Set<string>(WORKFLOW_PLUGIN_PERMISSIONS);
const PUBLISHER_KIND_SET = new Set<string>(WORKFLOW_PLUGIN_PUBLISHER_KINDS);

function requireNonEmptyString(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", `${field} must be a non-empty string`);
	return normalized;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
	return typeof error === "object"
		&& error !== null
		&& "code" in error
		&& error.code === "P2002";
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsePermissionList(value: unknown, field: string): readonly WorkflowPluginPermission[] {
	if (!Array.isArray(value)) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", `${field} must be an array`);
	}
	const permissions: WorkflowPluginPermission[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string" || !PERMISSION_SET.has(entry) || seen.has(entry)) {
			throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", `${field} contains an invalid or duplicated permission`);
		}
		seen.add(entry);
		permissions.push(entry as WorkflowPluginPermission);
	}
	return Object.freeze(permissions);
}

function parseStoredPermissionList(value: string): readonly WorkflowPluginPermission[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch (error: unknown) {
		throw new WorkflowPluginCatalogError(
			"plugin_catalog_admission_invalid",
			`Stored workflow plugin permissions are not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return parsePermissionList(parsed, "Stored workflow plugin permissions");
}

function sameRuntimeOwner(left: WorkflowPluginRuntimeOwnerV1, right: WorkflowPluginRuntimeOwnerV1): boolean {
	return left.kind === right.kind
		&& left.ownerId === right.ownerId
		&& left.runtimeVersion === right.runtimeVersion;
}

function hasTrustedRuntimeOwner(
	owner: WorkflowPluginRuntimeOwnerV1,
	trustedOwners: readonly WorkflowPluginRuntimeOwnerV1[],
): boolean {
	return trustedOwners.some((trusted) => sameRuntimeOwner(owner, trusted));
}

function assertStorageIdentity(row: StoredWorkflowPluginCatalogRow, manifest: WorkflowPluginManifestV1): void {
	if (row.plugin_id !== manifest.pluginId
		|| row.plugin_version !== manifest.pluginVersion
		|| row.runtime_owner_kind !== manifest.runtimeOwner.kind
		|| row.runtime_owner_id !== manifest.runtimeOwner.ownerId
		|| row.runtime_version !== manifest.runtimeOwner.runtimeVersion) {
		throw new WorkflowPluginCatalogError(
			"plugin_catalog_storage_identity_mismatch",
			`Stored workflow plugin identity does not match manifest ${manifest.pluginId}@${manifest.pluginVersion}`,
		);
	}
}

async function parseStoredManifest(row: StoredWorkflowPluginCatalogRow): Promise<WorkflowPluginManifestV1> {
	const actualHash = await sha256Hex(row.manifest_json);
	if (actualHash !== row.manifest_sha256) {
		throw new WorkflowPluginCatalogError(
			"plugin_catalog_manifest_hash_mismatch",
			`Stored workflow plugin manifest hash differs for ${row.plugin_id}@${row.plugin_version}`,
		);
	}
	let manifestValue: unknown;
	try {
		manifestValue = JSON.parse(row.manifest_json) as unknown;
	} catch (error: unknown) {
		throw new WorkflowPluginCatalogError(
			"plugin_catalog_manifest_corrupt",
			`Stored workflow plugin manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let manifest: WorkflowPluginManifestV1;
	try {
		manifest = parseWorkflowPluginManifestV1(manifestValue);
	} catch (error: unknown) {
		throw new WorkflowPluginCatalogError(
			"plugin_catalog_manifest_corrupt",
			`Stored workflow plugin manifest violates the protocol: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	assertStorageIdentity(row, manifest);
	return manifest;
}

export async function decodeAdmittedWorkflowPluginCatalogRow(
	row: StoredWorkflowPluginCatalogRow,
): Promise<WorkflowPluginCatalogRegistration> {
	if (!row.admission || row.admission.status !== "admitted" || row.admission.revoked_at !== null) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", "Workflow plugin catalog row is not actively admitted");
	}
	if (row.admission.plugin_version_id !== row.id || row.admission.decision_revision < 1) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", "Workflow plugin admission storage identity is invalid");
	}
	const manifest = await parseStoredManifest(row);
	const admission: WorkflowPluginAdmissionV1 = Object.freeze({
		pluginId: row.plugin_id,
		pluginVersion: row.plugin_version,
		runtimeOwner: manifest.runtimeOwner,
		grantedPermissions: parseStoredPermissionList(row.admission.granted_permissions_json),
	});
	const authorization = authorizeWorkflowPluginManifestV1(manifest, admission);
	if (!authorization.authorized) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", authorization.message);
	}
	return Object.freeze({ manifest, admission });
}

export async function listAdmittedWorkflowPluginCatalogRegistrations(
	db: PrismaClient,
): Promise<readonly WorkflowPluginCatalogRegistration[]> {
	const rows = await db.workflow_plugin_versions.findMany({
		where: { admission: { is: { status: "admitted" } } },
		include: { admission: true },
		orderBy: [{ plugin_id: "asc" }, { plugin_version: "asc" }],
	});
	const registrations: WorkflowPluginCatalogRegistration[] = [];
	for (const row of rows) registrations.push(await decodeAdmittedWorkflowPluginCatalogRow(row));
	return Object.freeze(registrations);
}

export async function createPersistedWorkflowPluginVersion(
	db: PrismaClient,
	input: Readonly<{
		manifest: unknown;
		publisherKind: WorkflowPluginPublisherKind;
		publisherId: string;
		createdByActor: string;
		nowIso: string;
	}>,
): Promise<WorkflowPluginManifestV1> {
	if (!PUBLISHER_KIND_SET.has(input.publisherKind)) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", "Workflow plugin publisher kind is invalid");
	}
	const publisherId = requireNonEmptyString(input.publisherId, "Workflow plugin publisherId");
	const createdByActor = requireNonEmptyString(input.createdByActor, "Workflow plugin createdByActor");
	const nowIso = requireNonEmptyString(input.nowIso, "Workflow plugin nowIso");
	const manifest = parseWorkflowPluginManifestV1(input.manifest);
	const manifestJson = JSON.stringify(manifest);
	try {
		await db.workflow_plugin_versions.create({
			data: {
				id: crypto.randomUUID(),
				plugin_id: manifest.pluginId,
				plugin_version: manifest.pluginVersion,
				publisher_kind: input.publisherKind,
				publisher_id: publisherId,
				manifest_json: manifestJson,
				manifest_sha256: await sha256Hex(manifestJson),
				runtime_owner_kind: manifest.runtimeOwner.kind,
				runtime_owner_id: manifest.runtimeOwner.ownerId,
				runtime_version: manifest.runtimeOwner.runtimeVersion,
				created_by_actor: createdByActor,
				created_at: nowIso,
			},
		});
	} catch (error: unknown) {
		if (isPrismaUniqueConstraintError(error)) {
			throw new WorkflowPluginCatalogError(
				"plugin_catalog_version_exists",
				`Workflow plugin ${manifest.pluginId}@${manifest.pluginVersion} already exists and cannot be overwritten`,
			);
		}
		throw error;
	}
	return manifest;
}

export async function admitPersistedWorkflowPluginVersion(
	db: PrismaClient,
	input: Readonly<{
		pluginId: string;
		pluginVersion: string;
		grantedPermissions: readonly WorkflowPluginPermission[];
		trustedRuntimeOwners: readonly WorkflowPluginRuntimeOwnerV1[];
		decidedByActor: string;
		reason?: string | null;
		nowIso: string;
	}>,
): Promise<void> {
	const pluginId = requireNonEmptyString(input.pluginId, "Workflow plugin pluginId");
	const pluginVersion = requireNonEmptyString(input.pluginVersion, "Workflow plugin pluginVersion");
	const decidedByActor = requireNonEmptyString(input.decidedByActor, "Workflow plugin decidedByActor");
	const nowIso = requireNonEmptyString(input.nowIso, "Workflow plugin nowIso");
	const row = await db.workflow_plugin_versions.findUnique({
		where: { plugin_id_plugin_version: { plugin_id: pluginId, plugin_version: pluginVersion } },
		include: { admission: true },
	});
	if (!row) {
		throw new WorkflowPluginCatalogError("plugin_catalog_version_not_found", `Workflow plugin ${pluginId}@${pluginVersion} does not exist`);
	}
	const manifest = await parseStoredManifest(row);
	if (!hasTrustedRuntimeOwner(manifest.runtimeOwner, input.trustedRuntimeOwners)) {
		throw new WorkflowPluginCatalogError("plugin_catalog_runtime_owner_untrusted", "Workflow plugin runtime owner has no trusted host adapter");
	}
	const grantedPermissions = parsePermissionList(input.grantedPermissions, "Workflow plugin grantedPermissions");
	const admission: WorkflowPluginAdmissionV1 = {
		pluginId,
		pluginVersion,
		runtimeOwner: manifest.runtimeOwner,
		grantedPermissions,
	};
	const authorization = authorizeWorkflowPluginManifestV1(manifest, admission);
	if (!authorization.authorized) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_invalid", authorization.message);
	}
	if (row.admission?.status === "admitted") {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_exists", `Workflow plugin ${pluginId}@${pluginVersion} is already admitted`);
	}
	const reason = input.reason?.trim() || null;
	const permissionJson = JSON.stringify(grantedPermissions);
	if (!row.admission) {
		try {
			await db.workflow_plugin_admissions.create({
				data: {
					id: crypto.randomUUID(),
					plugin_version_id: row.id,
					status: "admitted",
					granted_permissions_json: permissionJson,
					decision_revision: 1,
					decided_by_actor: decidedByActor,
					reason,
					admitted_at: nowIso,
					revoked_at: null,
					created_at: nowIso,
					updated_at: nowIso,
				},
			});
		} catch (error: unknown) {
			if (isPrismaUniqueConstraintError(error)) {
				throw new WorkflowPluginCatalogError(
					"plugin_catalog_admission_conflict",
					"Workflow plugin admission was created concurrently",
				);
			}
			throw error;
		}
		return;
	}
	const updated = await db.workflow_plugin_admissions.updateMany({
		where: {
			id: row.admission.id,
			status: "revoked",
			decision_revision: row.admission.decision_revision,
		},
		data: {
			status: "admitted",
			granted_permissions_json: permissionJson,
			decision_revision: { increment: 1 },
			decided_by_actor: decidedByActor,
			reason,
			admitted_at: nowIso,
			revoked_at: null,
			updated_at: nowIso,
		},
	});
	if (updated.count !== 1) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_conflict", "Workflow plugin admission changed concurrently");
	}
}

export async function revokePersistedWorkflowPluginAdmission(
	db: PrismaClient,
	input: Readonly<{
		pluginId: string;
		pluginVersion: string;
		decidedByActor: string;
		reason: string;
		nowIso: string;
	}>,
): Promise<void> {
	const pluginId = requireNonEmptyString(input.pluginId, "Workflow plugin pluginId");
	const pluginVersion = requireNonEmptyString(input.pluginVersion, "Workflow plugin pluginVersion");
	const decidedByActor = requireNonEmptyString(input.decidedByActor, "Workflow plugin decidedByActor");
	const reason = requireNonEmptyString(input.reason, "Workflow plugin revocation reason");
	const nowIso = requireNonEmptyString(input.nowIso, "Workflow plugin nowIso");
	const row = await db.workflow_plugin_versions.findUnique({
		where: { plugin_id_plugin_version: { plugin_id: pluginId, plugin_version: pluginVersion } },
		include: { admission: true },
	});
	if (!row) {
		throw new WorkflowPluginCatalogError("plugin_catalog_version_not_found", `Workflow plugin ${pluginId}@${pluginVersion} does not exist`);
	}
	if (!row.admission || row.admission.status !== "admitted") {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_missing", `Workflow plugin ${pluginId}@${pluginVersion} is not admitted`);
	}
	const updated = await db.workflow_plugin_admissions.updateMany({
		where: {
			id: row.admission.id,
			status: "admitted",
			decision_revision: row.admission.decision_revision,
		},
		data: {
			status: "revoked",
			decision_revision: { increment: 1 },
			decided_by_actor: decidedByActor,
			reason,
			revoked_at: nowIso,
			updated_at: nowIso,
		},
	});
	if (updated.count !== 1) {
		throw new WorkflowPluginCatalogError("plugin_catalog_admission_conflict", "Workflow plugin admission changed concurrently");
	}
}

export async function loadPersistedWorkflowPluginRuntimeRegistry(
	db: PrismaClient,
	adapters: readonly WorkflowPluginOwnerAdapter[],
): Promise<WorkflowPluginRuntimeRegistry> {
	return createWorkflowPluginRuntimeRegistry({
		adapters,
		registrations: await listAdmittedWorkflowPluginCatalogRegistrations(db),
	});
}
