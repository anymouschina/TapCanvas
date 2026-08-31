import fs from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	createProject,
	findLatestProjectForOwnerByNamePrefix,
	getProjectById,
	getProjectForUserAccess,
	getProjectForOwner,
	incrementProjectCloneCount,
	listProjectsAccessibleByUser,
	listProjectsAccessibleByUserPaginated,
	listProjectsForTeamPaginated,
	listPublicProjects,
	updateProjectName,
	updateProjectPublic,
	updateProjectSortWeight,
	type ProjectRow,
} from "./project.repo";
import {
	deleteTeamProjectShare,
	listTeamMembershipsByUserId,
	upsertTeamProjectShare,
} from "../team/team.repo";
import { upsertTemplateMetaByProject } from "./project-template-meta";
import type { ProjectDto } from "./project.schemas";
import { getFlowByIdUnsafe, mapFlowRowToDto, listFlowsByProject } from "../flow/flow.repo";
import { deleteProjectGraph } from "./project-delete";
import { listProjectChatArtifactSessions, listPublicProjectConversations } from "../memory/memory.repo";
import {
	listPublicChatSessionsByPrefix,
	listPublicChatMessages,
	resolveOrCreatePublicChatSession,
	appendPublicChatMessage,
} from "../apiKey/public-chat-session.repo";
import {
	ensureChapterSchema,
	listChaptersByProjectForOwner,
} from "../chapter/chapter.repo";
import { CanvasFlowSchema } from "../chapter/chapter.canvas-flow.schemas";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { execute } from "../../db/db";
import { projectWorkflowGraphForViewer } from "@tapcanvas/workflow-kernel-protocol";
import { cloneProjectMaterialAssets } from "../material/material.repo";
import {
	rewriteClonedBookIndexes,
	rewriteClonedChapterCanvasFlow,
} from "./project-clone-rewrite";

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
		cloneCount: row.clone_count ?? 0,
		sortWeight: row.sort_weight ?? 0,
		templateTitle: templateTitleRaw || row.name,
		templateDescription: templateDescriptionRaw || undefined,
		templateCoverUrl: templateCoverUrlRaw || undefined,
		teamShared: Boolean(row.team_shared),
		teamId: row.team_id ?? undefined,
		access: row.access ?? (row.owner_id ? "owner" : undefined),
		projectKind: row.project_kind === "ai_workflow" ? "ai_workflow" : "creative",
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

function rewriteFlowOwnerMeta(rawData: string, targetProjectId: string): string {
	try {
		const parsed = JSON.parse(rawData);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return rawData;
		return JSON.stringify({
			...parsed,
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: targetProjectId },
		});
	} catch {
		return rawData;
	}
}

