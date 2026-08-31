import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

vi.mock("../flow/flow.repo", () => ({
	getFlowForOwner: vi.fn(),
	getFlowByIdUnsafe: vi.fn(),
	mapFlowRowToDto: vi.fn(),
	updateFlow: vi.fn(),
	updateFlowByIdUnsafe: vi.fn(),
	createFlowVersion: vi.fn(),
	listFlowsByOwner: vi.fn(),
	listFlowsByProject: vi.fn(),
}));
vi.mock("../flow/flow.service", () => ({ sanitizeFlowDataForStorage: vi.fn() }));
vi.mock("../flow/flow.public.service", () => ({ applyPublicFlowGraphPatch: vi.fn() }));
vi.mock("../flow/flow.canvas-book-sync", () => ({ syncCanvasBookFromFlow: vi.fn() }));
vi.mock("../project/project.repo", () => ({
	getProjectById: vi.fn(),
	getProjectForOwner: vi.fn(),
}));
vi.mock("../agents/agents.service", () => ({
	getUserAgentPipelineRunById: vi.fn(),
	getNodeContextBundle: vi.fn(),
	getUserProjectWorkspaceContext: vi.fn(),
	getStoryboardSourceBundle: vi.fn(),
	getStoryboardContinuityEvidence: vi.fn(),
	getVideoReviewBundle: vi.fn(),
	listUserAgentPipelineRuns: vi.fn(),
}));
vi.mock("../agents/capability-bay.service", async () => {
	const actual = await vi.importActual<typeof import("../agents/capability-bay.service")>(
		"../agents/capability-bay.service",
	);
	return {
		...actual,
		getBuiltInCapabilityAvailability: vi.fn().mockResolvedValue({
			systemDisabledKeys: [],
			userDisabledKeys: [],
			disabledKeys: [],
		}),
	};
});
vi.mock("./agents-tool-bridge.billing-scope", () => ({
	resolveProjectBillingTeamId: vi.fn().mockResolvedValue("personal"),
}));
vi.mock("./agents-tool-bridge.generate-image-to-canvas", () => ({ generateImageToCanvas: vi.fn() }));
vi.mock("./agents-tool-bridge.generate-video-to-canvas", () => ({ generateVideoToCanvas: vi.fn() }));
vi.mock("../execution/execution.repo", () => ({
	getExecutionForOwner: vi.fn(),
	listExecutionEvents: vi.fn(),
	listExecutionsForOwnerFlow: vi.fn(),
	listNodeRunsForExecutionOwner: vi.fn(),
	mapExecutionEventRow: vi.fn(),
	mapExecutionRow: vi.fn(),
	mapNodeRunRow: vi.fn(),
}));
vi.mock("../storyboard/storyboard-structure", () => ({
	deriveShotPromptsFromStructuredData: vi.fn(),
	normalizeStoryboardStructuredData: vi.fn(),
}));
vi.mock("./shot-table-critic", () => ({ critiqueShotTable: vi.fn() }));
vi.mock("../../platform/redis-shared", () => ({ getSharedRedis: () => null }));

import "../apiKey/apiKey.routes";

const OWNER_ID = "story-facts-route-owner";
const projectRoots: string[] = [];

async function buildRouter(projectId: string) {
	const { OpenAPIHono } = await import("@hono/zod-openapi");
	const { honoErrorHandler } = await import("../../middleware/error");
	const { getUserProjectWorkspaceContext } = await import("../agents/agents.service");
	const { getProjectForOwner } = await import("../project/project.repo");
	const { registerPublicAgentsToolBridgeRoutes } = await import("./agents-tool-bridge.routes");

	vi.mocked(getProjectForOwner).mockResolvedValue({
		id: projectId,
		owner_id: OWNER_ID,
	} as never);
	vi.mocked(getUserProjectWorkspaceContext).mockResolvedValue({} as never);

	const router = new OpenAPIHono<{
		Variables: { userId: string; devPublicBypass: boolean };
	}>();
	router.onError(honoErrorHandler as never);
	router.use("*", async (c, next) => {
		c.set("userId", OWNER_ID);
		c.set("devPublicBypass", false);
		await next();
	});
	registerPublicAgentsToolBridgeRoutes(router as never);
	return { router, getUserProjectWorkspaceContext };
}

