import { executeRegisteredWorkflowNode } from "./execution.node-executors";
import { createHash } from "node:crypto";
import { WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX } from "@tapcanvas/workflow-kernel-protocol";
import { validateWorkflowAgentOutput } from "./execution.agent-output-contract";
import { deriveBeatSheetSourceProfile } from "./execution.beat-sheet-source-coverage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/error";
import type { AppContext, WorkerEnv } from "../../types";
import type { AgentsBridgeStreamObserver } from "../task/task.agents-bridge";
import type { WorkflowAgentActivitySnapshot } from "./execution.agent-progress";
import type { readWorkflowAgentPreferences as ReadWorkflowAgentPreferences } from "./execution.agent-preferences";

const { readWorkflowAgentPreferences } = vi.hoisted(() => ({
	readWorkflowAgentPreferences: vi.fn<Parameters<typeof ReadWorkflowAgentPreferences>, ReturnType<typeof ReadWorkflowAgentPreferences>>(),
}));
vi.mock("./execution.agent-preferences", () => ({ readWorkflowAgentPreferences }));
beforeEach(() => { readWorkflowAgentPreferences.mockReset().mockResolvedValue(null); });
const { readWorkflowAgentSettledResult } = vi.hoisted(() => ({ readWorkflowAgentSettledResult: vi.fn() }));
vi.mock("./execution.agent-settled-result", () => ({ readWorkflowAgentSettledResult }));
beforeEach(() => { readWorkflowAgentSettledResult.mockReset().mockResolvedValue(null); });

const { buildTaskRequest, runPersistedAgentsChatTask } = vi.hoisted(() => ({
	buildTaskRequest: vi.fn((input: Record<string, unknown>) => ({
		kind: "chat",
		prompt: input.prompt,
		extras: {
			modelKey: input.modelKey,
			sessionKey: input.sessionKey,
			canvasFlowId: input.canvasFlowId,
			canvasProjectId: input.canvasProjectId,
			canvasNodeId: input.canvasNodeId,
			requiredSkills: input.requiredSkills,
			mountedKnowledgeCardIds: input.mountedKnowledgeCardIds,
			executionToolPolicy: input.executionToolPolicy,
			disabledSkills: input.disabledSkills,
			disabledKnowledgeCardIds: input.disabledKnowledgeCardIds,
			forcedAgentRole: input.forcedAgentRole,
			allowedSubagentTypes: input.allowedSubagentTypes,
			response_format: input.response_format,
		},
	})),
	runPersistedAgentsChatTask: vi.fn(),
}));
const { getAgentsChatTurnStatus } = vi.hoisted(() => ({
	getAgentsChatTurnStatus: vi.fn(),
}));
const { resumePersistedAgentsChatTurn } = vi.hoisted(() => ({
	resumePersistedAgentsChatTurn: vi.fn(),
}));
const { cancelWorkflowAgentTurns } = vi.hoisted(() => ({
	cancelWorkflowAgentTurns: vi.fn(),
}));
const { getExecutionTraceLifecycleSnapshot } = vi.hoisted(() => ({
	getExecutionTraceLifecycleSnapshot: vi.fn(),
}));

vi.mock("../task/task.agents-chat-runtime", () => ({ getAgentsChatTurnStatus }));
vi.mock("../task/public-agents-chat", () => ({
	buildTaskRequest,
	resolveInactiveChatTurnRecoveryKind: (turn: {
		state: string;
		phase: string;
		reasonCode: string | null;
	}) => {
		if (turn.state === "suspended") {
			return turn.reasonCode === "provider_stream_interrupted"
				? "orphaned_checkpoint"
				: "physical_budget";
		}
		if (
			(turn.state === "unknown" || turn.state === "failed") &&
			(
				turn.reasonCode === "provider_stream_interrupted" ||
				turn.phase === "accepted" ||
				turn.phase === "agent_running" ||
				turn.phase === "completion_verifying"
			)
		) return "orphaned_checkpoint";
		return null;
	},
	resumePersistedAgentsChatTurn,
	runPersistedAgentsChatTask,
}));
vi.mock("./execution.agent-cancellation", () => ({ cancelWorkflowAgentTurns }));
vi.mock("../memory/execution-trace-events.repo", () => ({ getExecutionTraceLifecycleSnapshot }));

import {
	workflowAgentPrompt,
	isRecoverableWorkflowAgentInterruption,
	workflowAgentStructuredOutput,
	runWorkflowAgentNode,
} from "./execution.agent-runner";
import { resolveWorkflowAgentPhysicalContinuationReason } from "./execution.agent-physical-continuation";
import { workflowAgentPublicTurnId } from "./execution.agent-identity";
import { authorSourceJsonHash } from "../../../../../packages/schemas/author-source-representation/index.mjs";
import type { WorkflowProjectContext } from "./execution.project-context";
import { createWorkflowProjectContext } from "./execution.project-context";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import { workflowProjectImageCatalog } from "./execution.project-image-candidates";
import { workflowAgentProjectContextPromptFacts } from "./execution.agent-project-context";
import { workflowIntentFixture } from "./test-fixtures/workflow-user-intent";

const request = {
	executionId: "execution-1",
	executionFamilyId: "execution-family-1",
	nodeId: "agent-1",
	ownerId: "user-1",
	flowId: "flow-1",
	projectId: "project-1",
	workflowKey: "agent-workflow/v1",
	instruction: "生成完整产物",
	outputArtifactType: "tapcanvas.text/v1",
	outputEncoding: "plain_text" as const,
	deliveryRequirement: "交付完整文本",
	modelKey: "model-1",
	maxOutputTokens: 4096,
	inputs: { input: ["source"] },
	requiredSkills: [],
	mountedKnowledgeCardIds: ["knowledge-card-mounted"],
	disabledSkills: ["disabled-skill"],
	disabledKnowledgeCardIds: ["knowledge-card-disabled"],
	allowedTools: [],
	forcedAgentRole: "writer",
	resumeOnly: false,
	previousEvidence: null,
};

it.each([undefined, "compact_structured"] as const)("leaves a jsonSchema contract to agents-cli instead of repeating it in the prompt (%s)", (promptMode) => {
	const marker = "schema-marker-field-only-in-schema";
	const withSchema = workflowAgentPrompt({ ...request, promptMode, outputEncoding: "json_object" as const,
		jsonObjectContract: { allowedFields: ["title"], requiredStringFields: ["title"], jsonSchema: {
			type: "object", required: ["title"], properties: { title: { type: "string", description: marker } },
		} } });
	expect(withSchema).not.toContain(marker);
	const fieldsOnly = workflowAgentPrompt({ ...request, promptMode, outputEncoding: "json_object" as const,
		jsonObjectContract: { allowedFields: [marker], requiredStringFields: [marker] } });
	expect(fieldsOnly).toContain(marker);
});

it.each([undefined, "compact_structured"] as const)("distinguishes incremental physical responses from complete delivery (%s)", (promptMode) => {
	const typed = { ...request, promptMode, outputEncoding: "json_object" as const,
		jsonObjectContract: { allowedFields: ["title"], requiredStringFields: ["title"] },
		failurePolicy: "repair_with_correction" as const };
	const prompt = workflowAgentPrompt({ ...typed, executionPolicy: "multi_inference" });
	expect(prompt).toContain("从首轮起可以按 agents-cli 的原生 edits 协议");
	expect(prompt).toContain("只有完整候选通过冻结合同校验后才进入最终 text 端口");
	expect(prompt).not.toContain("提交前在本次推理内核对");
	const single = workflowAgentPrompt({ ...typed, executionPolicy: "single_inference" });
	expect(single).not.toContain("edits");
	expect(single).toContain("最终交付");
	expect(workflowAgentPrompt({ ...typed, failurePolicy: "single_submission" })).not.toContain("edits");
});

it.each(["json_array", "json_artifact"] as const)("keeps incremental transport available for %s contracts", (outputEncoding) => {
	const typed = { ...request, outputEncoding, failurePolicy: "repair_with_correction" as const };
	expect(workflowAgentStructuredOutput(typed)?.outputContract).toHaveProperty("kind", "json");
	expect(workflowAgentStructuredOutput(typed)?.outputContract).toHaveProperty("reviewPolicy", "disabled");
	expect(workflowAgentStructuredOutput({ ...typed, reviewPolicy: "independent" })?.outputContract).toHaveProperty("reviewPolicy", "independent");
	expect(workflowAgentPrompt(typed)).toContain("从首轮起可以按 agents-cli 的原生 edits 协议");
	expect(workflowAgentPrompt({ ...typed, executionPolicy: "single_inference" })).not.toContain("edits");
	expect(workflowAgentPrompt({ ...typed, failurePolicy: "single_submission" })).not.toContain("edits");
});

const recentIso = (ageMs = 1_000): string => new Date(Date.now() - ageMs).toISOString();
const authorDeliveryHash = (text: string): string => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

it.each([undefined, "compact_structured"] as const)("keeps runtime-bound fields out of the author prompt (%s)", (promptMode) => {
	const jsonSchema = {
		type: "object",
		"x-runtimeBindingTables": { identities: { "0": { id: "host-owned-identity" } } },
		properties: { references: { type: "array", items: {
			type: "object",
			"x-runtimeBindings": { table: "identities", selector: "selector", fields: { machineId: "id" } },
			properties: { selector: { type: "integer", enum: [0] }, machineId: { type: "string" } },
			required: ["selector", "machineId"], additionalProperties: false,
		} } },
		required: ["references"], additionalProperties: false,
	};
	const typed = { ...request, promptMode, outputEncoding: "json_object" as const,
		jsonObjectContract: { allowedFields: ["references"], jsonSchema } };
	const prompt = workflowAgentPrompt(typed);
	expect(prompt).not.toContain("x-runtimeBindingTables");
	expect(prompt).not.toContain("machineId");
	expect(prompt).not.toContain("host-owned-identity");
	const transmitted = workflowAgentStructuredOutput(typed)?.outputContract;
	expect(JSON.stringify(transmitted)).not.toContain("machineId");
	expect(JSON.stringify(transmitted)).not.toContain("host-owned-identity");
	expect(typed.jsonObjectContract.jsonSchema).toBe(jsonSchema);
});

it.each([undefined, "compact_structured"] as const)("projects derived fields out of all author contract surfaces (%s)", (promptMode) => {
	const jsonSchema = {
		type: "object",
		properties: { values: { type: "array", items: { type: "number" } }, computedTotal: { type: "number" } },
		required: ["values", "computedTotal"], additionalProperties: false,
		"x-runtimeDerivations": [{ op: "sum", valuesPath: ["values", "*"], outputPath: ["computedTotal"] }],
	};
	const typed = { ...request, promptMode, outputEncoding: "json_object" as const,
		jsonObjectContract: { allowedFields: ["values", "computedTotal"], requiredNumberFields: ["computedTotal"], jsonSchema } };
	expect(workflowAgentPrompt(typed)).not.toContain("computedTotal");
	expect(workflowAgentPrompt(typed)).not.toContain("x-runtimeDerivations");
	const transmitted = workflowAgentStructuredOutput(typed)?.outputContract;
	expect(JSON.stringify(transmitted)).not.toContain("computedTotal");
	expect(JSON.stringify(transmitted)).not.toContain("x-runtimeDerivations");
	expect(typed.jsonObjectContract.jsonSchema).toBe(jsonSchema);
	});

it.each([undefined, "compact_structured"] as const)("keeps frozen quoted source coordinates through the author prompt projection (%s)", (promptMode) => {
	const sourceId = "chapter-source";
	const content = "第1章\n“🌟同一句。”\n“🌟同一句。”";
	const sourceFingerprint = createHash("sha256").update(content).digest("hex");
	const deliveryContract = {
		protocolVersion: "tapcanvas.workflow-delivery-contract/v2",
		canvasFacts: { authoritativeSources: [{ sourceId, sourceFingerprint, content }] },
		sourceProfile: deriveBeatSheetSourceProfile({
			canvasFacts: { authoritativeSources: [{ sourceId, sourceFingerprint, content }] },
		}),
	};
	const units = deliveryContract.sourceProfile?.sourceQuotedUnits ?? [];
	const prompt = workflowAgentPrompt({
		...request,
		promptMode,
		outputEncoding: "json_object",
		jsonObjectContract: { allowedFields: [], jsonSchema: { type: "object", properties: {} } },
		outputArtifactType: "tapcanvas.beat-sheet/v2",
		inputs: { "delivery-contract": [deliveryContract] },
	});

	expect(units).toHaveLength(2);
	expect(prompt).toContain(JSON.stringify(units));
	expect(prompt).toContain('"sourceIndex":0');
	expect(prompt).toContain('"startOffset":');
	expect(prompt).toContain('"endOffset":');
	expect(prompt).toContain('"verbatim":"🌟同一句。"');
});

it("projects a single-submission policy without disabling the authoring tool surface", () => {
	const typed = { ...request, outputEncoding: "json_artifact" as const,
		failurePolicy: "single_submission" as const, executionPolicy: "single_inference" as const };
	expect(workflowAgentStructuredOutput(typed)?.outputContract).toMatchObject({
		submissionPolicy: "single_submission_record_and_fail",
		executionPolicy: "single_inference_no_tools_record_and_fail",
	});
	expect(workflowAgentStructuredOutput(typed)?.outputContract).not.toHaveProperty("providerRecoveryPolicy");
	expect(workflowAgentStructuredOutput({ ...typed, executionPolicy: undefined })?.outputContract)
		.not.toHaveProperty("executionPolicy");
});

it("projects explicit repair and multi-inference policies to the generic typed repair contract", () => {
	const typed = { ...request, outputEncoding: "json_artifact" as const,
		failurePolicy: "repair_with_correction" as const, executionPolicy: "multi_inference" as const };
	const outputContract = workflowAgentStructuredOutput(typed)?.outputContract;
	expect(outputContract).toMatchObject({ submissionPolicy: "repair_with_correction" });
	expect(outputContract).not.toHaveProperty("executionPolicy");
	expect(outputContract).not.toHaveProperty("providerRecoveryPolicy");
});

it("rebuilds a Clip author whose budget continuation child died instead of failing the item", async () => {
	// Observed: clip 9's continuation lost its worker lease, the root turn settled
	// failed/async_dependency_terminal, and the pipeline never wrote that Clip.
	getAgentsChatTurnStatus.mockResolvedValueOnce({
		sessionId: "workflow:execution-1:agent-1",
		durable: true,
		activeTurn: false,
		turn: {
			turnId: "workflow:execution-1:agent-1",
			internalTurnId: "turn-dead-child",
			state: "failed",
			phase: "failed",
			startedAt: "2026-10-03T03:19:00.000Z",
			updatedAt: "2026-10-03T03:46:41.000Z",
			lastConfirmedAt: "2026-10-03T03:46:41.000Z",
			requestText: "",
			reasonCode: "async_dependency_terminal",
			suspension: null,
			recoveryCheckpoint: {
				reasonCode: "async_dependency_terminal",
				physicalRunId: "physical-dead-child",
				progressRevision: 3,
				durableTaskReferences: [],
				durableProgressClaims: [],
				userIntentContract: null,
			},
			lastConfirmedSummary: "续写子任务终止",
			finalResponse: null,
			pendingUserInput: null,
			pendingQueueCount: 0,
			recentEvents: [],
		},
	});
	await expect(runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true }))
		.resolves.toMatchObject({
			requestTerminal: { status: "suspended", reason: "workflow_agent_physical_retry_pending" },
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "async_dependency_terminal",
				physicalRetryOrdinal: 1,
			},
		});
});

