import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { ProjectRow } from "./project.repo";

const {
	createProject,
	findLatestProjectForOwnerByNamePrefix,
	getProjectById,
	getProjectForUserAccess,
	getProjectForOwner,
	listFlowsByProject,
	ensureChapterSchema,
	listChaptersByProjectForOwner,
	listPublicChatSessionsByPrefix,
	listPublicProjectConversations,
	listProjectChatArtifactSessions,
	execute,
	listTeamMembershipsByUserId,
	deleteTeamProjectShare,
	upsertTeamProjectShare,
	cloneProjectMaterialAssets,
	prisma,
	transactionClient,
} = vi.hoisted(() => ({
	createProject: vi.fn(),
	findLatestProjectForOwnerByNamePrefix: vi.fn(),
	getProjectById: vi.fn(),
	getProjectForUserAccess: vi.fn(),
	getProjectForOwner: vi.fn(),
	listFlowsByProject: vi.fn(),
	ensureChapterSchema: vi.fn(),
	listChaptersByProjectForOwner: vi.fn(),
	listPublicChatSessionsByPrefix: vi.fn(),
	listPublicProjectConversations: vi.fn(),
	listProjectChatArtifactSessions: vi.fn(),
	execute: vi.fn(),
	listTeamMembershipsByUserId: vi.fn(),
	deleteTeamProjectShare: vi.fn(),
	upsertTeamProjectShare: vi.fn(),
	cloneProjectMaterialAssets: vi.fn(),
	prisma: {
		flows: {
			create: vi.fn(),
		},
		assets: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
			createMany: vi.fn(),
		},
		projects: {
			update: vi.fn(),
		},
		chapters: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
		},
		$transaction: vi.fn(),
	},
	transactionClient: {
		flows: {
			findMany: vi.fn(),
			deleteMany: vi.fn(),
			createMany: vi.fn(),
		},
		flow_versions: {
			deleteMany: vi.fn(),
		},
		projects: {
			update: vi.fn(),
		},
	},
}));

vi.mock("./project.repo", async () => {
	const actual = await vi.importActual<typeof import("./project.repo")>(
		"./project.repo",
	);
	return {
		...actual,
		createProject,
		findLatestProjectForOwnerByNamePrefix,
		getProjectById,
		getProjectForUserAccess,
		getProjectForOwner,
	};
});

vi.mock("../flow/flow.repo", async () => {
	const actual = await vi.importActual<typeof import("../flow/flow.repo")>(
		"../flow/flow.repo",
	);
	return {
		...actual,
		listFlowsByProject,
	};
});

vi.mock("../chapter/chapter.repo", async () => {
	const actual = await vi.importActual<typeof import("../chapter/chapter.repo")>(
		"../chapter/chapter.repo",
	);
	return {
		...actual,
		ensureChapterSchema,
		listChaptersByProjectForOwner,
	};
});

vi.mock("../apiKey/public-chat-session.repo", async () => {
	const actual = await vi.importActual<typeof import("../apiKey/public-chat-session.repo")>(
		"../apiKey/public-chat-session.repo",
	);
	return {
		...actual,
		listPublicChatSessionsByPrefix,
	};
});

vi.mock("../memory/memory.repo", async () => {
	const actual = await vi.importActual<typeof import("../memory/memory.repo")>(
		"../memory/memory.repo",
	);
	return {
		...actual,
		listPublicProjectConversations,
		listProjectChatArtifactSessions,
	};
});

vi.mock("../../db/db", async () => {
	const actual = await vi.importActual<typeof import("../../db/db")>("../../db/db");
	return { ...actual, execute };
});

vi.mock("../team/team.repo", async () => {
	const actual = await vi.importActual<typeof import("../team/team.repo")>(
		"../team/team.repo",
	);
	return {
		...actual,
		listTeamMembershipsByUserId,
		deleteTeamProjectShare,
		upsertTeamProjectShare,
	};
});

vi.mock("../material/material.repo", async () => {
	const actual = await vi.importActual<typeof import("../material/material.repo")>(
		"../material/material.repo",
	);
	return { ...actual, cloneProjectMaterialAssets };
});

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));

import {
	cloneProjectForUser,
	getPublicProjectChatSessions,
	getPublicProjectConversation,
	getPublicProjectFlows,
	shareProjectWithMyTeam,
	upsertProjectForUser,
} from "./project.service";

