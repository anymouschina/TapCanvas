import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
	VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
	VIDEO_PRODUCTION_WORKFLOW_KEY,
} from "@tapcanvas/video-orchestrator-protocol";
import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	attachmentFindFirst: vi.fn(),
	attachmentFindMany: vi.fn(),
	preferenceFindFirst: vi.fn(),
	preferenceFindMany: vi.fn(),
	preferenceUpsert: vi.fn(),
	preferenceDeleteMany: vi.fn(),
	attachmentDeleteMany: vi.fn(),
	systemSettingFindMany: vi.fn(),
	skillFindMany: vi.fn(),
	flowFindFirst: vi.fn(),
	flowFindMany: vi.fn(),
	versionFindFirst: vi.fn(),
	versionFindMany: vi.fn(),
	versionUpsert: vi.fn(),
	queryRaw: vi.fn(),
	getProjectForUserAccess: vi.fn(),
	listProjectsAccessibleByUser: vi.fn(),
	invocationFindMany: vi.fn(),
	projectUpdate: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("../project/project.repo", () => ({
	getProjectAccessSummary: mocks.getProjectForUserAccess,
	getProjectForUserAccess: mocks.getProjectForUserAccess,
	listProjectAccessSummaries: mocks.listProjectsAccessibleByUser,
	listProjectsAccessibleByUser: mocks.listProjectsAccessibleByUser,
}));

import {
	adoptAiWorkflowProject,
	equipStandaloneEvalWorkflowCapability,
	equipWorkflowCapability,
	generateWorkflowCapabilityDescription,
	getBuiltInCapabilityAvailability,
	getCapabilityBay,
	listEquippedWorkflowCapabilities,
	obsoleteWorkflowReplacementPreferences,
	resolveEquippedWorkflowExecutionTarget,
	unequipWorkflowCapability,
	updateBuiltInCapabilityState,
} from "./capability-bay.service";

describe("generateWorkflowCapabilityDescription", () => {
	it("forwards bounded workflow facts to the agents-cli atomic endpoint", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
			description: "适用于把本次源文本生成完整成片。",
		}), { status: 200, headers: { "content-type": "application/json" } }));
		try {
			const result = await generateWorkflowCapabilityDescription({
				env: {
					AGENTS_BRIDGE_BASE_URL: "http://agents-bridge:8799",
					AGENTS_BRIDGE_TOKEN: "internal-token",
				},
			} as unknown as AppContext, {
				model: "deepseek-v4-flash",
				workflow: {
					name: "一键成片工作流",
					nodeCount: 2,
					edgeCount: 1,
					invocation: { sourceMode: "inline_text", requiredTriggerPayloadFields: ["source"] },
					stages: [{
						label: "画布来源",
						description: "",
						operation: "canvas_source",
						executorRef: "tapcanvas.canvas.group.read/v1",
						outputArtifactType: "source_text",
					}],
				},
			});

			expect(result.description).toContain("源文本");
			expect(fetchMock).toHaveBeenCalledWith(
				"http://agents-bridge:8799/capabilities/descriptions/generate",
				expect.objectContaining({ method: "POST" }),
			);
			const request = fetchMock.mock.calls[0]?.[1];
			expect(JSON.parse(String(request?.body))).toMatchObject({
				model: "deepseek-v4-flash",
				workflow: { invocation: { sourceMode: "inline_text" } },
			});
		} finally {
			fetchMock.mockRestore();
		}
	});
});

const descriptor = {
	protocolVersion: "tapcanvas.agent-capability/v1" as const,
	capabilityId: "workflow:flow-1",
	kind: "workflow" as const,
	name: "一键成片",
	summary: "生成完整视频",
	sourceId: "flow-1",
	sourceVersionId: "version-1",
	sourceRevision: 1,
	projectId: "project-1",
	triggerNodeId: "trigger-1",
	nodeCount: 2,
	operations: ["video_submission"],
	requiredSkills: [],
	requiredTools: ["tapcanvas_video_orchestrate"],
	inputArtifacts: ["topic"],
	outputArtifacts: ["video"],
	permissions: ["workflow:invoke"],
	sideEffects: ["paid_generation"] as const,
	semanticEvidence: [],
};

const report = {
	protocolVersion: "tapcanvas.capability-conflict-report/v1" as const,
	targetCapabilityId: descriptor.capabilityId,
	checkedAt: "2026-08-15T00:00:00.000Z",
	descriptorSha256: "a".repeat(64),
	conflicts: [],
	blocking: false,
	requiresConfirmation: false,
};

const attachmentRow = {
	id: "attachment-1",
	user_id: "user-1",
	capability_kind: "workflow",
	source_id: descriptor.sourceId,
	source_version_id: descriptor.sourceVersionId,
	descriptor_json: JSON.stringify(descriptor),
	descriptor_sha256: report.descriptorSha256,
	conflict_report_json: JSON.stringify(report),
	route_decisions_json: "[]",
	conflict_report_revision: 1,
	created_at: "2026-08-15T00:00:00.000Z",
	updated_at: "2026-08-15T00:00:00.000Z",
};

const flowRow = {
	id: "flow-1",
	name: "一键成片",
	data: "mutable-current-flow-data",
	owner_id: "owner-1",
	project_id: "project-1",
	canvas_revision: 1,
	created_at: "2026-08-15T00:00:00.000Z",
	updated_at: "2026-08-15T00:00:00.000Z",
};

const database = {
	agent_capability_attachments: {
		findFirst: mocks.attachmentFindFirst,
		findMany: mocks.attachmentFindMany,
		deleteMany: mocks.attachmentDeleteMany,
	},
	flows: { findFirst: mocks.flowFindFirst, findMany: mocks.flowFindMany },
	flow_versions: {
		findFirst: mocks.versionFindFirst,
		findUnique: mocks.versionFindFirst,
		findMany: mocks.versionFindMany,
		upsert: mocks.versionUpsert,
	},
	projects: { findMany: vi.fn().mockResolvedValue([]) },
	agent_capability_preferences: {
		findMany: mocks.preferenceFindMany,
		upsert: mocks.preferenceUpsert,
		deleteMany: mocks.preferenceDeleteMany,
		findFirst: vi.fn(),
	},
	$transaction: mocks.transaction,
};
mocks.transaction.mockImplementation(async (
	operation: (transaction: typeof database) => Promise<unknown>,
) => operation(database));

