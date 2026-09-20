import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";
import { listFlowsByProject, mapFlowRowToDto } from "../flow/flow.repo";
import { getProjectForUserAccess } from "../project/project.repo";
import type { MaterialAssetDto, MaterialKind } from "./material.schemas";
import { projectNodeAssetsFromCanvases } from "./material.project-node-assets";
import { deprecatedCanvasScope, type CanvasDeprecationScope } from "./material.canvas-visibility";

export async function listProjectNodeAssetsForOwner(
	c: AppContext,
	userId: string,
	input: { projectId: string; kind?: MaterialKind },
): Promise<MaterialAssetDto[]> {
	return (await loadProjectCanvasAssetScopeForOwner(c, userId, input)).assets;
}

export async function loadProjectCanvasAssetScopeForOwner(
	c: AppContext,
	userId: string,
	input: { projectId: string; kind?: MaterialKind },
): Promise<{ assets: MaterialAssetDto[]; deprecation: CanvasDeprecationScope }> {
	const project = await getProjectForUserAccess(c.env.DB, input.projectId, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
			details: { projectId: input.projectId },
		});
	}

	const [flowRows, chapters] = await Promise.all([
		listFlowsByProject(c.env.DB, input.projectId),
		getPrismaClient().chapters.findMany({
			where: { project_id: input.projectId },
			select: {
				id: true,
				title: true,
				canvas_flow: true,
				canvas_flow_revision: true,
				created_at: true,
				updated_at: true,
			},
		}),
	]);
	const flowCanvases = flowRows.map((row) => {
		const flow = mapFlowRowToDto(row);
		return {
			projectId: input.projectId,
			ownerType: flow.ownerType ?? ("project" as const),
			ownerId: flow.ownerId ?? flow.id,
			ownerLabel: flow.name,
			flowId: flow.id,
			data: flow.data,
			canvasRevision: flow.canvasRevision,
			createdAt: flow.createdAt,
			updatedAt: flow.updatedAt,
		};
	});
	const chapterCanvases = chapters.map((chapter) => ({
		projectId: input.projectId,
		ownerType: "chapter" as const,
		ownerId: chapter.id,
		ownerLabel: chapter.title,
		flowId: `chapter:${chapter.id}`,
		data: chapter.canvas_flow,
		canvasRevision: chapter.canvas_flow_revision,
		createdAt: chapter.created_at,
		updatedAt: chapter.updated_at,
	}));
	const canvases = [...flowCanvases, ...chapterCanvases];
	return {
		assets: projectNodeAssetsFromCanvases(canvases, input.kind ? { kind: input.kind } : undefined),
		deprecation: deprecatedCanvasScope(canvases),
	};
}
