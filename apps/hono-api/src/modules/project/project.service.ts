import fs from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	createProject,
	findLatestProjectForOwnerByNamePrefix,
	getProjectById,
	getProjectForOwner,
	listProjectsByOwner,
	listPublicProjects,
	updateProjectName,
	updateProjectPublic,
	type ProjectRow,
} from "./project.repo";
import { upsertTemplateMetaByProject } from "./project-template-meta";
import type { ProjectDto } from "./project.schemas";
import { mapFlowRowToDto, listFlowsByProject } from "../flow/flow.repo";
import { deleteProjectGraph } from "./project-delete";

function sanitizePathSegment(value: string): string {
	return String(value || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildProjectDataRoot(projectId: string): string {
	return path.join(process.cwd(), "project-data", sanitizePathSegment(projectId));
}

async function removeProjectDataRootOrThrow(projectId: string): Promise<void> {
	const projectRoot = buildProjectDataRoot(projectId);
	try {
		await fs.rm(projectRoot, { recursive: true, force: true });
	} catch (error) {
		throw new AppError("Failed to delete project local data", {
			status: 500,
			code: "project_local_data_delete_failed",
			details: {
				projectId,
				projectRoot,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function mapProjectRowToDto(row: ProjectRow): ProjectDto {
	const templateTitleRaw =
		typeof row.template_title === "string" ? row.template_title.trim() : "";
	const templateDescriptionRaw =
		typeof row.template_description === "string"
			? row.template_description.trim()
			: "";
	const templateCoverUrlRaw =
		typeof row.template_cover_url === "string"
			? row.template_cover_url.trim()
			: "";
	return {
		id: row.id,
		name: row.name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		isPublic: row.is_public === 1,
		owner: row.owner_login ?? undefined,
		ownerName: row.owner_name ?? undefined,
		templateTitle: templateTitleRaw || row.name,
		templateDescription: templateDescriptionRaw || undefined,
		templateCoverUrl: templateCoverUrlRaw || undefined,
	};
}

const REPLAY_PROJECT_NAME_MARKERS = [
	" local direct replay ",
	" local replay ",
] as const;

function normalizeProjectName(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function buildReplayCloneNamePrefix(
	sourceProjectName: string,
	newName?: string,
): string | null {
	const normalizedName = normalizeProjectName(newName);
	if (!normalizedName) return null;
	for (const marker of REPLAY_PROJECT_NAME_MARKERS) {
		const prefix = `${sourceProjectName}${marker}`;
		if (normalizedName.startsWith(prefix) && normalizedName.length > prefix.length) {
			return prefix;
		}
	}
	return null;
}

async function copyProjectFlowsToTarget(input: {
	c: AppContext;
	ownerId: string;
	sourceProjectId: string;
	targetProjectId: string;
	nowIso: string;
	replaceExisting: boolean;
	nextProjectName?: string;
}): Promise<void> {
	const prisma = getPrismaClient();
	const sourceFlows = await listFlowsByProject(input.c.env.DB, input.sourceProjectId);

	if (!input.replaceExisting) {
		for (const flow of sourceFlows) {
			await prisma.flows.create({
				data: {
					id: crypto.randomUUID(),
					name: flow.name,
					data: flow.data,
					owner_id: input.ownerId,
					project_id: input.targetProjectId,
					created_at: input.nowIso,
					updated_at: input.nowIso,
				},
			});
		}
		return;
	}

	await prisma.$transaction(async (tx) => {
		const existingTargetFlows = await tx.flows.findMany({
			where: {
				project_id: input.targetProjectId,
				owner_id: input.ownerId,
			},
			select: { id: true },
		});
		const existingTargetFlowIds = existingTargetFlows.map((flow) => flow.id);
		if (existingTargetFlowIds.length > 0) {
			await tx.flow_versions.deleteMany({
				where: { flow_id: { in: existingTargetFlowIds } },
			});
		}
		await tx.flows.deleteMany({
			where: {
				project_id: input.targetProjectId,
				owner_id: input.ownerId,
			},
		});
		if (sourceFlows.length > 0) {
			await tx.flows.createMany({
				data: sourceFlows.map((flow) => ({
					id: crypto.randomUUID(),
					name: flow.name,
					data: flow.data,
					owner_id: input.ownerId,
					project_id: input.targetProjectId,
					created_at: input.nowIso,
					updated_at: input.nowIso,
				})),
			});
		}
		await tx.projects.update({
			where: { id: input.targetProjectId },
			data: {
				updated_at: input.nowIso,
				...(input.nextProjectName ? { name: input.nextProjectName } : {}),
			},
		});
	});
}

export async function listUserProjects(c: AppContext, userId: string) {
	const rows = await listProjectsByOwner(c.env.DB, userId);
	return rows.map(mapProjectRowToDto);
}

export async function listPublicProjectDtos(c: AppContext) {
	const rows = await listPublicProjects(c.env.DB);
	return rows.map(mapProjectRowToDto);
}

export async function upsertProjectForUser(
	c: AppContext,
	userId: string,
	input: { id?: string; name: string },
) {
	const nowIso = new Date().toISOString();

	if (input.id) {
		const existing = await getProjectForOwner(c.env.DB, input.id, userId);
		if (!existing) {
			throw new AppError("Project not found", {
				status: 400,
				code: "project_not_found",
			});
		}
		const updated = await updateProjectName(c.env.DB, {
			id: input.id,
			name: input.name,
			nowIso,
		});
		if (!updated) {
			throw new AppError("Project not found", {
				status: 400,
				code: "project_not_found",
			});
		}
		return mapProjectRowToDto(updated);
	}

	const id = crypto.randomUUID();
	const created = await createProject(c.env.DB, {
		id,
		name: input.name,
		ownerId: userId,
		nowIso,
	});
	return mapProjectRowToDto(created);
}

export async function toggleProjectPublicForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	isPublic: boolean,
) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (project.owner_id !== userId) {
		throw new AppError("Not project owner", {
			status: 403,
			code: "forbidden",
		});
	}

	const nowIso = new Date().toISOString();
	const updated = await updateProjectPublic(c.env.DB, {
		id: projectId,
		isPublic,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	return mapProjectRowToDto(updated);
}

export async function updateProjectTemplateForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	input: {
		templateTitle: string;
		templateDescription?: string;
		templateCoverUrl?: string;
		isPublic: boolean;
	},
) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (project.owner_id !== userId) {
		throw new AppError("Not project owner", {
			status: 403,
			code: "forbidden",
		});
	}

	const nowIso = new Date().toISOString();
	await upsertTemplateMetaByProject(c, {
		projectId,
		projectOwnerId: project.owner_id,
		projectName: project.name,
		templateTitle: input.templateTitle,
		templateDescription: input.templateDescription,
		templateCoverUrl: input.templateCoverUrl,
		updatedBy: "owner",
		nowIso,
	});
	const updated = await updateProjectPublic(c.env.DB, {
		id: projectId,
		isPublic: input.isPublic,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	return mapProjectRowToDto(updated);
}

export async function cloneProjectForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	newName?: string,
) {
	const nextProjectName = normalizeProjectName(newName);
	const source = await getProjectById(c.env.DB, projectId);
	if (!source) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (source.is_public !== 1 && source.owner_id !== userId) {
		throw new AppError("Project is not public", {
			status: 403,
			code: "project_not_public",
		});
	}

	const nowIso = new Date().toISOString();
	const replayCloneNamePrefix = buildReplayCloneNamePrefix(
		source.name,
		nextProjectName,
	);
	if (replayCloneNamePrefix) {
		const existingReplayProject = await findLatestProjectForOwnerByNamePrefix(
			c.env.DB,
			{
				ownerId: userId,
				namePrefix: replayCloneNamePrefix,
				excludeProjectId: projectId,
			},
		);
		if (existingReplayProject) {
			await copyProjectFlowsToTarget({
				c,
				ownerId: userId,
				sourceProjectId: projectId,
				targetProjectId: existingReplayProject.id,
				nowIso,
				replaceExisting: true,
				nextProjectName: nextProjectName || existingReplayProject.name,
			});
			const refreshedProject = await getProjectForOwner(
				c.env.DB,
				existingReplayProject.id,
				userId,
			);
			if (!refreshedProject) {
				throw new AppError("Failed to reload replay clone project", {
					status: 500,
					code: "replay_clone_project_reload_failed",
					details: {
						projectId: existingReplayProject.id,
						sourceProjectId: projectId,
					},
				});
			}
			return mapProjectRowToDto(refreshedProject);
		}
	}

	const clonedId = crypto.randomUUID();
	const cloned = await createProject(c.env.DB, {
		id: clonedId,
		name: nextProjectName || `${source.name} (Cloned)`,
		ownerId: userId,
		nowIso,
	});

	await copyProjectFlowsToTarget({
		c,
		ownerId: userId,
		sourceProjectId: projectId,
		targetProjectId: cloned.id,
		nowIso,
		replaceExisting: false,
	});

	return mapProjectRowToDto(cloned);
}

export async function getPublicProjectFlows(c: AppContext, projectId: string) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (project.is_public !== 1) {
		throw new AppError("Project is not public", {
			status: 403,
			code: "project_not_public",
		});
	}

	const flows = await listFlowsByProject(c.env.DB, projectId);
	return flows.map((f) => mapFlowRowToDto(f));
}

export async function deleteProjectForUser(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (project.owner_id !== userId) {
		throw new AppError("Not project owner", {
			status: 403,
			code: "forbidden",
		});
	}

	await deleteProjectGraph(projectId);
	await removeProjectDataRootOrThrow(projectId);
}