const context = { env: { DB: database } } as unknown as AppContext;

const frozenWorkflowJson = JSON.stringify({
	nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }],
	edges: [],
});

const capabilityWorkflowJson = JSON.stringify({
	nodes: [
		{ id: "trigger-1", data: { kind: "workflowTrigger" } },
		{
			id: "stage-1",
			data: {
				kind: "workflowStage",
				label: "成片",
				description: "生成视频",
				outputArtifactType: "video",
				workflowAtomicSpec: {
					operation: "video_submission",
					toolId: "tapcanvas_video_orchestrate",
					inputPorts: ["topic"],
				},
			},
		},
	],
	edges: [],
});

describe("equipStandaloneEvalWorkflowCapability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.preferenceFindMany.mockResolvedValue([]);
		mocks.listProjectsAccessibleByUser.mockResolvedValue([]);
		mocks.versionFindMany.mockResolvedValue([{
			id: "version-stale",
			data: capabilityWorkflowJson,
		}]);
		mocks.attachmentFindMany.mockResolvedValue([{
			...attachmentRow,
			id: "attachment-stale",
			source_version_id: "version-stale",
			descriptor_json: JSON.stringify({
				...descriptor,
				sourceVersionId: "version-stale",
				invocation: {
					sourceMode: "project_context",
					requiredTriggerPayloadFields: [],
					executionVariant: "full_video",
				},
			}),
		}]);
		mocks.flowFindMany
			// Runtime qualification observes that the attachment's live authoring
			// graph drifted from its pinned version.
			.mockResolvedValueOnce([{
				id: "flow-1",
				data: JSON.stringify({ nodes: [], edges: [] }),
			}])
			// No replacement candidate is available in this isolated unit case.
			.mockResolvedValueOnce([]);
	});

	it("does not report a stale attachment as equipped when runtime catalog qualification rejects it", async () => {
		await expect(equipStandaloneEvalWorkflowCapability(
			context,
			"user-1",
			"eval-project-1",
			"full_video",
		)).rejects.toMatchObject({ code: "agents_eval_workflow_variant_unavailable", status: 409 });

		expect(mocks.flowFindMany).toHaveBeenCalledTimes(2);
	});

	it("does not expose an authoring-current attachment whose canvas definition is outdated", async () => {
		const outdatedWorkflowJson = JSON.stringify({
			nodes: [
				{
					id: "trigger-1",
					data: {
						kind: "workflowTrigger",
						workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
					},
				},
				{
					id: "stage-1",
					data: {
						kind: "workflowStage",
						workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
						workflowExecutionVariant: "full_video",
						workflowAtomicSpec: { operation: "video_submission" },
					},
				},
			],
			edges: [],
		});
		mocks.versionFindMany.mockResolvedValue([{
			id: "version-outdated",
			data: outdatedWorkflowJson,
		}]);
		mocks.attachmentFindMany.mockResolvedValue([{
			...attachmentRow,
			id: "attachment-outdated",
			source_version_id: "version-outdated",
			descriptor_json: JSON.stringify({
				...descriptor,
				sourceVersionId: "version-outdated",
				invocation: {
					sourceMode: "project_context",
					requiredTriggerPayloadFields: [],
					executionVariant: "full_video",
				},
			}),
		}]);
		mocks.flowFindMany
			.mockReset()
			// The pinned and live authoring graphs are identical; only the
			// immutable canvas-definition provenance is old.
			.mockResolvedValueOnce([{
				id: "flow-1",
				data: outdatedWorkflowJson,
			}])
			.mockResolvedValueOnce([]);

		await expect(equipStandaloneEvalWorkflowCapability(
			context,
			"user-1",
			"eval-project-1",
			"full_video",
		)).rejects.toMatchObject({ code: "agents_eval_workflow_variant_unavailable", status: 409 });

		expect(mocks.flowFindMany).toHaveBeenCalledTimes(2);
		expect(mocks.versionUpsert).not.toHaveBeenCalled();
	});
});

describe("resolveEquippedWorkflowExecutionTarget", () => {
	beforeEach(() => {
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: frozenWorkflowJson });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: frozenWorkflowJson,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.getProjectForUserAccess.mockResolvedValue({ id: "project-1", access: "team_edit" });
		mocks.preferenceFindMany.mockResolvedValue([]);
	});

	it("revalidates project access and executes the exact inspected version snapshot", async () => {
		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");

		expect(mocks.getProjectForUserAccess).toHaveBeenCalledWith(expect.anything(), "project-1", "user-1");
		expect(target.flow.data).toBe(frozenWorkflowJson);
		expect(target.attachment.sourceVersionId).toBe("version-1");
	});

	it("rejects stale attachments instead of reusing or restarting changed workflow data", async () => {
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-2",
			flow_id: "flow-1",
			data: JSON.stringify({
				nodes: [
					{ id: "trigger-1", data: { kind: "workflowTrigger" } },
					{ id: "stage-2", data: { kind: "workflowStage" } },
				],
				edges: [],
			}),
			created_at: "2026-08-15T00:01:00.000Z",
		});

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_attachment_stale", status: 409 });
	});

	it("rejects execution after project access is revoked", async () => {
		mocks.getProjectForUserAccess.mockResolvedValue(null);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_source_access_revoked", status: 403 });
	});

	it("allows any user to resolve a system-level (all_users) attachment without the source project access", async () => {
		mocks.attachmentFindFirst.mockResolvedValue({ ...attachmentRow, scope: "all_users" });
		// 项目访问返回 null：若仍执行项目闸门会 403，这里应跳过并成功解析。
		mocks.getProjectForUserAccess.mockResolvedValue(null);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-other", "attachment-1");

		expect(target.attachment.scope).toBe("all_users");
		expect(target.flow.data).toBe(frozenWorkflowJson);
	});

	it("keeps personal (current_user) attachments invisible to other users", async () => {
		mocks.attachmentFindFirst.mockResolvedValue(null);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-other", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_attachment_not_found", status: 404 });
	});
});

