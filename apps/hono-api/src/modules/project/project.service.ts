import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import {
	createProject,
	deleteProjectById,
	getProjectById,
	getProjectForOwner,
	listProjectsByOwner,
	listPublicProjects,
	updateProjectName,
	updateProjectPublic,
} from "./project.repo";
import type { ProjectDto } from "./project.schemas";
import { mapFlowRowToDto, listFlowsByProject } from "../flow/flow.repo";

function mapProjectRowToDto(row: any): ProjectDto {
	return {
		id: row.id,
		name: row.name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		isPublic: row.is_public === 1,
		owner: row.owner_login ?? undefined,
		ownerName: row.owner_name ?? undefined,
	};
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

export async function cloneProjectForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	newName?: string,
) {
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
	const clonedId = crypto.randomUUID();
	const cloned = await createProject(c.env.DB, {
		id: clonedId,
		name: newName || `${source.name} (Cloned)`,
		ownerId: userId,
		nowIso,
	});

	// copy flows
	const flows = await listFlowsByProject(c.env.DB, projectId);
	if (flows.length > 0) {
		for (const flow of flows) {
			const id = crypto.randomUUID();
			await c.env.DB.prepare(
				`INSERT INTO flows (id, name, data, owner_id, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(
					id,
					flow.name,
					flow.data,
					userId,
					cloned.id,
					nowIso,
					nowIso,
				)
				.run();
		}
	}

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

	// For now, delete flows for this project; other related data
	// (assets, histories) will be handled when those modules migrate.
	const flows = await listFlowsByProject(c.env.DB, projectId);
	const flowIds = flows.map((f) => f.id);

	if (flowIds.length > 0) {
		const placeholders = flowIds.map(() => "?").join(",");
		await c.env.DB.prepare(
			`DELETE FROM flow_versions WHERE flow_id IN (${placeholders})`,
		)
			.bind(...flowIds)
			.run();
		await c.env.DB.prepare(
			`DELETE FROM flows WHERE id IN (${placeholders})`,
		)
			.bind(...flowIds)
			.run();
	}

	await deleteProjectById(c.env.DB, projectId);
}