async function copyProjectFlowsToTarget(input: {
	c: AppContext;
	ownerId: string;
	sourceOwnerId: string;
	sourceProjectId: string;
	targetProjectId: string;
	nowIso: string;
	replaceExisting: boolean;
	nextProjectName?: string;
}): Promise<void> {
	const prisma = getPrismaClient();
	const db = input.c.env.DB;
	const sourceFlows = await listFlowsByProject(db, input.sourceProjectId);

	const flowIdMapping: Array<{ oldId: string; newId: string }> = [];

	if (!input.replaceExisting) {
		for (const flow of sourceFlows) {
			const newFlowId = crypto.randomUUID();
			flowIdMapping.push({ oldId: flow.id, newId: newFlowId });
			await prisma.flows.create({
				data: {
					id: newFlowId,
					name: flow.name,
					data: rewriteFlowOwnerMeta(flow.data, input.targetProjectId),
					owner_id: input.ownerId,
					project_id: input.targetProjectId,
					created_at: input.nowIso,
					updated_at: input.nowIso,
				},
			});
		}
	} else {
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
						data: rewriteFlowOwnerMeta(flow.data, input.targetProjectId),
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

		// Replace assets: delete target then recreate from source
		await prisma.assets.deleteMany({
			where: { project_id: input.targetProjectId, owner_id: input.ownerId },
		});
	}

	// Copy source assets to target
	const sourceAssets = await prisma.assets.findMany({
		where: { project_id: input.sourceProjectId },
	});
	if (sourceAssets.length > 0) {
		await prisma.assets.createMany({
			data: sourceAssets.map((asset) => ({
				id: crypto.randomUUID(),
				name: asset.name,
				data: asset.data,
				owner_id: input.ownerId,
				project_id: input.targetProjectId,
				created_at: input.nowIso,
				updated_at: input.nowIso,
			})),
		});
	}

	// Material assets are the stable identity plane used by Workflow IR. Canvas
	// nodes alone are not a substitute: dropping this graph makes a cloned project
	// silently regenerate character/scene images during the next paid run.
	await cloneProjectMaterialAssets(db, {
		sourceProjectId: input.sourceProjectId,
		targetProjectId: input.targetProjectId,
		targetOwnerId: input.ownerId,
		nowIso: input.nowIso,
		replaceExisting: input.replaceExisting,
	});

	// Copy chapter rows (without these, the cloned project has an empty chapter list
	// and the user is forced to manually re-import a book to bootstrap chapters).
	await ensureChapterSchema(db);
	if (input.replaceExisting) {
		await execute(
			db,
			`DELETE FROM chapters WHERE project_id = ? AND owner_id = ?`,
			[input.targetProjectId, input.ownerId],
		);
	}
	if (input.sourceOwnerId) {
		const sourceChapters = await listChaptersByProjectForOwner({
			db,
			projectId: input.sourceProjectId,
			ownerId: input.sourceOwnerId,
		});
		const sourceChapterCanvases = await prisma.chapters.findMany({
			where: {
				project_id: input.sourceProjectId,
				owner_id: input.sourceOwnerId,
			},
			select: {
				id: true,
				canvas_flow: true,
				canvas_flow_revision: true,
			},
		});
		const sourceChapterCanvasById = new Map(
			sourceChapterCanvases.map((chapter) => [chapter.id, chapter]),
		);
		for (const ch of sourceChapters) {
			const targetChapterId = crypto.randomUUID();
			const sourceCanvas = sourceChapterCanvasById.get(ch.id);
			const clonedCanvasFlow = rewriteClonedChapterCanvasFlow({
				rawFlow: sourceCanvas?.canvas_flow ?? null,
				sourceProjectId: input.sourceProjectId,
				targetProjectId: input.targetProjectId,
				sourceChapterId: ch.id,
				targetChapterId,
			});
			await execute(
				db,
				`INSERT INTO chapters (
					id, owner_id, project_id, chapter_index, title, summary, status,
					 sort_order, cover_asset_id, continuity_context, style_profile_override,
					 legacy_chunk_index, source_book_id, source_book_chapter, last_worked_at,
					 canvas_flow, canvas_flow_revision, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					targetChapterId,
					input.ownerId,
					input.targetProjectId,
					ch.chapter_index,
					ch.title,
					ch.summary,
					ch.status,
					ch.sort_order,
					null,
					ch.continuity_context,
					ch.style_profile_override,
					ch.legacy_chunk_index,
					ch.source_book_id,
					ch.source_book_chapter,
					null,
					clonedCanvasFlow,
					sourceCanvas?.canvas_flow_revision ?? 0,
					input.nowIso,
					input.nowIso,
				],
			);
		}
	}

	// Copy book filesystem dir. /assets/books reads from
	// <repoRoot>/project-data/users/<userId>/projects/<projectId>/books/, which is
	// scoped per (userId, projectId). Without this copy the cloned project has no
	// book on disk and the user has to re-upload the original novel.
	if (input.sourceOwnerId) {
		const repoRoot = resolveProjectDataRepoRoot();
		const sourceBooksRoot = path.join(
			repoRoot,
			"project-data",
			"users",
			sanitizePathSegment(input.sourceOwnerId),
			"projects",
			sanitizePathSegment(input.sourceProjectId),
			"books",
		);
		const targetBooksRoot = path.join(
			repoRoot,
			"project-data",
			"users",
			sanitizePathSegment(input.ownerId),
			"projects",
			sanitizePathSegment(input.targetProjectId),
			"books",
		);
		if (input.replaceExisting) {
			await fs.rm(targetBooksRoot, { recursive: true, force: true });
		}
		const sourceStat = await fs.stat(sourceBooksRoot).catch(() => null);
		if (sourceStat?.isDirectory()) {
			await fs.mkdir(path.dirname(targetBooksRoot), { recursive: true });
			await fs.cp(sourceBooksRoot, targetBooksRoot, { recursive: true });
			await rewriteClonedBookIndexes({
				targetBooksRoot,
				sourceOwnerId: sanitizePathSegment(input.sourceOwnerId),
				targetOwnerId: sanitizePathSegment(input.ownerId),
				sourceProjectId: sanitizePathSegment(input.sourceProjectId),
				targetProjectId: sanitizePathSegment(input.targetProjectId),
			});
		}
	}

	// Copy conversation history (only for fresh clone to avoid overwriting user's own conversations).
	// Session keys embed the flow ID (e.g. project:<pid>:flow:<fid>:conversation:<key>:lane:...).
	// We rewrite both the project ID and any flow IDs using the mapping built above so that the
	// cloned project's chat panel can find the sessions by its own effective session key.
	if (!input.replaceExisting) {
		const srcPrefix = `project:${input.sourceProjectId}`;
		const tgtPrefix = `project:${input.targetProjectId}`;
		const sourceSessions = await listPublicChatSessionsByPrefix(db, {
			userId: input.sourceOwnerId,
			sessionKeyPrefix: srcPrefix,
			limit: 10,
		});
		for (const session of sourceSessions) {
			const messages = await listPublicChatMessages(db, {
				userId: input.sourceOwnerId,
				sessionId: session.id,
				limit: 80,
			});
			if (!messages.length) continue;
			let newSessionKey = session.session_key.startsWith(srcPrefix)
				? tgtPrefix + session.session_key.slice(srcPrefix.length)
				: `${tgtPrefix}:${session.id.slice(0, 8)}`;
			// Replace embedded source flow IDs with the corresponding target flow IDs.
			for (const { oldId, newId } of flowIdMapping) {
				newSessionKey = newSessionKey.replace(`:flow:${oldId}:`, `:flow:${newId}:`);
			}
			const newSession = await resolveOrCreatePublicChatSession(db, {
				id: crypto.randomUUID(),
				userId: input.ownerId,
				sessionKey: newSessionKey,
				nowIso: input.nowIso,
			});
			if (!newSession) continue;
			for (const msg of messages) {
				if (!msg.content?.trim()) continue;
				await appendPublicChatMessage(db, {
					id: crypto.randomUUID(),
					userId: input.ownerId,
					sessionId: newSession.id,
					role: msg.role as "user" | "assistant",
					content: msg.content,
					assetsJson: msg.assets_json ?? null,
					nowIso: msg.created_at,
				});
			}
		}
	}
}

export async function listUserProjects(c: AppContext, userId: string) {
	const rows = await listProjectsAccessibleByUser(c.env.DB, userId);
	return rows.map(mapProjectRowToDto);
}

function assertProjectCursorIsStructurallyValid(cursor?: string): void {
	if (!cursor) return;
	const separatorIndex = cursor.lastIndexOf("__");
	if (separatorIndex > 0 && separatorIndex < cursor.length - 2) return;
	throw new AppError("Invalid project cursor", {
		status: 400,
		code: "project_cursor_invalid",
	});
}

export async function listUserProjectsPaginated(
	c: AppContext,
	userId: string,
	params: { limit: number; cursor?: string; teamId?: string },
) {
	assertProjectCursorIsStructurallyValid(params.cursor);
	// 个人 team（personal_<uid> / "personal" 哨兵）并非真实团队——它在 team_project_shares
	// 没有任何共享记录，若按团队维度查询必然返回空。把它等同“未选团队”，回退到个人可见项目，
	// 这样“没有选择 team”默认就是查个人项目，而不是空列表。
	const teamId = (params.teamId || "").trim();
	const useTeamScope = teamId !== "" && teamId !== "personal" && !isPersonalTeam(teamId);
	const result = useTeamScope
		? await listProjectsForTeamPaginated(c.env.DB, userId, teamId, params)
		: await listProjectsAccessibleByUserPaginated(c.env.DB, userId, params);
	return { items: result.items.map(mapProjectRowToDto), nextCursor: result.nextCursor };
}

export async function listPublicProjectDtos(c: AppContext) {
	const rows = await listPublicProjects(c.env.DB);
	return rows.map(mapProjectRowToDto);
}

export async function upsertProjectForUser(
	c: AppContext,
	userId: string,
	input: { id?: string; name: string; teamId?: string },
) {
	const nowIso = new Date().toISOString();

	if (input.id) {
		const existing = await getProjectForUserAccess(c.env.DB, input.id, userId);
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

	await autoShareProjectWithActiveTeam(c, {
		projectId: id,
		userId,
		fallbackTeamId: input.teamId,
		nowIso,
	});

	return mapProjectRowToDto(created);
}

// Make a freshly-created project visible to the team it was created "in".
// We key off the request's active team (X-Team-Id header, surfaced as
// c.get("activeTeamId")) — the SAME signal that bills generations to team
// credits — so "uses team credits" and "shows up in the team list" can never
// drift apart. Body teamId is kept only as a fallback for callers that still
// pass it. Best-effort: a share failure must not break project creation, but
// (unlike before) it is logged instead of silently swallowed, since silent
// failures hid the bug where member-created / cloned projects never reached the
// team project list.
async function autoShareProjectWithActiveTeam(
	c: AppContext,
	input: {
		projectId: string;
		userId: string;
		fallbackTeamId?: string;
		nowIso: string;
	},
): Promise<void> {
	const headerTeamId = (c.get("activeTeamId") || "").trim();
	const teamId = headerTeamId || (input.fallbackTeamId || "").trim();
	if (!teamId || isPersonalTeam(teamId)) return;
	try {
		// Only share into teams the creator actually belongs to.
		const memberships = await listTeamMembershipsByUserId(c.env.DB, input.userId);
		if (!memberships.some((m) => m.team_id === teamId)) return;
		await upsertTeamProjectShare(c.env.DB, {
			projectId: input.projectId,
			teamId,
			access: "edit",
			sharedByUserId: input.userId,
			nowIso: input.nowIso,
		});
	} catch (error) {
		console.warn("[project] auto-share with active team failed", {
			projectId: input.projectId,
			teamId,
			userId: input.userId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
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
		sortWeight?: number;
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
	if (typeof input.sortWeight === "number") {
		await updateProjectSortWeight(projectId, input.sortWeight);
	}
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
			status: 404,
			code: "project_not_found",
		});
	}
	if (source.is_public !== 1) {
		const accessibleSource = await getProjectForUserAccess(c.env.DB, projectId, userId);
		if (!accessibleSource) {
			throw new AppError("Project does not allow copying", {
				status: 403,
				code: "project_copy_forbidden",
			});
		}
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
				sourceOwnerId: source.owner_id ?? "",
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
		sourceOwnerId: source.owner_id ?? "",
		sourceProjectId: projectId,
		targetProjectId: cloned.id,
		nowIso,
		replaceExisting: false,
	});

	await incrementProjectCloneCount(projectId).catch(() => {});

	// Record remix/二创 lineage on the cloned project for attribution ("改编自 @作者").
	await getPrismaClient()
		.projects.update({ where: { id: cloned.id }, data: { forked_from_project_id: projectId } })
		.catch(() => {});

	// Cloning in team context must also land the clone in the team list. The
	// frontend clone call sends no body teamId, so this relies on the active-team
	// header — the same signal used for credits and for create.
	await autoShareProjectWithActiveTeam(c, {
		projectId: cloned.id,
		userId,
		nowIso,
	});

	return mapProjectRowToDto(cloned);
}

export type PublicProjectScope = {
	ownerType: "chapter";
	ownerId: string;
};

async function getPublicProjectChapterOrThrow(projectId: string, chapterId: string) {
	const chapter = await getPrismaClient().chapters.findFirst({
		where: {
			id: chapterId,
			project_id: projectId,
		},
		select: {
			id: true,
			title: true,
			canvas_flow: true,
			canvas_flow_revision: true,
			created_at: true,
			updated_at: true,
		},
	});
	if (!chapter) {
		throw new AppError("Chapter is not attached to the public project", {
			status: 404,
			code: "public_project_chapter_not_found",
			details: { projectId, chapterId },
		});
	}
	return chapter;
}

type PublicProjectChapterCanvas = Awaited<ReturnType<typeof getPublicProjectChapterOrThrow>>;

function mapPublicChapterCanvas(projectId: string, chapter: PublicProjectChapterCanvas) {
	let rawFlow: unknown = { nodes: [], edges: [] };
	if (chapter.canvas_flow) {
		try {
			rawFlow = JSON.parse(chapter.canvas_flow) as unknown;
		} catch (error) {
			throw new AppError("Public chapter canvas flow is corrupted", {
				status: 500,
				code: "public_chapter_canvas_flow_corrupted",
				details: {
					projectId,
					chapterId: chapter.id,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
	const parsedFlow = CanvasFlowSchema.safeParse(rawFlow);
	if (!parsedFlow.success) {
		throw new AppError("Public chapter canvas flow has an invalid structure", {
			status: 500,
			code: "public_chapter_canvas_flow_invalid",
			details: {
				projectId,
				chapterId: chapter.id,
				issues: parsedFlow.error.issues,
			},
		});
	}

	const visibleFlow = CanvasFlowSchema.parse(
		projectWorkflowGraphForViewer(parsedFlow.data, false),
	);
	return {
		id: `chapter:${chapter.id}`,
		name: chapter.title,
		data: visibleFlow,
		ownerType: "chapter" as const,
		ownerId: chapter.id,
		canvasRevision: chapter.canvas_flow_revision,
		createdAt: chapter.created_at,
		updatedAt: chapter.updated_at,
	};
}

export async function getPublicProjectFlows(
	c: AppContext,
	projectId: string,
	scope?: PublicProjectScope,
) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project || project.is_public !== 1) {
		throw new AppError("Project creation process is not public", {
			status: 403,
			code: "project_process_not_public",
		});
	}

	if (scope?.ownerType === "chapter") {
		const chapter = await getPublicProjectChapterOrThrow(projectId, scope.ownerId);
		return [mapPublicChapterCanvas(projectId, chapter)];
	}

	const [flows, chapters] = await Promise.all([
		listFlowsByProject(c.env.DB, projectId),
		getPrismaClient().chapters.findMany({
			where: { project_id: projectId },
			select: {
				id: true,
				title: true,
				canvas_flow: true,
				canvas_flow_revision: true,
				created_at: true,
				updated_at: true,
			},
			orderBy: [{ sort_order: "asc" }, { chapter_index: "asc" }],
		}),
	]);
	return [
		...flows.map((flow) => {
			const dto = mapFlowRowToDto(flow);
			return {
				...dto,
				data: projectWorkflowGraphForViewer(dto.data, false),
			};
		}),
		...chapters.map((chapter) => mapPublicChapterCanvas(projectId, chapter)),
	];
}

export async function getPublicProjectFlow(c: AppContext, flowId: string) {
	const flow = await getFlowByIdUnsafe(c.env.DB, flowId);
	if (!flow) {
		throw new AppError("Flow not found", {
			status: 404,
			code: "flow_not_found",
		});
	}
	const projectId = String(flow.project_id || "").trim();
	if (!projectId) {
		throw new AppError("Flow is not attached to a public project", {
			status: 403,
			code: "flow_not_public",
		});
	}
	const project = await getProjectById(c.env.DB, projectId);
	if (!project || project.is_public !== 1) {
		throw new AppError("Flow is not public", {
			status: 403,
			code: "flow_not_public",
		});
	}
	const dto = mapFlowRowToDto(flow);
	return {
		...dto,
		data: projectWorkflowGraphForViewer(dto.data, false),
	};
}

export async function getPublicProjectConversation(
	c: AppContext,
	projectId: string,
	scope?: PublicProjectScope,
) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project || project.is_public !== 1) {
		throw new AppError("Project creation process is not public", {
			status: 403,
			code: "project_process_not_public",
		});
	}
	if (scope?.ownerType === "chapter") {
		await getPublicProjectChapterOrThrow(projectId, scope.ownerId);
	}
	return listPublicProjectConversations(c.env.DB, {
		userId: project.owner_id ?? "",
		projectId,
		...(scope?.ownerType === "chapter" ? { chapterId: scope.ownerId } : {}),
		...(scope?.ownerType === "chapter" ? {} : { includeChapterSessions: true }),
		limitSessions: 10,
		limitMessages: 120,
	});
}

export async function getPublicProjectChatSessions(c: AppContext, projectId: string) {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project || project.is_public !== 1) {
		throw new AppError("Project creation process is not public", {
			status: 403,
			code: "project_process_not_public",
		});
	}
	return listProjectChatArtifactSessions(c.env.DB, {
		userId: project.owner_id ?? "",
		projectId,
		limitSessions: 10,
		limitTurns: 10,
	});
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

function resolveTeamRole(role: unknown): "owner" | "admin" | "member" {
	const r = typeof role === "string" ? role.trim().toLowerCase() : "";
	if (r === "owner" || r === "admin" || r === "member") return r;
	return "member";
}

function isPersonalTeam(teamId: string): boolean {
	return String(teamId || "").trim().startsWith("personal_");
}

export async function shareProjectWithMyTeam(
	c: AppContext,
	userId: string,
	input: { projectId: string; teamId: string; shared: boolean },
) {
	const project = await getProjectById(c.env.DB, input.projectId);
	if (!project) {
		throw new AppError("Project not found", { status: 404, code: "project_not_found" });
	}
	if (project.owner_id !== userId) {
		throw new AppError("Not project owner", { status: 403, code: "forbidden" });
	}

	const teamId = input.teamId.trim();
	if (!teamId || isPersonalTeam(teamId)) {
		throw new AppError("个人账户不能作为项目共享目标", {
			status: 400,
			code: "team_required",
		});
	}

	const memberships = await listTeamMembershipsByUserId(c.env.DB, userId);
	const membership = memberships.find((m) => m.team_id === teamId) ?? null;
	if (!membership) {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}

	const role = resolveTeamRole(membership.role);
	if (role !== "owner" && role !== "admin") {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	if (input.shared === false) {
		await deleteTeamProjectShare(c.env.DB, { projectId: project.id, teamId });
		return null;
	}
	return upsertTeamProjectShare(c.env.DB, {
		projectId: project.id,
		teamId,
		access: "edit",
		sharedByUserId: userId,
		nowIso: new Date().toISOString(),
	});
}