async function execute(
	router: Awaited<ReturnType<typeof buildRouter>>["router"],
	projectId: string,
	toolName: "tapcanvas_story_facts_get" | "tapcanvas_story_facts_commit",
	args: Record<string, unknown>,
) {
	const response = await router.request(
		"/agents/tools/execute",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ toolName, canvasProjectId: projectId, args }),
		},
		{ DB: {} },
	);
	const body = (await response.json()) as Record<string, unknown>;
	const parsed =
		typeof body.content === "string"
			? (JSON.parse(body.content) as Record<string, unknown>)
			: null;
	return { response, body, parsed };
}

async function createBookFixture(): Promise<{
	projectId: string;
	bookId: string;
	bookDir: string;
}> {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const projectId = `story-facts-route-project-${runId}`;
	const bookId = `story-facts-route-book-${runId}`;
	const projectRoot = path.join(
		resolveProjectDataRepoRoot(),
		"project-data",
		"users",
		OWNER_ID,
		"projects",
		projectId,
	);
	projectRoots.push(projectRoot);
	const bookDir = path.join(projectRoot, "books", `physical-${runId}`);
	const contentFile = "chapters/chapter-1.json";
	await fs.mkdir(path.join(bookDir, "chapters"), { recursive: true });
	await fs.writeFile(
		path.join(bookDir, "index.json"),
		JSON.stringify({
			projectId,
			bookId,
			chapters: [{ chapter: 1, contentFile }],
			assets: {},
		}),
		"utf8",
	);
	await fs.writeFile(
		path.join(bookDir, contentFile),
		JSON.stringify({ content: "林墨把裂纹玉佩交给顾宁。" }),
		"utf8",
	);
	return { projectId, bookId, bookDir };
}

function firstCommitArgs(bookId: string): Record<string, unknown> {
	return {
		bookId,
		commitId: "handover-jade",
		expectedRevision: 0,
		source: { kind: "book_chapter", chapter: 1 },
		operations: [
			{
				type: "add",
				factId: "jade-owner-guning",
				subject: { kind: "character", key: "character:guning", name: "顾宁" },
				predicate: "持有",
				value: "裂纹玉佩",
				status: "confirmed",
				validFrom: { chapter: 1, sequence: 10 },
				disclosure: { mode: "immediate", revealAt: null },
			},
		],
	};
}

afterEach(async () => {
	const roots = projectRoots.splice(0, projectRoots.length);
	await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
	vi.clearAllMocks();
});

