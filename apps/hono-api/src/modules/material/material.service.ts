import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import type {
	CreateMaterialAssetRequest,
	CreateMaterialVersionRequest,
	CreateTeamMaterialAssetRequest,
	CreateMaterialFolderRequest,
	MaterialAssetDto,
	MaterialAssetVersionDto,
	MaterialFolderDto,
	MaterialImpactResponseDto,
	MaterialShotRefDto,
	UpdateMaterialAssetRequest,
	UpsertShotMaterialRefsRequest,
} from "./material.schemas";
import {
	createMaterialAsset,
	createMaterialVersion,
	createTeamMaterialAsset,
	createMaterialFolder as createMaterialFolderRepo,
	deleteTeamMaterialAsset,
	deleteMaterialAsset,
	deleteMaterialFolder as deleteMaterialFolderRepo,
	ensureMaterialSchema,
	getMaterialAssetById,
	getMaterialAssetForOwner,
	getMaterialFolderById,
	listImpactedShots,
	listMaterialFolders as listMaterialFoldersRepo,
	listShotMaterialRefs,
	listMaterialAssets,
	listMaterialVersions,
	listTeamMaterialAssets,
	updateMaterialAsset,
	upsertShotMaterialRef,
	writeCanvasIndexRefs,
	readCanvasIndexStyleImages,
	writeCanvasIndexStyleImages,
	readCanvasIndexStyleLock,
	writeCanvasIndexStyleLock,
	type CanvasIndexStyleLock,
	readCanvasIndexCinematicCamera,
	writeCanvasIndexCinematicCamera,
	type CanvasIndexCinematicCamera,
	readCanvasIndexDirectorPersona,
	writeCanvasIndexDirectorPersona,
	type CanvasIndexDirectorPersona,
} from "./material.repo";
import { getProjectForUserAccess } from "../project/project.repo";
import { getTeamMembershipForUserInTeam } from "../team/team.repo";
export { listProjectNodeAssetsForOwner } from "./material.project-node-assets.service";
import {
	getActiveProjectLookBible,
	type ActiveProjectLookBible,
} from "./project-look-bible";

async function assertProjectAccess(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<{ ownerId: string }> {
	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
	if (!project.owner_id) {
		throw new AppError("Project owner missing", {
			status: 500,
			code: "project_owner_missing",
			details: { projectId },
		});
	}
	return { ownerId: project.owner_id };
}

export async function getActiveProjectLookBibleForUser(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<ActiveProjectLookBible | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return getActiveProjectLookBible({ ownerId: access.ownerId, projectId });
}

async function requireMaterialAssetAccess(
	c: AppContext,
	userId: string,
	assetId: string,
): Promise<{ asset: MaterialAssetDto; ownerId: string }> {
	const asset = await getMaterialAssetById(c.env.DB, assetId);
	if (!asset) {
		throw new AppError("Material asset not found", {
			status: 404,
			code: "material_asset_not_found",
		});
	}
	// Personal materials are owner-scoped and cross-project: they are stored with an
	// empty projectId (see createMaterialAssetForOwner). For these there is no project to
	// authorize against, so verify direct ownership instead of calling assertProjectAccess
	// (which would 404 on the empty projectId and break favorite/rename/delete/version).
	if (!asset.projectId) {
		const owned = await getMaterialAssetForOwner(c.env.DB, { ownerId: userId, assetId });
		if (!owned) {
			throw new AppError("Material asset not found", {
				status: 404,
				code: "material_asset_not_found",
			});
		}
		return { asset, ownerId: userId };
	}
	const access = await assertProjectAccess(c, userId, asset.projectId);
	return { asset, ownerId: access.ownerId };
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
	// Personal materials are owner-scoped; projectId is recorded as creation context only.
	if (input.projectId) {
		await assertProjectAccess(c, userId, input.projectId);
	}
	if (input.folderId) {
		const folder = await getMaterialFolderById(c.env.DB, input.folderId);
		if (!folder || folder.scope !== "personal" || folder.ownerId !== userId) {
			throw new AppError("Material folder not found", {
				status: 404,
				code: "material_folder_not_found",
			});
		}
	}
	const nowIso = new Date().toISOString();
	const asset = await createMaterialAsset(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: input.projectId ?? "",
		kind: input.kind,
		name: input.name,
		nowIso,
		folderId: input.folderId,
	});
	const version = await createMaterialVersion(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: input.projectId ?? "",
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
	const { asset, ownerId } = await requireMaterialAssetAccess(c, userId, assetId);
	const nextVersion = asset.currentVersion + 1;
	return createMaterialVersion(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId,
		projectId: asset.projectId,
		assetId,
		version: nextVersion,
		data: input.data,
		note: input.note ?? null,
		createdAt: new Date().toISOString(),
	});
}