describe("workflow equip scope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.preferenceFindMany.mockResolvedValue([]);
		mocks.versionFindMany.mockResolvedValue([{ id: "version-1", data: frozenWorkflowJson }]);
		mocks.flowFindMany.mockResolvedValue([{ id: "flow-1", data: frozenWorkflowJson }]);
	});

	it("lists the user's own attachments plus system-level (all_users) workflows", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{ ...attachmentRow, id: "own-1", scope: "current_user" },
			{ ...attachmentRow, id: "system-1", scope: "all_users", user_id: "admin-1" },
		]);
		const rows = await listEquippedWorkflowCapabilities(context, "user-1");
		expect(rows.map((row) => row.id).sort()).toEqual(["own-1", "system-1"]);
	});

	it("does not expose an authoring-stale attachment to the executable tool surface", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{ ...attachmentRow, id: "stale-1", scope: "all_users", user_id: "admin-1" },
		]);
		mocks.flowFindMany.mockResolvedValue([{ id: "flow-1", data: capabilityWorkflowJson }]);

		const rows = await listEquippedWorkflowCapabilities(context, "user-1");

		expect(rows).toEqual([]);
	});

	it("fails a structurally requested variant with the exact outdated-definition reason", async () => {
		const outdatedWorkflowJson = JSON.stringify({
			nodes: [
				{
					id: "trigger-1",
					data: {
						kind: "workflowTrigger",
						workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
						workflowExecutionVariant: "full_video",
						workflowCanvasDefinitionVersion: VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
					},
				},
			],
			edges: [],
		});
		mocks.versionFindMany.mockResolvedValue([{ id: "version-1", data: outdatedWorkflowJson }]);
		mocks.flowFindMany.mockResolvedValue([{ id: "flow-1", data: outdatedWorkflowJson }]);
		mocks.attachmentFindMany.mockResolvedValue([{
			...attachmentRow,
			descriptor_json: JSON.stringify({
				...descriptor,
				invocation: {
					sourceMode: "project_context",
					requiredTriggerPayloadFields: [],
					executionVariant: "full_video",
				},
			}),
		}]);

		await expect(listEquippedWorkflowCapabilities(context, "user-1", {
			requiredExecutionVariant: "full_video",
		})).rejects.toMatchObject({
			code: "capability_workflow_definition_outdated",
			status: 409,
			terminal: true,
		});
	});

	it("fails a required variant explicitly when no matching attachment exists", async () => {
		mocks.attachmentFindMany.mockResolvedValue([]);
		mocks.versionFindMany.mockResolvedValue([]);
		mocks.flowFindMany.mockResolvedValue([]);

		await expect(listEquippedWorkflowCapabilities(context, "user-1", {
			requiredExecutionVariant: "full_video",
		})).rejects.toMatchObject({
			code: "capability_workflow_variant_unavailable",
			status: 409,
			terminal: true,
		});
	});

	it("projects a persisted one-click replacement as the primary route", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{ ...attachmentRow, id: "own-1", scope: "current_user" },
		]);
		mocks.preferenceFindMany.mockResolvedValue([{
			capability_kind: "built_in",
			capability_id: "one_click_video",
			enabled: 0,
			disabled_reason: "replaced",
			replaced_by_capability_id: "workflow:flow-1",
		}]);

		const rows = await listEquippedWorkflowCapabilities(context, "user-1");

		expect(rows[0]?.primaryForCapabilities).toEqual([{
			capabilityId: "builtin:one_click_video",
			name: "一键成片",
			description: "从创作目标规划并交付完整成片。",
		}]);
	});

	it("does not expose a root-authored preparation contract", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{ ...attachmentRow, id: "own-1", scope: "current_user" },
		]);
		const currentData = JSON.stringify({
			nodes: [{
				id: "beat-sheet",
				data: {
					workflowNodeId: "beat-sheet-agent",
					workflowAtomicSpec: { executorRef: "agents.logical-task/v2" },
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["protocolVersion"],
						requiredObjectFields: ["filmBible"],
						requiredArrayFields: ["beats"],
						allowedFields: ["protocolVersion", "filmBible", "beats"],
					},
				},
			}],
			edges: [],
		});
		mocks.versionFindMany.mockResolvedValue([{
			id: "version-1",
			data: currentData,
		}]);
		mocks.flowFindMany.mockResolvedValue([{ id: "flow-1", data: currentData }]);

		const rows = await listEquippedWorkflowCapabilities(context, "user-1");

		expect(rows[0]?.preparation).toBeUndefined();
	});

	it("rejects a non-admin attempt to publish a workflow as all_users", async () => {
		// 普通用户上下文：无 admin 身份；作用范围校验必须先于检查凭证/数据库交互。
		const nonAdminContext = {
			env: { DB: database },
			get: () => null,
		} as unknown as AppContext;
		await expect(equipWorkflowCapability(nonAdminContext, "user-1", "flow-1", {
			sourceVersionId: "version-1",
			descriptorSha256: "sha256-valid",
			inspectionToken: "invalid-token",
			resolutions: [],
			scope: "all_users",
		})).rejects.toMatchObject({ code: "capability_equip_scope_forbidden", status: 403 });
	});
});