describe("story facts public agents tools", () => {
	it("reads, CAS-commits, idempotently replays, and paginates", async () => {
		const { projectId, bookId } = await createBookFixture();
		const { router } = await buildRouter(projectId);

		const initial = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "authoring",
		});
		expect(initial.response.status).toBe(200);
		expect(initial.parsed).toMatchObject({
			revision: 0,
			projection: "authoring",
			facts: [],
		});

		const commitArgs = firstCommitArgs(bookId);
		const committed = await execute(
			router,
			projectId,
			"tapcanvas_story_facts_commit",
			commitArgs,
		);
		expect(committed.response.status).toBe(200);
		expect(committed.parsed).toMatchObject({
			revision: 1,
			commitRevision: 1,
			idempotent: false,
			partialSuccess: false,
			projection: { status: "updated" },
		});

		const replayed = await execute(
			router,
			projectId,
			"tapcanvas_story_facts_commit",
			commitArgs,
		);
		expect(replayed.response.status).toBe(200);
		expect(replayed.parsed).toMatchObject({
			revision: 1,
			commitRevision: 1,
			idempotent: true,
		});

		const page = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "authoring",
			offset: 0,
			limit: 1,
		});
		expect(page.response.status).toBe(200);
		expect(page.parsed).toMatchObject({
			revision: 1,
			offset: 0,
			returnedFactCount: 1,
			hasMore: false,
			nextOffset: null,
		});
	});

	it("rejects stale revisions and nonexistent persisted sources", async () => {
		const { projectId, bookId } = await createBookFixture();
		const { router } = await buildRouter(projectId);
		const commitArgs = firstCommitArgs(bookId);
		await execute(router, projectId, "tapcanvas_story_facts_commit", commitArgs);

		const stale = await execute(router, projectId, "tapcanvas_story_facts_commit", {
			...commitArgs,
			commitId: "stale-commit",
		});
		expect(stale.response.status).toBe(409);
		expect(stale.body).toMatchObject({ code: "story_facts_revision_conflict" });

		const missingSource = await execute(router, projectId, "tapcanvas_story_facts_commit", {
			...commitArgs,
			commitId: "missing-source",
			expectedRevision: 1,
			source: { kind: "book_chapter", chapter: 99 },
		});
		expect(missingSource.response.status).toBe(404);
		expect(missingSource.body).toMatchObject({ code: "story_fact_source_chapter_not_found" });
	});

	it("preserves a committed ledger when STORY_STATE projection fails", async () => {
		const { projectId, bookId, bookDir } = await createBookFixture();
		const { router, getUserProjectWorkspaceContext } = await buildRouter(projectId);
		vi.mocked(getUserProjectWorkspaceContext).mockRejectedValueOnce(
			new Error("projection storage unavailable"),
		);

		const partial = await execute(
			router,
			projectId,
			"tapcanvas_story_facts_commit",
			firstCommitArgs(bookId),
		);
		expect(partial.response.status).toBe(200);
		expect(partial.parsed).toMatchObject({
			revision: 1,
			commitRevision: 1,
			partialSuccess: true,
			projection: {
				status: "failed",
				reason: "projection storage unavailable",
			},
		});

		const ledger = JSON.parse(
			await fs.readFile(path.join(bookDir, "story-facts.json"), "utf8"),
		) as { revision: number; facts: Array<{ factId: string }> };
		expect(ledger.revision).toBe(1);
		expect(ledger.facts.map((fact) => fact.factId)).toEqual(["jade-owner-guning"]);
	});

	it("returns opaque guards before disclosure and full facts at the reveal point", async () => {
		const { projectId, bookId } = await createBookFixture();
		const { router } = await buildRouter(projectId);
		const secretValue = "同父异母姐弟";
		const secretSubjectName = "顾宁与林墨的真实关系";
		const secretPredicate = "真实关系";
		const secretFactId = "hidden-sibling-relation";

		const committed = await execute(router, projectId, "tapcanvas_story_facts_commit", {
			bookId,
			commitId: "hidden-sibling-relation-commit",
			expectedRevision: 0,
			source: { kind: "book_chapter", chapter: 1 },
			operations: [
				{
					type: "add",
					factId: secretFactId,
					subject: {
						kind: "relationship",
						key: "relationship:guning-linmo",
						name: secretSubjectName,
					},
					predicate: secretPredicate,
					value: secretValue,
					status: "confirmed",
					validFrom: { chapter: 1, sequence: 0 },
					disclosure: {
						mode: "gated",
						revealAt: { chapter: 5, sequence: 0 },
					},
				},
			],
		});
		expect(committed.response.status).toBe(200);

		const beforeReveal = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "audience_safe",
			at: { chapter: 1, sequence: 10 },
		});
		expect(beforeReveal.response.status).toBe(200);
		expect(beforeReveal.parsed).toMatchObject({
			projection: "audience_safe",
			facts: [
				{
					audienceVisibility: "hidden",
					factId: secretFactId,
					category: "relationship",
					status: "confirmed",
					disclosure: {
						mode: "gated",
						revealAt: { chapter: 5, sequence: 0 },
					},
				},
			],
		});
		const beforeRevealJson = JSON.stringify(beforeReveal.parsed);
		expect(beforeRevealJson).not.toContain(secretValue);
		expect(beforeRevealJson).not.toContain(secretSubjectName);
		expect(beforeRevealJson).not.toContain(secretPredicate);
		expect(beforeRevealJson).not.toContain("contentSha256");

		const atReveal = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "audience_safe",
			at: { chapter: 5, sequence: 0 },
		});
		expect(atReveal.response.status).toBe(200);
		expect(atReveal.parsed).toMatchObject({
			projection: "audience_safe",
			facts: [
				{
					audienceVisibility: "visible",
					factId: secretFactId,
					predicate: secretPredicate,
					value: secretValue,
				},
			],
		});
	});

	it("rejects incomplete or history-exposing audience-safe reads", async () => {
		const { projectId, bookId } = await createBookFixture();
		const { router } = await buildRouter(projectId);

		const missingPoint = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "audience_safe",
		});
		expect(missingPoint.response.status).toBe(400);
		expect(missingPoint.body).toMatchObject({ code: "story_facts_get_invalid" });

		const withHistory = await execute(router, projectId, "tapcanvas_story_facts_get", {
			bookId,
			projection: "audience_safe",
			at: { chapter: 1, sequence: 0 },
			includeCommits: true,
		});
		expect(withHistory.response.status).toBe(400);
		expect(withHistory.body).toMatchObject({ code: "story_facts_get_invalid" });
	});
});