export async function updateMaterialAssetForOwner(
	c: AppContext,
	userId: string,
	assetId: string,
	input: UpdateMaterialAssetRequest,
): Promise<MaterialAssetDto> {
	await ensureMaterialSchema(c.env.DB);
	const { asset, ownerId } = await requireMaterialAssetAccess(c, userId, assetId);
	if (input.data) {
		await createMaterialVersion(c.env.DB, {
			id: crypto.randomUUID(),
			ownerId,
			projectId: asset.projectId,
			assetId,
			version: asset.currentVersion + 1,
			data: input.data,
			note: null,
			createdAt: new Date().toISOString(),
		});
	}
	const updated = await updateMaterialAsset(c.env.DB, {
		ownerId,
		assetId,
		name: input.name,
		favorite: input.favorite,
		nowIso: new Date().toISOString(),
	});
	if (!updated) throw new AppError("Update failed", { status: 500, code: "update_failed" });
	return updated;
}

export async function deleteMaterialAssetForOwner(
	c: AppContext,
	userId: string,
	assetId: string,
): Promise<void> {
	await ensureMaterialSchema(c.env.DB);
	const { ownerId } = await requireMaterialAssetAccess(c, userId, assetId);
	await deleteMaterialAsset(c.env.DB, { ownerId, assetId });
}