describe("workflow replacement lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("releases only self-disabled Skill dependencies and preserves confirmed built-in replacements across versions", () => {
		expect(obsoleteWorkflowReplacementPreferences({
			workflowCapabilityId: "workflow:flow-1",
			replacementTargets: [],
			requiredSkills: ["tapcanvas-video-workflow"],
			preferences: [
				{
					capability_kind: "skill",
					capability_id: "tapcanvas-video-workflow",
					enabled: 0,
					disabled_reason: "replaced",
					replaced_by_capability_id: "workflow:flow-1",
				},
				{
					capability_kind: "built_in",
					capability_id: "one_click_video",
					enabled: 0,
					disabled_reason: "replaced",
					replaced_by_capability_id: "workflow:flow-1",
				},
				{
					capability_kind: "skill",
					capability_id: "user-disabled-skill",
					enabled: 0,
					disabled_reason: "user",
					replaced_by_capability_id: null,
				},
				{
					capability_kind: "skill",
					capability_id: "other-workflow-skill",
					enabled: 0,
					disabled_reason: "replaced",
					replaced_by_capability_id: "workflow:flow-2",
				},
			],
		})).toEqual([{
			capabilityKind: "skill",
			capabilityId: "tapcanvas-video-workflow",
		}]);
	});

	it("removes the attachment and only the replacement preferences owned by it when unequipped", async () => {
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.attachmentDeleteMany.mockResolvedValue({ count: 1 });
		mocks.preferenceDeleteMany.mockResolvedValue({ count: 2 });

		await expect(unequipWorkflowCapability(context, "user-1", "flow-1"))
			.resolves.toEqual({ detached: true });

		expect(mocks.preferenceDeleteMany).toHaveBeenCalledWith({
			where: {
				user_id: "user-1",
				enabled: 0,
				disabled_reason: "replaced",
				replaced_by_capability_id: "workflow:flow-1",
			},
		});
	});
});