it("keeps a single submission durably waiting after multiple transport interruptions", async () => {
	runPersistedAgentsChatTask.mockClear();
	const result = await runWorkflowAgentNode({} as WorkerEnv, {
		...request, outputEncoding: "json_artifact", failurePolicy: "single_submission", resumeOnly: true,
		previousEvidence: { deliveryEvidence: { retryablePhysicalFailure: true,
			physicalFailureReason: "provider_stream_interrupted", physicalRetryOrdinal: 9,
      retryNotBeforeAt: new Date(Date.now() + 60_000).toISOString() } },
	});
	expect(result.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_no_progress_recovery_deferred" });
	expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	// A judged failure is never resent, whatever the ordinal.
	const judged = await runWorkflowAgentNode({} as WorkerEnv, {
		...request, outputEncoding: "json_artifact", failurePolicy: "single_submission", resumeOnly: true,
		previousEvidence: { deliveryEvidence: { retryablePhysicalFailure: true,
			physicalFailureReason: "provider_balance_required", physicalRetryOrdinal: 1 } },
	});
	expect(judged.requestTerminal).toMatchObject({ status: "failed", reason: "provider_balance_required" });
});

it("transport continuation is independent of the number of physical attempts", () => {
  expect(resolveWorkflowAgentPhysicalContinuationReason("provider_stream_interrupted")).toBe("provider_stream_interrupted");
  expect(resolveWorkflowAgentPhysicalContinuationReason("workflow_agent_orphaned_checkpoint")).toBe("workflow_agent_orphaned_checkpoint");
  expect(resolveWorkflowAgentPhysicalContinuationReason("workflow_agent_no_progress_window_exhausted")).not.toBeNull();
  for (const reason of ["provider_balance_required", "structured_output_invalid", "permission_denied"]) {
    expect(resolveWorkflowAgentPhysicalContinuationReason(reason)).toBeNull();
  }
});

it.each(["tapcanvas.chapter-asset-plan/v3", "tapcanvas.chapter-asset-part/v1"])(
	"keeps %s asset discovery on demand across selection and prompt modes", (outputArtifactType) => {
		const assets = projectNodeAssetsFromCanvases([{
			projectId: "project-1", ownerType: "project", ownerId: "project-1", flowId: "old-chapter",
			canvasRevision: 1, createdAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z",
			data: { nodes: [
				{ id: "character", data: { kind: "image", label: "旧角色卡", imageUrl: "https://owned.test/character.png",
					referenceType: "character", physicalIdentityKey: "stable-character", prompt: "private-source-prompt",
					sourceAssetId: "lineage-private-marker" } },
				{ id: "character-copy", data: { kind: "image", label: "角色卡别名", imageUrl: "https://owned.test/character.png",
					referenceType: "character", physicalIdentityKey: "stable-character" } },
				{ id: "scene", data: { kind: "image", label: "旧场景", imageUrl: "https://owned.test/scene.png", referenceType: "scene" } },
				{ id: "failed", data: { kind: "image", label: "failed-marker", imageUrl: "https://owned.test/failed.png", status: "failed" } },
				{ id: "preview", data: { kind: "image", label: "preview-marker", imageUrl: "https://owned.test/preview.png", assetUsage: "preview_only" } },
				{ id: "video", data: { kind: "video", label: "video-marker", videoUrl: "https://owned.test/video.mp4" } },
			], edges: [] },
		}]);
		const baseContext = createWorkflowProjectContext({ projectId: "project-1", canvasId: "new-chapter",
			principalId: "user-1", canvasData: { nodes: [], edges: [] }, assets });
		const catalog = workflowProjectImageCatalog(baseContext);
		expect(catalog).toHaveLength(3);
		for (const selectedAssetIds of [[], [catalog[0]!.assetId]]) {
			const noRealMedia = { ...baseContext.assetSnapshot[0]!, assetId: "missing-media-marker",
				sourceFacts: { ...baseContext.assetSnapshot[0]!.sourceFacts, mediaIdentityKey: null } };
			const projectContext = { ...baseContext, selectedAssetIds,
				projectAssetIds: [...baseContext.projectAssetIds, noRealMedia.assetId],
				assetSnapshot: [...baseContext.assetSnapshot, noRealMedia] };
			const before = JSON.stringify(projectContext);
			for (const projectContextPromptMode of [undefined, "identity_only"] as const) {
				const facts = workflowAgentProjectContextPromptFacts(projectContext, outputArtifactType, projectContextPromptMode);
				expect(facts.selectedAssetIds).toEqual(selectedAssetIds);
				expect(facts).not.toHaveProperty("projectAssetCandidates");
				const selected = facts.selectedAssetSnapshot as { assetId: string }[];
				expect(selected.map(asset => asset.assetId)).toEqual(selectedAssetIds);
				for (const promptMode of [undefined, "compact_structured"] as const) {
					const prompt = workflowAgentPrompt({ ...request, outputArtifactType, projectContext, projectContextPromptMode,
						promptMode, outputEncoding: "json_object", jsonObjectContract: { requiredArrayFields: ["objectRegistry"], allowedFields: ["objectRegistry"] },
						allowedTools: ["tapcanvas_workflow_execution_inspect"] });
					for (const asset of catalog) {
						if (selectedAssetIds.includes(asset.assetId)) expect(prompt).toContain(asset.assetId);
						else expect(prompt).not.toContain(asset.assetId);
					}
					expect(prompt).toContain('frozenAssetMatch: {"tool":"tapcanvas_workflow_execution_inspect"');
					expect(prompt).toContain('"view":"asset_match"');
					expect(prompt).toContain("项目资产未全量注入当前上下文");
					for (const marker of ["private-source-prompt", "lineage-private-marker", "failed-marker", "preview-marker", "video-marker", "missing-media-marker", "https://owned.test/"]) {
						expect(prompt).not.toContain(marker);
					}
					const noToolPrompt = workflowAgentPrompt({ ...request, outputArtifactType, projectContext,
						projectContextPromptMode, promptMode, outputEncoding: "json_object",
						jsonObjectContract: { requiredArrayFields: ["objectRegistry"], allowedFields: ["objectRegistry"] }, allowedTools: [] });
					expect(noToolPrompt).not.toContain("frozenAssetMatch:");
					expect(noToolPrompt).not.toContain(catalog[1]!.assetId);
					const singleInferencePrompt = workflowAgentPrompt({ ...request, outputArtifactType, projectContext,
						projectContextPromptMode, promptMode, outputEncoding: "json_object", executionPolicy: "single_inference",
						jsonObjectContract: { requiredArrayFields: ["objectRegistry"], allowedFields: ["objectRegistry"] },
						allowedTools: ["tapcanvas_workflow_execution_inspect"] });
					expect(singleInferencePrompt).not.toContain("frozenAssetMatch:");
					expect(singleInferencePrompt).not.toContain(catalog[1]!.assetId);
				}
			}
			expect(JSON.stringify(projectContext)).toBe(before);
		}
	},
);

it("keeps frozen source while projecting only project identity for a lightweight author", () => {
	const projectContext = {
		version: 3,
		projectId: "project-1",
		canvasId: "chapter-1",
		sourceNodeId: "source-1",
		selectedAssetIds: [],
		projectAssetIds: [],
		timeline: { clips: [{ nodeId: "unrelated-timeline-clip", assetId: null, durationSeconds: 8, startSeconds: 0 }] },
		selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
		permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
		assetSnapshot: [],
		capturedAt: "2026-09-23T00:00:00.000Z",
	} satisfies WorkflowProjectContext;
	const input = {
		...request,
		outputArtifactType: "tapcanvas.chapter-clip-segmentation/v1",
		inputs: { "delivery-contract": [{ canvasFacts: { authoritativeSources: [{ sourceId: "source-1", content: "冻结正文必须保留" }] } }] },
		projectContext,
	};
	const fullPrompt = workflowAgentPrompt(input);
	const compactPrompt = workflowAgentPrompt({ ...input, projectContextPromptMode: "identity_only" });
	expect(fullPrompt).toContain("unrelated-timeline-clip");
	expect(compactPrompt).not.toContain("unrelated-timeline-clip");
	expect(compactPrompt).toContain("冻结正文必须保留");
	expect(compactPrompt).toContain('"projectId":"project-1"');
	const minimalPrompt = workflowAgentPrompt({
		...input,
		promptMode: "compact_structured",
		outputEncoding: "json_object",
		jsonObjectContract: {
			allowedFields: ["protocolVersion", "clips"],
			jsonSchema: { type: "object", properties: { protocolVersion: { type: "string" }, clips: { type: "array" } } },
		},
	});
	expect(minimalPrompt).toContain("冻结正文必须保留");
	expect(minimalPrompt).not.toContain("unrelated-timeline-clip");
	expect(minimalPrompt).not.toContain("本次执行未发现已锁定的项目风格参考图");
	expect(minimalPrompt.length).toBeLessThan(compactPrompt.length);
});

it("places an accepted turn body once when it is also the authoritative source", () => {
	const acceptedText = "唯一受理原文：保留人物关系并继续完成视频";
	const prompt = workflowAgentPrompt({
		...request,
		inputs: { "delivery-contract": [{ canvasFacts: {
			authoritativeSources: [{ sourceId: "turn-1", sourceFingerprint: "sha256:turn-1", content: acceptedText }],
			userRequest: { kind: "public_chat_turn", requestId: "turn-1", requestFingerprint: "sha256:turn-1", content: acceptedText },
		} }] },
	});
	expect(prompt.split(acceptedText)).toHaveLength(2);
	expect(prompt).toContain('"contentSource":{"sourceId":"turn-1","sourceFingerprint":"sha256:turn-1","sourceIndex":0}');
	expect(prompt).toContain("当前 accepted public-chat turn 的逐字事实已在冻结输入");
});

it("does not merge source and request bodies that differ in whitespace", () => {
	const prompt = workflowAgentPrompt({
		...request,
		inputs: { "delivery-contract": [{ canvasFacts: {
			authoritativeSources: [{ sourceId: "turn-2", sourceFingerprint: "sha256:turn-2", content: " 原文" }],
			userRequest: { kind: "public_chat_turn", requestId: "turn-2", requestFingerprint: "sha256:turn-2", content: "原文" },
		} }] },
	});
	expect(prompt).toContain('"content":" 原文"');
	expect(prompt).toContain('"content":"原文"');
	expect(prompt).not.toContain('"contentSource"');
});

it("keeps a selected actionable delivery available to the author beside the short accepted turn", () => {
	const screenplay = "\n《下次》\n何秀云把退卡单压在收银台下。\n";
	const prompt = workflowAgentPrompt({
		...request,
		inputs: { "delivery-contract": [{ canvasFacts: {
			authoritativeSources: [{
				sourceId: "actionable-delivery:delivery_ref_next_001",
				sourceFingerprint: createHash("sha256").update(screenplay).digest("hex"),
				sourceType: "actionable_delivery",
				content: screenplay,
			}],
			userRequest: {
				kind: "public_chat_turn",
				requestId: "public-turn-one-click",
				requestFingerprint: "accepted-turn-fingerprint",
				content: "一键成片",
			},
		} }] },
	});
	expect(prompt).toContain(JSON.stringify(screenplay).slice(1, -1));
	expect(prompt).toContain('"sourceType":"actionable_delivery"');
	expect(prompt).toContain("一键成片");
	expect(prompt).not.toContain('"sourceId":"public-turn-one-click"');
});

it("keeps historical image analyses out of the initial Agent context", () => {
	const source = "原".repeat(3_061);
	const projectContext = {
		version: 3,
		projectId: "project-1",
		canvasId: "chapter-16",
		sourceNodeId: "source-16",
		selectedAssetIds: [],
		projectAssetIds: [],
		timeline: { clips: [] },
		selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
		permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
		assetSnapshot: [],
		mediaUnderstanding: Array.from({ length: 14 }, (_, index) => ({
			referenceId: `historical-asset-${index}`,
			text: `HISTORICAL_IMAGE_ANALYSIS_${index}:${"图".repeat(1_000)}`,
			question: "历史图片分析问题",
			provenance: { version: 1 as const, mediaType: "image" as const,
				source: "persisted_task_result" as const, taskId: `vision-${index}`,
				modelKey: "vision", referenceId: `historical-asset-${index}`,
				promptHash: "prompt", analysisHash: "analysis", analyzedAt: "2026-09-22T00:00:00.000Z" },
		})),
		capturedAt: "2026-09-23T00:00:00.000Z",
	} satisfies WorkflowProjectContext;
	const prompt = workflowAgentPrompt({ ...request, projectContext, inputs: { source: [source] } });
	expect(prompt).toContain(source);
	expect(prompt.split(source)).toHaveLength(2);
	expect(prompt).not.toContain("HISTORICAL_IMAGE_ANALYSIS_");
	expect(prompt.length).toBeLessThan(8_000);
});

describe("workflow Agent runner durable interruption contract", () => {
	it("applies an explicitly authorized node preference without changing its frozen source or model", async () => {
		const receipt = { version: 1 as const, executionId: request.executionId, nodeId: request.nodeId,
			authorizedBy: request.ownerId, requestedAt: "2026-10-02T00:00:00.000Z", idempotencyKey: "explicit-none",
			preferences: { reasoningEffort: "none" as const } };
		readWorkflowAgentPreferences.mockResolvedValueOnce(receipt);
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [],
			raw: { text: "artifact", meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
		const frozen = { ...request, reasoningEffort: "low" as const };
		const before = JSON.stringify(frozen);
		await runWorkflowAgentNode({} as WorkerEnv, frozen);
		expect(readWorkflowAgentPreferences).toHaveBeenCalledWith(undefined, {
			executionId: request.executionId, nodeId: request.nodeId, ownerId: request.ownerId,
		});
		expect(buildTaskRequest.mock.calls.at(-1)?.[0]).toMatchObject({ modelKey: request.modelKey });
		expect(runPersistedAgentsChatTask.mock.calls.at(-1)?.[0].taskRequest.extras).toMatchObject({ reasoningEffort: "none" });
		expect(JSON.stringify(frozen)).toBe(before);
	});

	it("supplies an immutable delivered artifact as revision evidence while retaining the complete author contract", async () => {
		const deliveryArtifact = '{"title":"original delivery"}';
		const authorRepair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceExecutionId: "source-execution", sourceNodeRunId: "source-run",
			targetNodeId: request.nodeId, deliveryHash: authorDeliveryHash(deliveryArtifact), deliveryArtifact,
			diagnostic: "Observer requests a clearer causal transition; the successful receipt remains valid." };
		const typed = { ...request, outputEncoding: "json_object" as const, failurePolicy: "repair_with_correction" as const,
			reasoningEffort: "high" as const, authorRepair,
			jsonObjectContract: { allowedFields: ["title"], requiredStringFields: ["title"],
				jsonSchema: { type: "object", properties: { title: { type: "string", const: "revised title" } }, required: ["title"] } },
			inputs: { input: [{ frozenFact: "current snapshot" }] }, userIntentContract: { request: "original intent" } };
		const frozenBefore = JSON.stringify(typed);
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [], raw: {
			text: '{"title":"revised title"}', meta: { requestTerminal: { status: "succeeded" } },
		} }, response: {} });
		const result = await runWorkflowAgentNode({} as WorkerEnv, typed);
		const dispatched = runPersistedAgentsChatTask.mock.calls[0]![0].taskRequest;
		expect(dispatched.extras.runtimeAuthorRevisionEvidence).toEqual(authorRepair);
		expect(dispatched.extras.continuationExecutionContract.runtimeAuthorRevisionEvidence).toEqual(authorRepair);
		expect(dispatched.extras.structuredOutputRepair).toBeUndefined();
		expect(dispatched.extras.continuationExecutionContract.structuredOutputRepair).toBeUndefined();
		expect(dispatched.extras.structuredOutputSourceContext).toBe(JSON.stringify({
			inputs: typed.inputs, userIntentContract: typed.userIntentContract, projectContext: null }));
		expect(dispatched.prompt).not.toContain(authorRepair.diagnostic);
		expect(dispatched.prompt).not.toContain(deliveryArtifact);
		expect(dispatched.extras).toMatchObject({ modelKey: request.modelKey, reasoningEffort: "high",
			outputContract: { jsonSchema: typed.jsonObjectContract.jsonSchema } });
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
		expect(result.requestTerminal).toMatchObject({ status: "succeeded" });
		expect(JSON.stringify(typed)).toBe(frozenBefore);
	});

	it.each([
		{ label: "json_artifact body", outputEncoding: "json_artifact" as const, outputArtifactType: "tapcanvas.text/v1",
			deliveryArtifact: "delivered body", rawSubmission: '{"artifactType":"tapcanvas.text/v1","text":"delivered body"}', jsonObjectContract: null },
		{ label: "json_array delivery", outputEncoding: "json_array" as const, outputArtifactType: "tapcanvas.items/v1",
			deliveryArtifact: '[{"title":"delivered"}]', rawSubmission: '{"minItems":1,"items":[{"title":"delivered"}]}', jsonObjectContract: null },
		{ label: "compiled BeatSheet", outputEncoding: "json_object" as const, outputArtifactType: "tapcanvas.beat-sheet/v2",
			deliveryArtifact: '{"beats":[{"objectId":"host-bound-object"}]}',
			rawSubmission: '{"objectRegistry":[{"objectId":"authored-object"}],"beats":[]}',
			jsonObjectContract: { allowedFields: ["objectRegistry", "beats"], requiredArrayFields: ["objectRegistry", "beats"], jsonSchema: {
				type: "object", properties: { objectRegistry: { type: "array" }, beats: { type: "array" } }, required: ["objectRegistry", "beats"] } } },
	])("keeps $label separate from the original raw submission and complete schema", async (example) => {
		const authorRepair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceExecutionId: "source-execution",
			sourceNodeRunId: "source-run", targetNodeId: request.nodeId, deliveryHash: authorDeliveryHash(example.deliveryArtifact),
			deliveryArtifact: example.deliveryArtifact, diagnostic: "observer asks author to revise this delivered content" };
		const typed = { ...request, authorRepair, outputEncoding: example.outputEncoding, outputArtifactType: example.outputArtifactType,
			jsonObjectContract: example.jsonObjectContract, failurePolicy: "repair_with_correction" as const };
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "new-author-attempt", assets: [], raw: {
			text: example.rawSubmission, meta: { requestTerminal: { status: "succeeded" } },
		} }, response: {} });
		await runWorkflowAgentNode({} as WorkerEnv, typed);
		const dispatched = runPersistedAgentsChatTask.mock.calls[0]![0].taskRequest;
		expect(example.rawSubmission).not.toBe(example.deliveryArtifact);
		expect(dispatched.extras.runtimeAuthorRevisionEvidence).toEqual(authorRepair);
		expect(dispatched.extras.structuredOutputRepair).toBeUndefined();
		expect(dispatched.extras.outputContract).toEqual(workflowAgentStructuredOutput(typed)!.outputContract);
		expect(dispatched.extras.structuredOutputSourceContext).toBe(JSON.stringify({ inputs: request.inputs, userIntentContract: null, projectContext: null }));
		expect(dispatched.prompt).not.toContain(authorRepair.diagnostic);
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it.each(["hash", "target", "plain-text"] as const)("rejects a structurally invalid author repair %s before dispatch", async (violation) => {
		const deliveryArtifact = '{"title":"original"}';
		const authorRepair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceExecutionId: "source-execution", sourceNodeRunId: "source-run",
			targetNodeId: violation === "target" ? "other-node" : request.nodeId,
			deliveryHash: authorDeliveryHash(violation === "hash" ? "different artifact" : deliveryArtifact), deliveryArtifact, diagnostic: "observer feedback" };
		await expect(runWorkflowAgentNode({} as WorkerEnv, { ...request, authorRepair,
			outputEncoding: violation === "plain-text" ? "plain_text" : "json_artifact" }))
			.rejects.toThrow(violation === "hash" ? "runtime_author_revision_evidence_invalid" : "target_contract_invalid");
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it.each(["agent-1", "other-node"])("passes only the snapshot repair for target %s to its author", async (targetNodeId) => {
		const deliveryArtifact = '{"title":"original"}';
		const authorRepair = { version: 1 as const, sourceKind: "delivery_artifact" as const, sourceExecutionId: "source-execution", sourceNodeRunId: "source-run",
			targetNodeId, deliveryHash: authorDeliveryHash(deliveryArtifact), deliveryArtifact, diagnostic: "observer feedback" };
		const runAgent = vi.fn(async () => ({ taskId: "child", text: '{"title":"done"}', assets: [],
			expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: null, requestTerminal: { status: "succeeded" } }));
		const runVideo = vi.fn(async () => { throw new Error("Unexpected media generation"); });
		const result = await executeRegisteredWorkflowNode({ executionId: "new-execution", executionFamilyId: "family-1", ownerId: "user-1", flowId: "flow-1",
			flowVersionId: "version-1", projectId: "project-1", workflowKey: "test/v1", inputProvenance: [],
			flowVersionData: { workflowResolvedAuthorRepair: authorRepair },
			inputs: { trigger: [{ workflowResolvedAuthorRepair: { ...authorRepair, deliveryArtifact: "untrusted body" }, modelKey: "untrusted-model" }] },
			node: { id: "agent-1", type: "taskNode", kind: "workflowStage", data: { workflowInstruction: "Deliver title",
				workflowAgentOutputArtifactType: "tapcanvas.test-json/v1", workflowAgentOutputEncoding: "json_object", workflowAgentMaxOutputTokens: 4096,
				workflowAgentJsonObjectContract: { allowedFields: ["title"], requiredStringFields: ["title"] },
				workflowAgentDeliveryRequirement: "Deliver title", workflowAgentDefinitionId: "writer", workflowAgentModelKey: "author-model",
				workflowAgentReasoningEffort: "high", workflowAgentFailurePolicy: "repair_with_correction", workflowAgentToolPolicy: "none",
				workflowAtomicSpec: { version: 1, category: "agent", operation: "test", executorRef: "agents.logical-task/v2", executionMode: "once", inputPorts: [], outputPorts: ["result"] },
			} } }, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ modelKey: "author-model", reasoningEffort: "high" }));
		const dispatched = runAgent.mock.calls[0] as unknown as readonly [Readonly<{ authorRepair?: unknown }>];
		expect(dispatched[0].authorRepair).toEqual(targetNodeId === "agent-1" ? authorRepair : undefined);
		expect(runVideo).not.toHaveBeenCalled();
	});

	it("reports the bridge rejection when a single submission never reached a durable turn", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: null });
		getExecutionTraceLifecycleSnapshot.mockResolvedValueOnce({
			logicalTaskId: "workflow:execution-1:agent-1",
			rootTraceId: "workflow:execution-1:agent-1",
			status: "failed",
			startedAt: recentIso(),
			updatedAt: recentIso(),
		});
		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			failurePolicy: "single_submission",
			resumeOnly: true,
			previousEvidence: { deliveryEvidence: { transportInterrupted: true, errorCode: "agents_bridge_failed" } },
		});
		expect(result.requestTerminal).toMatchObject({ status: "failed", reason: "agents_bridge_failed" });
		expect(result.deliveryEvidence).toMatchObject({ traceStatus: "failed", errorCode: "agents_bridge_failed" });
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("passes the role Skill preload capability through the trusted Workflow task request", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: { id: "child", assets: [], raw: { text: "authored", meta: {
				expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" }, requestTerminal: { status: "succeeded" },
			} } }, response: {},
		});
		await runWorkflowAgentNode({} as WorkerEnv, { ...request, disableRoleSkillBundle: true });
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { extras: Record<string, unknown> };
		};
		expect(dispatched.taskRequest.extras).toMatchObject({
			forcedAgentRole: "writer",
			disableRoleSkillBundle: true,
		});
	});

	it("projects real bridge events through the Agent runner without retaining streamed text", async () => {
		const observed: WorkflowAgentActivitySnapshot[] = [];
		const runtimeNodeId = `runtime-${"r".repeat(300)}`;
		const itemId = `item-${"i".repeat(300)}`;
		runPersistedAgentsChatTask.mockImplementationOnce(async (input: unknown) => {
			const observerInput = input as Readonly<{ onStreamEvent?: AgentsBridgeStreamObserver }>;
			await observerInput.onStreamEvent?.({ event: "status-update", data: { phase: "agent_reasoning" } });
			await observerInput.onStreamEvent?.({ event: "content", data: { delta: "secret narrative" } });
			return {
				result: { id: "child", assets: [], raw: { text: "authored", meta: {
					expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" },
					requestTerminal: { status: "succeeded" },
				} } },
				response: {},
			};
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			onAgentActivity: (activity) => { observed.push(activity); },
			agentActivityContext: {
				displayName: "章节编排",
				runtimeNodeId,
				itemId,
				itemIndex: 4,
			},
		});

		expect(observed).toHaveLength(1);
		expect(observed[0]).toMatchObject({
			eventType: "content",
			displayName: "章节编排",
			runtimeNodeId,
			itemId,
			itemIndex: 4,
			streamedOutputChars: "secret narrative".length,
			observedEventCount: 2,
		});
		expect(JSON.stringify(observed)).not.toContain("secret narrative");
	});

	it("keeps the reviewed text envelope intact for the executor output contract", async () => {
		const text = "  完整正文\n保留末尾空白  ";
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: { id: "child", assets: [], raw: { text: JSON.stringify({ artifactType: "tapcanvas.text/v1", text }), meta: {
				expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" }, requestTerminal: { status: "succeeded" },
			} } }, response: {},
		});
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, outputEncoding: "json_artifact" });
		expect(result.text).toBe(JSON.stringify({ artifactType: "tapcanvas.text/v1", text }));
		expect(validateWorkflowAgentOutput({ encoding: "json_artifact", artifactType: "tapcanvas.text/v1", rawText: result.text, jsonArrayContract: null, jsonObjectContract: null })).toEqual({ ok: true, text: text.trim() });
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { extras: { outputContract: unknown; structuredOutputSourceContext: string } };
		};
		expect(dispatched.taskRequest.extras.outputContract).toMatchObject({
			kind: "json", submissionPolicy: "repair_with_correction", requiredStringFields: ["artifactType", "text"],
		});
		expect(dispatched.taskRequest.extras.structuredOutputSourceContext).toContain("source");
	});
	it.each([undefined, "none"] as const)("transfers the exact inactive predecessor draft with explicit preference %s", async (effort) => {
		if (effort) readWorkflowAgentPreferences.mockResolvedValueOnce({
			version: 1, executionId: request.executionId, nodeId: request.nodeId, authorizedBy: request.ownerId,
			requestedAt: "2026-10-02T00:00:00.000Z", idempotencyKey: "retain-draft-none", preferences: { reasoningEffort: effort },
		});
		const sourceContext = JSON.stringify({ inputs: request.inputs, userIntentContract: null, projectContext: null });
		const typedRequest = { ...request, outputEncoding: "json_artifact" as const };
		const contract = workflowAgentStructuredOutput(typedRequest)!.outputContract;
		const contractHash = `sha256:${createHash("sha256").update(JSON.stringify(contract, (_key, value: unknown) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) return value;
			const object = value as Record<string, unknown>;
			return Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
		})).digest("hex")}`;
		const repair = { version: 1, contractHash, candidate: '{"artifactType":', correction: "truncated",
			sourceContext, continuation: true };
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: { turnId: "old-turn:physical-retry:1" }, structuredOutputRepair: repair });
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [], raw: {
			text: '{"artifactType":"tapcanvas.text/v1","text":"done"}', meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
		await runWorkflowAgentNode({} as WorkerEnv, { ...typedRequest, previousEvidence: {
			agentRepairSource: { sessionKey: "old-session", turnId: "old-turn" } } });
		expect(getAgentsChatTurnStatus).toHaveBeenCalledWith(expect.anything(), request.ownerId, "old-session",
			expect.objectContaining({ includeStructuredOutputRepair: true }));
		const call = runPersistedAgentsChatTask.mock.calls.at(-1)![0];
		if (effort) expect(call.taskRequest.extras).toMatchObject({ reasoningEffort: effort,
			continuationExecutionContract: { reasoningEffort: effort } });
		expect(call.taskRequest.extras.sessionKey).not.toBe("old-session");
		expect(call.taskRequest.extras.structuredOutputRepair).toEqual(repair);
		expect(call.taskRequest.extras.continuationExecutionContract.structuredOutputRepair).toEqual(repair);
	});

	it("continues authorized authoring when an inactive execution checkpoint has no draft", async () => {
		const predecessor = { executionId: "predecessor-execution", nodeId: request.nodeId };
		const sessionKey = `workflow:${predecessor.executionId}:${predecessor.nodeId}`;
		const receiptTurnId = workflowAgentPublicTurnId({ ...predecessor, physicalRetryOrdinal: null });
		const latestTurnId = workflowAgentPublicTurnId({ ...predecessor, physicalRetryOrdinal: 1 });
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: { turnId: latestTurnId } });
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [], raw: {
			text: '{"artifactType":"tapcanvas.text/v1","text":"done"}', meta: { requestTerminal: { status: "succeeded" } },
		} }, response: {} });
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		try {
			await runWorkflowAgentNode({} as WorkerEnv, { ...request, outputEncoding: "json_artifact", previousEvidence: {
				agentRepairSource: { sessionKey, turnId: receiptTurnId },
			} });
			expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
			expect(runPersistedAgentsChatTask.mock.calls[0]![0].taskRequest.extras.structuredOutputRepair).toBeUndefined();
			expect(info.mock.calls.some(([value]) => String(value).includes("workflow_agent_repair_handoff_no_draft"))).toBe(true);
		} finally { info.mockRestore(); }
	});
	it("measures repair context without logging source text or changing frozen identity", async () => {
		const source = "private-chapter-body-".repeat(100);
		const inputs = { input: [{ source, knowledgeCandidateSearch: { entries: [{ body: "audit-only-".repeat(200) }] } }] };
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		try {
			runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [],
				raw: { text: JSON.stringify({ artifactType: "tapcanvas.text/v1", text: "artifact" }),
					meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
			await runWorkflowAgentNode({} as WorkerEnv, { ...request, inputs, outputEncoding: "json_artifact" });
			const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
				taskRequest: { prompt: string; extras: { structuredOutputSourceContext: string } };
			};
			const frozen = dispatched.taskRequest.extras.structuredOutputSourceContext;
			expect(frozen).toBe(JSON.stringify({ inputs, userIntentContract: null, projectContext: null }));
			const diagnosticText = info.mock.calls.map(([value]) => String(value))
				.find((value) => value.includes('"message":"workflow_agent_context_volume"'));
			expect(diagnosticText).toBeDefined();
			const diagnostic = JSON.parse(diagnosticText!) as Record<string, unknown>;
			expect(diagnostic).toMatchObject({ promptCharacters: dispatched.taskRequest.prompt.length,
				frozenSourceCharacters: frozen.length, candidateReferenceCount: 0, projectionOwner: "final_model_tool_surface", retainedCandidateCharacters: 0 });
			expect(diagnosticText).not.toContain(source);
			expect(diagnosticText).not.toContain("audit-only");
		} finally { info.mockRestore(); }
	});
	it("passes uniquely persisted input references without replacing the frozen repair source", async () => {
		const inputs = { source: [{ document: "完整来源与事实。".repeat(800) }] };
		const before = JSON.stringify(inputs);
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "child", assets: [], raw: {
			text: '{"artifactType":"tapcanvas.text/v1","text":"done"}', meta: { requestTerminal: { status: "succeeded" } },
		} }, response: {} });
		await runWorkflowAgentNode({} as WorkerEnv, {
			...request, inputs, outputEncoding: "json_artifact",
			allowedTools: ["tapcanvas_execution_node_runs_get"],
			persistedInputSource: { nodeId: "persisted-parent", revision: "frozen-revision", inputs },
		});
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)![0];
		const extras = dispatched.taskRequest.extras as {
			structuredOutputSourceContext: string;
			contextReadProjections: Array<{ source: string; reference: string; requiredTool: string }>;
		};
		expect(extras.structuredOutputSourceContext).toBe(JSON.stringify({ inputs, userIntentContract: null, projectContext: null }));
		expect(extras.contextReadProjections).toHaveLength(1);
		const projection = extras.contextReadProjections[0]!;
		expect(projection.requiredTool).toBe("tapcanvas_execution_node_runs_get");
		expect(JSON.parse(projection.reference).contentRead.args).toMatchObject({
			nodeId: "persisted-parent", revision: "frozen-revision", view: "content", field: "input", format: "json",
		});
		expect(dispatched.taskRequest.prompt).toContain(projection.source);
		expect(JSON.stringify(inputs)).toBe(before);
	});
	it("retains the logical turn when an existing-turn recovery read is temporarily unavailable", async () => {
		runPersistedAgentsChatTask.mockRejectedValueOnce(new AppError("already exists", { status: 409, code: "agents_chat_turn_already_exists" }));
		getAgentsChatTurnStatus.mockRejectedValueOnce(new AppError("runtime unavailable", { status: 503, code: "agents_chat_runtime_request_failed" }));
		const result = await runWorkflowAgentNode({} as WorkerEnv, request);
		expect(result.requestTerminal).toMatchObject({ status: "suspended" });
		expect(result.taskId).toBe(workflowAgentPublicTurnId({ executionId: request.executionId, nodeId: request.nodeId, physicalRetryOrdinal: null }));
		expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
	});
	beforeEach(() => {
		vi.clearAllMocks();
		// Clear queued one-shot transport responses as well as call history.
		getAgentsChatTurnStatus.mockReset();
		runPersistedAgentsChatTask.mockReset();
		resumePersistedAgentsChatTurn.mockReset();
		getExecutionTraceLifecycleSnapshot.mockResolvedValue(null);
		cancelWorkflowAgentTurns.mockResolvedValue([{
			target: {
				sessionId: "workflow:execution-1:agent-1",
				turnId: "workflow:execution-1:agent-1",
				nodeId: "agent-1",
				runtimeNodeId: "agent-1",
			},
			status: "already_inactive",
			receipt: {
				localTransport: "not_running",
				runtime: "already_inactive",
				continuations: "none",
			},
			errorCode: null,
			errorMessage: null,
		}]);
	});


  const singleTypedRequest = {
    ...request, failurePolicy: "single_submission" as const, outputEncoding: "json_object" as const,
    jsonObjectContract: { requiredStringFields: ["title"], allowedFields: ["title"] },
  };
  const physicalSnapshot = (ordinal: number, reasonCode: string, progressRevision = 0, checkpoint = false) => {
    const turnId = workflowAgentPublicTurnId({ executionId: request.executionId, nodeId: request.nodeId,
      physicalRetryOrdinal: ordinal || null });
    return { sessionId: "workflow:execution-1:agent-1", durable: true, activeTurn: false,
      turn: { turnId, internalTurnId: `internal-${ordinal}`, state: "failed", phase: "failed",
        startedAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:02.000Z",
        lastConfirmedAt: "2026-08-12T00:00:02.000Z", requestText: "", reasonCode,
        suspension: checkpoint ? { physicalRunId: turnId, progressRevision } : null,
        recoveryCheckpoint: checkpoint ? { reasonCode, physicalRunId: turnId, progressRevision,
          durableTaskReferences: [] as Record<string, unknown>[], durableProgressClaims: [], userIntentContract: null } : null,
        lastConfirmedSummary: "Physical transport interrupted", finalResponse: null as string | null,
        pendingUserInput: null, pendingQueueCount: 0, recentEvents: [] } };
  };

  it.each(["single_inference", "multi_inference"] as const)(
    "single submission recovers multiple transport exits through durable backoff and succeeds (%s)", async executionPolicy => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-07T07:00:00.000Z"));
        const initial = { ...singleTypedRequest, executionPolicy, reasoningEffort: "high" as const };
        const frozen = JSON.stringify(initial);
        let previousEvidence: Record<string, unknown> | null = null;
        let deferred: Awaited<ReturnType<typeof runWorkflowAgentNode>> | undefined;
        for (let ordinal = 0; ordinal < 5; ordinal += 1) {
          const publicTurnId = workflowAgentPublicTurnId({ executionId: request.executionId, nodeId: request.nodeId,
            physicalRetryOrdinal: ordinal || null });
          runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: publicTurnId, assets: [], raw: { text: "", meta: {
            requestTerminal: { status: "suspended", reason: "provider_stream_interrupted" } } } } });
          getAgentsChatTurnStatus.mockResolvedValueOnce(physicalSnapshot(ordinal, "provider_stream_interrupted"));
          deferred = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: ordinal > 0, previousEvidence });
          expect(deferred.requestTerminal).toMatchObject({ status: "suspended" });
          previousEvidence = { deliveryEvidence: deferred.deliveryEvidence };
        }
        expect(deferred?.requestTerminal).toMatchObject({ reason: "workflow_agent_no_progress_recovery_deferred" });
        expect(deferred?.deliveryEvidence).toMatchObject({ physicalRetryOrdinal: 5, noProgressRecoveryEpoch: 1,
          retryAfterMs: 60_000, retryablePhysicalFailure: true, reasonCode: "provider_stream_interrupted" });
        expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(5);
        const callsBeforeQuietWindow = cancelWorkflowAgentTurns.mock.calls.length;
        const waiting = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: true, previousEvidence });
        expect(waiting.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_no_progress_recovery_deferred" });
        expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(5);
        expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(callsBeforeQuietWindow);
        vi.setSystemTime(new Date("2026-10-07T07:01:00.001Z"));
        runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1:physical-retry:5",
          assets: [], raw: { text: '{"title":"完整产物"}', meta: {
            requestTerminal: { status: "succeeded", reason: "structured_output_satisfied" } } } } });
        const completed = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: true, previousEvidence });
        expect(completed.requestTerminal).toMatchObject({ status: "succeeded" });
        expect(completed.text).toBe('{"title":"完整产物"}');
        expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(6);
        expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(callsBeforeQuietWindow + 1);
        const calls = runPersistedAgentsChatTask.mock.calls as unknown as Array<[{
          requestInput: { modelKey: string }; taskRequest: { extras: Record<string, unknown> }; rootRequestId: string;
        }]>;
        expect(new Set(calls.map(([call]) => call.rootRequestId)).size).toBe(6);
        expect(calls.every(([call]) => call.requestInput.modelKey === initial.modelKey)).toBe(true);
        expect(calls.every(([call]) => call.taskRequest.extras.reasoningEffort === "high")).toBe(true);
        expect(calls.every(([call]) => (call.taskRequest.extras.outputContract as Record<string, unknown>).submissionPolicy ===
          "single_submission_record_and_fail")).toBe(true);
        expect(calls.every(([call]) => !("providerRecoveryPolicy" in (call.taskRequest.extras.outputContract as Record<string, unknown>)))).toBe(true);
        expect(JSON.stringify(initial)).toBe(frozen);
      } finally { vi.useRealTimers(); }
    },
  );


  it("single-submission rate-limit backpressure waits until its deadline and then resumes unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-07T07:30:00.000Z"));
      const initial = { ...singleTypedRequest, executionPolicy: "single_inference" as const };
      const initialFrozen = JSON.stringify(initial);
      getAgentsChatTurnStatus.mockResolvedValueOnce(physicalSnapshot(0, "llm_http_429"));
      const deferred = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: true });
      expect(deferred.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_rate_limit_backpressure" });
      expect(deferred.deliveryEvidence).toMatchObject({ physicalRetryOrdinal: 1, physicalFailureReason: "llm_http_429",
        retryablePhysicalFailure: true, retryAfterMs: expect.any(Number), retryNotBeforeAt: expect.any(String) });
      const evidence = deferred.deliveryEvidence as Record<string, unknown>;
      const previousEvidence = { deliveryEvidence: evidence };
      const callsBefore = getAgentsChatTurnStatus.mock.calls.length;
      const waiting = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: true, previousEvidence });
      expect(waiting.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_rate_limit_backpressure" });
      expect(waiting.deliveryEvidence).toEqual(evidence);
      expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
      expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
      expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(callsBefore);
      vi.setSystemTime(new Date(String(evidence.retryNotBeforeAt)).getTime() + 1);
      runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1:physical-retry:1",
        assets: [], raw: { text: '{"title":"恢复后的产物"}', meta: {
          requestTerminal: { status: "succeeded", reason: "structured_output_satisfied" } } } } });
      const completed = await runWorkflowAgentNode({} as WorkerEnv, { ...initial, resumeOnly: true, previousEvidence });
      expect(completed.requestTerminal).toMatchObject({ status: "succeeded" });
      expect(completed.text).toBe('{"title":"恢复后的产物"}');
      expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(1);
      expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(initial)).toBe(initialFrozen);
      const [call] = runPersistedAgentsChatTask.mock.calls[0] as unknown as [{
        rootRequestId: string; requestInput: { modelKey: string }; taskRequest: { extras: Record<string, unknown> };
      }];
      expect(call.rootRequestId).toBe("workflow:execution-1:agent-1:physical-retry:1");
      expect(call.requestInput.modelKey).toBe(initial.modelKey);
      expect((call.taskRequest.extras.outputContract as Record<string, unknown>).submissionPolicy).toBe("single_submission_record_and_fail");
    } finally { vi.useRealTimers(); }
  });

  it("a legacy failed physical receipt preserves the exact failure while recovering the single submission", async () => {
    const reason = "structured_submission_provider_stream_interrupted";
    const structuredOutputFailure = { protocolVersion: "structured-output-execution-failure/v1", reasonCode: reason,
      providerStreamStall: { bytesRead: 503, chunksRead: 1, silentMs: 180_000 } };
    runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1", assets: [],
      raw: { text: "", meta: { requestTerminal: { status: "failed", reason }, structuredOutputExecutionFailure: structuredOutputFailure } } } });
    getAgentsChatTurnStatus.mockResolvedValueOnce(physicalSnapshot(0, reason));
    const recovered = await runWorkflowAgentNode({} as WorkerEnv, singleTypedRequest);
    expect(recovered.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_physical_retry_pending" });
    expect(recovered.deliveryEvidence).toMatchObject({ physicalRetryOrdinal: 1, physicalFailureReason: "provider_stream_interrupted",
      reasonCode: reason, physicalFailureObservation: { requestTerminal: { status: "failed", reason }, structuredOutputFailure } });
    expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
  });

  it("single-submission recovery uses the existing receipt and same-turn resume owner after the deadline", async () => {
    const snapshot = physicalSnapshot(0, "provider_stream_interrupted", 4, true);
    const acceptedReference = { version: 1, toolName: "paid_task", mode: "result", runId: "accepted-run", taskId: "accepted-task",
      draftRevision: null, beatRevision: null, preflightRevision: null, preflightFingerprint: null, clipIndex: null, acceptedAsync: true };
    expect(snapshot.turn.recoveryCheckpoint).not.toBeNull();
    snapshot.turn.recoveryCheckpoint!.durableTaskReferences = [acceptedReference];
    getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot);
    resumePersistedAgentsChatTurn.mockResolvedValueOnce({ resumed: true });
    const recovered = await runWorkflowAgentNode({} as WorkerEnv, { ...singleTypedRequest, resumeOnly: true,
      previousEvidence: { deliveryEvidence: { retryNotBeforeAt: new Date(Date.now() - 1).toISOString(),
        recoveryWindow: { progressRevision: 3, physicalRunId: "old-physical", windowsWithoutProgress: 4, limit: 5 } } } });
    expect(recovered.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_same_task_continuation_scheduled" });
    expect(recovered.deliveryEvidence).toMatchObject({ recoveryWindow: { progressRevision: 4, windowsWithoutProgress: 1 },
      recoveryCheckpoint: { durableTaskReferenceCount: 1, physicalRunId: "workflow:execution-1:agent-1" } });
    expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
    expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId: "workflow:execution-1:agent-1" }));
    expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
    expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
    expect(snapshot.turn.recoveryCheckpoint?.durableTaskReferences).toEqual([acceptedReference]);
  });

  it("keeps a single-submission schema rejection on the same logical repair frontier", async () => {
    const candidate = '{"title":42}';
    const snapshot = physicalSnapshot(0, "structured_output_invalid");
    snapshot.turn.finalResponse = candidate;
    const outputRepair = { version: 1, sourceTurnId: "workflow:execution-1:agent-1",
      candidate, error: "title must be a string" };
    getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot);
    const result = await runWorkflowAgentNode({} as WorkerEnv, { ...singleTypedRequest, resumeOnly: true,
      previousEvidence: { outputRepair } });
    expect(result.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_physical_retry_pending" });
    expect(result.deliveryEvidence).toMatchObject({ retryablePhysicalFailure: true,
      physicalFailureReason: "structured_output_invalid", physicalRetryOrdinal: 1,
      sessionKey: "workflow:execution-1:agent-1" });
    expect(result.deliveryVerification).toBeNull();
    expect(outputRepair).toEqual({ version: 1, sourceTurnId: "workflow:execution-1:agent-1",
      candidate, error: "title must be a string" });
    expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
    expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
  });

  it.each(["permission_denied", "provider_balance_required"])(
    "single-submission recovery preserves deterministic failure and its recorded candidate: %s", async reason => {
      const snapshot = physicalSnapshot(0, reason);
      snapshot.turn.finalResponse = '{"recorded":"unchanged"}';
      getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot);
      const result = await runWorkflowAgentNode({} as WorkerEnv, { ...singleTypedRequest, resumeOnly: true });
      expect(result.requestTerminal).toMatchObject({ status: "failed", reason });
      expect(result.text).toBe('{"recorded":"unchanged"}');
      expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
      expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
      expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
    },
  );

  it("single-submission recovery reconciles an already settled candidate without resending it", async () => {
    const candidate = '{"title":"原始交付"}';
    readWorkflowAgentSettledResult.mockResolvedValueOnce({ traceId: "settled", publicTurnId: "workflow:execution-1:agent-1",
      text: candidate, meta: { requestTerminal: { status: "succeeded", reason: "structured_output_satisfied" } } });
    getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: null });
    const result = await runWorkflowAgentNode({} as WorkerEnv, { ...singleTypedRequest, resumeOnly: true,
      previousEvidence: { deliveryEvidence: { retryablePhysicalFailure: true, physicalFailureReason: "provider_stream_interrupted",
        physicalRetryOrdinal: 8 } } });
    expect(result.text).toBe(candidate);
    expect(result.requestTerminal).toMatchObject({ status: "succeeded" });
    expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
    expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
  });

	it.each([true, false])("reconciles an exact settled predecessor before a queued or running retry (%s)", async (retryPending) => {
		const previousPublicTurnId = "workflow:execution-1:agent-1";
		readWorkflowAgentSettledResult.mockResolvedValueOnce({ traceId: "continued-exact-turn",
			publicTurnId: previousPublicTurnId, text: "original settled artifact", meta: {
				requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
			} });
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: null });
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			previousEvidence: { deliveryEvidence: { physicalRetryOrdinal: 1,
				...(retryPending ? { retryablePhysicalFailure: true, physicalFailureReason: "provider_stream_interrupted" } : {}) } } });
		expect(result).toMatchObject({ taskId: previousPublicTurnId, text: "original settled artifact",
			requestTerminal: { status: "succeeded" }, deliveryEvidence: { settledTraceId: "continued-exact-turn" } });
		expect(readWorkflowAgentSettledResult).toHaveBeenCalledWith(undefined, {
			ownerId: "user-1", sessionKey: previousPublicTurnId, publicTurnIds: [previousPublicTurnId], outputContract: null,
		});
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(getAgentsChatTurnStatus).toHaveBeenCalledTimes(1);
	});

	it("keeps an active successor owned until it settles or is explicitly interrupted", async () => {
		readWorkflowAgentSettledResult.mockResolvedValueOnce({ traceId: "settled-predecessor",
			publicTurnId: "workflow:execution-1:agent-1", text: "original", meta: { requestTerminal: { status: "succeeded" } } });
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: true, turn: {
			turnId: "workflow:execution-1:agent-1:physical-retry:1", state: "running", phase: "agent_running",
			lastConfirmedAt: "2026-10-02T05:14:24Z", recoveryCheckpoint: null,
		} });
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			previousEvidence: { deliveryEvidence: { physicalRetryOrdinal: 1 } } });
		expect(result.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_successor_still_running" });
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it.each(["repair_with_correction", "single_submission"] as const)("keeps a %s typed repair authorized by the host instead of reusing the rejected predecessor", async (failurePolicy) => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: null });
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1:physical-retry:1",
			assets: [], raw: { text: "corrected artifact", meta: { requestTerminal: { status: "succeeded" } } } } });
		await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			failurePolicy, outputEncoding: "json_object", outputArtifactType: "tapcanvas.test/v1",
			jsonObjectContract: { requiredStringFields: ["title"], allowedFields: ["title"] },
			previousEvidence: { outputRepair: { version: 1, sourceTurnId: "workflow:execution-1:agent-1",
				candidate: "rejected artifact", error: "structural contract error" }, deliveryEvidence: {
				physicalRetryOrdinal: 1, retryablePhysicalFailure: true, physicalFailureReason: "structured_output_invalid" } } });
		expect(readWorkflowAgentSettledResult).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
		const dispatched = runPersistedAgentsChatTask.mock.calls[0]?.[0];
		expect(dispatched.requestInput.modelKey).toBe(request.modelKey);
		expect(dispatched.taskRequest.extras.structuredOutputRepair).toMatchObject({
			candidate: "rejected artifact", correction: "structural contract error",
			verifierCorrectionPending: true,
			sourceContext: expect.any(String),
		});
		expect(dispatched.taskRequest.extras.continuationExecutionContract.structuredOutputRepair)
			.toEqual(dispatched.taskRequest.extras.structuredOutputRepair);
		expect(dispatched.taskRequest.extras.outputContract.submissionPolicy).toBe(failurePolicy === "single_submission"
			? "single_submission_record_and_fail" : "repair_with_correction");
	});

	it.each(["delivery_checkpoint", "durable_source_checkpoint"] as const)(
		"explicit host rejection supersedes the %s while preserving unknown paid review state", async checkpointSource => {
			const typed = { ...request, outputEncoding: "json_object" as const, outputArtifactType: "tapcanvas.test/v1",
				jsonObjectContract: { requiredStringFields: ["title"], allowedFields: ["title"] } };
			const sourceContext = JSON.stringify({ inputs: request.inputs, userIntentContract: null, projectContext: null });
			const paidState = { revisions: [{ candidateHash: "exact-paid-original",
				attemptState: { status: "unknown" }, reviewCursor: { status: "inference_attempted", pendingRequest: "original accepted request" } }] };
			const previousCheckpoint = { version: 1, candidate: '{"title":"older runtime cache"}', correction: "Submit the complete cache",
				contractHash: authorSourceJsonHash(workflowAgentStructuredOutput(typed)!.outputContract), sourceContext,
				draft: true, authorSelfCheck: paidState };
			const outputRepair = { version: 1, sourceTurnId: "exact-host-rejected-turn", candidate: '{"title":"current host-rejected candidate"}',
				error: "Frozen receipt reference does not match current candidate" };
			if (checkpointSource === "durable_source_checkpoint") {
				getAgentsChatTurnStatus.mockResolvedValueOnce({ activeTurn: false, turn: null, structuredOutputRepair: previousCheckpoint });
			}
			runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "real-repaired-turn", assets: [],
				raw: { text: '{"title":"author corrected reference"}', meta: { requestTerminal: { status: "succeeded" } } } } });
			const before = JSON.stringify(previousCheckpoint);
			await runWorkflowAgentNode({} as WorkerEnv, { ...typed, previousEvidence: { outputRepair,
				...(checkpointSource === "delivery_checkpoint" ? { deliveryEvidence: { structuredOutputRepair: previousCheckpoint } }
					: { agentRepairSource: { sessionKey: "exact-source-session", turnId: "exact-source-turn" } }) } });
			const actual = runPersistedAgentsChatTask.mock.calls[0]![0].taskRequest.extras.structuredOutputRepair;
			expect(actual).toEqual({ version: 1, candidate: outputRepair.candidate, correction: outputRepair.error,
				sourceContext, verifierCorrectionPending: true, authorSelfCheck: paidState });
			expect(JSON.stringify(previousCheckpoint)).toBe(before);
			expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
			expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		});

	it("fences the predecessor in the stable session before admitting a physical retry", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", activeTurn: false,
			turn: { turnId: "workflow:execution-1:agent-1", state: "failed" } });
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1:physical-retry:1", assets: [],
			raw: { text: "artifact", meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			previousEvidence: { deliveryEvidence: { retryablePhysicalFailure: true, physicalRetryOrdinal: 1, physicalFailureReason: "provider_stream_interrupted",
				noProgressRecoveryEpoch: 7, recoveryCheckpoint: { progressRevision: 3, physicalRunId: "closed-physical-run" } } } });
		expect(result).toMatchObject({ taskId: "workflow:execution-1:agent-1:physical-retry:1",
			deliveryEvidence: { sessionKey: "workflow:execution-1:agent-1", physicalRetryOrdinal: 1 } });
		expect(cancelWorkflowAgentTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [expect.objectContaining({
			sessionId: "workflow:execution-1:agent-1", turnId: "workflow:execution-1:agent-1",
		})] }));
		expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
		const dispatched = runPersistedAgentsChatTask.mock.calls[0]?.[0];
		expect(dispatched.taskRequest.extras.taskRepairEvidence).toMatchObject({
			version: 1, disposition: "replan_required", reasonCode: "provider_stream_interrupted",
			terminalBoundary: null, safePathsExhausted: false,
		});
		expect(JSON.parse(dispatched.taskRequest.extras.taskRepairEvidence.rationale)).toMatchObject({
			noProgressRecoveryEpoch: 7, recoveryCheckpoint: { progressRevision: 3, physicalRunId: "closed-physical-run" },
		});
		expect(dispatched.taskRequest.extras.continuationExecutionContract.taskRepairEvidence)
			.toEqual(dispatched.taskRequest.extras.taskRepairEvidence);
		expect(buildTaskRequest).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "workflow:execution-1:agent-1" }));
	});

	it.each([1, 2, 3])("fences an observed older generation when intervening generations never admitted (retry %i)", async (ordinal) => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", activeTurn: false,
			turn: { turnId: "workflow:execution-1:agent-1", state: "failed" } });
		runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: `workflow:execution-1:agent-1:physical-retry:${ordinal}`, assets: [],
			raw: { text: "artifact", meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			previousEvidence: { deliveryEvidence: { physicalRetryOrdinal: ordinal } } });
		expect(result).toMatchObject({ taskId: `workflow:execution-1:agent-1:physical-retry:${ordinal}`,
			deliveryEvidence: { sessionKey: "workflow:execution-1:agent-1", physicalRetryOrdinal: ordinal } });
		expect(cancelWorkflowAgentTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [expect.objectContaining({
			sessionId: "workflow:execution-1:agent-1", turnId: "workflow:execution-1:agent-1",
		})] }));
		expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
		expect(buildTaskRequest).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "workflow:execution-1:agent-1" }));
	});

	it.each(["running", "failed"])("does not re-admit an accepted identity hidden by an older projection (%s)", async (status) => {
		const publicTurnId = "workflow:execution-1:agent-1:physical-retry:2";
		getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", activeTurn: false,
			turn: { turnId: "workflow:execution-1:agent-1", state: "failed" } });
		getExecutionTraceLifecycleSnapshot.mockResolvedValueOnce({
			logicalTaskId: publicTurnId, rootTraceId: publicTurnId, status,
			startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
		});
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true,
			previousEvidence: { deliveryEvidence: { physicalRetryOrdinal: 2 } } });
		expect(result.requestTerminal).toMatchObject({ status: "suspended" });
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(1);
		if (status === "failed") expect(result.deliveryEvidence).toMatchObject({ physicalRetryOrdinal: 3 });
	});

	it.each(["chat_resume_turn_mismatch", "chat_resume_claim_superseded"])("reconciles a lost resume race without failing the logical task: %s", async (code) => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", activeTurn: false,
			turn: { turnId: "workflow:execution-1:agent-1", state: "suspended", phase: "suspended",
				reasonCode: "structured_output_repair_exhausted", finalResponse: null,
				recoveryCheckpoint: { progressRevision: 1, physicalRunId: "physical-1", reasonCode: "structured_output_repair_exhausted", durableTaskReferences: [], durableProgressClaims: [] } } });
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError("ownership changed", { status: 409, code }));
		const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, resumeOnly: true });
		expect(result.requestTerminal).toMatchObject({ status: "suspended", reason: "workflow_agent_resume_ownership_changed" });
		expect(result.deliveryEvidence).toMatchObject({ reconciliationFailure: { action: "resume", code } });
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
	});

	it("publishes the one-submission policy as a first-class runtime contract", async () => {
		const expectedTurnId = workflowAgentPublicTurnId({
			executionId: request.executionId,
			nodeId: request.nodeId,
			physicalRetryOrdinal: null,
		});
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: expectedTurnId,
				assets: [],
				raw: {
					text: "一次完整产物",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-first-submission" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
						runtime: {
							structuredOutputReview: {
								version: 1,
								blocking: false,
								contractHash: `sha256:${"a".repeat(64)}`,
								candidateHash: `sha256:${"b".repeat(64)}`,
								feedbackDelivered: true,
								status: "observations_remaining",
								observations: [{ code: "model_authored_consistency", message: "对白窗口为 3 秒。" }],
								candidate: "不应透传候选正文",
								correction: "不应透传修订指令",
								reasoning: "不应透传推理正文",
							},
							structuredOutputReviewProjectionIssue: {
								reason: "invalid_observation_rows",
								droppedObservationCount: 1,
							},
							knowledgeCandidateSearch: {
								version: 1,
								status: "candidate_found",
								attempted: true,
								candidateCount: 2,
								blocking: false,
								rationale: "已返回知识卡候选元数据。",
								domains: ["视听语言演出"],
								toolCallId: "knowledge-search-1",
							},
							promptExampleCandidateSearch: {
								version: 1,
								status: "no_match",
								mediaType: "video",
								attempted: true,
								remoteAttempted: true,
								candidateCount: 0,
								blocking: false,
								rationale: "同媒体案例检索零命中。",
								toolCallId: "prompt-search-1",
							},
						},
					},
				},
			},
			response: {},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, request);
		expect(result.promptExampleCandidateSearch).toMatchObject({
			status: "no_match",
			attempted: true,
			candidateCount: 0,
			toolCallId: "prompt-search-1",
		});
		expect(result.structuredOutputReview).toEqual({
			version: 1,
			blocking: false,
			contractHash: `sha256:${"a".repeat(64)}`,
			candidateHash: `sha256:${"b".repeat(64)}`,
			feedbackDelivered: true,
			status: "observations_remaining",
			observations: [{ code: "model_authored_consistency", message: "对白窗口为 3 秒。" }],
		});
		expect(result.structuredOutputReviewProjectionIssue).toEqual({
			reason: "invalid_observation_rows",
			droppedObservationCount: 1,
		});
		expect(result.requestTerminal).toMatchObject({ status: "succeeded" });
		expect(result.knowledgeCandidateSearch).toMatchObject({
			status: "candidate_found",
			attempted: true,
			candidateCount: 2,
			domains: ["视听语言演出"],
			toolCallId: "knowledge-search-1",
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			rootRequestId: string;
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(call.rootRequestId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.publicTurnId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.logicalTaskId).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.sessionKey).toBe(expectedTurnId);
		expect(call.taskRequest.extras?.structuredOutputSubmissionPolicy)
			.toBe("repair_with_correction");
		expect(call.taskRequest.extras?.requestedMaxOutputTokens).toBe(4096);
		expect(call.taskRequest.extras?.maxOutputTokens).toBe(4096);
		expect(call.taskRequest.extras?.continuationExecutionContract).toMatchObject({
			structuredOutputSubmissionPolicy: "repair_with_correction",
			requestedMaxOutputTokens: 4096,
			maxOutputTokens: 4096,
		});
		expect((runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string };
		}).taskRequest.prompt).toContain("每个物理响应按本次冻结的执行与提交策略处理");
	});

	it.each(["performed", "not_performed"] as const)("diagnoses %s envelope observation after actual json_array unwrap through node evidence", async (status) => {
    const items = [{ value: "artifact" }];
    const rawText = JSON.stringify({ minItems: 1, items });
    const normalizedText = JSON.stringify(items);
    const candidateHash = `sha256:${createHash("sha256").update(rawText, "utf8").digest("hex")}`;
    const expectedCandidateHash = `sha256:${createHash("sha256").update(normalizedText, "utf8").digest("hex")}`;
    const receipt = { version: 1, status, scopeHash: `sha256:${"a".repeat(64)}`, candidateHash, evidenceFingerprint: "c".repeat(64),
      criteria: status === "performed" ? [{ requirement: "Node output", evidenceIds: ["scope"], assessment: "met", rationale: "Original envelope matches request", revisionAction: null }] : [],
      ...(status === "not_performed" ? { reason: "single_inference_contract" } : {}),
      execution: { model: "author-model", reasoningEffort: "high" },
      inferenceCalls: status === "performed" ? [{ model: "author-model", reasoningEffort: "high", startedAt: "2026-09-30T00:00:00Z", finishedAt: "2026-09-30T00:00:01Z", status: "completed" }] : [] };
    runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "workflow:execution-1:agent-1", assets: [], raw: {
      text: rawText, meta: { expectedDelivery: { active: true }, deliveryEvidence: { logicalTaskId: "workflow:execution-1:agent-1" },
        deliveryVerification: null, requestTerminal: { status: "succeeded", reason: "agent_turn_succeeded" }, runtime: { atomicAuthorSelfCheck: receipt } },
    } }, response: {} });
    const outcome = await runWorkflowAgentNode({} as WorkerEnv, { ...request, outputEncoding: "json_array", outputArtifactType: "tapcanvas.test-json/v1",
      jsonArrayContract: { itemRequiredStringFields: ["value"], itemAllowedFields: ["value"] } });
    expect(outcome.text).toBe(normalizedText);
    expect(outcome.atomicAuthorSelfCheck).toBeUndefined();
    const projectionIssue = { reason: "candidate_identity_mismatch", observedCandidateHash: candidateHash, expectedCandidateHash };
    expect(outcome.atomicAuthorSelfCheckProjectionIssue).toEqual(projectionIssue);
    expect(outcome.requestTerminal).toMatchObject({ status: "succeeded" });
    const result = await executeRegisteredWorkflowNode({ executionId: "execution-1", executionFamilyId: "family-1", ownerId: "user-1", flowId: "flow-1",
      flowVersionId: "version-1", projectId: "project-1", workflowKey: "test/v1", inputs: {}, inputProvenance: [],
      node: { id: "agent-1", type: "taskNode", kind: "workflowStage", data: { workflowInstruction: "Deliver this node's items",
        workflowAgentOutputArtifactType: "tapcanvas.test-json/v1", workflowAgentOutputEncoding: "json_array", workflowAgentMaxOutputTokens: 4096,
        workflowAgentJsonArrayContract: { itemRequiredStringFields: ["value"], itemAllowedFields: ["value"] },
        workflowAgentDeliveryRequirement: "Deliver items", workflowAgentDefinitionId: "writer", workflowAgentModelKey: "author-model", workflowAgentToolPolicy: "none",
        workflowAtomicSpec: { version: 1, category: "agent", operation: "test", executorRef: "agents.logical-task/v2", executionMode: "once", inputPorts: [], outputPorts: ["result"] },
      } } }, { runAgent: vi.fn(async () => outcome), runJavascript: vi.fn(), runVideo: vi.fn(async () => { throw new Error("Unexpected media generation in an author metadata test"); }) });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.outputRefs.evidence.atomicAuthorSelfCheck).toBeUndefined();
    expect(result.outputRefs.evidence.atomicAuthorSelfCheckProjectionIssue).toEqual(projectionIssue);
    expect(result.outputRefs.evidence.executorCompleted).toBe(true);
    expect(result.outputRefs.ports.result).toMatchObject({ text: normalizedText, atomicAuthorSelfCheckProjectionIssue: projectionIssue });
    expect(result.outputRefs.ports.result).not.toHaveProperty("atomicAuthorSelfCheck");
    const artifact = result.outputRefs.artifacts.find(item => item.type === "tapcanvas.test-json/v1");
    expect(JSON.parse(String(artifact?.value))).toEqual(items);
    expect(JSON.parse(String(artifact?.value))).not.toHaveProperty("atomicAuthorSelfCheck");
  });

	it("retains a diagnostic for a malformed raw review without changing a succeeded result", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: workflowAgentPublicTurnId({ executionId: request.executionId, nodeId: request.nodeId, physicalRetryOrdinal: null }),
				assets: [],
				raw: {
					text: "已交付文本",
					meta: {
						requestTerminal: { status: "succeeded" },
						runtime: { structuredOutputReview: { version: 1, blocking: true } },
					},
				},
			},
			response: {},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, request);

		expect(result.structuredOutputReview).toBeUndefined();
		expect(result.structuredOutputReviewProjectionIssue).toEqual({
			reason: "invalid_receipt",
			droppedObservationCount: 0,
		});
		expect(result.requestTerminal).toMatchObject({ status: "succeeded" });
	});

	it("uses the protocol maximum for typed Workflow Agents without a node budget", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: '{"value":"完整产物"}',
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-json" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.test-json/v1",
			outputEncoding: "json_object",
			jsonObjectContract: {
				requiredStringFields: ["value"],
				allowedFields: ["value"],
			},
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(call.taskRequest.extras).toMatchObject({
			requestedMaxOutputTokens: 4096,
			maxOutputTokens: WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
			continuationExecutionContract: {
				requestedMaxOutputTokens: 4096,
				maxOutputTokens: WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
			},
		});
	});

	it("uses an explicit structured-output token budget for one provider action", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: '{"value":"完整产物"}',
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-json" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.test-json/v1",
			outputEncoding: "json_object",
			structuredOutputTokenBudget: 16_384,
			jsonObjectContract: {
				requiredStringFields: ["value"],
				allowedFields: ["value"],
			},
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(call.taskRequest.extras).toMatchObject({
			requestedMaxOutputTokens: 4096,
			maxOutputTokens: 16_384,
			continuationExecutionContract: {
				requestedMaxOutputTokens: 4096,
				maxOutputTokens: 16_384,
			},
		});
	});

	it("projects canvas facts once when delivery-contract carries a downstream copy", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "完整产物",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-context" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			inputs: {
				"canvas-facts": [{
					text: "唯一来源正文",
					userRequest: {
						kind: "public_chat_turn",
						content: "当前回合要求从高潮中段进入并保持开放动作出口",
						requestId: "turn-1",
					},
				}],
				"delivery-contract": [{
					userIntentContract: { contractHash: "standing-preference-contract", prefer: ["测试用户偏好事实"] },
					canvasFacts: {
						authoritativeSources: [{ text: "duplicate-source-body" }],
						userRequest: {
							kind: "public_chat_turn",
							content: "当前回合要求从高潮中段进入并保持开放动作出口",
							requestId: "turn-1",
						},
					},
					generationContract: { videoModel: "model-1", durationOptions: [5] },
				}],
			},
		});

		const prompt = (runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string };
		}).taskRequest.prompt;
		expect(prompt).toContain('"canvasFactsSourcePort":"canvas-facts"');
		expect(prompt).not.toContain("duplicate-source-body");
		expect(prompt).toContain("唯一来源正文");
		expect(prompt).toContain("当前回合要求从高潮中段进入并保持开放动作出口");
		expect(prompt).toContain("优先级高于旧画布文本对呈现方式的隐含要求");
		expect(prompt).toContain("expandedSourceDraft");
		expect(prompt).toContain('同一执行链携带的 UserIntentContract');
		expect(prompt).toContain('"contractHash":"standing-preference-contract"');
	});

	it("delivers snapshot intent to the model and retrieval without changing the node's output goal", async () => {
		const contract = workflowIntentFixture();
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: { id: "child", assets: [], raw: { text: "node artifact", meta: {
				expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" }, requestTerminal: { status: "succeeded" },
			} } }, response: {},
		});
		await runWorkflowAgentNode({} as WorkerEnv, { ...request, userIntentContract: contract, inputs: { item: [{ itemId: "2" }] } });
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string; extras: { retrievalContext: { facts: { id: string; text: string }[] }; userIntentContract?: unknown } };
		};
		expect(dispatched.taskRequest.prompt).toContain(JSON.stringify(contract));
		const fact = dispatched.taskRequest.extras.retrievalContext.facts.find((item) => item.id === "parent-user-intent");
		expect(JSON.parse(fact!.text)).toEqual(contract);
		// The parent async goal is context, not a child command to generate media.
		expect(dispatched.taskRequest.extras.userIntentContract).toBeUndefined();
		expect(dispatched.taskRequest.prompt).toContain(request.outputArtifactType);
	});

	it("retains an overdue production target as diagnostics without aborting the agent", async () => {
		const nowMs = Date.parse("2026-08-29T05:06:00.000Z");
		const dateNow = vi.spyOn(Date, "now").mockReturnValue(nowMs);
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "完整产物",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-deadline" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		try {
			await runWorkflowAgentNode({} as WorkerEnv, {
				...request,
				logicalTaskBudgetRootId: "public-turn-1",
				productionStartDeadline: {
					version: 2,
					kind: "video_provider_receipt",
					source: "public_chat",
					anchor: "request_accepted",
					publicTurnId: "public-turn-1",
					acceptedAt: "2026-08-29T05:00:00.000Z",
					deadlineAt: "2026-08-29T05:05:00.000Z",
					targetExecutorRef: "tapcanvas.video.generate/v1",
					controlledNodeIds: ["agent-1"],
				},
			});
		} finally {
			dateNow.mockRestore();
		}

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest?: { extras?: Record<string, unknown> };
		} | undefined;
		expect(call?.taskRequest?.extras?.workflowPhysicalAttemptDeadlineAt).toBeUndefined();
		expect(call?.taskRequest?.extras?.logicalTaskBudgetRootId).toBe("public-turn-1");
		expect(call?.taskRequest?.extras?.continuationExecutionContract).toHaveProperty("logicalTaskBudgetRootId", "public-turn-1");
		expect(call?.taskRequest?.extras?.continuationExecutionContract).not.toHaveProperty("workflowPhysicalAttemptDeadlineAt");
	});

	it("polls the same active durable turn without starting a second chat", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 正在执行当前任务",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "running",
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_turn_still_running",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("moves an inactive accepted checkpoint to a new physical attempt after the bridge restarts", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
				retryablePhysicalFailure: true,
				physicalFailureReason: "workflow_agent_orphaned_checkpoint",
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("waits through the fresh durable-admission handoff before orphan recovery", async () => {
		const admittedAt = new Date().toISOString();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-fresh-admission",
				state: "unknown",
				phase: "accepted",
				startedAt: admittedAt,
				updatedAt: admittedAt,
				lastConfirmedAt: admittedAt,
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求刚刚受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_accepted_turn_activation_pending",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("counts each orphaned physical generation once in the generic no-progress window", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1:physical-retry:2",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1:physical-retry:2",
				internalTurnId: "turn-orphaned-2",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					physicalRetryOrdinal: 2,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "workflow:execution-1:agent-1:physical-retry:1",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			deliveryEvidence: {
				physicalRetryOrdinal: 3,
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "workflow:execution-1:agent-1:physical-retry:2",
					windowsWithoutProgress: 3,
					limit: 5,
				},
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
		});
	});

	it("keeps waiting when another reconciler resumes an inactive accepted checkpoint first", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned-race",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"turn is already active",
			{ status: 409, code: "chat_resume_turn_active" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_orphaned_turn_continuation_scheduled",
			},
			deliveryEvidence: {
				source: "agents_cli_durable_turn_status",
				state: "unknown",
				phase: "accepted",
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("does not let an older physical reconciler repost when a newer session owner is visible", async () => {
		const newerTurnId = workflowAgentPublicTurnId({
			executionId: request.executionId,
			nodeId: request.nodeId,
			physicalRetryOrdinal: 2,
		});
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: newerTurnId,
				internalTurnId: "turn-newer-owner",
				state: "unknown",
				phase: "accepted",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:01.000Z",
				lastConfirmedAt: "2026-08-12T00:00:01.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 请求已受理",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					physicalRetryOrdinal: 1,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: workflowAgentPublicTurnId({ ...request, physicalRetryOrdinal: 1 }),
						windowsWithoutProgress: 1,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
				requestTerminal: {
					status: "suspended",
					reason: "workflow_agent_newer_physical_owner_active",
				},
				deliveryEvidence: {
					state: "unknown",
				},
			});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("closes interactive tools for an initial typed output node", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "{\"items\":[]}",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { version: 1 },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.test/v1",
			outputEncoding: "json_object",
			jsonObjectContract: {
				requiredArrayFields: ["items"],
				allowedFields: ["items"],
			},
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			requestInput?: Record<string, unknown>;
		} | undefined;
		expect(call?.requestInput?.requiredSkills).toBeUndefined();
		expect(call?.requestInput?.executionToolPolicy).toEqual({ mode: "restricted", allowedTools: [] });
	});

	it("preloads frozen Workflow Skill dependencies while preserving bounded discovery tools", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "{\"items\":[]}",
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { version: 1 },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			outputEncoding: "json_object",
			jsonObjectContract: {
				requiredArrayFields: ["items"],
				allowedFields: ["items"],
			},
			requiredSkills: ["tapcanvas-video-prompt-writer"],
			allowedTools: ["skill_search", "Skill", "knowledge_search", "knowledge_read"],
		});

		const call = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			requestInput?: Record<string, unknown>;
			taskRequest?: { prompt?: string };
		} | undefined;
		expect(call?.requestInput?.requiredSkills).toEqual(["tapcanvas-video-prompt-writer"]);
		expect(call?.requestInput?.executionToolPolicy).toEqual({
			mode: "restricted",
			allowedTools: ["skill_search", "Skill", "knowledge_search", "knowledge_read"],
		});
		expect(call?.taskRequest?.prompt).toContain("冻结 Workflow Skill 依赖已经预载");
		expect(call?.taskRequest?.prompt).toContain("skill_search 仍可用于发现当前请求需要的额外 Skill");
		expect(call?.taskRequest?.prompt).toContain("shots[].durationSeconds 是最终可执行秒数，不是相对权重");
		expect(call?.taskRequest?.prompt).toContain("边界相等不算相交");
		expect(call?.taskRequest?.prompt).toContain("motionDynamics.direction");
		expect(call?.taskRequest?.prompt).toContain("left、right、forward、backward、upward、downward 或 diagonal");
		expect(call?.taskRequest?.prompt).toContain("结构失败保留精确路径、候选长度与哈希，按冻结提交策略处理同链修复和当前动作边界");
	});

	it("preserves the recovery window while the scheduled physical continuation is running", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-continuation",
				state: "running",
				phase: "agent_running",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:03.000Z",
				lastConfirmedAt: "2026-08-12T00:00:03.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "Agent 正在续跑当前任务",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-1",
						windowsWithoutProgress: 1,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_turn_still_running",
			},
			deliveryEvidence: {
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "physical-1",
					windowsWithoutProgress: 1,
					limit: 5,
				},
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it.each([0, 6, 25])("defers without counter-only termination and retains replanning evidence at epoch %i", async (priorEpoch) => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-3",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-3",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					noProgressRecoveryEpoch: priorEpoch,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-2",
						windowsWithoutProgress: 4,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_no_progress_recovery_deferred",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
				physicalRetryOrdinal: 1,
				noProgressRecoveryEpoch: priorEpoch + 1,
				taskRepairEvidence: { disposition: "replan_required", terminalBoundary: null, safePathsExhausted: false },
				retryNotBeforeAt: expect.any(String),
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "workflow:execution-1:agent-1:physical-retry:1",
					windowsWithoutProgress: 0,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it("starts a distinct physical retry when the same suspended run has no continuation owner", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-pending",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-pending",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-pending",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 1,
				recoveryWindow: {
					progressRevision: 0,
					physicalRunId: "physical-pending",
					windowsWithoutProgress: 2,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
	});

	it("keeps provider balance as external wait without resuming or consuming physical retries", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-provider-balance",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-22T13:00:00.000Z",
				updatedAt: "2026-08-22T13:00:01.000Z",
				lastConfirmedAt: "2026-08-22T13:00:01.000Z",
				requestText: "",
				reasonCode: "provider_balance_required",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_balance_required",
					physicalRunId: "physical-provider-balance",
					progressRevision: 7,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "模型渠道余额不足，任务已进入持久等待",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					previousExternalWait: true,
					recoveryWindow: {
						progressRevision: 7,
						physicalRunId: "physical-before-provider-balance",
						windowsWithoutProgress: 4,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "provider_balance_required",
			},
			deliveryEvidence: {
				state: "suspended",
				phase: "suspended",
				recoveryCheckpoint: {
					reasonCode: "provider_balance_required",
					physicalRunId: "physical-provider-balance",
					progressRevision: 7,
				},
				recoveryWindow: {
					windowsWithoutProgress: 4,
					limit: 5,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("preserves the advanced durable checkpoint while scheduling a distinct physical retry", async () => {
		resumePersistedAgentsChatTurn.mockClear();
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-progressed",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:06.000Z",
				lastConfirmedAt: "2026-08-12T00:00:06.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-progressed",
					progressRevision: 1,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "physical-before-progress",
						windowsWithoutProgress: 2,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			deliveryEvidence: {
				recoveryCheckpoint: {
					physicalRunId: "physical-progressed",
					progressRevision: 1,
				},
				retryablePhysicalFailure: true,
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
	});

	it("recovers the persisted response without bypassing the caller's typed-output verifier", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "succeeded",
				phase: "succeeded",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "当前回合已完成",
				finalResponse: "完整产物",
				structuredOutputReview: {
					version: 1,
					blocking: false,
					contractHash: `sha256:${"a".repeat(64)}`,
					candidateHash: `sha256:${"b".repeat(64)}`,
					feedbackDelivered: true,
					status: "observations_remaining",
					observations: [{ code: "model_authored_consistency", message: "对白窗口为 3 秒。" }],
				},
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { transportInterrupted: true },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: "完整产物",
			deliveryVerification: null,
			requestTerminal: {
				status: "succeeded",
				reason: "agents_cli_durable_turn_succeeded",
			},
			structuredOutputReview: {
				version: 1,
				blocking: false,
				contractHash: `sha256:${"a".repeat(64)}`,
				candidateHash: `sha256:${"b".repeat(64)}`,
				feedbackDelivered: true,
				status: "observations_remaining",
				observations: [{ code: "model_authored_consistency", message: "对白窗口为 3 秒。" }],
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it.each([2, 3, 7])("continues rejected physical generation %i without returning to the original run", async (ordinal) => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: `workflow:execution-1:agent-1:physical-retry:${ordinal}`,
			durable: true,
			activeTurn: false,
			turn: {
				turnId: `workflow:execution-1:agent-1:physical-retry:${ordinal}`,
				internalTurnId: "turn-1",
				state: "succeeded",
				phase: "succeeded",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "当前回合已完成",
				finalResponse: "完整产物",
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: { physicalRetryOrdinal: ordinal },
				outputRepair: { version: 1, sourceTurnId: `workflow:execution-1:agent-1:physical-retry:${ordinal}`, candidate: "完整产物", error: "field must be a string" },
			},
		})).resolves.toMatchObject({
			taskId: `workflow:execution-1:agent-1:physical-retry:${ordinal}`,

			deliveryVerification: null,
			deliveryEvidence: { physicalRetryOrdinal: ordinal + 1, physicalFailureReason: "structured_output_invalid" },
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("schedules the persisted continuation for a physical-budget suspension", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					physicalRunId: "physical-1",
					progressRevision: 3,
				},
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-1",
					progressRevision: 3,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-1",
			stage: 2,
			resumeTrigger: "physical_budget",
			recoveryKind: "physical_budget",
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-1",
					progressRevision: 3,
					durableTaskReferenceCount: 0,
					durableProgressClaimCount: 0,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it.each(["suspended", "failed"] as const)("resumes a matching physical suspension from a %s checkpoint without duplicating execution", async (state) => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-suspended-race",
				state,
				phase: state,
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: {
					physicalRunId: "physical-race",
					progressRevision: 3,
				},
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-race",
					progressRevision: 3,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"turn is already active",
			{ status: 409, code: "chat_resume_turn_active" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					physicalRunId: "physical-race",
					progressRevision: 3,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledTimes(1);
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("schedules a persisted physical continuation from its durable checkpoint", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-physical-continuation-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "max_turns",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "max_turns",
					physicalRunId: "physical-continuation-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "正在继续同一物理执行",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-physical-1",
			stage: 2,
			resumeTrigger: "physical_budget",
			recoveryKind: "physical_budget",
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { state: "suspended" },
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "max_turns",
					physicalRunId: "physical-continuation-1",
					progressRevision: 0,
				},
			},
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
	});

	it("schedules the same persisted continuation after a provider stream interruption", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-provider-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "供应商响应流中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({
			ok: true,
			resumed: true,
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
			continuationId: "continuation-provider-1",
			stage: 2,
			resumeTrigger: "provider_stream_interrupted",
			recoveryKind: "provider_stream_interrupted",
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				previousWorkflowEvidence: {
					previousWorkflowEvidence: { state: "must-not-be-copied" },
				},
			},
		});
		expect(result).toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_same_task_continuation_scheduled",
			},
			deliveryEvidence: {
				recoveryCheckpoint: {
					reasonCode: "provider_stream_interrupted",
					physicalRunId: "physical-provider-1",
					progressRevision: 0,
				},
			},
		});
		expect(result.deliveryEvidence).not.toHaveProperty("previousWorkflowEvidence");
		expect(resumePersistedAgentsChatTurn).toHaveBeenLastCalledWith(expect.objectContaining({
			userId: "user-1",
			sessionKey: "workflow:execution-1:agent-1",
			turnId: "workflow:execution-1:agent-1",
		}));
	});

	it("starts a bounded fresh physical run when provider interruption has no checkpoint", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-orphaned-provider",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "provider_stream_interrupted",
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "供应商连接在首个持久 checkpoint 前中断",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: null,
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 1,
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it.each(["failed", "suspended"] as const)("uses the provider receipt to replan a %s turn without an orphan wait", async (state) => {
		const providerReceipt = {
			protocolVersion: "provider-response-rejection/v1",
			reasonCode: "provider_response_rejected",
			terminalState: "failed",
			providerCode: "data_inspection_failed",
			providerErrorType: null,
			providerReason: "Output data may contain inappropriate content.",
			partialTextChars: 4229,
			partialToolCallCount: 0,
			responseId: null,
			recoveryMode: "agent_replan",
			responseScope: "current_provider_response_only",
			acceptedSideEffect: false,
		};
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: `turn-provider-rejection-${state}`,
				state,
				phase: state,
				startedAt: "2026-09-23T10:00:00.000Z",
				updatedAt: "2026-09-23T10:00:02.000Z",
				lastConfirmedAt: "2026-09-23T10:00:02.000Z",
				requestText: "",
				reasonCode: "provider_response_rejected",
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "供应商拒绝当前响应，未形成结构化提交",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1:physical-retry:1",
				assets: [],
				raw: {
					text: "依据 provider receipt 完成合法修订。",
					meta: { requestTerminal: { status: "succeeded" } },
				},
			},
			response: {},
		});

		const firstResult = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: { deliveryEvidence: { providerResponseRejection: providerReceipt } },
		});
		expect(firstResult).toMatchObject({
			deliveryEvidence: {
				providerResponseRejection: providerReceipt,
				physicalFailureReason: "workflow_agent_provider_replan_required",
				physicalRetryOrdinal: 1,
			},
			requestTerminal: { status: "suspended", reason: "workflow_agent_physical_retry_pending" },
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();

		const recovered = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: firstResult as unknown as Record<string, unknown>,
		});
		expect(recovered).toMatchObject({
			taskId: "workflow:execution-1:agent-1:physical-retry:1",
			text: "依据 provider receipt 完成合法修订。",
			requestTerminal: { status: "succeeded" },
		});
		expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(1);
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest?: { extras?: Record<string, unknown> };
		};
		expect(dispatched.taskRequest?.extras?.providerResponseRejection).toEqual(providerReceipt);
	});

	it("projects provider rejection evidence from the bridge runtime summary", async () => {
		const providerReceipt = {
			protocolVersion: "provider-response-rejection/v1",
			reasonCode: "provider_response_rejected",
			terminalState: "failed",
			providerCode: "content_filter",
			providerErrorType: "content_policy",
			providerReason: "provider policy receipt",
			partialTextChars: 12,
			partialToolCallCount: 0,
			responseId: "response-1",
			recoveryMode: "agent_replan",
			responseScope: "current_provider_response_only",
			acceptedSideEffect: false,
		};
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: "供应商拒绝，不应作为产物",
					meta: {
						requestTerminal: { status: "failed", reason: "provider_response_rejected" },
						runtime: {
							providerResponseRejections: [providerReceipt],
							structuredOutputExecutionFailure: {
								protocolVersion: "structured-output-execution-failure/v1",
								reasonCode: "provider_response_rejected",
								recoveryMode: "agent_replan",
								providerFailure: providerReceipt,
							},
						},
					},
				},
			},
			response: {},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, request);
		expect(result.requestTerminal).toMatchObject({ status: "suspended", reason: "provider_response_rejected" });
		expect(result.deliveryEvidence).toMatchObject({
			recoveryMode: "agent_replan",
			providerResponseRejection: providerReceipt,
			physicalFailureReason: "workflow_agent_provider_replan_required",
		});
		expect(result.structuredOutputFailure).toMatchObject({
			reasonCode: "provider_response_rejected",
			providerFailure: providerReceipt,
		});
	});

	it("reopens a repairable structured-output turn instead of projecting an invalid candidate as success", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-structured-1",
				state: "failed",
				phase: "failed",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "structured_output_invalid",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "structured_output_invalid",
					physicalRunId: "physical-structured-1",
					progressRevision: 0,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "结构化输出未满足",
				finalResponse: '{"invalidCandidate":true}',
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			resumeOnly: true,
			previousEvidence: null,
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "structured_output_invalid",
				physicalRetryOrdinal: 1,
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
		});
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("moves a physical-budget suspension to a new physical attempt when no continuation is claimable", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: "workflow:execution-1:agent-1",
				internalTurnId: "turn-1",
				state: "suspended",
				phase: "suspended",
				startedAt: "2026-08-12T00:00:00.000Z",
				updatedAt: "2026-08-12T00:00:02.000Z",
				lastConfirmedAt: "2026-08-12T00:00:02.000Z",
				requestText: "",
				reasonCode: "root_physical_execution_budget_exhausted",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "root_physical_execution_budget_exhausted",
					physicalRunId: "physical-pending-1",
					progressRevision: 4,
					durableTaskReferences: [],
					durableProgressClaims: [],
					userIntentContract: null,
				},
				lastConfirmedSummary: "物理执行窗口已结束",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockRejectedValueOnce(new AppError(
			"continuation is not ready",
			{ status: 409, code: "chat_resume_continuation_not_ready" },
		));

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_retry_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "root_physical_execution_budget_exhausted",
				physicalRetryOrdinal: 1,
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("performs no model or fence call before a persisted 429 quiet window is due", async () => {
		const retryNotBeforeAt = new Date(Date.now() + 60_000).toISOString();
		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					version: 1,
					source: "workflow_agent_rate_limit_backpressure",
					retryablePhysicalFailure: true,
					physicalFailureReason: "llm_http_429",
					physicalRetryOrdinal: 1,
					rateLimitDeferralCount: 1,
					retryAfterMs: 65_000,
					retryNotBeforeAt,
				},
			},
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1:physical-retry:1",
			deliveryEvidence: {
				physicalFailureReason: "llm_http_429",
				retryNotBeforeAt,
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_rate_limit_backpressure",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
	});

	it("performs no model or fence call before a deferred no-progress generation is due", async () => {
		const retryNotBeforeAt = new Date(Date.now() + 60_000).toISOString();
		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					version: 1,
					source: "agents_cli_durable_turn_status",
					retryablePhysicalFailure: true,
					physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
					physicalRetryOrdinal: 5,
					noProgressRecoveryEpoch: 1,
					retryAfterMs: 60_000,
					retryNotBeforeAt,
					recoveryWindow: {
						progressRevision: 0,
						physicalRunId: "workflow:execution-1:agent-1:physical-retry:5",
						windowsWithoutProgress: 0,
						limit: 5,
					},
				},
			},
		})).resolves.toMatchObject({
			taskId: "workflow:execution-1:agent-1:physical-retry:5",
			deliveryEvidence: {
				physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
				retryNotBeforeAt,
			},
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_no_progress_recovery_deferred",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
	});

	it("keeps the logical node suspended when the previous generation fence is not yet confirmed", async () => {
		cancelWorkflowAgentTurns.mockResolvedValueOnce([{
			target: {
				sessionId: "workflow:execution-1:agent-1:physical-retry:1",
				turnId: "workflow:execution-1:agent-1:physical-retry:1",
				nodeId: "agent-1",
				runtimeNodeId: "agent-1",
			},
			status: "failed",
			receipt: null,
			errorCode: "runtime_interrupt_unknown",
			errorMessage: "runtime did not confirm interruption",
		}]);

		await expect(runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: {
				deliveryEvidence: {
					retryablePhysicalFailure: true,
					physicalFailureReason: "provider_stream_interrupted",
					physicalRetryOrdinal: 2,
				},
			},
		})).resolves.toMatchObject({
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_physical_generation_fence_pending",
			},
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 2,
				generationFencePending: true,
				previousPublicTurnId: "workflow:execution-1:agent-1:physical-retry:1",
				currentPublicTurnId: "workflow:execution-1:agent-1:physical-retry:2",
				fenceErrorCode: "runtime_interrupt_unknown",
			},
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("forwards an explicit json_object prompt-package contract to agents-cli", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ prompt: "动态提示词", negativePrompt: "动态负向词" }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-image-prompt" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.image-prompt-package/v1",
			jsonObjectContract: {
				requiredStringFields: ["prompt", "negativePrompt", "sourceFingerprint"],
				exactStringFields: { sourceFingerprint: "fingerprint-1" },
				allowedFields: ["prompt", "negativePrompt", "sourceFingerprint"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
						extras: expect.objectContaining({
							outputContract: expect.objectContaining({
								requiredStringFields: ["prompt", "negativePrompt", "sourceFingerprint"],
								exactStringFields: { sourceFingerprint: "fingerprint-1" },
								allowedFields: ["prompt", "negativePrompt", "sourceFingerprint"],
						}),
						responseFormat: { type: "json_object" },
					}),
				}),
			}),
		);
	});

	it("forwards caller-frozen existing asset identities to the agents-cli contract", () => {
		const existingAssetId = "project-node:chapter:prior:workflow-asset:existing::output::image";
		const typedRequest = {
			...request,
			outputEncoding: "json_object" as const,
			outputArtifactType: "tapcanvas.beat-sheet/v2",
			jsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredArrayFields: ["blockingPlans"],
				allowedFields: ["protocolVersion", "blockingPlans"],
				knownExistingAssetIds: [existingAssetId],
			},
		};

		const structured = workflowAgentStructuredOutput(typedRequest);
		expect(structured?.outputContract).toMatchObject({
			knownExistingAssetIds: [existingAssetId],
		});
	});

	it("enables provider JSON Output without imposing a fixed BeatSheet clip topology", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({
						protocolVersion: "2",
						filmBible: { title: "短片" },
						beats: [{ clipId: "clip-001" }],
					}),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-object" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			inputs: {
				"delivery-contract": [{
					targetDurationSeconds: 40,
					generationContract: {
						videoModel: "doubao-seedance-2.5",
						durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
						maxDurationSeconds: 30,
						clipPlanningPolicy: "agent_semantic_duration_budget",
					},
				}],
			},
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.beat-sheet/v2",
			jsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredObjectFields: ["filmBible"],
				requiredArrayFields: ["beats"],
				allowedFields: ["protocolVersion", "filmBible", "beats"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
						outputContract: expect.objectContaining({
							requiredStringFields: ["protocolVersion"],
							requiredObjectFields: ["filmBible"],
							requiredArrayFields: ["beats"],
							allowedFields: ["protocolVersion", "filmBible", "beats"],
						}),
						responseFormat: { type: "json_object" },
						continuationExecutionContract: expect.objectContaining({
							outputContract: expect.objectContaining({
								requiredObjectFields: ["filmBible"],
								requiredArrayFields: ["beats"],
							}),
							responseFormat: { type: "json_object" },
						}),
					}),
				}),
			}),
		);
	});

	it.each([true, false])("gives BeatSheet every ready project image with explicit selection=%s", async (hasSelection) => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({
						protocolVersion: "tapcanvas.beat-sheet/v2",
						objectRegistry: [{
							objectId: "char-zhangsan",
							referenceAssetIds: ["asset-zhangsan"],
						}],
						beats: [{ clipIndex: 0 }],
					}),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-selected-asset" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			allowedTools: ["tapcanvas_workflow_execution_inspect"],
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.beat-sheet/v2",
			jsonObjectContract: {
				requiredStringFields: ["protocolVersion"],
				requiredArrayFields: ["objectRegistry", "beats"],
				allowedFields: ["protocolVersion", "objectRegistry", "beats"],
			},
			projectContext: {
				mediaUnderstanding: [{ referenceId: "asset-zhangsan", text: "Visible garment; fibre composition unknown.", question: "Read image", provenance: { version: 1, mediaType: "image", source: "persisted_task_result", taskId: "vision-1", modelKey: "vision", referenceId: "asset-zhangsan", promptHash: "question-hash", analysisHash: "analysis-hash", analyzedAt: "2026-08-30T06:00:00.000Z" } }],
				version: 3,
				projectId: "project-1",
				canvasId: "chapter:chapter-1",
				sourceNodeId: "chapter-seed-1",
				selectedAssetIds: hasSelection ? ["asset-zhangsan"] : [],
				projectAssetIds: ["asset-zhangsan", "asset-qin-courtyard"],
				timeline: { clips: [] },
				selection: {
					nodeIds: hasSelection ? ["node-zhangsan"] : [],
					assetIds: hasSelection ? ["asset-zhangsan"] : [],
					activeNodeId: hasSelection ? "node-zhangsan" : null,
					groupId: null,
				},
				permissions: {
					principalId: "user-1",
					projectRead: true,
					canvasRead: true,
					assetRead: true,
					assetWrite: true,
				},
				assetSnapshot: [{
					assetId: "asset-zhangsan",
					assetVersion: 1,
					assetVersionId: "asset-zhangsan:v1",
					contentFingerprint: "sha256:zhangsan",
					projectId: "project-1",
					name: "张三游魂角色设定图",
					canonicalName: "张三",
					kind: "character",
					referenceType: "character",
					approvalStatus: "approved",
					origin: "material",
					flowId: "chapter-1",
					nodeId: "node-zhangsan",
					mediaKind: "image",
					state: "ready",
					assetUsage: "production",
					assetPurpose: null,
					productionEligible: true,
					productionExclusionReason: null,
					styleFingerprint: null,
					sourceFacts: {
						referenceType: "character",
						roleName: "张三",
						physicalIdentityKey: "spirit-zhangsan",
						characterAssetRole: "identity",
						characterProfileVersion: "character-card/v3",
						identityAnchors: ["三十多岁男性游魂"],
						prohibitedDrift: ["不得替换为秦小龙肉身"],
						sourceNodeId: "node-zhangsan",
						workflowExecutionId: "source-execution-1",
						taskId: "image-task-1",
						prompt: "三十多岁中国男性游魂角色设定图",
					},
					updatedAt: "2026-08-30T07:00:00.000Z",
				}, {
					assetId: "asset-qin-courtyard",
					assetVersion: 2,
					assetVersionId: "asset-qin-courtyard:v2",
					contentFingerprint: "sha256:qin-courtyard",
					projectId: "project-1",
					name: "第一章秦家院落与柴房",
					canonicalName: "qin-family-courtyard",
					kind: "scene",
					referenceType: "scene",
					approvalStatus: "approved",
					origin: "project_node",
					flowId: "chapter-1",
					nodeId: "node-qin-courtyard",
					mediaKind: "image",
					state: "ready",
					assetUsage: "production",
					assetPurpose: null,
					productionEligible: true,
					productionExclusionReason: null,
					styleFingerprint: null,
					sourceFacts: {
						referenceType: "scene",
						roleName: "秦家院落与柴房",
						physicalIdentityKey: null,
						characterAssetRole: null,
						characterProfileVersion: null,
						identityAnchors: [],
						prohibitedDrift: ["不得改变院落与柴房方位"],
						sourceNodeId: "node-qin-courtyard",
						workflowExecutionId: "source-execution-1",
						taskId: "image-task-2",
						prompt: "秦家院落、柴房和院门的固定空间关系",
					},
					updatedAt: "2026-08-30T07:00:30.000Z",
				}],
				capturedAt: "2026-08-30T07:01:00.000Z",
			},
		});

		const prompt = (runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as {
			taskRequest: { prompt: string };
		}).taskRequest.prompt;
		const extras = (runPersistedAgentsChatTask.mock.calls.at(-1)?.[0] as { taskRequest: { extras: Record<string, unknown> } }).taskRequest.extras;
		expect(extras.structuredOutputSourceContext).not.toContain("Visible garment; fibre composition unknown.");
		expect(extras.structuredOutputSourceContext).toContain("asset-zhangsan");
		if (hasSelection) expect(prompt).toContain("显式所选资产是一等执行事实，不是可选参考");
		if (hasSelection) expect(prompt).toContain("根级 objectRegistry[].referenceAssetIds");
		if (hasSelection) expect(prompt).toContain("selectedAssetIds 的每个 ID 都在 objectRegistry[].referenceAssetIds 中精确出现一次");
		expect(prompt).toContain('"assetId":"asset-zhangsan"');
		expect(prompt).toContain('"assetId":"asset-qin-courtyard"');
		expect(prompt).toContain('"name":"张三游魂角色设定图"');
		expect(prompt).toContain('"selected":false');
		expect(prompt).toContain('"physicalIdentityKey":"spirit-zhangsan"');
		expect(prompt).not.toContain("Visible garment; fibre composition unknown.");
		expect(prompt).not.toContain("三十多岁中国男性游魂角色设定图");
		expect(prompt).toContain('"tool":"tapcanvas_workflow_execution_inspect"');
		expect(prompt).toContain('"projectAssetCandidates"');
		expect(prompt).toContain('"mediaKind":"image"');
		expect(prompt).toContain('"view":"assets"');
		expect(extras.structuredOutputSourceContext).toContain('"mediaKind":"image"');
		expect(prompt).toContain("展示名、canonicalName 或章节内称谓不同不代表新身份");
		expect(prompt).toContain("runtime 后续只验证精确 ID 的项目归属、图片就绪状态和单对象绑定，不会返回语义纠偏");
		if (hasSelection) expect(prompt).toContain("runtime 只解析和验证显式绑定，不按名称猜测");
		expect(prompt).toContain("一次性路人、匿名围观者、背景人群");
		expect(prompt).toContain("referenceRole=none 且两个引用 ID 数组为空");
	});

	it("projects opening-agent context to frozen chapter, request, generation, and selected-asset facts", () => {
		const sourceContent = `CH14_START${"章".repeat(4_085)}😀${"章节正文".repeat(1_000)}CH14_END`;
		const irrelevant = "unrelated-workflow-state:" + "x".repeat(24_000);
		const userRequest = "保留本轮明确的改编要求，并尽快提交第一段真实视频。";
		const deliveryContract = {
			protocolVersion: "2",
			executionScope: "media_delivery",
			targetDurationSeconds: 10,
			sourceProfile: { speechLineCount: 2, fullSourceChars: sourceContent.length },
			generationContract: {
				videoModel: "video-model-1",
				maxReferenceImages: 4,
				durationOptions: [5, 10],
				maxDurationSeconds: 10,
				clipPlanningPolicy: "agent_semantic_duration_budget",
				providerSubmissionTopology: { targetDurationSeconds: 10, expectedClipCount: 1 },
				privateProviderTrace: irrelevant,
			},
			expectedDelivery: { internalEnvelope: irrelevant },
			internalExecutionSnapshot: irrelevant,
			canvasFacts: {
				sourceMode: "project_context",
				flowId: "chapter:14",
				authoritativeSources: [{ sourceId: "chapter-14", sourceFingerprint: "sha256:chapter-14", content: sourceContent }],
				userRequest: { kind: "public_chat_turn", requestId: "turn-14", content: userRequest, requestFingerprint: "sha256:request" },
				referenceVideoAnalyses: [{ nodeId: "reference-1", text: "reference facts" }],
				unusedCanvasProjection: irrelevant,
			},
		};
		const selectedAsset = {
			assetId: "asset-selected",
			assetVersion: 1,
			assetVersionId: "asset-selected:v1",
			contentFingerprint: "sha256:selected",
			projectId: "project-1",
			name: "selected character card",
			canonicalName: "character-1",
			kind: "character",
			referenceType: "character",
			approvalStatus: "approved",
			origin: "material" as const,
			flowId: "chapter:14",
			nodeId: "node-selected",
			mediaKind: "image" as const,
			state: "ready" as const,
			assetUsage: "production" as const,
			assetPurpose: null,
			productionEligible: true,
			productionExclusionReason: null,
			styleFingerprint: null,
			sourceFacts: {
				referenceType: "character",
				roleName: "character-1",
				physicalIdentityKey: "body-1",
				characterAssetRole: "identity",
				characterProfileVersion: "character-card/v3",
				identityAnchors: ["existing character identity"],
				prohibitedDrift: [],
				mediaIdentityKey: "media-selected",
				sourceNodeId: "node-selected",
				workflowExecutionId: null,
				taskId: null,
				prompt: "selected asset source prompt",
			},
			updatedAt: "2026-09-23T00:00:00.000Z",
		};
		const projectContext = {
			version: 3 as const,
			projectId: "project-1",
			canvasId: "chapter:14",
			sourceNodeId: "chapter-14",
			selectedAssetIds: ["asset-selected"],
			projectAssetIds: ["asset-selected", "asset-unselected"],
			timeline: { clips: [{ nodeId: "timeline-secret-marker", assetId: null, durationSeconds: 30, startSeconds: 0 }] },
			selection: { nodeIds: ["selection-secret-marker"], assetIds: ["asset-selected"], activeNodeId: null, groupId: null },
			permissions: { principalId: "user-1", projectRead: true as const, canvasRead: true as const, assetRead: true as const, assetWrite: false },
			assetSnapshot: [selectedAsset, { ...selectedAsset, assetId: "asset-unselected", name: "unselected-secret-marker" }],
			mediaUnderstanding: [{ referenceId: "asset-unselected", text: "unselected-analysis-secret-marker", question: "inspect", provenance: {
				version: 1 as const, mediaType: "image" as const, source: "persisted_task_result" as const,
				taskId: "unselected-analysis-task", modelKey: "vision-test", referenceId: "asset-unselected",
				promptHash: "sha256:unselected-prompt", analysisHash: "sha256:unselected-analysis", analyzedAt: "2026-09-23T00:00:00.000Z",
			} }],
			capturedAt: "2026-09-23T00:00:00.000Z",
		};
		const inputs = {
			"canvas-facts": [{ ...deliveryContract.canvasFacts }],
			"delivery-contract": [deliveryContract],
		};
		const prompt = workflowAgentPrompt({
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.opening-clip/v3",
			instruction: "Create the opening clip from the frozen source.",
			deliveryRequirement: "Submit one opening clip.",
			inputs,
			allowedTools: ["tapcanvas_workflow_execution_inspect"],
			projectContext,
		});
		const promptInputsMarker = "上游端口事实（JSON，delivery-contract 中的 canvasFactsSourcePort 仅表示引用，不是第二份来源正文）：";
		const promptInputsMarkerEnd = prompt.lastIndexOf(promptInputsMarker) + promptInputsMarker.length;
		const trailingPrompt = prompt.slice(promptInputsMarkerEnd);
		const promptInputsStart = promptInputsMarkerEnd + trailingPrompt.length - trailingPrompt.trimStart().length;
		const promptInputsEnd = prompt.indexOf("\n\n", promptInputsStart);
		const promptInputs = prompt.slice(promptInputsStart, promptInputsEnd);
		expect(promptInputs.length).toBeLessThan(JSON.stringify(inputs).length / 2);
		expect(prompt).toContain("CH14_START");
		expect(prompt).not.toContain("CH14_END");
		expect(prompt).toContain("sourceRanges 只提交连续的来源前缀");
		expect(prompt).toContain(userRequest);
		expect(prompt).toContain('"videoModel":"video-model-1"');
		expect(prompt).not.toContain("selected asset source prompt");
		expect(prompt).not.toContain("unrelated-workflow-state:");
		expect(prompt).not.toContain("timeline-secret-marker");
		expect(prompt).not.toContain("unselected-secret-marker");
		expect(prompt).not.toContain("unselected-analysis-secret-marker");
		expect(prompt).not.toContain('frozenAssetRead: {"tool":"tapcanvas_workflow_execution_inspect"');
		const projectedInputs = JSON.parse(promptInputs) as {
			"canvas-facts": Array<{ authoritativeSources: Array<{
				content: string;
				sourceFingerprint: string;
				sourceWindow: { startOffset: number; endOffset: number; sourceLength: number; offsetUnit: string; complete: boolean };
			}> }>;
			"delivery-contract": Array<{ canvasFactsSourcePort?: string; canvasFacts?: unknown }>;
		};
		const projectedSource = projectedInputs["canvas-facts"][0]?.authoritativeSources[0];
		expect(projectedSource).toMatchObject({
			sourceFingerprint: "sha256:chapter-14",
			sourceWindow: {
				startOffset: 0,
				endOffset: 4_095,
				sourceLength: sourceContent.length,
				offsetUnit: "utf16_code_unit",
				complete: false,
			},
		});
		expect(projectedSource?.content).toBe(sourceContent.slice(0, 4_095));
		expect(projectedInputs["delivery-contract"][0]).toMatchObject({ canvasFactsSourcePort: "canvas-facts" });
		expect(projectedInputs["delivery-contract"][0]).not.toHaveProperty("canvasFacts");
		expect(sourceContent.length).toBeGreaterThan(projectedSource?.content.length ?? 0);

		const framePrompt = workflowAgentPrompt({
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.opening-frame-plan/v1",
			instruction: "Author the opening frame plan from the frozen chapter facts.",
			deliveryRequirement: "Deliver one image prompt package with exact project references.",
			inputs,
			projectContext,
		});
		expect(framePrompt).toContain('"projectAssetCandidates"');
		expect(framePrompt).toContain('"assetId":"asset-selected"');
		expect(framePrompt).toContain('"assetId":"asset-unselected"');
		expect(framePrompt).not.toContain("timeline-secret-marker");
		expect(framePrompt).not.toContain("unrelated-workflow-state:");
		expect(framePrompt).not.toContain("展示名、canonicalName 或章节内称谓不同不代表新身份");
	});

	it("adapts an array-only JSON object to the agents-cli non-empty array contract", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [{ clipId: "clip-001" }] }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-clips" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			jsonObjectContract: {
				requiredArrayFields: ["clips"],
				allowedFields: ["clips"],
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
						outputContract: expect.objectContaining({
							kind: "json",
							submissionPolicy: "repair_with_correction",
							contractName: "tapcanvas.video-writer-artifact",
							contractVersion: "14",
							requiredArrayField: "clips",
							description: expect.stringContaining("non-empty top-level array field"),
						}),
						responseFormat: { type: "json_object" },
					}),
				}),
			}),
		);
	});

	it("forwards clip writer version identity while leaving frozen asset projection to the compiler", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [], selfQaNote: "done", creativeReview: {} }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-writer" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			jsonObjectContract: {
				requiredStringFields: ["selfQaNote"],
				requiredObjectFields: ["creativeReview"],
				requiredArrayFields: ["clips"],
				expectedArrayLengths: { clips: 1 },
				arrayItemExactStringFields: { clips: [{ exitState: "老隼跪地开匣" }] },
				arrayItemExactStringArrayFields: { clips: [{ characterRoleNames: ["老隼"] }] },
				allowedFields: ["clips", "selfQaNote", "creativeReview"],
				itemExactAssetIds: {
					declarationPaths: ["assetObjectContracts"],
					expected: ["asset-hero", "asset-scene"],
				},
			},
		});

		expect(runPersistedAgentsChatTask).toHaveBeenLastCalledWith(expect.objectContaining({
			taskRequest: expect.objectContaining({
					extras: expect.objectContaining({
					outputContract: expect.objectContaining({
						kind: "json",
						contractName: "tapcanvas.video-writer-artifact",
						contractVersion: "14",
						expectedArrayLength: 1,
					}),
				}),
			}),
		}));
		const outputContract = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.outputContract;
		expect(outputContract).not.toHaveProperty("arrayItemExactAssetIds");
		expect(outputContract).not.toHaveProperty("arrayItemExactNumberFields");
		expect(outputContract).not.toHaveProperty("arrayItemExactStringFields");
		expect(outputContract).not.toHaveProperty("arrayItemExactStringArrayFields");
		expect(outputContract).not.toHaveProperty("requiredStringFields");
		expect(outputContract).not.toHaveProperty("requiredObjectFields");
	});

	it("requires SpeechEvent arrays in the same Agent chain when the frozen clip context contains speech", async () => {
		const sourceEvidence = {
			protocolVersion: "tapcanvas.source-evidence/v1",
			origin: "delivery-contract.canvasFacts.authoritativeSources",
			status: "matched",
			sourceId: "source-original",
			sourceFingerprint: "source-original-fingerprint",
			sources: [{ sourceId: "source-original", sourceFingerprint: "source-original-fingerprint", content: "  爬升再俯冲。\n卸力翻滚踩稳。  " }],
		};
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [] }),
					meta: {
						expectedDelivery: { active: true },
						deliveryEvidence: { items: [{ evidenceId: "e-writer-speech" }] },
						deliveryVerification: { status: "satisfied" },
						requestTerminal: { status: "succeeded" },
					},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
				inputs: {
					"clip-contexts": [{
						beat: {
							clipId: "clip-a",
							durationSeconds: 15,
							assetObjectContracts: [{ name: "hero", kind: "character" }],
						},
						assetObjectContracts: [{ name: "hero", kind: "character" }],
						sourceEvidence,
						spokenScript: [{ lineId: "L01", speakerName: "小美", text: "我在这里" }],
					dialoguePaceRate: 3,
				}],
			},
			jsonObjectContract: {
				requiredArrayFields: ["clips"],
				expectedArrayLengths: { clips: 1 },
				itemRequiredNonEmptyArrayFields: ["shots"],
				allowedFields: ["clips"],
			},
		});

		const outputContract = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.outputContract;
		const prompt = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.prompt as string;
			const sourceContext = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.structuredOutputSourceContext as string;
		expect(prompt).toContain('"sourceId":"source-original"');
		expect(prompt).toContain('"sourceFingerprint":"source-original-fingerprint"');
		expect(prompt).toContain('"contentCharacters":18');
		expect(prompt).not.toContain(sourceEvidence.sources[0].content);
			expect(sourceContext).toContain('"sourceFingerprint":"source-original-fingerprint"');
			expect(sourceContext).not.toContain(sourceEvidence.sources[0].content);
		expect(sourceContext.match(/"assetObjectContracts"/g)).toHaveLength(1);
			expect(outputContract).toMatchObject({
			kind: "json",
			contractName: "tapcanvas.video-writer-artifact",
			contractVersion: "14",
			requiredArrayField: "clips",
			expectedArrayLength: 1,
			itemTimelineDurationSeconds: 15,
			itemSpeechContract: { dialoguePaceRate: 3, lines: [{ lineId: "L01", speakerName: "小美", text: "我在这里" }] },
			allowedTopLevelFields: ["clips", "creativeReview", "selfQaNote"],
				requiredNonEmptyArrayPaths: ["shots", "speakerBindings", "speechEvents"],
			});
		});

		it("retains a non-identical top-level asset contract beside the canonical beat registry", async () => {
			runPersistedAgentsChatTask.mockResolvedValueOnce({
				result: {
					id: "workflow:execution-1:agent-1",
					assets: [],
					raw: { text: JSON.stringify({ clips: [] }), meta: { requestTerminal: { status: "succeeded" } } },
				},
				response: {},
			});
			const canonicalContracts = [{ name: "hero", kind: "character" }];
			const additionalContracts = [{ name: "hero", kind: "character", role: "foreground" }];
			await runWorkflowAgentNode({} as WorkerEnv, {
				...request,
				outputEncoding: "json_object",
				outputArtifactType: "tapcanvas.clip-prompts/v2",
				inputs: {
					"clip-contexts": [{
						beat: { clipId: "clip-a", assetObjectContracts: canonicalContracts },
						assetObjectContracts: additionalContracts,
						sourceEvidence: { protocolVersion: "v1", sources: [] },
					}],
				},
				jsonObjectContract: { requiredArrayFields: ["clips"], allowedFields: ["clips"] },
			});
			const sourceContext = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest?.extras?.structuredOutputSourceContext as string;
			expect(sourceContext).toContain('"role":"foreground"');
			expect(sourceContext.match(/"assetObjectContracts"/g)).toHaveLength(2);
		});

		it("projects only the current keyed asset collection into each Clip writer prompt", async () => {
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: "workflow:execution-1:agent-1",
				assets: [],
				raw: {
					text: JSON.stringify({ clips: [] }),
					meta: { requestTerminal: { status: "succeeded" } },
				},
			},
			response: {},
		});
		const collection = {
			protocolVersion: "workflow.collection/v1",
			collectionId: "asset-bindings",
			items: [
				{
					index: 0,
					itemId: "asset-a",
					value: {
						assetPlan: { consumerClipIds: ["clip-a", "clip-b"], displayName: "current" },
						binding: { consumerClipIds: ["clip-a", "clip-b"], bindingId: "binding-a" },
						prompt: "only-current-asset",
					},
				},
				{ index: 1, itemId: "asset-b", value: { assetPlan: { consumerClipIds: ["clip-b"] }, prompt: "other-clip-asset" } },
			],
		};
		const originalCollection = structuredClone(collection);
		await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			runtimeItemIndex: 0,
			outputEncoding: "json_object",
			outputArtifactType: "tapcanvas.clip-prompts/v2",
				inputs: {
					"clip-contexts": [{
						beat: { clipId: "clip-a", durationSeconds: 4 },
						assetPlans: [{ assetId: "asset-a", consumerClipIds: ["clip-a", "clip-b"], description: "current-plan" }],
						spokenScript: [],
					}],
					"asset-bindings": [collection],
			},
			jsonObjectContract: { requiredArrayFields: ["clips"], allowedFields: ["clips"] },
		});
		const dispatched = runPersistedAgentsChatTask.mock.calls.at(-1)?.[0]?.taskRequest;
		const sourceContext = dispatched?.extras?.structuredOutputSourceContext as string;
			expect(sourceContext).toContain("asset-a");
			expect(sourceContext).not.toContain('"itemId":"asset-b"');
			expect(sourceContext).toContain('"consumerClipIds":["clip-a"]');
			expect(sourceContext).not.toContain('"consumerClipIds":["clip-a","clip-b"]');
		expect(collection).toEqual(originalCollection);
		});

	it("projects the current and adjacent sequence facts without repeating the chapter timeline", () => {
		const segment = (clipIndex: number, event: string) => ({
			clipId: `clip-${clipIndex}`,
			clipIndex,
			startKeyframe: `start-${clipIndex}`,
			endKeyframe: `end-${clipIndex}`,
			exitState: `exit-${clipIndex}`,
			storyEvents: [event],
			timing: { transitionFromPrevious: null, transitionToNext: null },
			assetObjectContracts: [{ name: `object-${clipIndex}`, kind: "character", physicalIdentityKey: `identity-${clipIndex}` }],
		});
		const prompt = workflowAgentPrompt({
			...request,
			outputArtifactType: "tapcanvas.clip-prompts/v2",
			inputs: {
				"clip-contexts": [{
					beat: { clipId: "clip-1", clipIndex: 1, durationSeconds: 4, assetObjectContracts: [{ name: "canonical", kind: "character" }] },
					assetObjectContracts: [{ name: "canonical", kind: "character" }],
					sequenceContext: {
						current: segment(1, "current-event"),
						previous: segment(0, "previous-event"),
						next: segment(2, "next-event"),
						sequenceControlPlan: { protocolVersion: "test", totalDurationSeconds: 16, segments: [0, 1, 2, 3].map((index) => ({ clipIndex: index })) },
						sequenceTimeline: [0, 1, 2, 3].map((index) => ({ clipIndex: index, storyEvents: [`timeline-${index}`] })),
						sequenceContextScope: {
							protocolVersion: "tapcanvas.sequence-context-scope/v1",
							currentClipIndex: 1,
							totalClipCount: 4,
							readPolicy: "read_parent_beat_sheet_for_non_adjacent_clips",
							fullSequenceRead: {
								tool: "tapcanvas_execution_node_runs_get",
								args: { path: ["beat-sheet", "0"] },
							},
						},
					},
				}],
			},
		});

		expect(prompt).toContain("current-event");
		expect(prompt).toContain("end-0");
		expect(prompt).not.toContain("timeline-3");
		expect(prompt).not.toContain("previous-event");
		expect(prompt).not.toContain("next-event");
		expect(prompt).not.toContain("duplicate-top-level");
		expect(prompt).toContain("canonical");
		expect(prompt).toContain('"fullSequenceRead"');
		expect(prompt).toContain('"read_parent_beat_sheet_for_non_adjacent_clips"');
	});

	it("projects clip-design continuity without shrinking the shared identity pool", () => {
		const registry = [{
			objectId: "char-hero",
			kind: "character",
			name: "主角",
			physicalIdentityKey: "hero-v1",
			referenceRole: "identity",
			identityInvariant: "同一角色肉身与服装锚点",
			referenceAssetIds: ["asset-hero"],
			referenceImageNodeIds: [],
			imageSource: { mode: "generate", prompt: "不得在 clip prompt 重复展开" },
		}];
		const input = {
			clipIndex: 1,
			sourceId: "source-1",
			sourceFingerprint: "fingerprint-1",
			chapterArc: { storyPromise: "promise", protagonistThroughline: "throughline", primaryPayoff: "payoff", endingHook: null },
			beat: {
				clipIndex: 1,
				durationSeconds: 8,
				sourceUnitRefs: [{ unitId: "unit-lineage-only", startOffset: 0 }],
				startKeyframe: "current-entry",
				endKeyframe: "current-exit",
				narrativeIntent: "current intent",
				causalEntry: "current cause",
				irreversibleResult: "current result",
				handoffToNext: "current handoff",
				storyEvents: [{ sourceBeatId: "event-1", event: "current event", exitState: "exit", startSeconds: 0, endSeconds: 8 }],
				dialogueScript: [],
			},
			previousBeat: {
				clipIndex: 0, durationSeconds: 8, startKeyframe: "previous-entry", endKeyframe: "previous-exit",
				storyEvents: [{ event: "previous full event ledger" }], sourceUnitRefs: [{ unitId: "previous-lineage" }],
				dialogueScript: [{ text: "previous dialogue" }], irreversibleResult: "previous result", handoffToNext: "previous handoff",
			},
			nextBeat: {
				clipIndex: 2, durationSeconds: 8, startKeyframe: "next-entry", endKeyframe: "next-exit",
				storyEvents: [{ event: "next full event ledger" }], sourceUnitRefs: [{ unitId: "next-lineage" }],
				dialogueScript: [{ text: "next dialogue" }], causalEntry: "next cause", irreversibleResult: "next result",
			},
			objectRegistry: registry,
			backgroundPlans: [{ objectId: "bg-1", displayName: "背景" }],
			speechLedger: [],
		};
		const prompt = workflowAgentPrompt({
			...request,
			outputArtifactType: "tapcanvas.clip-design/v2",
			inputs: { "clip-design-inputs": [input] },
		});

		expect(prompt).toContain("current-entry");
		expect(prompt).toContain("previous-exit");
		expect(prompt).toContain("next-entry");
		expect(prompt).toContain("同一角色肉身与服装锚点");
		expect(prompt).toContain("asset-hero");
		expect(prompt).not.toContain("unit-lineage-only");
		expect(prompt).not.toContain("previous full event ledger");
		expect(prompt).not.toContain("next full event ledger");
		expect(prompt).not.toContain("不得在 clip prompt 重复展开");
	});

	it("uses one bounded identity for the trace request and durable public turn", async () => {
		const longRequest = {
			...request,
			executionId: `execution-${"x".repeat(120)}`,
			nodeId: `agent-${"y".repeat(120)}`,
		};
		const expectedTurnId = workflowAgentPublicTurnId({
			executionId: longRequest.executionId,
			nodeId: longRequest.nodeId,
			physicalRetryOrdinal: null,
		});
		runPersistedAgentsChatTask.mockResolvedValueOnce({
			result: {
				id: expectedTurnId,
				assets: [],
				raw: {
				text: "完整产物",
				meta: {
					expectedDelivery: { active: true },
					deliveryEvidence: { items: [{ evidenceId: "e-long-id" }] },
					deliveryVerification: { status: "satisfied" },
					requestTerminal: { status: "succeeded" },
				},
				},
			},
			response: {},
		});

		await runWorkflowAgentNode({} as WorkerEnv, longRequest);

		const call = runPersistedAgentsChatTask.mock.calls.at(-1);
		expect(call).toBeDefined();
		const input = call?.[0] as {
			c: AppContext;
			rootRequestId: string;
			taskRequest: { extras?: Record<string, unknown> };
		};
		expect(expectedTurnId).toHaveLength(160);
		expect(input.c.get("requestId")).toBe(expectedTurnId);
		expect(input.taskRequest.extras?.publicTurnId).toBe(expectedTurnId);
		expect(input.taskRequest.extras?.logicalTaskId).toBe(expectedTurnId);
		expect(input.rootRequestId).toBe(expectedTurnId);
	});
});