type TransactionCallback = (
	tx: typeof transactionClient,
) => Promise<unknown> | unknown;

function createContext(activeTeamId: string | null = null): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
		get: (key: string) => (key === "activeTeamId" ? activeTeamId : undefined),
	} as unknown as AppContext;
}

function createProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
	return {
		id: "project-1",
		name: "七十二变（0327）",
		is_public: 0,
		owner_id: "user-1",
		created_at: "2026-03-29T00:00:00.000Z",
		updated_at: "2026-03-29T00:00:00.000Z",
		owner_login: "phone_1273",
		owner_name: "phone_1273",
		template_title: null,
		template_description: null,
		template_cover_url: null,
		...overrides,
	};
}

function createFlowRow(overrides: Partial<FlowRow> = {}): FlowRow {
	return {
		id: "flow-1",
		name: "第一章",
		data: JSON.stringify({ nodes: [], edges: [] }),
		owner_id: "user-1",
		project_id: "project-1",
		created_at: "2026-03-29T00:00:00.000Z",
		updated_at: "2026-03-29T00:00:00.000Z",
		...overrides,
	};
}

describe("cloneProjectForUser replay clone reuse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getProjectForUserAccess.mockResolvedValue(createProjectRow());
		listFlowsByProject.mockResolvedValue([
			createFlowRow({ id: "flow-a", name: "分镜 A" }),
			createFlowRow({ id: "flow-b", name: "分镜 B" }),
		]);
		prisma.assets.findMany.mockResolvedValue([]);
		prisma.assets.deleteMany.mockResolvedValue({ count: 0 });
		prisma.assets.createMany.mockResolvedValue({ count: 0 });
		prisma.projects.update.mockResolvedValue(undefined);
		prisma.chapters.findMany.mockResolvedValue([]);
		listChaptersByProjectForOwner.mockResolvedValue([]);
		listPublicChatSessionsByPrefix.mockResolvedValue([]);
		transactionClient.flows.findMany.mockResolvedValue([]);
		transactionClient.flows.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.flows.createMany.mockResolvedValue({ count: 0 });
		transactionClient.flow_versions.deleteMany.mockResolvedValue({ count: 0 });
		transactionClient.projects.update.mockResolvedValue(undefined);
		prisma.flows.create.mockResolvedValue(undefined);
		prisma.$transaction.mockImplementation(async (callback: unknown) => {
			if (typeof callback !== "function") {
				throw new Error("Expected transaction callback");
			}
			return await (callback as TransactionCallback)(transactionClient);
		});
	});

	it("reuses an existing local replay project and refreshes its flows", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const replayProject = createProjectRow({
			id: "replay-project",
			name: "七十二变（0327） local replay 2026-03-29T03-27-01-177Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(replayProject);
		getProjectForOwner.mockResolvedValue(replayProject);
		transactionClient.flows.findMany.mockResolvedValue([{ id: "old-flow-1" }]);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local replay 2026-03-29T03-30-28-745Z",
		);

		expect(findLatestProjectForOwnerByNamePrefix).toHaveBeenCalledWith(
			expect.anything(),
			{
				ownerId: "user-1",
				namePrefix: "七十二变（0327） local replay ",
				excludeProjectId: "source-project",
			},
		);
		expect(createProject).not.toHaveBeenCalled();
		expect(prisma.flows.create).not.toHaveBeenCalled();
		expect(transactionClient.flow_versions.deleteMany).toHaveBeenCalledWith({
			where: { flow_id: { in: ["old-flow-1"] } },
		});
		expect(transactionClient.flows.deleteMany).toHaveBeenCalledWith({
			where: {
				project_id: "replay-project",
				owner_id: "user-1",
			},
		});
		expect(transactionClient.flows.createMany).toHaveBeenCalledWith({
			data: [
					expect.objectContaining({
						name: "分镜 A",
						data: JSON.stringify({
							nodes: [],
							edges: [],
							__tapcanvasFlowOwner: { ownerType: "project", ownerId: "replay-project" },
						}),
					owner_id: "user-1",
					project_id: "replay-project",
				}),
					expect.objectContaining({
						name: "分镜 B",
						data: JSON.stringify({
							nodes: [],
							edges: [],
							__tapcanvasFlowOwner: { ownerType: "project", ownerId: "replay-project" },
						}),
					owner_id: "user-1",
					project_id: "replay-project",
				}),
			],
		});
		expect(transactionClient.projects.update).toHaveBeenCalledWith({
			where: { id: "replay-project" },
			data: expect.objectContaining({
				name: "七十二变（0327） local replay 2026-03-29T03-30-28-745Z",
			}),
		});
		expect(cloneProjectMaterialAssets).toHaveBeenCalledWith(
			expect.anything(),
			{
				sourceProjectId: "source-project",
				targetProjectId: "replay-project",
				targetOwnerId: "user-1",
				nowIso: expect.any(String),
				replaceExisting: true,
			},
		);
		expect(result).toMatchObject({ id: "replay-project" });
	});

	it("recognizes local direct replay names and reuses the existing replay project", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const replayProject = createProjectRow({
			id: "direct-replay-project",
			name: "七十二变（0327） local direct replay 2026-03-29T03-38-42-105Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(replayProject);
		getProjectForOwner.mockResolvedValue(replayProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local direct replay 2026-03-29T04-00-00-000Z",
		);

		expect(findLatestProjectForOwnerByNamePrefix).toHaveBeenCalledWith(
			expect.anything(),
			{
				ownerId: "user-1",
				namePrefix: "七十二变（0327） local direct replay ",
				excludeProjectId: "source-project",
			},
		);
		expect(transactionClient.flow_versions.deleteMany).not.toHaveBeenCalled();
		expect(createProject).not.toHaveBeenCalled();
		expect(result).toMatchObject({ id: "direct-replay-project" });
	});

	it("creates a fresh replay project when no prior replay clone exists", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const clonedProject = createProjectRow({
			id: "new-replay-project",
			name: "七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
		});

		getProjectById.mockResolvedValue(sourceProject);
		findLatestProjectForOwnerByNamePrefix.mockResolvedValue(null);
		createProject.mockResolvedValue(clonedProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
		);

		expect(createProject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				name: "七十二变（0327） local replay 2026-03-29T05-00-00-000Z",
				ownerId: "user-1",
			}),
		);
		expect(prisma.flows.create).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ id: "new-replay-project" });
	});

	it("keeps normal clone names on the original create-new-project path", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const clonedProject = createProjectRow({
			id: "plain-clone-project",
			name: "七十二变（0327） 自定义副本",
		});

		getProjectById.mockResolvedValue(sourceProject);
		createProject.mockResolvedValue(clonedProject);

		const result = await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"七十二变（0327） 自定义副本",
		);

		expect(findLatestProjectForOwnerByNamePrefix).not.toHaveBeenCalled();
		expect(createProject).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				name: "七十二变（0327） 自定义副本",
				ownerId: "user-1",
			}),
		);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(prisma.flows.create).toHaveBeenCalledTimes(2);
		expect(cloneProjectMaterialAssets).toHaveBeenCalledWith(
			expect.anything(),
			{
				sourceProjectId: "source-project",
				targetProjectId: "plain-clone-project",
				targetOwnerId: "user-1",
				nowIso: expect.any(String),
				replaceExisting: false,
			},
		);
		expect(result).toMatchObject({ id: "plain-clone-project" });
	});

	it("rejects copying a private project the requester cannot access", async () => {
		getProjectById.mockResolvedValue(createProjectRow({
			id: "private-project",
			owner_id: "another-user",
			is_public: 0,
		}));
		getProjectForUserAccess.mockResolvedValue(null);

		await expect(cloneProjectForUser(
			createContext(),
			"user-1",
			"private-project",
			"不可复制副本",
		)).rejects.toMatchObject({
			status: 403,
			code: "project_copy_forbidden",
		});
		expect(createProject).not.toHaveBeenCalled();
	});

	it("allows an authenticated requester to copy a public project", async () => {
		const publicProject = createProjectRow({ id: "public-project", is_public: 1 });
		const clonedProject = createProjectRow({ id: "public-project-copy" });
		getProjectById.mockResolvedValue(publicProject);
		createProject.mockResolvedValue(clonedProject);

		await cloneProjectForUser(createContext(), "user-1", "public-project", "公开项目副本");

		expect(getProjectForUserAccess).not.toHaveBeenCalled();
		expect(createProject).toHaveBeenCalled();
	});

	it("copies a chapter canvas and rebases its project and chapter identities", async () => {
		const sourceProject = createProjectRow({ id: "source-project" });
		const clonedProject = createProjectRow({ id: "target-project" });
		getProjectById.mockResolvedValue(sourceProject);
		createProject.mockResolvedValue(clonedProject);
		listChaptersByProjectForOwner.mockResolvedValue([{
			id: "source-chapter",
			owner_id: "user-1",
			project_id: "source-project",
			chapter_index: 1,
			title: "第一章",
			summary: "正文",
			status: "draft",
			sort_order: 10,
			cover_asset_id: null,
			continuity_context: null,
			style_profile_override: null,
			legacy_chunk_index: 1,
			source_book_id: "book-1",
			source_book_chapter: 1,
			last_worked_at: null,
			created_at: "2026-08-25T00:00:00.000Z",
			updated_at: "2026-08-25T00:00:00.000Z",
		}]);
		prisma.chapters.findMany.mockResolvedValue([{
			id: "source-chapter",
			canvas_flow: JSON.stringify({
				nodes: [{
					id: "chapter-seed-source-chapter",
					data: {
						sourceProjectId: "source-project",
						sourceChapterId: "source-chapter",
						imageUrl: "https://oss.example/image.png",
					},
				}],
				edges: [],
			}),
			canvas_flow_revision: 9,
		}]);

		await cloneProjectForUser(
			createContext(),
			"user-1",
			"source-project",
			"章节资产副本",
		);

		const chapterInsert = execute.mock.calls.find((call) =>
			String(call[1]).includes("INSERT INTO chapters")
		);
		expect(chapterInsert).toBeDefined();
		const values = chapterInsert?.[2] as unknown[];
		const targetChapterId = String(values[0]);
		const clonedCanvas = JSON.parse(String(values[15])) as {
			__tapcanvasFlowOwner: { ownerId: string };
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
		};
		expect(values[16]).toBe(9);
		expect(clonedCanvas.__tapcanvasFlowOwner.ownerId).toBe(targetChapterId);
		expect(clonedCanvas.nodes[0]).toMatchObject({
			id: `chapter-seed-${targetChapterId}`,
			data: {
				sourceProjectId: "target-project",
				sourceChapterId: targetChapterId,
				imageUrl: "https://oss.example/image.png",
			},
		});
	});
});