describe("getCapabilityBay", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectForUserAccess.mockResolvedValue({
			id: "project-1",
			name: "当前项目",
			project_kind: "creative",
			updated_at: "2026-08-15T00:00:00.000Z",
			access: "team_edit",
		});
		mocks.flowFindMany.mockResolvedValue([flowRow]);
		mocks.listProjectsAccessibleByUser.mockResolvedValue([{
			id: "project-1",
			name: "当前项目",
			project_kind: "creative",
			updated_at: "2026-08-15T00:00:00.000Z",
		}]);
		mocks.attachmentFindMany.mockResolvedValue([]);
		mocks.invocationFindMany.mockResolvedValue([]);
		mocks.preferenceFindMany.mockResolvedValue([]);
		mocks.systemSettingFindMany.mockResolvedValue([]);
		mocks.skillFindMany.mockResolvedValue([]);
		mocks.flowFindMany.mockResolvedValue([{ ...flowRow, data: capabilityWorkflowJson }]);
	});

	it("loads the current project alongside globally managed AI workflow projects", async () => {
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					flow_versions: { findMany: mocks.versionFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
					$queryRaw: mocks.queryRaw,
				},
			},
		} as unknown as AppContext;

		const result = await getCapabilityBay(bayContext, "user-1", "project-1");

		expect(mocks.flowFindMany).toHaveBeenCalledWith({
			where: { project_id: { in: ["project-1"] } },
			orderBy: { updated_at: "desc" },
		});
		expect(mocks.queryRaw).not.toHaveBeenCalled();
		expect(result.candidates).toHaveLength(1);
		expect(result.skills).toEqual([]);
		expect(result.builtInCapabilities.length).toBeGreaterThan(0);
		expect(result.builtInCapabilities.every((capability) => capability.enabled)).toBe(true);
		expect(result.builtInCapabilities.find((capability) => capability.key === "paid_media_generation"))
			.toMatchObject({ replaceable: false, enabled: true });
		expect(result.builtInCapabilities.find((capability) => capability.key === "one_click_video"))
			.toMatchObject({ replaceable: true, enabled: true });
		expect(result.builtInCapabilities
		.filter((capability) => capability.key !== "paid_media_generation" && capability.key !== "one_click_video")
		.every((capability) => capability.replaceable)).toBe(true);
		expect(result.currentProject).toMatchObject({
			id: "project-1",
			projectKind: "creative",
			flowCount: 1,
		});
		expect(result.workflowProjects).toEqual([]);
		expect(result.invocations).toEqual([]);
		expect(result.candidates[0]).toMatchObject({
			projectName: "当前项目",
			descriptor: { sourceVersionId: expect.stringMatching(/^capability-version-[a-f0-9]{64}$/) },
		});
	});

	it("keeps presentation-only edits on the same capability version and rotates it for authoring edits", async () => {
		const workflow = JSON.parse(capabilityWorkflowJson) as {
			nodes: Array<Record<string, unknown>>;
			edges: Array<Record<string, unknown>>;
		};
		const presentationOnlyWorkflow = {
			...workflow,
			nodes: workflow.nodes.map((node, index) => ({
				...node,
				position: { x: index * 480, y: index * 220 },
				selected: index === 1,
				measured: { width: 360, height: 220 },
			})),
		};
		const authoringEditedWorkflow = {
			...presentationOnlyWorkflow,
			nodes: presentationOnlyWorkflow.nodes.map((node) => {
				const data = (node as Record<string, unknown>).data;
				if (!data || typeof data !== "object" || Array.isArray(data)) return node;
				const dataRecord = data as Record<string, unknown>;
				return dataRecord.kind === "workflowStage"
					? { ...node, data: { ...dataRecord, label: "生成预告片" } }
					: node;
			}),
		};
		mocks.flowFindMany
			.mockResolvedValueOnce([{ ...flowRow, data: capabilityWorkflowJson }])
			.mockResolvedValueOnce([{ ...flowRow, data: JSON.stringify(presentationOnlyWorkflow) }])
			.mockResolvedValueOnce([{ ...flowRow, data: JSON.stringify(authoringEditedWorkflow) }]);
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
				},
			},
		} as unknown as AppContext;

		const first = await getCapabilityBay(bayContext, "user-1", "project-1");
		const presentationOnly = await getCapabilityBay(bayContext, "user-1", "project-1");
		const authoringEdited = await getCapabilityBay(bayContext, "user-1", "project-1");
		const firstVersionId = first.candidates[0]?.descriptor.sourceVersionId;

		expect(firstVersionId).toMatch(/^capability-version-[a-f0-9]{64}$/);
		expect(presentationOnly.candidates[0]?.descriptor.sourceVersionId).toBe(firstVersionId);
		expect(authoringEdited.candidates[0]?.descriptor.sourceVersionId).not.toBe(firstVersionId);
	});

	it("marks an attachment stale when its descriptor contract changed without a flow version change", async () => {
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					flow_versions: { findMany: mocks.versionFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
				},
			},
		} as unknown as AppContext;
		const first = await getCapabilityBay(bayContext, "user-1", "project-1");
		const candidate = first.candidates[0];
		expect(candidate).toBeDefined();
		mocks.attachmentFindMany.mockResolvedValueOnce([{
			...attachmentRow,
			source_version_id: candidate?.descriptor.sourceVersionId,
			descriptor_json: JSON.stringify(candidate?.descriptor),
			descriptor_sha256: "0".repeat(64),
		}]);

		const second = await getCapabilityBay(bayContext, "user-1", "project-1");

		expect(second.candidates[0]).toMatchObject({
			attached: true,
			attachedVersionId: candidate?.descriptor.sourceVersionId,
			stale: true,
		});
		expect(second.candidates[0]?.descriptorSha256).not.toBe("0".repeat(64));
	});

	it("marks an attachment stale when its frozen canvas definition is older than the live definition", async () => {
		const currentWorkflow = JSON.parse(capabilityWorkflowJson) as {
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
			edges: unknown[];
		};
		const withDefinition = (version: number, fingerprint: string) => JSON.stringify({
			...currentWorkflow,
			nodes: currentWorkflow.nodes.map((node) => ({
				...node,
				data: {
					...node.data,
					workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
					workflowCanvasDefinitionVersion: version,
					workflowCanvasDefinitionFingerprint: fingerprint,
				},
			})),
		});
		const liveWorkflow = withDefinition(
			VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION,
			VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
		);
		const frozenOutdatedWorkflow = withDefinition(
			VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION - 1,
			"sha256:outdated",
		);
		mocks.flowFindMany.mockResolvedValue([{ ...flowRow, data: liveWorkflow }]);
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					flow_versions: { findMany: mocks.versionFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
				},
			},
		} as unknown as AppContext;
		const current = await getCapabilityBay(bayContext, "user-1", "project-1");
		const candidate = current.candidates[0];
		expect(candidate).toBeDefined();
		mocks.attachmentFindMany.mockResolvedValueOnce([{
			...attachmentRow,
			source_version_id: candidate?.descriptor.sourceVersionId,
			descriptor_json: JSON.stringify(candidate?.descriptor),
			descriptor_sha256: candidate?.descriptorSha256,
		}]);
		mocks.versionFindMany.mockResolvedValueOnce([{
			id: candidate?.descriptor.sourceVersionId,
			data: frozenOutdatedWorkflow,
		}]);

		const result = await getCapabilityBay(bayContext, "user-1", "project-1");

		expect(result.candidates[0]).toMatchObject({
			attached: true,
			stale: true,
		});
	});

	it("projects a persisted built-in capability stop as runtime state", async () => {
		mocks.preferenceFindMany.mockResolvedValue([{
			id: "preference-1",
			capability_kind: "built_in",
			capability_id: "one_click_video",
			enabled: 0,
			disabled_reason: "user",
			replaced_by_capability_id: null,
			created_at: "2026-08-15T00:00:00.000Z",
			updated_at: "2026-08-15T00:00:00.000Z",
		}]);
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
					$queryRaw: mocks.queryRaw,
				},
			},
		} as unknown as AppContext;

		const result = await getCapabilityBay(bayContext, "user-1", "project-1");
		const paidMedia = result.builtInCapabilities.find((capability) => capability.key === "one_click_video");

		expect(paidMedia).toMatchObject({
			enabled: false,
			systemEnabled: true,
			userEnabled: false,
			disabledReason: "user",
			replacedByCapabilityId: null,
			replaceable: true,
		});
	});

	it("projects a system stop without erasing the user's enabled preference", async () => {
		mocks.systemSettingFindMany.mockResolvedValue([{
			capability_id: "one_click_video",
			enabled: 0,
			updated_by_user_id: "admin-1",
			created_at: "2026-08-15T00:00:00.000Z",
			updated_at: "2026-08-15T00:00:00.000Z",
		}]);
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
					$queryRaw: mocks.queryRaw,
				},
			},
		} as unknown as AppContext;

		const result = await getCapabilityBay(bayContext, "user-1", "project-1");
		expect(result.builtInCapabilities.find((capability) => capability.key === "one_click_video"))
			.toMatchObject({
				enabled: false,
				systemEnabled: false,
				userEnabled: true,
				disabledReason: "system",
			});
	});

	it("rejects a project outside the current user's access scope", async () => {
		mocks.getProjectForUserAccess.mockResolvedValue(null);
		const bayContext = {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					agent_capability_attachments: { findMany: mocks.attachmentFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_skills: { findMany: mocks.skillFindMany },
					agent_capability_invocations: { findMany: mocks.invocationFindMany },
					$queryRaw: mocks.queryRaw,
				},
			},
		} as unknown as AppContext;

		await expect(getCapabilityBay(bayContext, "user-1", "project-other"))
			.rejects.toMatchObject({ code: "capability_project_not_found", status: 404 });
		expect(mocks.flowFindMany).not.toHaveBeenCalled();
		expect(mocks.queryRaw).not.toHaveBeenCalled();
	});
});