it("retains typed knowledge candidates until the model boundary knows the effective reader capability", () => {
  const set = { protocolVersion: "workflow.knowledge-candidates/v2", candidateSetId: "set", requestHash: "request", createdAt: "2026-09-22", retrievalMode: "vector", abstained: false,
    diagnostics: { vectorCandidates: 1, indexedCards: 1, availableCards: 1, embeddingModel: "bge-m3" },
    candidates: [{ cardId: "private-card-id", sourceRoot: "scope", domain: "dialogue", facet: null, title: "PRIVATE-CANDIDATE-BODY", roleScope: [], contentSha256: "a".repeat(64), bodyBytes: 100,
      rank: 1, score: 0.1, vectorScore: 0.5, vectorRank: 1, matchedQueryIds: ["agent_query"] }] };
  const original = JSON.stringify(set);
  const prompt = workflowAgentPrompt({ ...request, inputs: { "knowledge-candidates": [set], "source": [{ text: "真实剧情必须保留" }] } });
  expect(prompt).toContain("workflow.knowledge-candidates/v2");
  expect(prompt).toContain("PRIVATE-CANDIDATE-BODY");
  expect(prompt).toContain("真实剧情必须保留");
  expect(JSON.stringify(set)).toBe(original);
});

describe("workflow Agent transient database interruption", () => {
	const publicTurnId = workflowAgentPublicTurnId({
		executionId: request.executionId,
		nodeId: request.nodeId,
		physicalRetryOrdinal: null,
	});
	const interruptedEvidence = {
		deliveryEvidence: { transportInterrupted: true, errorCode: "57P03" },
	};

	beforeEach(() => {
		vi.clearAllMocks();
		getExecutionTraceLifecycleSnapshot.mockResolvedValue(null);
	});

	it.each(["57P01", "57P02", "57P03", "08006"])(
		"treats PostgreSQL transient SQLSTATE %s as a durable-turn interruption",
		(code) => {
			expect(isRecoverableWorkflowAgentInterruption(new AppError("temporary database transport failure", {
				status: 502,
				code,
			}))).toBe(true);
		},
	);

	it("recognizes the finite PostgreSQL readiness message when bridge preserves a generic code", () => {
		expect(isRecoverableWorkflowAgentInterruption(new AppError(
			"the database system is not yet accepting connections",
			{ status: 502, code: "agents_bridge_failed" },
		))).toBe(true);
		expect(isRecoverableWorkflowAgentInterruption(new AppError(
			"database unavailable",
			{ status: 502, code: "workflow_database_error_unclassified" },
		))).toBe(false);
	});

	it("persists a transient database error as a wait on the original public turn", async () => {
		runPersistedAgentsChatTask.mockRejectedValueOnce(new AppError(
			"the database system is not yet accepting connections",
			{ status: 502, code: "agents_bridge_failed" },
		));

		const result = await runWorkflowAgentNode({} as WorkerEnv, request);

		expect(result).toMatchObject({
			taskId: publicTurnId,
			deliveryEvidence: {
				transportInterrupted: true,
				errorCode: "57P03",
				logicalTaskId: publicTurnId,
				sessionKey: "workflow:execution-1:agent-1",
				retryableByDurableWorkflow: true,
			},
			requestTerminal: { status: "suspended", reason: "workflow_agent_transport_recovery_pending" },
		});
		expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
		expect(getAgentsChatTurnStatus).not.toHaveBeenCalled();
	});

	it("keeps an active accepted turn in reconciliation without a second model or tool run", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: true,
			turn: {
				turnId: publicTurnId,
				internalTurnId: "turn-active",
				state: "running",
				phase: "agent_running",
				startedAt: recentIso(),
				updatedAt: recentIso(),
				lastConfirmedAt: recentIso(),
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: interruptedEvidence,
		});

		expect(result).toMatchObject({
			taskId: publicTurnId,
			requestTerminal: { status: "suspended", reason: "workflow_agent_turn_still_running" },
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});

	it("returns the accepted turn's durable completion instead of dispatching again", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: publicTurnId,
				internalTurnId: "turn-complete",
				state: "succeeded",
				phase: "succeeded",
				startedAt: recentIso(),
				updatedAt: recentIso(),
				lastConfirmedAt: recentIso(),
				requestText: "",
				reasonCode: null,
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "done",
				finalResponse: "durable result",
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: interruptedEvidence,
		});

		expect(result).toMatchObject({
			taskId: publicTurnId,
			text: "durable result",
			requestTerminal: { status: "succeeded", reason: "agents_cli_durable_turn_succeeded" },
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("resumes a persisted interrupted checkpoint on the exact same turn", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: publicTurnId,
				internalTurnId: "turn-interrupted",
				state: "suspended",
				phase: "suspended",
				startedAt: recentIso(),
				updatedAt: recentIso(),
				lastConfirmedAt: recentIso(),
				requestText: "",
				reasonCode: "57P03",
				suspension: null,
				recoveryCheckpoint: {
					reasonCode: "57P03",
					physicalRunId: "physical-interrupted",
					progressRevision: 1,
					durableTaskReferences: [],
					durableProgressClaims: [],
				},
				lastConfirmedSummary: "database interruption",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});
		resumePersistedAgentsChatTurn.mockResolvedValueOnce({ resumed: true });

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: interruptedEvidence,
		});

		expect(result).toMatchObject({
			taskId: publicTurnId,
			requestTerminal: { status: "suspended", reason: "workflow_agent_same_task_continuation_scheduled" },
		});
		expect(resumePersistedAgentsChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			sessionKey: "workflow:execution-1:agent-1",
			turnId: publicTurnId,
		}));
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
	});

	it("waits through the accepted-to-active projection gap before any retry", async () => {
		getAgentsChatTurnStatus.mockResolvedValueOnce({
			sessionId: "workflow:execution-1:agent-1",
			durable: true,
			activeTurn: false,
			turn: {
				turnId: publicTurnId,
				internalTurnId: "turn-accepted",
				state: "unknown",
				phase: "agent_running",
				startedAt: recentIso(),
				updatedAt: recentIso(),
				lastConfirmedAt: recentIso(),
				requestText: "",
				reasonCode: "57P03",
				suspension: null,
				recoveryCheckpoint: null,
				lastConfirmedSummary: "accepted turn projection is pending",
				finalResponse: null,
				pendingUserInput: null,
				pendingQueueCount: 0,
				recentEvents: [],
			},
		});

		const result = await runWorkflowAgentNode({} as WorkerEnv, {
			...request,
			resumeOnly: true,
			previousEvidence: interruptedEvidence,
		});

		expect(result).toMatchObject({
			taskId: publicTurnId,
			requestTerminal: { status: "suspended", reason: "workflow_agent_accepted_turn_activation_pending" },
		});
		expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
		expect(resumePersistedAgentsChatTurn).not.toHaveBeenCalled();
	});
});