describe("public project process access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prisma.chapters.findMany.mockResolvedValue([]);
	});

	it("rejects canvas, conversation, and artifact access when the project is private", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 0 }));

		await expect(getPublicProjectFlows(createContext(), "project-1")).rejects.toMatchObject({
			status: 403,
			code: "project_process_not_public",
		});
		await expect(getPublicProjectConversation(createContext(), "project-1")).rejects.toMatchObject({
			status: 403,
			code: "project_process_not_public",
		});
		await expect(getPublicProjectChatSessions(createContext(), "project-1")).rejects.toMatchObject({
			status: 403,
			code: "project_process_not_public",
		});
		expect(listFlowsByProject).not.toHaveBeenCalled();
		expect(listPublicProjectConversations).not.toHaveBeenCalled();
		expect(listProjectChatArtifactSessions).not.toHaveBeenCalled();
	});

	it("returns the real canvas and conversation data when the project is public", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		listFlowsByProject.mockResolvedValue([createFlowRow()]);
		listPublicProjectConversations.mockResolvedValue([{ sessionId: "session-1", messages: [] }]);

		const flows = await getPublicProjectFlows(createContext(), "project-1");
		const conversation = await getPublicProjectConversation(createContext(), "project-1");

		expect(flows).toEqual([expect.objectContaining({ id: "flow-1", name: "第一章" })]);
		expect(conversation).toEqual([{ sessionId: "session-1", messages: [] }]);
		expect(listPublicProjectConversations).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ projectId: "project-1", includeChapterSessions: true }),
		);
		expect(listPublicProjectConversations.mock.calls.at(-1)?.[1]).not.toHaveProperty("chapterId");
	});

	it("returns project and chapter canvases as one complete public directory", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		listFlowsByProject.mockResolvedValue([createFlowRow({ id: "root-flow", name: "项目画布" })]);
		prisma.chapters.findMany.mockResolvedValue([{
			id: "chapter-1",
			title: "第一章",
			canvas_flow: JSON.stringify({ nodes: [{ id: "chapter-node" }], edges: [] }),
			canvas_flow_revision: 3,
			created_at: "2026-07-20T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		}]);

		const flows = await getPublicProjectFlows(createContext(), "project-1");

		expect(flows).toEqual([
			expect.objectContaining({ id: "root-flow" }),
			expect.objectContaining({
				id: "chapter:chapter-1",
				ownerType: "chapter",
				ownerId: "chapter-1",
				data: { nodes: [{ id: "chapter-node" }], edges: [] },
			}),
		]);
	});

	it("returns only the associated chapter conversation scope", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		prisma.chapters.findFirst.mockResolvedValue({ id: "chapter-30" });
		listPublicProjectConversations.mockResolvedValue([{ sessionId: "chapter-session", messages: [] }]);

		const conversation = await getPublicProjectConversation(createContext(), "project-1", {
			ownerType: "chapter",
			ownerId: "chapter-30",
		});

		expect(prisma.chapters.findFirst).toHaveBeenCalledWith({
			where: { id: "chapter-30", project_id: "project-1" },
			select: {
				id: true,
				title: true,
				canvas_flow: true,
				canvas_flow_revision: true,
				created_at: true,
				updated_at: true,
			},
		});
		expect(listPublicProjectConversations).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				projectId: "project-1",
				chapterId: "chapter-30",
			}),
		);
		expect(conversation).toEqual([{ sessionId: "chapter-session", messages: [] }]);
	});

	it("does not expose conversation for a chapter outside the public project", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		prisma.chapters.findFirst.mockResolvedValue(null);

		await expect(getPublicProjectConversation(createContext(), "project-1", {
			ownerType: "chapter",
			ownerId: "chapter-from-another-project",
		})).rejects.toMatchObject({
			status: 404,
			code: "public_project_chapter_not_found",
		});
		expect(listPublicProjectConversations).not.toHaveBeenCalled();
	});

	it("returns the associated chapter canvas instead of the project flow list", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		prisma.chapters.findFirst.mockResolvedValue({
			id: "chapter-30",
			title: "第三十章",
			canvas_flow: JSON.stringify({
				nodes: [{ id: "chapter-node-1" }],
				edges: [],
			}),
			canvas_flow_revision: 12,
			created_at: "2026-07-20T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		});

		const flows = await getPublicProjectFlows(createContext(), "project-1", {
			ownerType: "chapter",
			ownerId: "chapter-30",
		});

		expect(prisma.chapters.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "chapter-30", project_id: "project-1" },
		}));
		expect(listFlowsByProject).not.toHaveBeenCalled();
		expect(flows).toEqual([expect.objectContaining({
			id: "chapter:chapter-30",
			name: "第三十章",
			ownerType: "chapter",
			ownerId: "chapter-30",
			canvasRevision: 12,
			data: {
				nodes: [{ id: "chapter-node-1" }],
				edges: [],
			},
		})]);
	});

	it("does not expose a chapter that is outside the public project", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		prisma.chapters.findFirst.mockResolvedValue(null);

		await expect(getPublicProjectFlows(createContext(), "project-1", {
			ownerType: "chapter",
			ownerId: "chapter-from-another-project",
		})).rejects.toMatchObject({
			status: 404,
			code: "public_project_chapter_not_found",
		});
	});

	it("fails explicitly when the public chapter canvas is corrupted", async () => {
		getProjectById.mockResolvedValue(createProjectRow({ is_public: 1 }));
		prisma.chapters.findFirst.mockResolvedValue({
			id: "chapter-30",
			title: "第三十章",
			canvas_flow: "{broken-json",
			canvas_flow_revision: 12,
			created_at: "2026-07-20T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		});

		await expect(getPublicProjectFlows(createContext(), "project-1", {
			ownerType: "chapter",
			ownerId: "chapter-30",
		})).rejects.toMatchObject({
			status: 500,
			code: "public_chapter_canvas_flow_corrupted",
		});
	});
});