describe("adoptAiWorkflowProject", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectForUserAccess.mockResolvedValue({
			id: "project-1",
			name: "当前项目",
			project_kind: "creative",
			updated_at: "2026-08-15T00:00:00.000Z",
			access: "owner",
		});
		mocks.flowFindMany.mockResolvedValue([flowRow]);
		mocks.flowFindMany.mockResolvedValue([{ ...flowRow, data: capabilityWorkflowJson }]);
		mocks.projectUpdate.mockResolvedValue({});
	});

	function createAdoptContext(): AppContext {
		return {
			env: {
				DB: {
					flows: { findMany: mocks.flowFindMany },
					projects: { update: mocks.projectUpdate },
					$queryRaw: mocks.queryRaw,
				},
			},
		} as unknown as AppContext;
	}

	it("classifies an existing project only after finding a valid saved workflow", async () => {
		const result = await adoptAiWorkflowProject(createAdoptContext(), "user-1", "project-1");

		expect(result).toMatchObject({
			projectId: "project-1",
			projectName: "当前项目",
			projectKind: "ai_workflow",
			flowCount: 1,
			eligibleFlowCount: 1,
			changed: true,
		});
		expect(mocks.projectUpdate).toHaveBeenCalledWith({
			where: { id: "project-1" },
			data: { project_kind: "ai_workflow", updated_at: expect.any(String) },
		});
	});

	it("rejects classification when the project has no valid saved workflow", async () => {
		mocks.flowFindMany.mockResolvedValue([]);

		await expect(adoptAiWorkflowProject(createAdoptContext(), "user-1", "project-1"))
			.rejects.toMatchObject({ code: "capability_project_workflow_missing", status: 409 });
		expect(mocks.projectUpdate).not.toHaveBeenCalled();
	});

	it("rejects classification without project write access", async () => {
		mocks.getProjectForUserAccess.mockResolvedValue({
			id: "project-1",
			name: "当前项目",
			project_kind: "creative",
			updated_at: "2026-08-15T00:00:00.000Z",
		});

		await expect(adoptAiWorkflowProject(createAdoptContext(), "user-1", "project-1"))
			.rejects.toMatchObject({ code: "capability_project_write_forbidden", status: 403 });
		expect(mocks.flowFindMany).not.toHaveBeenCalled();
		expect(mocks.projectUpdate).not.toHaveBeenCalled();
	});

	it("is idempotent when the project is already classified", async () => {
		mocks.getProjectForUserAccess.mockResolvedValue({
			id: "project-1",
			name: "当前项目",
			project_kind: "ai_workflow",
			updated_at: "2026-08-15T00:00:00.000Z",
			access: "owner",
		});

		await expect(adoptAiWorkflowProject(createAdoptContext(), "user-1", "project-1"))
			.resolves.toMatchObject({ changed: false, updatedAt: "2026-08-15T00:00:00.000Z" });
		expect(mocks.projectUpdate).not.toHaveBeenCalled();
	});
});

describe("updateBuiltInCapabilityState", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.preferenceFindFirst.mockResolvedValue(null);
		mocks.preferenceUpsert.mockResolvedValue({});
	});

	it("persists an explicit user stop for the exact built-in capability key", async () => {
		const capabilityContext = {
			env: {
				DB: {
					agent_capability_preferences: {
						findFirst: mocks.preferenceFindFirst,
						upsert: mocks.preferenceUpsert,
					},
					agent_capability_attachments: { findFirst: mocks.attachmentFindFirst },
				},
			},
		} as unknown as AppContext;

		await expect(updateBuiltInCapabilityState(
			capabilityContext,
			"user-1",
			"one_click_video",
			false,
		)).resolves.toEqual({ capabilityKey: "one_click_video", enabled: false });
		expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
			create: expect.objectContaining({
				capability_kind: "built_in",
				capability_id: "one_click_video",
				enabled: 0,
				disabled_reason: "user",
				replaced_by_capability_id: null,
			}),
		}));
	});

	it("can re-enable a foundational media primitive even when a stale workflow replacement row remains", async () => {
		mocks.preferenceFindFirst.mockResolvedValue({
			enabled: 0,
			disabled_reason: "replaced",
			replaced_by_capability_id: "workflow:flow-one-click",
		});
		mocks.attachmentFindFirst.mockResolvedValue({ id: "attachment-one-click" });
		mocks.systemSettingFindMany.mockResolvedValue([]);
		const capabilityContext = {
			env: {
				DB: {
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_capability_preferences: {
						findFirst: mocks.preferenceFindFirst,
						upsert: mocks.preferenceUpsert,
					},
					agent_capability_attachments: { findFirst: mocks.attachmentFindFirst },
				},
			},
		} as unknown as AppContext;

		await expect(updateBuiltInCapabilityState(
			capabilityContext,
			"user-1",
			"paid_media_generation",
			true,
		)).resolves.toEqual({ capabilityKey: "paid_media_generation", enabled: true });
		expect(mocks.attachmentFindFirst).not.toHaveBeenCalled();
		expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
			update: expect.objectContaining({
				enabled: 1,
				disabled_reason: null,
				replaced_by_capability_id: null,
			}),
		}));
	});
});

describe("getBuiltInCapabilityAvailability", () => {
	it("combines system and user stops without losing their source", async () => {
		mocks.systemSettingFindMany.mockResolvedValue([{ capability_id: "one_click_video" }]);
		mocks.preferenceFindMany.mockResolvedValue([{
			capability_id: "paid_media_generation",
			disabled_reason: "user",
		}]);
		const availabilityContext = {
			env: {
				DB: {
					agent_builtin_capability_settings: { findMany: mocks.systemSettingFindMany },
					agent_capability_preferences: { findMany: mocks.preferenceFindMany },
				},
			},
		} as unknown as AppContext;

		await expect(getBuiltInCapabilityAvailability(availabilityContext, "user-1"))
			.resolves.toEqual({
				systemDisabledKeys: ["one_click_video"],
				userDisabledKeys: ["paid_media_generation"],
				disabledKeys: ["one_click_video", "paid_media_generation"],
			});
	});
});

