// 真实加载器：把 material.repo 的 DTO 映射成引擎的 MaterialLike，并组装 WorldInfoLoader。
// 纯映射 materialDtoToSource 可单测；DB 取数胶水靠 material.repo 自身覆盖。
import type { PrismaClient } from "@prisma/client";
import { listMaterialAssets } from "../material/material.repo";
import type { MaterialAssetDto } from "../material/material.schemas";
import type { MaterialLike } from "./world-info.engine";
import type { WorldInfoLoader } from "./world-info.service";

function readWi(data: Record<string, unknown> | undefined): MaterialLike["wi"] | undefined {
	const wi = data?.wi;
	if (!wi || typeof wi !== "object" || Array.isArray(wi)) return undefined;
	return wi as MaterialLike["wi"];
}

export function materialDtoToSource(dto: MaterialAssetDto): MaterialLike {
	const data = (dto.latestVersion?.data ?? {}) as Record<string, unknown>;
	const imageUrl = typeof data.imageUrl === "string" ? data.imageUrl : undefined;
	return {
		id: dto.id,
		kind: dto.kind,
		name: dto.name,
		...(imageUrl ? { imageUrl } : {}),
		...(readWi(data) ? { wi: readWi(data) } : {}),
	};
}

/**
 * 项目级世界书加载器。P0 仅接素材库（character/scene/prop/style/text，已带 kind 分类）。
 * characterBibles/styleBible 待 project-context 暴露干净 loader 后再接（见设计 §6.5）。
 */
export function createProjectWorldInfoLoader(
	db: PrismaClient,
	input: { ownerId: string; projectId: string },
): WorldInfoLoader {
	return {
		loadMaterials: async () => {
			const assets = await listMaterialAssets(db, {
				ownerId: input.ownerId,
				projectId: input.projectId,
			});
			return assets.map(materialDtoToSource);
		},
	};
}