export async function listMaterialAssetsForOwner(
	c: AppContext,
	userId: string,
	input: {
		projectId?: string;
		kind?: "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice";
	},
): Promise<MaterialAssetDto[]> {
	await ensureMaterialSchema(c.env.DB);
	return listMaterialAssets(c.env.DB, {
		ownerId: userId,
		...(input.projectId ? { projectId: input.projectId } : {}),
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
	const { ownerId } = await requireMaterialAssetAccess(c, userId, input.assetId);
	return listMaterialVersions(c.env.DB, {
		ownerId,
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
	const access = await assertProjectAccess(c, userId, input.projectId);
	const nowIso = new Date().toISOString();
	const out: MaterialShotRefDto[] = [];
	for (const ref of input.refs) {
		const asset = await getMaterialAssetForOwner(c.env.DB, {
			ownerId: access.ownerId,
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
			ownerId: access.ownerId,
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
	const access = await assertProjectAccess(c, userId, input.projectId);
	return listImpactedShots(c.env.DB, {
		ownerId: access.ownerId,
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
	const access = await assertProjectAccess(c, userId, input.projectId);
	return listShotMaterialRefs(c.env.DB, {
		ownerId: access.ownerId,
		projectId: input.projectId,
		shotId: input.shotId,
	});
}

// ── Team asset helpers ────────────────────────────────────────────────────────

async function assertTeamAccess(
	c: AppContext,
	userId: string,
	teamId: string,
): Promise<void> {
	const membership = await getTeamMembershipForUserInTeam(c.env.DB, userId, teamId);
	if (!membership) {
		throw new AppError("Not a team member", {
			status: 403,
			code: "not_team_member",
		});
	}
}

export async function listTeamMaterialAssetsForMember(
	c: AppContext,
	userId: string,
	input: {
		teamId: string;
		kind?: "character" | "scene" | "prop" | "style" | "text";
	},
): Promise<MaterialAssetDto[]> {
	await ensureMaterialSchema(c.env.DB);
	await assertTeamAccess(c, userId, input.teamId);
	return listTeamMaterialAssets(c.env.DB, { teamId: input.teamId, kind: input.kind });
}

export async function createTeamMaterialAssetForMember(
	c: AppContext,
	userId: string,
	input: CreateTeamMaterialAssetRequest,
): Promise<{ asset: MaterialAssetDto; version: MaterialAssetVersionDto }> {
	await ensureMaterialSchema(c.env.DB);
	await assertTeamAccess(c, userId, input.teamId);
	const nowIso = new Date().toISOString();
	const asset = await createTeamMaterialAsset(c.env.DB, {
		id: crypto.randomUUID(),
		teamId: input.teamId,
		userId,
		kind: input.kind,
		name: input.name,
		nowIso,
		folderId: input.folderId,
	});
	const version = await createMaterialVersion(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: "",
		assetId: asset.id,
		version: 1,
		data: input.initialData,
		note: input.note ?? null,
		createdAt: nowIso,
	});
	return { asset, version };
}

export async function deleteTeamMaterialAssetForMember(
	c: AppContext,
	userId: string,
	assetId: string,
): Promise<void> {
	await ensureMaterialSchema(c.env.DB);
	const asset = await getMaterialAssetById(c.env.DB, assetId);
	if (!asset) throw new AppError("Material asset not found", { status: 404, code: "material_asset_not_found" });
	if (!asset.teamId) throw new AppError("Asset is not a team asset", { status: 400, code: "not_team_asset" });
	await assertTeamAccess(c, userId, asset.teamId);
	await deleteTeamMaterialAsset(c.env.DB, { assetId, teamId: asset.teamId });
}

// ── Folder helpers ────────────────────────────────────────────────────────────

export async function createMaterialFolderForUser(
	c: AppContext,
	userId: string,
	input: CreateMaterialFolderRequest,
): Promise<MaterialFolderDto> {
	await ensureMaterialSchema(c.env.DB);
	if (input.teamId) {
		await assertTeamAccess(c, userId, input.teamId);
	}
	const createdAt = new Date().toISOString();
	return createMaterialFolderRepo(c.env.DB, {
		id: crypto.randomUUID(),
		teamId: input.teamId,
		ownerId: input.teamId ? undefined : userId,
		name: input.name,
		createdAt,
	});
}

export async function listMaterialFoldersForUser(
	c: AppContext,
	userId: string,
	input: {
		teamId?: string;
	},
): Promise<MaterialFolderDto[]> {
	await ensureMaterialSchema(c.env.DB);
	if (input.teamId) {
		await assertTeamAccess(c, userId, input.teamId);
		return listMaterialFoldersRepo(c.env.DB, { teamId: input.teamId });
	}
	return listMaterialFoldersRepo(c.env.DB, { ownerId: userId });
}

export async function deleteMaterialFolderForUser(
	c: AppContext,
	userId: string,
	folderId: string,
): Promise<void> {
	await ensureMaterialSchema(c.env.DB);
	const folder = await getMaterialFolderById(c.env.DB, folderId);
	if (!folder) return;
	if (folder.scope === "official") {
		throw new AppError("Official material folders are read-only", {
			status: 403,
			code: "official_material_read_only",
		});
	}
	if (folder.scope === "team") {
		if (!folder.teamId) {
			throw new AppError("Material folder scope is invalid", {
				status: 500,
				code: "material_folder_scope_invalid",
			});
		}
		await assertTeamAccess(c, userId, folder.teamId);
	} else if (folder.ownerId !== userId) {
		throw new AppError("Material folder not found", {
			status: 404,
			code: "material_folder_not_found",
		});
	}
	await deleteMaterialFolderRepo(c.env.DB, { id: folderId });
}

export async function upsertCanvasIndexRefForOwner(
	c: AppContext,
	userId: string,
	input: {
		projectId: string;
		nodeId?: string;
		sourceNodeId?: string;
		referenceType: "character" | "scene";
		name: string;
		imageUrl: string;
		prompt?: string;
		modelKey?: string;
		imageSize?: string;
		creationStage?: string;
	},
): Promise<void> {
	const access = await assertProjectAccess(c, userId, input.projectId);
	await writeCanvasIndexRefs(input.projectId, access.ownerId, [
		{
			kind: input.referenceType,
			name: input.name,
			imageUrl: input.imageUrl,
			nodeId: input.nodeId,
			sourceNodeId: input.sourceNodeId,
			prompt: input.prompt,
			modelKey: input.modelKey,
			imageSize: input.imageSize,
			creationStage: input.creationStage,
		},
	]);
}

/** 读项目级全局风格图（canvas-index.json styleImages）。鉴权后按 ownerId 读。 */
export async function getProjectStyleImagesForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<string[]> {
	const access = await assertProjectAccess(c, userId, projectId);
	return readCanvasIndexStyleImages(projectId, access.ownerId);
}

/** 设项目级全局风格图（覆盖式）。前端 picker / agent set-style / 都写这里。返回归一化后的列表。 */
export async function setProjectStyleImagesForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
	styleImages: string[],
): Promise<string[]> {
	const access = await assertProjectAccess(c, userId, projectId);
	return writeCanvasIndexStyleImages(projectId, access.ownerId, styleImages);
}

/** 读项目级「锁定风格」元数据（chip 渲染用：单选 id/名字/自定义文字/分类）。 */
export async function getProjectStyleLockForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<CanvasIndexStyleLock | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return readCanvasIndexStyleLock(projectId, access.ownerId);
}

/** 设项目级「锁定风格」元数据（覆盖式，传 null 清除）。 */
export async function setProjectStyleLockForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
	styleLock: CanvasIndexStyleLock | null,
): Promise<CanvasIndexStyleLock | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return writeCanvasIndexStyleLock(projectId, access.ownerId, styleLock);
}

/** 读项目级「摄像机规格」（前端摄像机 chip / agent 出图注入共享同一源）。 */
export async function getProjectCinematicCameraForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<CanvasIndexCinematicCamera | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return readCanvasIndexCinematicCamera(projectId, access.ownerId);
}

/** 设项目级「摄像机规格」（覆盖式，传 null 清除）。 */
export async function setProjectCinematicCameraForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
	cinematicCamera: CanvasIndexCinematicCamera | null,
): Promise<CanvasIndexCinematicCamera | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return writeCanvasIndexCinematicCamera(projectId, access.ownerId, cinematicCamera);
}

/** 读项目级「导演人格」（filmBible.directorTone 的项目级选型锚，指向 作者导演美学 知识卡）。 */
export async function getProjectDirectorPersonaForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<CanvasIndexDirectorPersona | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return readCanvasIndexDirectorPersona(projectId, access.ownerId);
}

/** 设项目级「导演人格」（覆盖式，传 null 清除=回到小T自选）。 */
export async function setProjectDirectorPersonaForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
	persona: CanvasIndexDirectorPersona | null,
): Promise<CanvasIndexDirectorPersona | null> {
	const access = await assertProjectAccess(c, userId, projectId);
	return writeCanvasIndexDirectorPersona(projectId, access.ownerId, persona);
}