describe("thrown typed-output failure retains the same durable candidate", () => {
 const typed = { ...request, outputEncoding: "json_artifact" as const, failurePolicy: "single_submission" as const };
 const taskId = workflowAgentPublicTurnId({ executionId: request.executionId, nodeId: request.nodeId, physicalRetryOrdinal: null });
 const sourceContext = JSON.stringify({ inputs: request.inputs, userIntentContract: null, projectContext: null });
 const repair = { version: 1, candidate: '{"artifactType":"tapcanvas.text/v1","text":"raw"}\n{"extra":true}',
  correction: "json_output_multiple_top_level_values", sourceContext, contractHash: authorSourceJsonHash(workflowAgentStructuredOutput(typed)!.outputContract) };
 const snapshot = (draft: Record<string, unknown> | null = repair) => ({ sessionId: taskId, durable: true, activeTurn: false,
  structuredOutputRepair: draft, turn: { turnId: taskId, internalTurnId: "real-failed-turn", state: "failed", phase: "failed",
   startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastConfirmedAt: new Date().toISOString(), requestText: "",
   reasonCode: "structured_output_invalid", suspension: null, finalResponse: null, lastConfirmedSummary: "schema rejected", pendingUserInput: null,
   pendingQueueCount: 0, recentEvents: [], recoveryCheckpoint: { reasonCode: "structured_output_invalid", physicalRunId: taskId,
    progressRevision: 1, durableTaskReferences: [], durableProgressClaims: [], userIntentContract: null } } });
 beforeEach(() => {
  runPersistedAgentsChatTask.mockReset(); getAgentsChatTurnStatus.mockReset(); resumePersistedAgentsChatTurn.mockReset();
  cancelWorkflowAgentTurns.mockReset().mockResolvedValue([{ status: "already_inactive", receipt: {}, errorCode: null }]);
  getExecutionTraceLifecycleSnapshot.mockReset().mockResolvedValue(null);
 });
 it("reads exact typed failure checkpoint and delivers its raw draft/correction to the next fenced physical attempt", async () => {
  runPersistedAgentsChatTask.mockRejectedValueOnce(Object.assign(new Error(repair.correction), { code: "structured_output_invalid" }));
  getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot());
  const result = await runWorkflowAgentNode({} as WorkerEnv, typed);
  expect(result).toMatchObject({ text: repair.candidate, requestTerminal: { status: "suspended" }, deliveryEvidence: {
   physicalRetryOrdinal: 1, physicalFailureReason: "structured_output_invalid", structuredOutputRepair: repair,
   structuredFailureObservation: { candidateAvailability: "retained_checkpoint" } } });
  expect(getAgentsChatTurnStatus).toHaveBeenCalledWith(expect.anything(), request.ownerId, taskId, expect.objectContaining({ includeStructuredOutputRepair: true }));
  expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
  runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "fixed", assets: [], raw: { text: '{"artifactType":"tapcanvas.text/v1","text":"fixed"}',
   meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
  await runWorkflowAgentNode({} as WorkerEnv, { ...typed, resumeOnly: true, previousEvidence: { deliveryEvidence: result.deliveryEvidence } });
  expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(1);
  expect(runPersistedAgentsChatTask.mock.calls[1]![0].taskRequest.extras).toMatchObject({ modelKey: request.modelKey, sessionKey: taskId,
   structuredOutputRepair: repair, continuationExecutionContract: { structuredOutputRepair: repair } });
 });
 it("preserves the original source bytes through recovery after storage reorders nested object keys", async () => {
  const originalInputs = { source: [{ identity: { sourceId: "source-1", revision: 1 }, content: "original source" }] };
  const persistedInputs = { source: [{ content: "original source", identity: { revision: 1, sourceId: "source-1" } }] };
  const originalSource = JSON.stringify({ inputs: originalInputs, userIntentContract: null, projectContext: null });
  const retained = { ...repair, sourceContext: originalSource, progress: { candidateSha256: "retained-draft" } };
  runPersistedAgentsChatTask.mockRejectedValueOnce(Object.assign(new Error(repair.correction), { code: "structured_output_invalid" }));
  getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot(retained));
  const result = await runWorkflowAgentNode({} as WorkerEnv, { ...typed, inputs: persistedInputs });
  expect(result.deliveryEvidence).toMatchObject({ structuredOutputRepair: retained });
  runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "fixed", assets: [], raw: {
   text: '{"artifactType":"tapcanvas.text/v1","text":"fixed"}', meta: { requestTerminal: { status: "succeeded" } }
  } }, response: {} });
  await runWorkflowAgentNode({} as WorkerEnv, {
   ...typed, inputs: persistedInputs, resumeOnly: true, previousEvidence: { deliveryEvidence: result.deliveryEvidence }
  });
  expect(runPersistedAgentsChatTask.mock.calls[1]![0].taskRequest.extras).toMatchObject({
   structuredOutputSourceContext: originalSource, structuredOutputRepair: retained,
   continuationExecutionContract: { structuredOutputSourceContext: originalSource, structuredOutputRepair: retained }
  });
  expect(cancelWorkflowAgentTurns).toHaveBeenCalledTimes(1);
 });
 it("keeps legacy candidate absence explicit instead of claiming draft reuse", async () => {
  runPersistedAgentsChatTask.mockRejectedValueOnce(Object.assign(new Error(repair.correction), { code: "structured_output_invalid" }));
  getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot(null));
  const result = await runWorkflowAgentNode({} as WorkerEnv, typed);
  expect(result).toMatchObject({ requestTerminal: { status: "suspended" }, deliveryEvidence: { structuredFailureObservation: { candidateAvailability: "unavailable" } } });
  expect((result.deliveryEvidence as Record<string, unknown>).structuredOutputRepair).toBeUndefined();
  expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
 });
 it("does not transfer a candidate whose frozen source differs", async () => {
  runPersistedAgentsChatTask.mockRejectedValueOnce(Object.assign(new Error(repair.correction), { code: "structured_output_invalid" }));
  getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot({ ...repair, sourceContext: "other source" }));
  await expect(runWorkflowAgentNode({} as WorkerEnv, typed)).rejects.toThrow("workflow_agent_repair_source_mismatch");
  expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1); expect(cancelWorkflowAgentTurns).not.toHaveBeenCalled();
 });
 it("logs a source mismatch during initial recovery without dispatching another author", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
   getAgentsChatTurnStatus.mockResolvedValueOnce(snapshot({ ...repair, sourceContext: "different frozen source" }));
   await expect(runWorkflowAgentNode({} as WorkerEnv, { ...typed, initialRecovery: {
    version: 1, sourceExecutionId: "source-execution", sourceNodeRunId: "source-node-run",
    nodeId: typed.nodeId, reason: "structured_failure_without_turn_receipt"
   } })).rejects.toThrow("workflow_agent_repair_source_mismatch");
   expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"source_json_invalid"'));
   expect(warning).toHaveBeenCalledWith(expect.stringContaining('"executionId":"execution-1"'));
   expect(warning.mock.calls.flat().join(" ")).not.toContain("different frozen source");
   expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
  } finally { warning.mockRestore(); }
 });
 it("records typed failure while waiting for a failed durable status transport", async () => {
  runPersistedAgentsChatTask.mockRejectedValueOnce(Object.assign(new Error(repair.correction), { code: "structured_output_invalid" }));
  getAgentsChatTurnStatus.mockRejectedValueOnce(new AppError("status transport unavailable", { status: 503, code: "agents_chat_runtime_timeout" }));
  await expect(runWorkflowAgentNode({} as WorkerEnv, typed)).resolves.toMatchObject({ requestTerminal: { status: "suspended" },
   deliveryEvidence: { structuredFailureObservation: { code: "structured_output_invalid", candidateAvailability: "observation_failed" } } });
  expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
 });
});

