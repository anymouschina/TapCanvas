import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { isAdminRequest } from "../team/team.service";
import { getProjectById, updateProjectName, updateProjectPublic } from "../project/project.repo";
import { deleteProjectGraph } from "../project/project-delete";
import {
	normalizeOwnerId,
	upsertTemplateMetaByProject,
} from "../project/project-template-meta";
import type { AdminProjectDto } from "./project-admin.schemas";
import { getProjectForAdmin, listProjectsForAdmin } from "./project-admin.repo";

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

function requireAdmin(c: AppContext): void {
	if (!isAdminRequest(c)) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
}

function normalizeFlowCount(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value ?? 0);
	return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function mapRowToDto(row: any): AdminProjectDto {
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
		id: String(row.id),
		name: String(row.name || ""),
		isPublic: Number(row.is_public ?? 0) === 1,
		ownerId: normalizeOwnerId(row.owner_id),
		owner:
			typeof row.owner_login === "string" ? row.owner_login : row.owner_login ?? null,
		ownerName:
			typeof row.owner_name === "string" ? row.owner_name : row.owner_name ?? null,
		flowCount: normalizeFlowCount(row.flow_count),
		createdAt: String(row.created_at || ""),
		updatedAt: String(row.updated_at || ""),
		templateTitle: templateTitleRaw || String(row.name || ""),
		templateDescription: templateDescriptionRaw || null,
		templateCoverUrl: templateCoverUrlRaw || null,
	};
}

export async function listAdminProjects(
	c: AppContext,
	input: {
		q?: string | null;
		ownerId?: string | null;
		isPublic?: boolean;
		limit?: number;
	},
): Promise<AdminProjectDto[]> {
	requireAdmin(c);
	const rows = await listProjectsForAdmin(c.env.DB, {
		q: input.q,
		ownerId: input.ownerId,
		isPublic: input.isPublic,
		limit: typeof input.limit === "number" ? input.limit : 200,
	});
	return rows.map(mapRowToDto);
}

export async function updateAdminProject(
	c: AppContext,
	input: {
		projectId: string;
		name?: string;
		isPublic?: boolean;
		templateTitle?: string;
		templateDescription?: string;
		templateCoverUrl?: string;
	},
): Promise<AdminProjectDto> {
	requireAdmin(c);

	const projectId = (input.projectId || "").trim();
	if (!projectId) {
		throw new AppError("projectId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const existing = await getProjectById(c.env.DB, projectId);
	if (!existing) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}

	const nowIso = new Date().toISOString();

	if (typeof input.name === "string") {
		const nextName = input.name.trim();
		if (!nextName) {
			throw new AppError("name is required", {
				status: 400,
				code: "invalid_request",
			});
		}
		await updateProjectName(c.env.DB, { id: projectId, name: nextName, nowIso });
	}

	if (typeof input.isPublic === "boolean") {
		await updateProjectPublic(c.env.DB, {
			id: projectId,
			isPublic: input.isPublic,
			nowIso,
		});
	}

	const shouldUpdateTemplateMeta =
		typeof input.templateTitle === "string" ||
		typeof input.templateDescription === "string" ||
		typeof input.templateCoverUrl === "string";
	if (shouldUpdateTemplateMeta) {
		await upsertTemplateMetaByProject(c, {
			projectId,
			projectOwnerId: normalizeOwnerId(existing.owner_id),
			projectName: String(input.name || existing.name || "").trim() || "未命名模板",
			templateTitle: input.templateTitle,
			templateDescription: input.templateDescription,
			templateCoverUrl: input.templateCoverUrl,
			updatedBy: "admin",
			nowIso,
		});
	}

	const updated = await getProjectForAdmin(c.env.DB, projectId);
	if (!updated) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
	return mapRowToDto(updated);
}

export async function deleteAdminProject(
	c: AppContext,
	input: { projectId: string },
): Promise<void> {
	requireAdmin(c);

	const projectId = (input.projectId || "").trim();
	if (!projectId) {
		throw new AppError("projectId is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const existing = await getProjectById(c.env.DB, projectId);
	if (!existing) {
		// idempotent
		return;
	}

	await deleteProjectGraph(projectId);
	await removeProjectDataRootOrThrow(projectId);
}