// These exercise autoShareProjectWithActiveTeam — the helper used by BOTH
// upsertProjectForUser and cloneProjectForUser — through the create path, which
// avoids the heavy clone flow/asset-copy machinery. The clone path calls the
// exact same helper, so its branching is covered here.
describe("auto-share new projects with the active team", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createProject.mockResolvedValue(createProjectRow({ id: "fresh-1" }));
		listTeamMembershipsByUserId.mockResolvedValue([]);
	});

	function createdProjectId(): string {
		return (createProject.mock.calls[0]?.[1] as { id: string }).id;
	}

	it("shares into the active team (X-Team-Id header) when the creator is a member", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "team-x" }]);

		await upsertProjectForUser(createContext("team-x"), "user-1", {
			name: "新项目",
		});

		expect(upsertTeamProjectShare).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				projectId: createdProjectId(),
				teamId: "team-x",
				access: "edit",
				sharedByUserId: "user-1",
			}),
		);
	});

	it("uses body teamId only as a fallback when no active-team header is present", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "team-body" }]);

		await upsertProjectForUser(createContext(null), "user-1", {
			name: "新项目",
			teamId: "team-body",
		});

		expect(upsertTeamProjectShare).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ teamId: "team-body" }),
		);
	});

	it("prefers the active-team header over the body teamId", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([
			{ team_id: "team-header" },
			{ team_id: "team-body" },
		]);

		await upsertProjectForUser(createContext("team-header"), "user-1", {
			name: "新项目",
			teamId: "team-body",
		});

		expect(upsertTeamProjectShare).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ teamId: "team-header" }),
		);
	});

	it("does not share when there is no active team and no body teamId", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "team-x" }]);

		await upsertProjectForUser(createContext(null), "user-1", { name: "新项目" });

		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});

	it("does not share into a personal team", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "personal_user-1" }]);

		await upsertProjectForUser(createContext("personal_user-1"), "user-1", {
			name: "新项目",
		});

		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});

	it("does not share when the creator is not a member of the active team", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "other-team" }]);

		await upsertProjectForUser(createContext("team-x"), "user-1", {
			name: "新项目",
		});

		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});

	it("does not break project creation when sharing throws", async () => {
		createProject.mockResolvedValue(createProjectRow({ id: "fresh-2" }));
		listTeamMembershipsByUserId.mockResolvedValue([{ team_id: "team-x" }]);
		upsertTeamProjectShare.mockRejectedValue(new Error("db down"));

		const result = await upsertProjectForUser(createContext("team-x"), "user-1", {
			name: "新项目",
		});

		expect(result).toMatchObject({ id: "fresh-2" });
	});
});