describe("bound source author initial recovery admission", () => {
 const initialRecovery = { version: 1 as const, sourceExecutionId: "failed-source", sourceNodeRunId: "real-source-run", nodeId: request.nodeId, reason: "structured_failure_without_turn_receipt" as const };
 beforeEach(() => { runPersistedAgentsChatTask.mockReset(); getAgentsChatTurnStatus.mockReset(); getExecutionTraceLifecycleSnapshot.mockReset(); });
 it("starts only after exact current turn and immutable admission are both absent", async () => {
  getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", durable: true, activeTurn: false, turn: null });
  getExecutionTraceLifecycleSnapshot.mockResolvedValueOnce(null);
  runPersistedAgentsChatTask.mockResolvedValueOnce({ result: { id: "new-author", assets: [], raw: { text: "actual author result", meta: { requestTerminal: { status: "succeeded" } } } }, response: {} });
  await runWorkflowAgentNode({} as WorkerEnv, { ...request, initialRecovery });
  expect(runPersistedAgentsChatTask).toHaveBeenCalledTimes(1);
  expect(getExecutionTraceLifecycleSnapshot).toHaveBeenCalledWith(undefined, { traceId: "workflow:execution-1:agent-1", userId: request.ownerId });
 });
 it("reconciles an already admitted projection gap without submitting a duplicate", async () => {
  getAgentsChatTurnStatus.mockResolvedValueOnce({ sessionId: "workflow:execution-1:agent-1", durable: true, activeTurn: false, turn: null });
  getExecutionTraceLifecycleSnapshot.mockResolvedValue({ status: "running", logicalTaskId: "workflow:execution-1:agent-1", rootTraceId: "workflow:execution-1:agent-1", updatedAt: new Date().toISOString(), startedAt: new Date().toISOString() });
  const result = await runWorkflowAgentNode({} as WorkerEnv, { ...request, initialRecovery });
  expect(result.requestTerminal).toMatchObject({ status: "suspended" });
  expect(runPersistedAgentsChatTask).not.toHaveBeenCalled();
 });
});
