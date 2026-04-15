import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import type {
	CreateMaterialAssetRequest,
	CreateMaterialVersionRequest,
	MaterialAssetDto,
	MaterialAssetVersionDto,
	MaterialImpactResponseDto,
	MaterialShotRefDto,
	UpsertShotMaterialRefsRequest,
} from "./material.schemas";
import {
	createMaterialAsset,
	createMaterialVersion,
	ensureMaterialSchema,
	ensureProjectOwnership,
	getMaterialAssetForOwner,
	listImpactedShots,
	listShotMaterialRefs,
	listMaterialAssets,
	listMaterialVersions,
	upsertShotMaterialRef,
} from "./material.repo";

async function assertProjectAccess(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<void> {
	const hasAccess = await ensureProjectOwnership(c.env.DB, projectId, userId);
	if (!hasAccess) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
}

export async function createMaterialAssetForOwner(
	c: AppContext,
	userId: string,
	input: CreateMaterialAssetRequest,
): Promise<{
	asset: MaterialAssetDto;
	version: MaterialAssetVersionDto;
}> {
	await ensureMaterialSchema(c.env.DB);
	await assertProjectAccess(c, userId, input.projectId);
	const nowIso = new Date().toISOString();
	const asset = await createMaterialAsset(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: input.projectId,
		kind: input.kind,
		name: input.name,
		nowIso,
	});
	const version = await createMaterialVersion(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: input.projectId,
		assetId: asset.id,
		version: 1,
		data: input.initialData,
		note: input.note ?? null,
		createdAt: nowIso,
	});
	return { asset, version };
}

export async function createMaterialVersionForOwner(
	c: AppContext,
	userId: string,
	assetId: string,
	input: CreateMaterialVersionRequest,
): Promise<MaterialAssetVersionDto> {
	await ensureMaterialSchema(c.env.DB);
	const asset = await getMaterialAssetForOwner(c.env.DB, {
		ownerId: userId,
		assetId,
	});
	if (!asset) {
		throw new AppError("Material asset not found", {
			status: 404,
			code: "material_asset_not_found",
		});
	}
	await assertProjectAccess(c, userId, asset.projectId);
	const nextVersion = asset.currentVersion + 1;
	return createMaterialVersion(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: asset.projectId,
		assetId,
		version: nextVersion,
		data: input.data,
		note: input.note ?? null,
		createdAt: new Date().toISOString(),
	});
}

export async function listMaterialAssetsForOwner(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		kind?: "character" | "scene" | "prop" | "style";
	},
): Promise<MaterialAssetDto[]> {
	await ensureMaterialSchema(c.env.DB);
	await assertProjectAccess(c, userId, input.projectId);
	return listMaterialAssets(c.env.DB, {
		ownerId: userId,
		projectId: input.projectId,
		kind: input.kind,
	});
}

export async function listMaterialVersionsForOwner(
	c: AppContext,
	userId: string,
	input: {
		assetId: string;
		limit: number;
	},
): Promise<MaterialAssetVersionDto[]> {
	await ensureMaterialSchema(c.env.DB);
	const asset = await getMaterialAssetForOwner(c.env.DB, {
		ownerId: userId,
		assetId: input.assetId,
	});
	if (!asset) {
		throw new AppError("Material asset not found", {
			status: 404,
			code: "material_asset_not_found",
		});
	}
	return listMaterialVersions(c.env.DB, {
		ownerId: userId,
		assetId: input.assetId,
		limit: input.limit,
	});
}

export async function upsertShotMaterialRefsForOwner(
	c: AppContext,
	userId: string,
	input: UpsertShotMaterialRefsRequest,
): Promise<MaterialShotRefDto[]> {
	await ensureMaterialSchema(c.env.DB);
	await assertProjectAccess(c, userId, input.projectId);
	const nowIso = new Date().toISOString();
	const out: MaterialShotRefDto[] = [];
	for (const ref of input.refs) {
		const asset = await getMaterialAssetForOwner(c.env.DB, {
			ownerId: userId,
			assetId: ref.assetId,
		});
		if (!asset || asset.projectId !== input.projectId) {
			throw new AppError("Material asset not found in project", {
				status: 404,
				code: "material_asset_not_in_project",
				details: { assetId: ref.assetId, projectId: input.projectId },
			});
		}
		if (ref.assetVersion > asset.currentVersion) {
			throw new AppError("assetVersion exceeds currentVersion", {
				status: 400,
				code: "material_version_out_of_range",
				details: {
					assetId: ref.assetId,
					requestedVersion: ref.assetVersion,
					currentVersion: asset.currentVersion,
				},
			});
		}
		const row = await upsertShotMaterialRef(c.env.DB, {
			id: crypto.randomUUID(),
			ownerId: userId,
			projectId: input.projectId,
			shotId: input.shotId,
			assetId: ref.assetId,
			assetVersion: ref.assetVersion,
			nowIso,
		});
		out.push(row);
	}
	return out;
}

export async function listImpactedShotsForOwner(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		assetId?: string;
	},
): Promise<MaterialImpactResponseDto> {
	await ensureMaterialSchema(c.env.DB);
	await assertProjectAccess(c, userId, input.projectId);
	return listImpactedShots(c.env.DB, {
		ownerId: userId,
		projectId: input.projectId,
		assetId: input.assetId,
	});
}

export async function listShotMaterialRefsForOwner(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		shotId: string;
	},
): Promise<MaterialShotRefDto[]> {
	await ensureMaterialSchema(c.env.DB);
	await assertProjectAccess(c, userId, input.projectId);
	return listShotMaterialRefs(c.env.DB, {
		ownerId: userId,
		projectId: input.projectId,
		shotId: input.shotId,
	});
}