describe("user disable of system-level workflows", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getProjectForUserAccess.mockResolvedValue({ id: "project-1", access: "team_edit" });
		mocks.versionFindMany.mockResolvedValue([{ id: "version-1", data: frozenWorkflowJson }]);
		mocks.flowFindMany.mockResolvedValue([
			{ id: "flow-own", data: frozenWorkflowJson },
			{ id: "flow-system", data: frozenWorkflowJson },
		]);
	});

	it("hides a manually disabled system workflow from the equipped tool surface", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{ ...attachmentRow, id: "own-1", scope: "current_user", source_id: "flow-own" },
			{ ...attachmentRow, id: "system-1", scope: "all_users", source_id: "flow-system", user_id: "admin-1" },
		]);
		mocks.preferenceFindMany.mockResolvedValue([
			{ capability_kind: "workflow", capability_id: "flow-system", enabled: 0 },
		]);

		const rows = await listEquippedWorkflowCapabilities(context, "user-1");
		expect(rows.map((row) => row.sourceId)).toEqual(["flow-own"]);
	});

	it("keeps an enabled system workflow visible and flags userEnabled", async () => {
		mocks.attachmentFindMany.mockResolvedValue([
			{
				...attachmentRow,
				id: "system-1",
				scope: "all_users",
				source_id: "flow-system",
				user_id: "admin-1",
				route_decisions_json: JSON.stringify([{
					conflictId: "functional:builtin:one_click_video",
					withCapabilityId: "builtin:one_click_video",
					action: "replace_existing",
				}]),
			},
		]);
		mocks.preferenceFindMany.mockResolvedValue([]);

		const rows = await listEquippedWorkflowCapabilities(context, "user-1");
		expect(rows.map((row) => row.sourceId)).toEqual(["flow-system"]);
		expect(rows[0]?.userEnabled).toBe(true);
		expect(rows[0]?.primaryForCapabilities).toEqual([{
			capabilityId: "builtin:one_click_video",
			name: "一键成片",
			description: "从创作目标规划并交付完整成片。",
		}]);
	});

	it("rejects execution of a system workflow the user disabled", async () => {
		mocks.attachmentFindFirst.mockResolvedValue({
			...attachmentRow, scope: "all_users", source_id: "flow-system", user_id: "admin-1",
		});
		mocks.preferenceFindMany.mockResolvedValue([
			{ capability_kind: "workflow", capability_id: "flow-system", enabled: 0 },
		]);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_workflow_disabled_by_user", status: 403 });
	});

	it("persists the user toggle only for an existing system workflow", async () => {
		mocks.attachmentFindFirst.mockResolvedValue({
			...attachmentRow, scope: "all_users", source_id: "flow-system", user_id: "admin-1",
		});
		mocks.preferenceUpsert.mockResolvedValue({ id: "pref-1" });

		const { updateWorkflowCapabilityState } = await import("./capability-bay.service");
		await expect(updateWorkflowCapabilityState(context, "user-1", "flow-system", false))
			.resolves.toEqual({ flowId: "flow-system", enabled: false });
		expect(mocks.preferenceUpsert).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				user_id_capability_kind_capability_id: {
					user_id: "user-1", capability_kind: "workflow", capability_id: "flow-system",
				},
			},
			create: expect.objectContaining({ enabled: 0, disabled_reason: "user" }),
			update: expect.objectContaining({ enabled: 0, disabled_reason: "user" }),
		}));

		mocks.attachmentFindFirst.mockResolvedValue(null);
		await expect(updateWorkflowCapabilityState(context, "user-1", "flow-missing", false))
			.rejects.toMatchObject({ code: "capability_system_workflow_not_found", status: 404 });
	});
});