describe("manual project team sharing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getProjectById.mockResolvedValue(createProjectRow({
			id: "project-owned",
			owner_id: "user-1",
		}));
		listTeamMembershipsByUserId.mockResolvedValue([
			{ team_id: "team-target", role: "admin" },
			{ team_id: "team-header", role: "owner" },
		]);
		deleteTeamProjectShare.mockResolvedValue(undefined);
		upsertTeamProjectShare.mockResolvedValue({
			project_id: "project-owned",
			team_id: "team-target",
			access: "edit",
			shared_by_user_id: "user-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:00:00.000Z",
		});
	});

	it("uses the explicit target team even when the active-team header differs", async () => {
		await shareProjectWithMyTeam(createContext("team-header"), "user-1", {
			projectId: "project-owned",
			teamId: "team-target",
			shared: true,
		});

		expect(upsertTeamProjectShare).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				projectId: "project-owned",
				teamId: "team-target",
				access: "edit",
				sharedByUserId: "user-1",
			}),
		);
	});

	it("deletes only the explicitly targeted team share", async () => {
		const result = await shareProjectWithMyTeam(createContext("team-header"), "user-1", {
			projectId: "project-owned",
			teamId: "team-target",
			shared: false,
		});

		expect(result).toBeNull();
		expect(deleteTeamProjectShare).toHaveBeenCalledWith(
			expect.anything(),
			{ projectId: "project-owned", teamId: "team-target" },
		);
		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});

	it("rejects personal accounts as a manual sharing target", async () => {
		await expect(shareProjectWithMyTeam(createContext(), "user-1", {
			projectId: "project-owned",
			teamId: "personal_user-1",
			shared: true,
		})).rejects.toMatchObject({
			status: 400,
			code: "team_required",
		});
		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});

	it("requires an owner or admin membership in the target team", async () => {
		listTeamMembershipsByUserId.mockResolvedValue([
			{ team_id: "team-target", role: "member" },
		]);

		await expect(shareProjectWithMyTeam(createContext(), "user-1", {
			projectId: "project-owned",
			teamId: "team-target",
			shared: true,
		})).rejects.toMatchObject({
			status: 403,
			code: "forbidden",
		});
		expect(upsertTeamProjectShare).not.toHaveBeenCalled();
	});
});
