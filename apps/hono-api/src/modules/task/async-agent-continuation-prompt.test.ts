import { describe, expect, it } from "vitest";
import {
	buildAsyncAgentContinuationPrompt,
	selectAuthoritativeProgressFrontier,
} from "./async-agent-continuation-prompt";

describe("buildAsyncAgentContinuationPrompt", () => {
	it("turns an accepted dependency continuation into settlement-only work", () => {
		const prompt = buildAsyncAgentContinuationPrompt({
			stage: 8,
			parentContinuationId: "parent-cover",
			handledArtifactIds: ["image:node:cover-1"],
			progressFingerprint: "cover-frontier",
			dependencyNodeIds: ["cover-1"],
			dependencyTaskIds: ["task-cover-1"],
			dependencyRunIds: [],
			durableTaskReferences: [],
			durableProgressClaims: [],
			actionRecoveryFacts: [],
			expectedDelivery: { active: true, kind: "image" },
			taskCapsule: { version: 1, goal: "生成一个章节封面", requestFacts: {} },
		}, "dependency");

		expect(prompt).toContain("已经被供应商受理的异步依赖");
		expect(prompt).toContain("nodeId/taskId/runId 是唯一交付所有者");
		expect(prompt).toContain("禁止调用任何新生成");
		expect(prompt).toContain("不得改写提示词后再次提交");
		expect(prompt).not.toContain("业务执行尚未开始");
	});

	it("reinjects a short immutable root goal without changing the durable frontier", () => {
		const goal = "由小T自主规划并触发当前章节一键成片，使用 Seedance 2.0 与 480p。";
		const prompt = buildAsyncAgentContinuationPrompt({
			stage: 2,
			parentContinuationId: "parent-1",
			handledArtifactIds: ["root_physical_run:1"],
			progressFingerprint: "frontier-2",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			durableTaskReferences: [],
			durableProgressClaims: [],
			actionRecoveryFacts: [],
			expectedDelivery: { active: true, kind: "final_film" },
			taskCapsule: { version: 1, goal, requestFacts: {} },
		}, "physical_budget");

		expect(prompt).toContain("<original_task_goal immutable=\"true\">");
		expect(prompt).toContain(goal);
		expect(prompt).toContain("业务执行尚未开始");
		expect(prompt).toContain("第一个合法业务动作");
		expect(prompt).not.toContain("只能执行其中 progressCursor.requiredReadActions");
		expect(prompt).not.toContain("<original_task_goal_ref");
	});

	it("treats historical receipts and non-retryable failures as pre-action evidence when no business frontier exists", () => {
		const prompt = buildAsyncAgentContinuationPrompt({
			stage: 7,
			parentContinuationId: "parent-pre-action",
			handledArtifactIds: ["root_physical_run:7"],
			progressFingerprint: "frontier-pre-action",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			durableTaskReferences: [{
				version: 1,
				toolName: "tapcanvas_equipped_workflow_run",
				mode: "inspect",
				runId: "cancelled-old-run",
				taskId: null,
				draftRevision: "old-revision",
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: false,
			}],
			durableProgressClaims: [],
			actionRecoveryFacts: [{
				version: 1,
				toolName: "record_user_intent",
				mode: null,
				status: "failed",
				code: "tool_call_failed",
				message: "An earlier intent write failed before the frozen contract existed.",
				runId: null,
				draftRevision: null,
			}],
			expectedDelivery: { active: true, kind: "final_film" },
			taskCapsule: { version: 1, goal: "完成第35章一键成片", requestFacts: {} },
		}, "physical_budget");

		expect(prompt).toContain("业务执行尚未开始");
		expect(prompt).toContain("第一个合法业务动作");
		expect(prompt).not.toContain("只能执行其中 progressCursor.requiredReadActions");
	});

	it("projects the durable frontier before a hash reference without replaying the source", () => {
		const source = "任意长篇原文".repeat(10_000);
		const prompt = buildAsyncAgentContinuationPrompt({
			stage: 3,
			parentContinuationId: "parent-2",
			handledArtifactIds: ["root_physical_run:2"],
			progressFingerprint: "frontier-3",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: ["run-1"],
			durableTaskReferences: [{
				version: 1,
				toolName: "tapcanvas_arbitrary_graph",
				mode: "write_unit",
				runId: "run-1",
				taskId: null,
				draftRevision: "revision-7",
				beatRevision: null,
				preflightRevision: null,
				preflightFingerprint: null,
				clipIndex: null,
				acceptedAsync: false,
				progressCursor: {
					version: 1,
					graph: "arbitrary_graph",
					phase: "draft",
					revision: "revision-7",
					completedUnitIds: ["unit-0"],
					pendingUnitIds: ["unit-1"],
					allowedNextActions: ["write_unit"],
					requiredReadActions: [],
				},
			}],
			durableProgressClaims: [{
				key: "assetId:asset-1",
				fingerprint: "fingerprint-1",
				kind: "durable_action",
				toolName: "tapcanvas_call_tool",
				toolCallId: "call-confirm-1",
				observedAt: "2026-08-11T00:00:00.000Z",
				revision: 3,
			}],
			actionRecoveryFacts: [],
			expectedDelivery: { active: true, kind: "arbitrary_delivery" },
			taskCapsule: { version: 1, goal: source, requestFacts: {} },
		}, "physical_budget");

		expect(prompt).toContain("write_unit");
		expect(prompt).toContain('"authoritativeProgressFrontier"');
		expect(prompt).toContain("call-confirm-1");
		expect(prompt).toContain("禁止重复读取同一 schema");
		expect(prompt).toContain("durable_agents_session");
		expect(prompt).not.toContain(source);
		expect(prompt.indexOf("<continuation_checkpoint>")).toBeLessThan(
			prompt.indexOf("<original_task_goal_ref"),
		);
		expect(prompt.length).toBeLessThan(2_000);
	});

	it("reinjects the immutable task body for a direct typed Workflow Agent continuation", () => {
		const goal = [
			"执行当前工作流 Agent 原子节点。",
			"上游端口事实（JSON）：",
			JSON.stringify({ value: { clipId: "clip-0002", text: "冻结片段正文" } }),
			"最终响应必须只包含一个严格 JSON 对象。",
		].join("\n");
		const prompt = buildAsyncAgentContinuationPrompt({
			stage: 1,
			parentContinuationId: null,
			handledArtifactIds: [],
			progressFingerprint: "workflow-agent-window-2",
			dependencyNodeIds: [],
			dependencyTaskIds: [],
			dependencyRunIds: [],
			durableTaskReferences: [],
			durableProgressClaims: [],
			actionRecoveryFacts: [],
			expectedDelivery: { active: true, kind: "tapcanvas.video-prompt/v1" },
			taskCapsule: {
				version: 1,
				goal,
				requestFacts: {},
				executionContract: {
					version: 1,
					directForcedAgentExecution: true,
					outputContract: {
						kind: "json",
						requiredStringFields: ["artifactType", "text"],
					},
				},
			},
		}, "physical_budget");

		expect(prompt).toContain("<original_task_goal immutable=\"true\">");
		expect(prompt).toContain("冻结片段正文");
		expect(prompt).toContain("最终响应必须只包含一个严格 JSON 对象");
		expect(prompt).not.toContain("durable_agents_session");
		expect(prompt).toContain("禁止声称输入缺失");
		expect(prompt).toContain("不存在待执行的 durable graph action");
		expect(prompt).toContain("本窗口禁止再次调用 Skill");
		expect(prompt).toContain("通过当前结构化终态工具提交原始 typed output");
		expect(prompt).not.toContain("只能执行其中 progressCursor.requiredReadActions");
	});

	it("projects one monotonic frontier instead of making the model choose among historical receipts", () => {
		const baseReference = {
			version: 1 as const,
			toolName: "tapcanvas_arbitrary_graph",
			mode: "write_unit",
			runId: "run-1",
			taskId: null,
			draftRevision: "revision-7",
			beatRevision: null,
			preflightRevision: null,
			preflightFingerprint: null,
			clipIndex: null,
			acceptedAsync: false,
		};
		const references = [{
			...baseReference,
			progressCursor: {
				version: 1 as const,
				graph: "arbitrary_graph",
				phase: "draft",
				revision: "revision-7",
				completedUnitIds: ["unit-0", "unit-1"],
				pendingUnitIds: ["unit-2"],
				allowedNextActions: ["write_unit_2"],
				requiredReadActions: ["read_unit_2"],
			},
		}, {
			...baseReference,
			mode: "read_unit",
			progressCursor: {
				version: 1 as const,
				graph: "arbitrary_graph",
				phase: "draft",
				revision: "revision-7",
				completedUnitIds: ["unit-0"],
				pendingUnitIds: ["unit-1", "unit-2"],
				allowedNextActions: ["write_unit_1"],
				requiredReadActions: [],
			},
		}];

		const frontier = selectAuthoritativeProgressFrontier(references);

		expect(frontier?.progressCursor).toMatchObject({
			completedUnitIds: ["unit-0", "unit-1"],
			allowedNextActions: ["write_unit_2"],
			requiredReadActions: ["read_unit_2"],
		});
	});

	it("lets a genuinely new durable identity replace an older completed graph", () => {
		const frontier = selectAuthoritativeProgressFrontier([{
			version: 1,
			toolName: "tapcanvas_arbitrary_graph",
			mode: "commit",
			runId: "old-run",
			taskId: null,
			draftRevision: "old-revision",
			beatRevision: null,
			preflightRevision: null,
			preflightFingerprint: null,
			clipIndex: null,
			acceptedAsync: false,
			progressCursor: {
				version: 1,
				graph: "arbitrary_graph",
				phase: "committed",
				revision: "old-revision",
				completedUnitIds: ["unit-0", "unit-1", "unit-2"],
				pendingUnitIds: [],
				allowedNextActions: ["publish"],
				requiredReadActions: [],
			},
		}, {
			version: 1,
			toolName: "tapcanvas_arbitrary_graph",
			mode: "begin",
			runId: "new-run",
			taskId: null,
			draftRevision: "new-revision",
			beatRevision: null,
			preflightRevision: null,
			preflightFingerprint: null,
			clipIndex: null,
			acceptedAsync: false,
			progressCursor: {
				version: 1,
				graph: "arbitrary_graph",
				phase: "draft",
				revision: "new-revision",
				completedUnitIds: [],
				pendingUnitIds: ["unit-0"],
				allowedNextActions: ["write_unit_0"],
				requiredReadActions: [],
			},
		}]);

		expect(frontier?.runId).toBe("new-run");
		expect(frontier?.progressCursor.allowedNextActions).toEqual(["write_unit_0"]);
	});
});