describe("workflow fanout diff stale tolerance", () => {
	it("normalizes historical execution-snapshot attachments back to the executable authoring graph", async () => {
		const triggerId = "workflow:manual-trigger";
		const videoId = "workflow:video-submit";
		const attachedVersion = JSON.stringify({
			nodes: [
				{
					id: triggerId,
					type: "taskNode",
					data: {
						kind: "workflowTrigger",
						workflowTriggerPayload: { source: "previous invocation" },
					},
				},
				{
					id: videoId,
					type: "taskNode",
					data: {
						kind: "workflowStage",
						workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" },
						workflowVideoModelKey: "doubao-seedance-2.5",
						workflowVideoResolution: "480p",
						workflowVideoAspectRatio: "16:9",
					},
				},
			],
			edges: [{ id: "edge-1", source: triggerId, target: videoId }],
		});
		const liveFlow = JSON.stringify({
			nodes: [
				{ id: "g1", type: "groupNode", data: { isGroup: true, label: "工作流" } },
				{ id: triggerId, type: "taskNode", data: { kind: "workflowTrigger" } },
				{
					id: videoId,
					type: "taskNode",
					data: { kind: "workflowStage", workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" } },
				},
			],
			edges: [{ id: "edge-1", source: triggerId, target: videoId }],
		});
		mocks.attachmentFindFirst.mockResolvedValue({
			...attachmentRow,
			source_version_id: "workflow-version-execution-1",
		});
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "workflow-version-execution-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");
		expect(target.flow.data).toBe(attachedVersion);
	});

	it("ignores execution telemetry changes on frozen workflow template nodes", async () => {
		const attachedVersion = JSON.stringify({
			nodes: [{
				id: "stage-1",
				type: "taskNode",
				position: { x: 10, y: 20 },
				data: { kind: "workflowStage", workflowNodeId: "stage-1", status: "idle" },
			}],
			edges: [],
		});
		const liveFlow = JSON.stringify({
			nodes: [{
				id: "stage-1",
				type: "taskNode",
				position: { x: 10, y: 20 },
				data: {
					kind: "workflowStage",
					workflowNodeId: "stage-1",
					status: "success",
					progress: 100,
					runToken: "run-1",
					lastResult: { at: 123, kind: "workflowStage" },
					workflowInputArtifactIds: ["artifact-1"],
					workflowEffectIds: ["effect-1"],
				},
			}],
			edges: [],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");
		expect(target.flow.data).toBe(attachedVersion);
	});

	it("treats workflow stage presentation changes as non-authoring changes", async () => {
		const stageData = {
			kind: "workflowStage",
			workflowNodeId: "stage-1",
			workflowAtomicSpec: { executorRef: "tapcanvas.video.generate/v1" },
		};
		const attachedVersion = JSON.stringify({
			nodes: [{
				id: "stage-1",
				type: "taskNode",
				position: { x: 10, y: 20 },
				selected: false,
				width: 320,
				height: 180,
				data: stageData,
			}],
			edges: [],
		});
		const liveFlow = JSON.stringify({
			nodes: [{
				id: "stage-1",
				type: "taskNode",
				position: { x: 880, y: 460 },
				positionAbsolute: { x: 880, y: 460 },
				selected: true,
				dragging: false,
				resizing: false,
				width: 360,
				height: 220,
				measured: { width: 360, height: 220 },
				data: stageData,
			}],
			edges: [],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");
		expect(target.flow.data).toBe(attachedVersion);
	});

	it("ignores React Flow edge presentation defaults while preserving the frozen executable edge", async () => {
		const nodes = [
			{ id: "trigger-1", data: { kind: "workflowTrigger" } },
			{ id: "stage-1", data: { kind: "workflowStage" } },
		];
		const attachedVersion = JSON.stringify({
			nodes,
			edges: [{
				id: "edge-1",
				source: "trigger-1",
				sourceHandle: "out-workflow:trigger",
				target: "stage-1",
				targetHandle: "in-workflow:trigger",
			}],
		});
		const liveFlow = JSON.stringify({
			nodes,
			edges: [{
				id: "edge-1",
				source: "trigger-1",
				sourceHandle: "out-workflow:trigger",
				target: "stage-1",
				targetHandle: "in-workflow:trigger",
				type: "typed",
				animated: false,
				selected: false,
				data: {},
				style: { strokeWidth: 2 },
			}],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");

		expect(target.flow.data).toBe(attachedVersion);
	});

	it("still rejects a typed workflow port change", async () => {
		const nodes = [
			{ id: "trigger-1", data: { kind: "workflowTrigger" } },
			{ id: "stage-1", data: { kind: "workflowStage" } },
		];
		const attachedVersion = JSON.stringify({
			nodes,
			edges: [{
				id: "edge-1",
				source: "trigger-1",
				sourceHandle: "out-workflow:trigger",
				target: "stage-1",
				targetHandle: "in-workflow:trigger",
			}],
		});
		const liveFlow = JSON.stringify({
			nodes,
			edges: [{
				id: "edge-1",
				source: "trigger-1",
				sourceHandle: "out-workflow:result",
				target: "stage-1",
				targetHandle: "in-workflow:trigger",
				type: "typed",
				animated: false,
				data: {},
			}],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_attachment_stale", status: 409 });
	});

	it("treats a moved concat film node as a non-edit (position change only)", async () => {
		const filmNode = (x: number) => ({
			id: "film-exec-1",
			type: "taskNode",
			position: { x, y: 120 },
			data: { kind: "composeVideo", status: "success", videoUrl: "https://example.com/a.mp4", workflowExecutionId: "exec-1" },
		});
		// attached 版本把 film 节点也保存进了模板（用户保存时产物在画布上），
		// live 只是把 film 节点从 x=4356 移到 x=1676。
		const attachedVersion = JSON.stringify({ nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }, filmNode(4356)], edges: [] });
		const liveFlow = JSON.stringify({ nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }, filmNode(1676)], edges: [] });

		const flowRowWithFilm = { ...flowRow, data: liveFlow };
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue(flowRowWithFilm);
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");
		expect(target.attachment.sourceVersionId).toBe("version-1");
		expect(target.flow.data).toBe(attachedVersion);
	});

	it("ignores different historical film artifacts and their edges on both graph snapshots", async () => {
		const trigger = { id: "trigger-1", data: { kind: "workflowTrigger" } };
		const stage = { id: "stage-1", data: { kind: "workflowStage", instruction: "write clips" } };
		const filmNode = (executionId: string, videoUrl: string) => ({
			id: `film-${executionId}`,
			type: "taskNode",
			position: { x: 1200, y: 120 },
			data: { kind: "composeVideo", status: "success", videoUrl, workflowExecutionId: executionId },
		});
		const attachedVersion = JSON.stringify({
			nodes: [trigger, stage, filmNode("exec-old", "https://example.com/old.mp4")],
			edges: [
				{ id: "template-edge", source: "trigger-1", target: "stage-1" },
				{ id: "old-film-edge", source: "stage-1", target: "film-exec-old" },
			],
		});
		const liveFlow = JSON.stringify({
			nodes: [
				trigger,
				stage,
				filmNode("exec-old", "https://example.com/old-reconciled.mp4"),
				filmNode("exec-new", "https://example.com/new.mp4"),
			],
			edges: [
				{ id: "new-film-edge", source: "stage-1", target: "film-exec-new" },
				{ id: "template-edge", source: "trigger-1", target: "stage-1" },
			],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		const target = await resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1");
		expect(target.flow.data).toBe(attachedVersion);
	});

	it("still rejects a real template edit (workflow stage data change)", async () => {
		const attachedVersion = JSON.stringify({ nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger" } }], edges: [] });
		const liveFlow = JSON.stringify({ nodes: [{ id: "trigger-1", data: { kind: "workflowTrigger", workflowSourceText: "改过的源" } }], edges: [] });
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_attachment_stale", status: 409 });
	});

	it("still rejects a real template edge change", async () => {
		const nodes = [
			{ id: "trigger-1", data: { kind: "workflowTrigger" } },
			{ id: "stage-1", data: { kind: "workflowStage" } },
			{ id: "stage-2", data: { kind: "workflowStage" } },
		];
		const attachedVersion = JSON.stringify({
			nodes,
			edges: [
				{ id: "edge-1", source: "trigger-1", target: "stage-1" },
				{ id: "edge-2", source: "stage-1", target: "stage-2" },
			],
		});
		const liveFlow = JSON.stringify({
			nodes,
			edges: [
				{ id: "edge-1", source: "trigger-1", target: "stage-2" },
				{ id: "edge-2", source: "stage-2", target: "stage-1" },
			],
		});
		mocks.attachmentFindFirst.mockResolvedValue(attachmentRow);
		mocks.flowFindFirst.mockResolvedValue({ ...flowRow, data: liveFlow });
		mocks.versionFindFirst.mockResolvedValue({
			id: "version-1",
			flow_id: "flow-1",
			data: attachedVersion,
			created_at: "2026-08-15T00:00:00.000Z",
		});
		mocks.preferenceFindMany.mockResolvedValue([]);

		await expect(resolveEquippedWorkflowExecutionTarget(context, "user-1", "attachment-1"))
			.rejects.toMatchObject({ code: "capability_attachment_stale", status: 409 });
	});
});
