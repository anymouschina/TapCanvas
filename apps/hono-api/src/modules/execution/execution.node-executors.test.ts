import { enrichVideoClipContextWithMaterializedAssets } from "./execution.video-workflow-contract";
import { prepareChapterAssetCollection, bindMaterializedAssetConsumers } from "./execution.chapter-asset-preparation";
import { assetBindingIdentity } from "./execution.asset-identity";
import type { WorkflowAgentRunRequest } from "./execution.node-executors";
import { stagedAuthoringFixture } from "./test-fixtures/video-authoring-stages";
import { sceneReferenceFixture } from "./execution.scene-reference-fixture";
import { ExternalDependencyError } from "../../platform/external-dependency-error";
import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection, isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import {
	BEAT_SHEET_TAKE_EXECUTOR_REF,
	executeRegisteredWorkflowNode,
	validateWorkflowBeatSheetProjectAssetBindings,
	workflowImageAssetMetadata,
} from "./execution.node-executors";
import {
	createWorkflowAcceptedTurnSource,
	WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
} from "./execution.workflow-source-authority";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";
import type { WorkflowNodeSnapshot } from "./execution.node-runtime";
import { sha256Hex } from "../asset/book-content-hash";
import { freezeWorkflowUserIntent } from "./execution.workflow-user-intent";
import { workflowIntentFixture } from "./test-fixtures/workflow-user-intent";

const runVideo = vi.fn();

function selectedAssetProjectContext(selectedAssetIds: readonly string[]) {
	return {
		version: 3 as const,
		projectId: "project-1",
		canvasId: "chapter-1",
		sourceNodeId: "source-1",
		selectedAssetIds,
		projectAssetIds: selectedAssetIds,
		timeline: { clips: [] },
		selection: { nodeIds: [], assetIds: selectedAssetIds, activeNodeId: null, groupId: null },
		permissions: {
			principalId: "user-1",
			projectRead: true as const,
			canvasRead: true as const,
			assetRead: true as const,
			assetWrite: true,
		},
		assetSnapshot: selectedAssetIds.map((assetId) => ({
			assetId,
			assetVersion: 1,
			assetVersionId: `${assetId}:v1`,
			contentFingerprint: `${assetId}:fingerprint`,
			projectId: "project-1",
			name: assetId,
			canonicalName: assetId,
			kind: "text",
			referenceType: null,
			approvalStatus: null,
			origin: "material" as const,
			flowId: null,
			nodeId: null,
			mediaKind: "image" as const,
			state: "ready" as const,
			assetUsage: null,
			assetPurpose: null,
			productionEligible: true,
			productionExclusionReason: null,
			styleFingerprint: null,
			sourceFacts: {
				referenceType: null,
				roleName: null,
				physicalIdentityKey: null,
				characterAssetRole: null,
				characterProfileVersion: null,
				identityAnchors: [],
				prohibitedDrift: [],
				sourceNodeId: null,
				workflowExecutionId: null,
				taskId: null,
				prompt: null,
			},
			updatedAt: "2026-08-29T00:00:00.000Z",
		})),
		capturedAt: "2026-08-29T00:00:00.000Z",
	};
}

describe("workflow BeatSheet project asset bindings", () => {
	it("rejects an omitted explicit asset before image fan-out", () => {
		const error = validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({
				beats: [{
					assetObjectContracts: [{
						kind: "character",
						name: "刘秀",
						physicalIdentityKey: "liu-xiu-body",
						referenceAssetIds: ["asset-liu-xiu"],
					}],
				}],
			}),
			projectContext: selectedAssetProjectContext(["asset-liu-xiu", "asset-qin-er-niu"]),
		});
		expect(error).toContain('missing ID');
		expect(error).toContain('asset-qin-er-niu');
	});

	it("accepts exact selected IDs repeated only for their stable object role", () => {
		const projectContext = selectedAssetProjectContext(["asset-liu-xiu", "asset-qin-jia"]);
		const error = validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({
				beats: [0, 1].map(() => ({
					assetObjectContracts: [{
						kind: "character",
						name: "刘秀",
						physicalIdentityKey: "liu-xiu-body",
						referenceAssetIds: ["asset-liu-xiu"],
					}, {
						kind: "scene",
						name: "秦家",
						referenceAssetIds: ["asset-qin-jia"],
					}],
				})),
			}),
			projectContext,
		});
		expect(error).toBeNull();
	});

	it("accepts four current-canvas node references for one object and rejects cross-canvas handles", () => {
		const base = selectedAssetProjectContext(["a", "b", "c", "d"]);
		const projectContext = { ...base, assetSnapshot: base.assetSnapshot.map((asset) => ({
			...asset, flowId: base.canvasId, nodeId: `node-${asset.assetId}`,
		})) };
		const beatSheetText = JSON.stringify({ beats: [{ assetObjectContracts: [{ kind: "prop", name: "产品",
			referenceImageNodeIds: ["node-a", "node-b", "node-c", "node-d"], referenceAssetIds: ["a"],
		}] }] });
		expect(validateWorkflowBeatSheetProjectAssetBindings({ beatSheetText, projectContext })).toBeNull();
		expect(validateWorkflowBeatSheetProjectAssetBindings({ beatSheetText, projectContext: {
			...projectContext, canvasId: "another-canvas",
		} })).toContain("requires exactly one ready image");
	});

	it("keeps multi-view and distinct-object selections separate, and supplies exact handles for isolated repair", () => {
		const base = selectedAssetProjectContext(["product-front", "product-back", "host"]);
		const projectContext = { ...base, assetSnapshot: base.assetSnapshot.map((asset) => ({
			...asset, flowId: base.canvasId, nodeId: `node-${asset.assetId}`,
		})) };
		const contracts = [{ kind: "prop", name: "商品", referenceAssetIds: ["product-front", "product-back"] },
			{ kind: "character", name: "主播", physicalIdentityKey: "host-body", referenceAssetIds: ["host"] }];
		const validate = (assetObjectContracts: typeof contracts) => validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({ beats: [{ assetObjectContracts }] }), projectContext,
		});
		expect(validate(contracts)).toBeNull();
		const missing = validate([contracts[0]!]);
		expect(missing).toContain('"host"');
		expect(missing).toContain("root objectRegistry[].referenceAssetIds");
		expect(missing).toContain("Do not write beats[].assetObjectContracts");
		expect(missing).toContain('"assetId":"host","nodeId":"node-host"');
		const error = validate([{ ...contracts[0]!, referenceAssetIds: ["invented-id"] }, contracts[1]!]);
		expect(error).toContain("outside the frozen ready production image set");
		expect(error).toContain('"assetId":"product-front","nodeId":"node-product-front"');
		expect(error).toContain('preserve selectedAssetIds=["product-front","product-back","host"]');
	});

	it("rejects unauthorized project assets and cross-role identity drift", () => {
		const projectContext = selectedAssetProjectContext(["asset-liu-xiu"]);
		expect(validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({ beats: [{ assetObjectContracts: [{ kind: "scene", name: "秦家", referenceAssetIds: ["old-qin-jia"] }] }] }),
			projectContext,
		})).toContain("outside the frozen ready production image set");
		expect(validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({
				beats: [{ assetObjectContracts: [{ kind: "character", name: "刘秀", physicalIdentityKey: "liu-xiu-body", referenceAssetIds: ["asset-liu-xiu"] }] },
					{ assetObjectContracts: [{ kind: "character", name: "秦二牛", physicalIdentityKey: "qin-er-niu-body", referenceAssetIds: ["asset-liu-xiu"] }] }],
			}),
			projectContext,
		})).toContain("conflicting roles");
	});

	it("allows the Agent to bind a ready non-selected project asset by exact ID", () => {
		const selectedOnly = selectedAssetProjectContext(["asset-user-selected"]);
		const reusableAlias = {
			...selectedOnly.assetSnapshot[0],
			assetId: "asset-liu-xiu-chapter-1",
			assetVersionId: "asset-liu-xiu-chapter-1:v1",
			contentFingerprint: "asset-liu-xiu-chapter-1:fingerprint",
			name: "刘秀角色卡",
			canonicalName: "human-liu-xiu",
			kind: "character",
			referenceType: "character",
			sourceFacts: {
				...selectedOnly.assetSnapshot[0]!.sourceFacts,
				referenceType: "character",
				roleName: "刘秀",
				physicalIdentityKey: "body-liu-xiu",
			},
		};
		const projectContext = {
			...selectedOnly,
			selectedAssetIds: [],
			projectAssetIds: [reusableAlias.assetId],
			selection: { ...selectedOnly.selection, assetIds: [] },
			assetSnapshot: [reusableAlias],
		};
		expect(validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({
				beats: [{
					assetObjectContracts: [{
						kind: "character",
						name: "汉光武帝",
						physicalIdentityKey: "body-liu-xiu",
						referenceAssetIds: [reusableAlias.assetId],
					}],
				}],
			}),
			projectContext,
		})).toBeNull();
	});

	it("allows an exact prior-chapter scene asset across scene-name aliases", () => {
		const selectedOnly = selectedAssetProjectContext(["asset-user-selected"]);
		const reusableScene = {
			...selectedOnly.assetSnapshot[0],
			assetId: "asset-qin-home-chapter-1",
			assetVersionId: "asset-qin-home-chapter-1:v1",
			contentFingerprint: "asset-qin-home-chapter-1:fingerprint",
			name: "秦家院落场景卡",
			canonicalName: "qin-family-courtyard",
			kind: "scene",
			referenceType: "scene",
			sourceFacts: {
				...selectedOnly.assetSnapshot[0]!.sourceFacts,
				referenceType: "scene",
				roleName: "秦家院落",
			},
		};
		const projectContext = {
			...selectedOnly,
			selectedAssetIds: [],
			projectAssetIds: [reusableScene.assetId],
			selection: { ...selectedOnly.selection, assetIds: [] },
			assetSnapshot: [reusableScene],
		};
		expect(validateWorkflowBeatSheetProjectAssetBindings({
			beatSheetText: JSON.stringify({
				beats: [{
					assetObjectContracts: [{
						kind: "scene",
						name: "刘秀寄居的秦家旧院",
						referenceAssetIds: [reusableScene.assetId],
					}],
				}],
			}),
			projectContext,
		})).toBeNull();
	});
});

describe("workflow image asset identity metadata", () => {
	it("persists canonical object identity for scene and character generations", () => {
		expect(workflowImageAssetMetadata({
			role: "scene://五指巷小义庄",
			sceneCard: sceneReferenceFixture,
			prompt: sceneReferenceFixture.spacePrompt,
			negativePrompt: sceneReferenceFixture.negativePrompt,
			identityAnchors: ["固定入口"],
			prohibitedDrift: ["入口不变"],
			displayName: "五指巷小义庄",
		})).toEqual({
			referenceType: "scene",
			canonicalName: "五指巷小义庄",
			displayName: "五指巷小义庄",
			sceneName: "五指巷小义庄",
			sceneAssetRole: sceneReferenceFixture.sceneAssetRole,
			sceneProfileVersion: sceneReferenceFixture.sceneProfileVersion,
			sceneOccupancy: sceneReferenceFixture.sceneOccupancy,
			sceneLightingSpec: sceneReferenceFixture.sceneLightingSpec,
			sceneAnchors: ["固定入口"],
			prohibitedSceneDrift: ["入口不变"],
		});
		expect(workflowImageAssetMetadata({
			role: "character://body-liu-xiu-001",
			displayName: "刘秀",
			referenceType: "character",
			roleName: "body-liu-xiu-001",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityBoardSpec: {
				layout: "identity_board_four_view",
				faceViews: ["front", "profile"],
				fullBodyViews: ["front", "back"],
				crossViewConsistency: true,
				referenceRoleIsolation: true,
				neutralReferenceBackground: true,
				readableTextVisible: true,
				brandingVisible: false,
				neutralBaseState: true,
				canonicalNameVisible: false,
				ipSafeOriginal: true,
			},
			identityAnchors: ["固定骨相"],
			prohibitedDrift: ["不得换脸"],
		})).toEqual(expect.objectContaining({
			referenceType: "character",
			canonicalName: "body-liu-xiu-001",
			displayName: "刘秀",
			physicalIdentityKey: "body-liu-xiu-001",
			identityBoardSpec: {
				layout: "identity_board_four_view",
				faceViews: ["front", "profile"],
				fullBodyViews: ["front", "back"],
				crossViewConsistency: true,
				referenceRoleIsolation: true,
				neutralReferenceBackground: true,
				readableTextVisible: true,
				brandingVisible: false,
				neutralBaseState: true,
				canonicalNameVisible: false,
				ipSafeOriginal: true,
			},
		}));
	});

	it("rejects an incomplete identity board instead of silently inventing views", () => {
		expect(() => workflowImageAssetMetadata({
			role: "character://hero",
			displayName: "Hero",
			referenceType: "character",
			roleName: "hero",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityBoardSpec: { layout: "identity_board_four_view" },
			identityAnchors: ["固定骨相"],
			prohibitedDrift: ["不得换脸"],
		})).toThrow("faceViews");
	});
});

function node(
	id: string,
	executorRef: string,
	data: Record<string, unknown> = {},
	executionMode: "once" | "each" | "collect" = "once",
	outputPorts: readonly string[] = [],
	itemConcurrency?: number,
	inputPorts: readonly string[] = [],
): WorkflowNodeSnapshot {
	return {
		id,
		type: "taskNode",
		kind: executorRef === "workflow.trigger/v1" ? "workflowTrigger" : "workflowStage",
		data: {
			...(executorRef === "tapcanvas.video.generate/v1" ? { workflowVideoReferencePolicy: "forbidden" } : {}),
			...(executorRef === "agents.logical-task/v2"
				? { workflowAgentOutputEncoding: "plain_text", workflowAgentMaxOutputTokens: 4096 }
				: {}),
			...data,
			workflowAtomicSpec: {
				version: 1,
				category: "agent",
				operation: "test",
				executorRef,
				executionMode,
				...(itemConcurrency === undefined ? {} : { itemConcurrency }),
				inputPorts,
				outputPorts,
			},
		},
	};
}

function context(input: {
	node: WorkflowNodeSnapshot;
	inputs?: Record<string, readonly unknown[]>;
	inputProvenance?: readonly Readonly<{
		sourceNodeId: string;
		sourceNodeRunId: string;
		sourcePortId: string;
		targetPortId: string;
		artifacts: readonly Readonly<{ type: string; identity: string | null }>[];
	}>[];
	checkpointOutputRefs?: (outputRefs: WorkflowNodeOutputV1) => Promise<void>;
	flowVersionData?: unknown;
}) {
	return {
		executionId: "execution-1",
		executionFamilyId: "execution-family-1",
		ownerId: "user-1",
		flowId: "flow-1",
		flowVersionId: "flow-version-parent",
		projectId: "project-1",
		workflowKey: "agent-workflow/v1",
		...(input.flowVersionData === undefined ? {} : { flowVersionData: input.flowVersionData }),
		node: input.node,
		inputs: input.inputs ?? {},
		inputProvenance: input.inputProvenance ?? [],
		...(input.checkpointOutputRefs ? { checkpointOutputRefs: input.checkpointOutputRefs } : {}),
	};
}

describe("workflow read-only contract recovery", () => {
	it("waits through a catalog fault and resumes the same estimate without invoking media or authors", async () => {
		const runVideoEstimate = vi.fn()
			.mockRejectedValueOnce(new ExternalDependencyError({ kind: "model_catalog", identity: "video-model", field: "maxReferenceImages", code: "missing_reference_limit", observed: null }))
			.mockRejectedValueOnce(new ExternalDependencyError({ kind: "model_catalog", identity: "video-model", field: "maxReferenceImages", code: "missing_reference_limit", observed: null }))
			.mockResolvedValueOnce({ estimateIdentity: "execution-1:estimate", modelKey: "video-model", resolution: "720p", aspectRatio: "16:9", estimatedCredits: 4, perClip: [] });
		const runAgent = vi.fn();
		const generate = vi.fn();
		const dependencies = { runAgent, runJavascript: vi.fn(), runVideo: generate, runVideoEstimate };
		const input = context({ node: node("estimate", "video.estimate/v1", {
			workflowVideoModelKey: "video-model", workflowVideoResolution: "720p", workflowVideoAspectRatio: "16:9",
		}, "collect", ["estimate"], undefined, ["prompt-package"]), inputs: {
			"prompt-package": [{ clips: [{ itemId: "clip-1", durationSeconds: 15 }] }],
		} });
		const waiting = await executeRegisteredWorkflowNode(input, dependencies);
		expect(waiting).toMatchObject({ ok: false, waitingExternal: true });
		if (waiting.ok || !waiting.waitingExternal) throw new Error("Expected external wait");
		const resumed = await executeRegisteredWorkflowNode({ ...input,
			resumeOutputRefs: JSON.parse(JSON.stringify(waiting.outputRefs)) as WorkflowNodeOutputV1,
		}, dependencies);
		expect(resumed).toMatchObject({ ok: true, outputRefs: { evidence: { executorCompleted: true } } });
		expect(runVideoEstimate).toHaveBeenCalledTimes(3);
		expect(runVideoEstimate.mock.calls[0]).toEqual(runVideoEstimate.mock.calls[1]);
		expect(runVideoEstimate.mock.calls[1]).toEqual(runVideoEstimate.mock.calls[2]);
		expect(runAgent).not.toHaveBeenCalled();
		expect(generate).not.toHaveBeenCalled();
	});
	it("does not turn arbitrary errors or matching error text into retry authorization", async () => {
		const result = await executeRegisteredWorkflowNode(context({ node: node("estimate", "video.estimate/v1", {
			workflowVideoModelKey: "video-model", workflowVideoResolution: "720p", workflowVideoAspectRatio: "16:9",
		}, "collect", ["estimate"], undefined, ["prompt-package"]), inputs: { "prompt-package": [{ clips: [] }] } }), {
			runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn(),
			runVideoEstimate: vi.fn().mockRejectedValue(new Error("video_model_reference_image_policy_missing:video-model")),
		});
		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		expect(result).not.toHaveProperty("waitingExternal", true);
	});
});

function frozenTemporalFrameTrack(
	durationSeconds: number,
	entryState: string,
	exitState: string,
) {
	return Array.from({ length: Math.ceil(durationSeconds) }, (_, windowIndex) => {
		const startSeconds = windowIndex;
		const endSeconds = Math.min(windowIndex + 1, durationSeconds);
		return {
			windowIndex,
			startSeconds,
			endSeconds,
			startState: windowIndex === 0 ? entryState : `连续状态-${windowIndex}`,
			startFrame: `${startSeconds}s 起帧`,
			transition: `${startSeconds}-${endSeconds}s 可见过渡`,
			carryFrame: `${endSeconds}s 承帧`,
			carryState: windowIndex === Math.ceil(durationSeconds) - 1 ? exitState : `连续状态-${windowIndex + 1}`,
			storyEventIndices: [0],
		};
	});
}

function frozenTemporalFrameCoverage(durationSeconds: number) {
	return Array.from({ length: Math.ceil(durationSeconds) }, (_, windowIndex) => ({
		windowIndex,
		shotNos: [1],
	}));
}

function frozenSingleClipContext(input: Readonly<{
	executionScope?: "prompt_only" | "media_delivery";
	clipId?: string;
	clipIndex?: number;
	durationSeconds?: number;
	characters?: readonly string[];
	exitState?: string;
	assetPlans?: readonly Record<string, unknown>[];
	assetObjectContracts?: readonly Record<string, unknown>[];
}> = {}) {
	const clipId = input.clipId ?? "clip-001";
	const clipIndex = input.clipIndex ?? 0;
	const durationSeconds = input.durationSeconds ?? 10;
	const characters = input.characters ?? ["主角"];
	const exitState = input.exitState ?? "主角停在门前";
	const entryState = "双方进入同一交锋空间";
	return {
		...(input.executionScope ? { executionScope: input.executionScope } : {}),
		clipIndex,
		beat: {
			clipId,
			clipIndex,
			durationSeconds,
			characters,
			exitState,
			storyEvents: [{
				sourceBeatId: "source-0",
				startSeconds: 0,
				endSeconds: durationSeconds,
				event: "双方完成一次连续动作",
				entryState,
				exitState,
			}],
			temporalFrameTrack: frozenTemporalFrameTrack(durationSeconds, entryState, exitState),
		},
		assetObjectContracts: input.assetObjectContracts ?? [
			frozenWriterObjectContract({ kind: "character", name: "主角", referenceRole: "none" }),
		],
		...(input.assetPlans ? { assetPlans: input.assetPlans } : {}),
	};
}

function frozenWriterObjectContract(input: Readonly<{
	assetId?: string;
	kind: "character" | "scene" | "prop";
	name: string;
	referenceRole: "identity" | "environment" | "none" | "prop";
}>): Record<string, unknown> {
	const state = `${input.kind}:${input.name}:state`;
	return {
		...(input.assetId ? { assetId: input.assetId } : {}),
		kind: input.kind,
		name: input.name,
		...(input.kind === "character" ? { physicalIdentityKey: input.name } : {}),
		referenceImageNodeIds: [],
		referenceRole: input.referenceRole,
		identityInvariant: `${input.kind}:${input.name}:identity`,
		startState: state,
		spatialRelation: "位于同一连续空间",
		driver: "承接冻结事件",
		stateChange: "发生一次可见变化",
		endState: state,
	};
}

function frozenAssetBeatSheet(
	clipId = "clip-a",
	roles: readonly Readonly<{
		kind: "character" | "scene";
		name: string;
		referenceRole: "identity" | "environment" | "none";
	}>[] = [
		{ kind: "character", name: "hero", referenceRole: "identity" },
		{ kind: "scene", name: "测试场景", referenceRole: "environment" },
	],
) {
	return {
		text: JSON.stringify({
			beats: [{
				clipId,
				clipIndex: 0,
				characters: roles.filter((role) => role.kind === "character").map((role) => role.name),
				assetObjectContracts: roles.map(frozenWriterObjectContract),
			}],
		}),
	};
}

describe("workflow node executor registry", () => {
	it("polls a no-progress Agent suspension on its durable retry timer", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			assets: [],
			expectedDelivery: { artifactType: "tapcanvas.text/v1" },
			 deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "workflow_agent_no_progress_window_exhausted",
				noProgressRecoveryMode: "signal_only",
				retryNotBeforeAt: "2026-08-23T00:01:00.000Z",
			},
			deliveryVerification: null,
			requestTerminal: {
				status: "suspended",
				reason: "workflow_agent_no_progress_recovery_deferred",
			},
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent-1", "agents.logical-task/v2", {
				workflowInstruction: "生成文本",
				workflowAgentOutputArtifactType: "tapcanvas.text/v1",
				workflowAgentDeliveryRequirement: "交付文本",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), {
			runAgent,
			runJavascript: vi.fn(),
			runVideo,
		});
		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			externalCheck: { version: 1, mode: "poll", notBeforeAt: "2026-08-23T00:01:00.000Z" },
		});
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("treats an explicitly cleared workflow trigger payload as a fresh manual trigger", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("manual-trigger", "workflow.trigger/v1", { workflowTriggerPayload: null }, "once", ["trigger"]),
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					trigger: {
						executionId: "execution-1",
						triggerNodeId: "manual-trigger",
					},
				},
			},
		});
	});

	it("uses the admission-frozen semantic duration window without imposing clip topology", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("delivery-contract", "agents.delivery.contract/v2", {
				workflowExecutionScope: "media_delivery",
			}, "once", ["delivery-contract"], undefined, ["canvas-facts"]),
			inputs: {
				"canvas-facts": [{
					sourceMode: "inline_text",
					text: "五个剧情变化，但物理视频拓扑由工作流所有",
					callConfig: {
						targetDurationSeconds: 40,
						videoModelKey: "doubao-seedance-2.5",
						workflowVideoDurationPlan: {
							protocolVersion: "tapcanvas.workflow-video-duration-plan/v2",
							targetDurationSeconds: 40,
							modelKey: "doubao-seedance-2.5",
							durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
							maxDurationSeconds: 30,
							policy: "agent_semantic_duration_budget",
						},
					},
				}],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"delivery-contract": {
						targetDurationSeconds: 40,
						generationContract: {
							clipPlanningPolicy: "agent_semantic_duration_budget",
							durationOptions: expect.any(Array),
						},
					},
				},
			},
		});
	});

	it("preserves chapter source identity and content when attaching an expansion draft", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("delivery-contract", "agents.delivery.contract/v2", {
				workflowExecutionScope: "media_delivery",
				workflowVideoModelKey: "doubao-seedance-2.5",
			}, "once", ["delivery-contract"], undefined, ["canvas-facts", "expanded-source"]),
			inputs: {
				"canvas-facts": [{
					sourceMode: "project_context",
					authoritativeSources: [{
						sourceId: "source-node-1",
						content: "原始短文本",
						sourceFingerprint: "stale",
					}],
				}],
				"expanded-source": [{ text: "同一人物完成了一条可拍的连续行动链。" }],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			resolveVideoDurationOptions: vi.fn(async () => [5, 10]),
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"delivery-contract": {
						canvasFacts: {
							sourceProcessing: "optional_text_expansion_non_authoritative",
							authoritativeSources: [{
								sourceId: "source-node-1",
								content: "原始短文本",
								sourceFingerprint: "stale",
							}],
							expandedSourceDraft: {
								content: "同一人物完成了一条可拍的连续行动链。",
								sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
							},
						},
					},
				},
			},
		});
	});

	it("keeps the latest public-chat turn authoritative over an expansion draft", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("delivery-contract", "agents.delivery.contract/v2", {
				workflowExecutionScope: "media_delivery",
				workflowVideoModelKey: "doubao-seedance-2.5",
			}, "once", ["delivery-contract"], undefined, ["canvas-facts", "expanded-source"]),
			inputs: {
				"canvas-facts": [{
					sourceMode: "project_context",
					authoritativeSources: [{
						sourceId: "source-node-1",
						content: "原始短文本，结尾保持开放动作",
						sourceFingerprint: "stale",
					}],
					userRequest: {
						kind: "public_chat_turn",
						requestId: "turn-1",
						content: "15 秒直接进入高潮，不要收势",
					},
				}],
				"expanded-source": [{ text: "扩写草稿加入了碰撞前定格。" }],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			resolveVideoDurationOptions: vi.fn(async () => [5, 10]),
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"delivery-contract": {
						canvasFacts: {
							sourceProcessing: "optional_text_expansion_non_authoritative",
							authoritativeSources: [{
								sourceId: "source-node-1",
								content: "原始短文本，结尾保持开放动作",
							}],
							expandedSourceDraft: { content: "扩写草稿加入了碰撞前定格。" },
						},
					},
				},
			},
		});
	});

	it("keeps a public-chat source authoritative when the userRequest projection is absent", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("delivery-contract", "agents.delivery.contract/v2", {
				workflowExecutionScope: "media_delivery",
				workflowVideoModelKey: "doubao-seedance-2.5",
			}, "once", ["delivery-contract"], undefined, ["canvas-facts", "expanded-source"]),
			inputs: {
				"canvas-facts": [{
					sourceMode: "project_context",
					authoritativeSources: [{
						sourceId: "public-chat-turn:turn-1",
						kind: "public_chat_turn",
						content: "直接进入动作并保持开放出口",
						sourceFingerprint: "stale",
					}],
				}],
				"expanded-source": [{ text: "扩写草稿加入了对峙停顿。" }],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			resolveVideoDurationOptions: vi.fn(async () => [5, 10]),
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"delivery-contract": {
						canvasFacts: {
							sourceProcessing: "optional_text_expansion_non_authoritative",
							authoritativeSources: [{
								sourceId: "public-chat-turn:turn-1",
								content: "直接进入动作并保持开放出口",
							}],
							expandedSourceDraft: { content: "扩写草稿加入了对峙停顿。" },
						},
					},
				},
			},
		});
	});

	it("preserves explicit clip durations when an authored workflow model supplies the live catalog", async () => {
		const resolveVideoDurationOptions = vi.fn(async () => (
			Array.from({ length: 27 }, (_, index) => index + 4)
		));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("delivery-contract", "agents.delivery.contract/v2", {
				workflowExecutionScope: "media_delivery",
				workflowVideoModelKey: "doubao-seedance-2.5",
			}, "once", ["delivery-contract"], undefined, ["canvas-facts"]),
			inputs: {
				"canvas-facts": [{
					sourceMode: "project_context",
					callConfig: {
						targetDurationSeconds: 10,
						requestedClipCount: 2,
						requestedClipDurationsSeconds: [5, 5],
					},
				}],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			resolveVideoDurationOptions,
		});

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"delivery-contract": {
						targetDurationSeconds: 10,
						generationContract: {
							providerSubmissionTopology: {
								expectedClipCount: 2,
								minimumClipDurations: [5, 5],
								source: "user_clip_durations",
							},
						},
					},
				},
			},
		});
		expect(resolveVideoDurationOptions).toHaveBeenCalledTimes(1);
	});

	it("runs the paid video segment, concat and delivery nodes from one frozen production plan", async () => {
		const promptPackage = {
			protocolVersion: "2",
			artifactType: "tapcanvas.prompt-package/v2",
			clips: [
				{
					itemId: "clip-a",
					prompt: "提示词 A",
					durationSeconds: 5,
					declaredAssetIds: ["hero"],
					assetBindings: [{ assetId: "hero", kind: "character", name: "剑修", referenceRole: "identity" }],
					structuredClip: {
						durationSeconds: 5,
						logline: "剑修完成一次可见动作",
						assetObjectContracts: [{
							kind: "character",
							name: "剑修",
							referenceImageNodeIds: [],
							referenceRole: "identity",
						}],
						shots: [{ shotNo: 1, visualTask: "看清动作结果", action: "剑修跨步并稳住重心", durationSeconds: 5, depictedStoryEventIndices: [0] }],
					},
				},
				{
					itemId: "clip-b",
					prompt: "提示词 B",
					durationSeconds: 8,
					declaredAssetIds: [],
					assetBindings: [],
					structuredClip: {
						durationSeconds: 8,
						assetObjectContracts: [],
						shots: [{ shotNo: 1, visualTask: "承接前态", action: "动作余势推动环境变化", durationSeconds: 8, depictedStoryEventIndices: [0] }],
					},
				},
			],
			deliveryEvidence: {
				version: 2,
				source: "workflow_prompt_package",
				clipCount: 2,
				totalDurationSeconds: 13,
				sourceSpeechLineCount: 0,
				narrativeSpeechLineCount: 0,
				executableSpeechLineCount: 0,
				assetBindingCount: 1,
				embeddedAuthoringReviewCount: 0,
			},
			deliveryVerification: {
				version: 2,
				status: "unsatisfied",
				verifiedBy: "workflow_prompt_package_contract",
			},
		};
		const assetBindings = createWorkflowCollection({
			collectionId: "asset-bindings",
			producerNodeId: "image-generator",
			producerPortId: "asset-bindings",
			itemIds: ["hero"],
			values: [{
				assetPlan: { assetId: "hero" },
				nodeId: "image-node-hero",
				imageUrl: "https://assets.example/hero.png",
			}],
		});
		const runVideoEstimate = vi.fn(async () => ({
			estimateIdentity: "execution-1:estimate",
			modelKey: "video-model",
			resolution: "1080p",
			aspectRatio: "16:9",
			estimatedCredits: 12,
			perClip: [
				{ itemId: "clip-a", durationSeconds: 5, credits: 5 },
				{ itemId: "clip-b", durationSeconds: 8, credits: 7 },
			],
		}));
		const estimate = await executeRegisteredWorkflowNode(context({
			node: node("estimate", "video.estimate/v1", {
				workflowVideoModelKey: "video-model",
				workflowVideoResolution: "1080p",
				workflowVideoAspectRatio: "16:9",
			}, "collect", ["estimate"], undefined, ["prompt-package"]),
			inputs: { "prompt-package": [promptPackage] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runVideoEstimate });
		expect(estimate.ok).toBe(true);
		if (!estimate.ok) throw new Error("Expected estimate success");
		expect(runVideoEstimate).toHaveBeenCalledWith(expect.objectContaining({
			referenceImageCount: 0,
		}));

		const handoff = await executeRegisteredWorkflowNode(context({
			node: node("handoff", "video.production.handoff/v1", {}, "collect", ["production-plan"], undefined, ["prompt-package", "estimate", "asset-bindings", "voice-manifest"]),
			inputs: {
				"prompt-package": [promptPackage],
				estimate: [estimate.outputRefs.ports.estimate],
				"asset-bindings": [assetBindings],
				"voice-manifest": [{ protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] }],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			prepareVideoProductionAssets: vi.fn(async () => ({
				protocolVersion: "tapcanvas.voice-manifest/v1" as const,
				entries: [],
			})),
		});
		expect(handoff.ok).toBe(true);
		if (!handoff.ok) throw new Error("Expected production handoff success");
		const productionPlan = handoff.outputRefs.ports["production-plan"];
		expect(isWorkflowCollection(productionPlan)).toBe(true);
		if (!isWorkflowCollection(productionPlan)) throw new Error("Expected production-plan collection");
		expect(productionPlan.items.every((item) => (
			typeof item.value === "object"
			&& item.value !== null
			&& !Array.isArray(item.value)
			&& (item.value as Record<string, unknown>).videoReferencePolicy === "forbidden"
		))).toBe(true);

		const submitVideo = vi.fn(async (request: { itemIndex: number }) => ({
			status: "success" as const,
			nodeId: `video-${request.itemIndex}`,
			taskId: `task-${request.itemIndex}`,
			videoUrl: `https://assets.example/${request.itemIndex}.mp4`,
			thumbnailUrl: null,
			reused: false,
		}));
		const submitted = await executeRegisteredWorkflowNode(context({
			node: node("submit", "tapcanvas.video.generate/v1", {}, "each", ["provider-receipts"], 1, ["production-plan"]),
			inputs: { "production-plan": [productionPlan] },
			flowVersionData: {
				workflowProjectContext: {
					...selectedAssetProjectContext([]),
					visualStyle: {
						referenceImages: ["https://assets.example/style.png"],
						styleLock: { styleId: "anime-night", styleName: "统一夜战", stylePrompt: "二维赛璐璐，蓝紫霓虹" },
						styleFingerprint: "sha256:style-night",
					},
				},
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });
    const prepareVideo = vi.fn(async () => ({ nodeId: "prepared-video" }));
    const noVideoSubmission = vi.fn();
    const prepared = await executeRegisteredWorkflowNode(context({
      node: node("prepare", "tapcanvas.video.prepare/v1", { workflowVideoReferencePolicy: "forbidden" }, "each", ["prepared-nodes"], 1, ["production-plan"]),
      inputs: { "production-plan": [productionPlan] },
    }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: noVideoSubmission, prepareVideo });
    if (!prepared.ok) throw new Error("errorMessage" in prepared ? prepared.errorMessage : "Unexpected external wait");
    expect(prepared).toMatchObject({ ok: true });
    expect(prepareVideo).toHaveBeenCalledTimes(productionPlan.items.length);
    expect(noVideoSubmission).not.toHaveBeenCalled();
		expect(submitted.ok).toBe(true);
		expect(submitVideo).toHaveBeenCalledTimes(2);
		expect(submitVideo).toHaveBeenNthCalledWith(1, expect.objectContaining({
			estimateIdentity: "execution-1:estimate",
			modelKey: "video-model",
			itemIndex: 0,
			referenceImageNodeIds: ["image-node-hero"],
			styleReferenceImages: ["https://assets.example/style.png"],
			stylePrompt: "二维赛璐璐，蓝紫霓虹",
			styleFingerprint: "sha256:style-night",
			structuredClip: expect.objectContaining({
				shots: [{ shotNo: 1, visualTask: "看清动作结果", action: "剑修跨步并稳住重心", durationSeconds: 5, depictedStoryEventIndices: [0] }],
			}),
		}));
		if (!submitted.ok) throw new Error("Expected video submission success");

		const forbiddenReferencePlan = {
			...productionPlan,
			items: productionPlan.items.map((item, index) => ({
				...item,
				value: index === 0 && typeof item.value === "object" && item.value !== null && !Array.isArray(item.value)
					? { ...(item.value as Record<string, unknown>), referenceVideoUrl: "https://assets.example/reference.mp4" }
					: item.value,
			})),
		};
		const forbiddenSubmitVideo = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "must-not-run",
			taskId: "must-not-run",
			videoUrl: "https://assets.example/must-not-run.mp4",
			thumbnailUrl: null,
			reused: false,
		}));
		const rejectedReference = await executeRegisteredWorkflowNode(context({
			node: node("submit-forbidden-reference", "tapcanvas.video.generate/v1", {}, "each", ["provider-receipts"], 1, ["production-plan"]),
			inputs: { "production-plan": [forbiddenReferencePlan] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: forbiddenSubmitVideo });
		expect(rejectedReference).toMatchObject({
			ok: false,
		});
		expect(JSON.stringify(rejectedReference)).toContain("referenceVideoUrl is forbidden");
		expect(forbiddenSubmitVideo).not.toHaveBeenCalled();

		const normalized = await executeRegisteredWorkflowNode(context({
			node: node("results", "workflow.control.join/v1", {}, "each", ["video-assets"], undefined, ["provider-receipts"]),
			inputs: { "provider-receipts": [submitted.outputRefs.ports["provider-receipts"]] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) throw new Error("Expected normalized video assets");

		const runVideoConcat = vi.fn(async () => ({
			videoUrl: "https://assets.example/master.mp4",
			assetId: "asset-master-1",
			clipCount: 2,
			reusedSingleClip: false,
			mediaProbeEvidence: {
				probe: { width: 832, height: 480, durationSeconds: 13 },
				diagnostics: [{
					code: "media_spec_mismatch" as const,
					blocking: false as const,
					expected: { aspectRatio: "16:9", durationSeconds: 13 },
					actual: { width: 832, height: 480, durationSeconds: 13 },
					fields: ["aspectRatio"] as const,
					message: "规格差异",
				}],
			},
		}));
		const projectWorkflowFilm = vi.fn(async () => undefined);
		const concatenated = await executeRegisteredWorkflowNode(context({
			node: node("concat", "video.concat/v1", {}, "collect", ["master-video"], undefined, ["video-assets", "estimate", "prompt-package"]),
			inputs: {
				"video-assets": [normalized.outputRefs.ports["video-assets"]],
				estimate: [estimate.outputRefs.ports.estimate],
				"prompt-package": [promptPackage],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runVideoConcat, projectWorkflowFilm });
		if (!concatenated.ok) throw new Error("errorMessage" in concatenated ? concatenated.errorMessage : "Unexpected external wait");
		expect(concatenated).toMatchObject({ ok: true, outputRefs: { ports: { "master-video": { videoUrl: "https://assets.example/master.mp4" } } } });
		expect(projectWorkflowFilm).toHaveBeenCalledWith(expect.objectContaining({
		videoUrl: "https://assets.example/master.mp4",
		assetId: "asset-master-1",
		clipCount: 2,
		targetDurationSeconds: 13,
			aspectRatio: "16:9",
		mediaProbeEvidence: expect.objectContaining({ probe: expect.objectContaining({ width: 832, height: 480 }) }),
		}));
		const delivered = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", {
				workflowDeliveryArtifactType: "tapcanvas.master-video/v1",
			}, "collect", ["delivery-evidence"], undefined, ["master-video", "prompt-package"]),
			inputs: {
				"master-video": [concatenated.outputRefs.ports["master-video"]],
				"prompt-package": [promptPackage],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		expect(delivered).toMatchObject({
			ok: true,
			outputRefs: { artifacts: [{ type: "tapcanvas.master-video/v1", value: "https://assets.example/master.mp4" }] },
		});

        const assets = normalized.outputRefs.ports["video-assets"];
        if (!isWorkflowCollection(assets)) throw new Error("Expected video collection");
        runVideoConcat.mockClear();
        const partial = await executeRegisteredWorkflowNode(context({
            node: node("concat-partial", "video.concat/v1", {
                workflowMediaDeliveryPolicy: { version: 1, maxRetries: 1, exhausted: "deliver_successes" },
            }, "collect", ["master-video"], undefined, ["video-assets", "estimate", "prompt-package"]),
            inputs: { "video-assets": [createWorkflowCollection({ collectionId: "partial", producerNodeId: "results", producerPortId: "video-assets", values: assets.items.filter(item => item.itemId === "clip-b").map(item => item.value), itemIds: ["clip-b"] })],
                estimate: [estimate.outputRefs.ports.estimate], "prompt-package": [promptPackage] },
        }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runVideoConcat });
        if (!partial.ok) throw new Error("errorMessage" in partial ? partial.errorMessage : "Unexpected external wait");
        expect(runVideoConcat).toHaveBeenCalledWith(expect.objectContaining({ targetDurationSeconds: 8 }));
        expect(partial.outputRefs.ports["master-video"]).toMatchObject({ deliveryCoverage: {
            status: "partial", requestedDurationSeconds: 13, deliveredDurationSeconds: 8,
            completedItemIds: ["clip-b"], missingItemIds: ["clip-a"],
        } });
        const partialDelivery = await executeRegisteredWorkflowNode(context({
            node: node("delivery-partial", "agents.delivery.verify/v2", {
                workflowDeliveryArtifactType: "tapcanvas.master-video/v1",
            }, "collect", ["delivery-evidence"], undefined, ["master-video", "prompt-package"]),
            inputs: { "master-video": [partial.outputRefs.ports["master-video"]], "prompt-package": [promptPackage] },
        }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
        expect(partialDelivery).toMatchObject({ ok: false, errorCode: "workflow_delivery_coverage_unsatisfied", outputRefs: { evidence: {
            expectedDelivery: { itemIds: ["clip-b", "clip-a"], durationSeconds: 13 },
            deliveryEvidence: { itemIds: ["clip-b"], durationSeconds: 8 },
            deliveryVerification: { status: "unsatisfied", coverage: "partial", missingItemIds: ["clip-a"], artifactPreserved: true, terminalAuthority: false },
        } } });
	});
	it("submits a strict Agent image prompt package with explicit asset roles", async () => {
		const runImage = vi.fn(async () => ({
			status: "waiting_external" as const,
			nodeId: "canvas-image-1",
			taskId: "image-task-1",
			reused: false,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("image", "tapcanvas.image.generate/v1", {
				workflowImageModelKey: "gpt-image-2",
				workflowImageAspectRatio: "16:9",
				workflowImageSize: "2K",
				workflowImageReferenceAssetBindings: [
					{ assetId: "layout-asset", role: "layout", strength: 0.8 },
					{ assetId: "style-asset", role: "style", strength: 0.55 },
				],
			}, "once", ["image"]),
			inputs: {
				"prompt-package": [{ text: JSON.stringify({ prompt: "动态提示词", negativePrompt: "动态负向词" }) }],
			},
			flowVersionData: {
				workflowProjectContext: {
					...selectedAssetProjectContext([]),
					visualStyle: {
						referenceImages: ["https://assets.example/style.png"],
						styleLock: { styleId: "anime-night", styleName: "统一夜战", stylePrompt: "二维赛璐璐，蓝紫霓虹" },
						styleFingerprint: "sha256:style-night",
					},
				},
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runImage, runVideo });
		expect(result).toMatchObject({ ok: false, waitingExternal: true });
		expect(runImage).toHaveBeenCalledWith(expect.objectContaining({
			prompt: "动态提示词",
			negativePrompt: "动态负向词",
			modelKey: "gpt-image-2",
			aspectRatio: "16:9",
			imageSize: "2K",
			referenceAssetBindings: [
				{ assetId: "layout-asset", role: "layout", strength: 0.8 },
				{ assetId: "style-asset", role: "style", strength: 0.55 },
			],
			styleReferenceImages: ["https://assets.example/style.png"],
			stylePrompt: "二维赛璐璐，蓝紫霓虹",
			styleFingerprint: "sha256:style-night",
		}));
	});

	it("rejects malformed image prompt packages before a paid submission", async () => {
		const runImage = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("image", "tapcanvas.image.generate/v1", {
				workflowImageModelKey: "gpt-image-2",
				workflowImageAspectRatio: "16:9",
				workflowImageSize: "2K",
				workflowImageReferenceAssetBindings: [],
			}, "once", ["image"]),
			inputs: { "prompt-package": [{ text: '{"prompt":"缺负向词"}' }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runImage, runVideo });
		expect(result).toMatchObject({ ok: false, errorMessage: expect.stringContaining("requires non-empty prompt and negativePrompt") });
		expect(runImage).not.toHaveBeenCalled();
	});

	it("verifies a generated image only when it carries a persistent HTTP(S) URL", async () => {
		const dependencies = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo };
		const success = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", {
				workflowDeliveryArtifactType: "tapcanvas.image/v1",
				workflowDeliveryRequirement: "一张真实图片",
			}, "collect", ["delivery-evidence"]),
			inputs: { result: [{ imageUrl: "https://assets.example/image.png", nodeId: "canvas-image-1" }] },
		}), dependencies);
		expect(success).toMatchObject({ ok: true, outputRefs: { artifacts: [{ type: "tapcanvas.image/v1", value: "https://assets.example/image.png" }] } });

		const failed = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", { workflowDeliveryArtifactType: "tapcanvas.image/v1" }, "collect", ["delivery-evidence"]),
			inputs: { result: [{ imageUrl: "blob:temporary" }] },
		}), dependencies);
		expect(failed).toMatchObject({ ok: false, errorMessage: expect.stringContaining("persistent HTTP(S) media URL") });
	});

	it("persists per-item video receipts and resumes the same items without losing lineage", async () => {
		const collection = createWorkflowCollection({
			collectionId: "prompts",
			producerNodeId: "prompt-agent",
			producerPortId: "result",
			values: [{ text: "prompt one" }, { text: "prompt two" }],
			itemIds: ["segment-1", "segment-2"],
		});
		const videoNode = node("video", "tapcanvas.video.generate/v1", {
			workflowVideoModelKey: "video-model",
			workflowVideoDurationSeconds: 5,
			workflowVideoResolution: "1080p",
			workflowVideoAspectRatio: "16:9",
		}, "each", ["video"]);
		const submitVideo = vi.fn(async (request: { itemIndex: number }) => ({
			status: "waiting_external" as const,
			nodeId: `canvas-video-${request.itemIndex}`,
			taskId: `task-${request.itemIndex}`,
			providerAcceptedAt: "2026-09-07T01:02:03.000Z",
			reused: false,
		}));
		const first = await executeRegisteredWorkflowNode(context({
			node: videoNode,
			inputs: { prompt: [collection] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		if (first.ok || first.waitingExternal !== true) throw new Error("Expected external wait");
		expect(first.outputRefs.itemRuns.map((item) => item.evidence.providerAcceptedAt)).toEqual(["2026-09-07T01:02:03.000Z", "2026-09-07T01:02:03.000Z"]);
		expect(first.outputRefs.itemRuns.map((item) => ({ itemId: item.itemId, status: item.status, taskId: item.evidence.taskId }))).toEqual([
			{ itemId: "segment-1", status: "waiting_external", taskId: "task-0" },
			{ itemId: "segment-2", status: "waiting_external", taskId: "task-1" },
		]);
		expect(submitVideo).toHaveBeenCalledTimes(2);

		const inspectThenSubmit = vi.fn(async (request: {
			itemIndex: number;
			previousEvidence: Record<string, unknown> | null;
			resumeOnly: boolean;
		}) => request.resumeOnly
			? {
				status: "success" as const,
				nodeId: String(request.previousEvidence?.canvasNodeId),
				taskId: String(request.previousEvidence?.taskId),
				videoUrl: `https://assets.example/video-${request.itemIndex}.mp4`,
				thumbnailUrl: null,
				reused: true,
			}
			: {
				status: "waiting_external" as const,
				nodeId: `canvas-video-${request.itemIndex}`,
				taskId: `task-${request.itemIndex}`,
				reused: false,
			});
		const second = await executeRegisteredWorkflowNode({
			...context({ node: videoNode, inputs: { prompt: [collection] } }),
			resumeOnly: true,
			resumeOutputRefs: first.outputRefs,
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: inspectThenSubmit });
		expect(second).toMatchObject({
			ok: true,
			outputRefs: {
				itemRuns: [
					{ itemId: "segment-1", status: "success" },
					{ itemId: "segment-2", status: "success" },
				],
			},
		});
		if (!second.ok) throw new Error("Expected every accepted video to reconcile together");
		expect(second.outputRefs.itemRuns.map((item) => item.artifacts[0]?.value)).toEqual([
			"https://assets.example/video-0.mp4",
			"https://assets.example/video-1.mp4",
		]);
		expect(inspectThenSubmit).toHaveBeenCalledTimes(2);
	});

	it("freezes the unique voice manifest at production handoff and video submit only consumes it", async () => {
		const promptPackage = {
			protocolVersion: "2",
			artifactType: "tapcanvas.prompt-package/v2",
			clips: [{
				itemId: "clip-000",
				prompt: "clip one",
				durationSeconds: 5,
				declaredAssetIds: [],
				assetBindings: [],
				structuredClip: {
					durationSeconds: 5,
					assetObjectContracts: [],
					speakerBindings: [{ name: "大伯母", assetKind: "character" }],
					speechEvents: [{ speechEventId: "speech-L01", lineId: "L01", startOffset: 0, endOffset: 4, startSeconds: 0, endSeconds: 2, speakerName: "大伯母", delivery: "on_screen", spokenText: "你回来了。" }],
					shots: [{ shotNo: 1, visualTask: "人物开口", action: "大伯母看向门口", durationSeconds: 5, depictedStoryEventIndices: [0], speechEventIds: ["speech-L01"] }],
				},
			}],
			deliveryEvidence: { version: 2, source: "workflow_prompt_package", clipCount: 1, totalDurationSeconds: 5, sourceSpeechLineCount: 1, narrativeSpeechLineCount: 0, executableSpeechLineCount: 1, assetBindingCount: 0, embeddedAuthoringReviewCount: 0 },
			deliveryVerification: { version: 2, status: "satisfied", verifiedBy: "workflow_prompt_package_contract" },
		};
		const assetBindings = createWorkflowCollection({ collectionId: "assets", producerNodeId: "images", producerPortId: "asset-bindings", itemIds: [], values: [] });
		const prepareVideoProductionAssets = vi.fn(async () => ({
			protocolVersion: "tapcanvas.voice-manifest/v1" as const,
			entries: [{ speakerName: "大伯母", voiceId: "voice-1", voiceLabel: "邻居阿姨", nodeId: "voice-card-1", audioUrl: "https://assets.example/voice.mp3", audioDurationSec: 3 }],
		}));
		const runFrozenVideo = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "video-0",
			taskId: "task-0",
			videoUrl: "https://assets.example/video-0.mp4",
			thumbnailUrl: null,
			reused: false,
		}));
		const voiceCatalog = {
			protocolVersion: "tapcanvas.voice-catalog/v1",
			speakers: ["大伯母"],
			existingBindings: [{ speakerName: "大伯母", voiceId: "voice-1", voiceLabel: "邻居阿姨", nodeId: "voice-card-1", audioUrl: "https://assets.example/voice.mp3", audioDurationSec: 3 }],
			catalog: [],
		};
		const voicePlan = { text: JSON.stringify({ protocolVersion: "tapcanvas.voice-plan/v1", entries: [{ speakerName: "大伯母", voiceId: "voice-1", rationale: "沿用已冻结声音身份" }] }) };
		const materialized = await executeRegisteredWorkflowNode(context({
			node: node("voice-materialize", "video.voice-manifest.materialize/v1", {}, "collect", ["voice-manifest"], undefined, ["voice-catalog", "voice-plan", "estimate"]),
			inputs: {
				"voice-catalog": [voiceCatalog],
				"voice-plan": [voicePlan],
				estimate: [{ estimateIdentity: "estimate-1", modelKey: "video-model", resolution: "480p", aspectRatio: "16:9" }],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: runFrozenVideo, prepareVideoProductionAssets });
		expect(materialized.ok).toBe(true);
		if (!materialized.ok) return;
		const handoff = await executeRegisteredWorkflowNode(context({
			node: node("handoff", "video.production.handoff/v1", {}, "collect", ["production-plan"], undefined, ["prompt-package", "estimate", "asset-bindings", "voice-manifest"]),
			inputs: {
				"prompt-package": [promptPackage],
				estimate: [{ estimateIdentity: "estimate-1", modelKey: "video-model", resolution: "480p", aspectRatio: "16:9" }],
				"asset-bindings": [assetBindings],
				"voice-manifest": [materialized.outputRefs.ports["voice-manifest"]],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: runFrozenVideo });
		expect(handoff.ok).toBe(true);
		expect(prepareVideoProductionAssets).toHaveBeenCalledWith(expect.objectContaining({ speakerNames: ["大伯母"], modelKey: "video-model" }));
		if (!handoff.ok) return;
		const productionPlan = handoff.outputRefs.ports["production-plan"];
		expect(productionPlan).toMatchObject({ items: [{ value: { structuredClip: { voiceBinding: [{ character: "大伯母", voiceId: "voice-1" }], referenceAudioRequired: true } } }] });
		const emptyVoiceManifest = await executeRegisteredWorkflowNode(context({
			node: node("empty-voice-manifest", "video.voice-manifest.empty/v1", {}, "once", ["voice-manifest"], undefined, ["trigger"]),
			inputs: { trigger: [{ requested: true }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: runFrozenVideo });
		expect(emptyVoiceManifest.ok).toBe(true);
		if (!emptyVoiceManifest.ok) return;
		expect(emptyVoiceManifest.outputRefs).toMatchObject({
			ports: { "voice-manifest": { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] } },
			evidence: { speakerCount: 0, nativeAudioOnly: true },
		});
		const optionalAudioHandoff = await executeRegisteredWorkflowNode(context({
			node: node("optional-audio-handoff", "video.production.handoff/v1", { workflowReferenceAudioPolicy: "optional" }, "collect", ["production-plan"], undefined, ["prompt-package", "estimate", "asset-bindings", "voice-manifest"]),
			inputs: {
				"prompt-package": [promptPackage],
				estimate: [{ estimateIdentity: "estimate-1", modelKey: "video-model", resolution: "480p", aspectRatio: "16:9" }],
				"asset-bindings": [assetBindings],
				"voice-manifest": [emptyVoiceManifest.outputRefs.ports["voice-manifest"]],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: runFrozenVideo });
		expect(optionalAudioHandoff.ok).toBe(true);
		if (!optionalAudioHandoff.ok) return;
		expect(optionalAudioHandoff.outputRefs.ports["production-plan"]).toMatchObject({
			items: [{ value: { structuredClip: { voiceBinding: [], referenceAudioUrls: [], referenceAudioRequired: false } } }],
		});
		const submitPrepare = vi.fn();
		const submitted = await executeRegisteredWorkflowNode(context({
			node: node("video", "tapcanvas.video.generate/v1", { workflowVideoReferencePolicy: "forbidden" }, "each", ["provider-receipts"], 8, ["production-plan"]),
			inputs: { "production-plan": [productionPlan] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: runFrozenVideo, prepareVideoProductionAssets: submitPrepare });
		if (!submitted.ok) throw new Error(JSON.stringify(submitted));
		expect(submitted.ok).toBe(true);
		expect(submitPrepare).not.toHaveBeenCalled();
	});

	it("fails VoiceManifest materialization before provider submission", async () => {
		const runVideo = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("voice-materialize", "video.voice-manifest.materialize/v1", {}, "collect", ["voice-manifest"], undefined, ["voice-catalog", "voice-plan", "estimate"]),
			inputs: {
				"voice-catalog": [{ protocolVersion: "tapcanvas.voice-catalog/v1", speakers: [], existingBindings: [], catalog: [] }],
				"voice-plan": [{ text: JSON.stringify({ protocolVersion: "tapcanvas.voice-plan/v1", entries: [] }) }],
				estimate: [{ modelKey: "video-model" }],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, prepareVideoProductionAssets: vi.fn(async () => { throw new Error("voice manifest failed"); }) });
		expect(result.ok).toBe(false);
		expect(runVideo).not.toHaveBeenCalled();
	});

	it("uses an explicit provider-native voice contract without calling seed-audio materialization", async () => {
		const prepareVideoProductionAssets = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("voice-materialize", "video.voice-manifest.materialize/v1", { workflowVoiceMode: "provider_native" }, "collect", ["voice-manifest"], undefined, ["voice-catalog", "voice-plan", "estimate"]),
			inputs: {
				"voice-catalog": [{ protocolVersion: "tapcanvas.voice-catalog/v1", speakers: ["旁白"], existingBindings: [], catalog: [{ id: "voice-1", name: "旁白" }] }],
				"voice-plan": [{ text: JSON.stringify({ protocolVersion: "tapcanvas.voice-plan/v1", entries: [{ speakerName: "旁白", voiceId: "voice-1", rationale: "供应商原生对白仅保留角色分配事实" }] }) }],
				estimate: [{ modelKey: "doubao-seedance-2.0" }],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn(), prepareVideoProductionAssets });
		expect(result.ok).toBe(true);
		expect(prepareVideoProductionAssets).not.toHaveBeenCalled();
		if (!result.ok) return;
		expect(result.outputRefs).toMatchObject({
			ports: { "voice-manifest": { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] } },
			evidence: { speakerCount: 1, entryCount: 0, audioUrls: [], nativeAudioOnly: true },
		});
	});

	it("submits every idempotent external item within the configured concurrency window", async () => {
		const collection = createWorkflowCollection({
			collectionId: "sequential-prompts",
			producerNodeId: "prompt-agent",
			producerPortId: "result",
			values: [{ text: "prompt one" }, { text: "prompt two" }, { text: "prompt three" }],
			itemIds: ["segment-1", "segment-2", "segment-3"],
		});
		let activeSubmissions = 0;
		let peakSubmissions = 0;
		const submitVideo = vi.fn(async (request: { itemIndex: number }) => {
			activeSubmissions += 1;
			peakSubmissions = Math.max(peakSubmissions, activeSubmissions);
			await new Promise((resolve) => setTimeout(resolve, 4));
			activeSubmissions -= 1;
			return {
				status: "waiting_external" as const,
				nodeId: `canvas-video-${request.itemIndex}`,
				taskId: `task-${request.itemIndex}`,
				reused: false,
			};
		});

		const result = await executeRegisteredWorkflowNode(context({
			node: node("video", "tapcanvas.video.generate/v1", {
				workflowVideoModelKey: "video-model",
				workflowVideoDurationSeconds: 5,
				workflowVideoResolution: "480p",
				workflowVideoAspectRatio: "16:9",
			}, "each", ["video"], 2),
			inputs: { prompt: [collection] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				evidence: {
					itemConcurrency: 2,
					configuredItemConcurrency: 2,
					activeItems: 0,
					startedItems: 3,
					peakActiveItems: 2,
					completedItems: 0,
					settledItems: 3,
					waitingItems: 3,
					totalItems: 3,
				},
				itemRuns: [
					{ itemId: "segment-1", status: "waiting_external" },
					{ itemId: "segment-2", status: "waiting_external" },
					{ itemId: "segment-3", status: "waiting_external" },
				],
			},
		});
		expect(submitVideo).toHaveBeenCalledTimes(3);
		expect(peakSubmissions).toBe(2);
	});

	it("passes a JavaScript node's connected JSON input to the local runner", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn(async () => ({ output: { text: "HELLO" }, durationMs: 12 }));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("javascript", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { text: input.text.toUpperCase() }",
			}),
			inputs: { input: [{ text: "hello" }] },
		}), { runAgent, runJavascript, runVideo });

		expect(runJavascript).toHaveBeenCalledWith({
			code: "return { text: input.text.toUpperCase() }",
			input: { text: "hello" },
		});
		expect(result).toMatchObject({
			ok: true,
			outputRefs: { ports: { result: { text: "HELLO" } }, evidence: { durationMs: 12 } },
		});
	});

	it("splits an explicit array into a lineage-preserving workflow collection", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("split", "workflow.collection.split/v1", {
				workflowCollectionItemIdField: "segmentId",
			}, "once", [], undefined, ["value"]),
			inputs: {
				value: [[
					{ segmentId: "segment-1", text: "第一段" },
					{ segmentId: "segment-2", text: "第二段" },
				]],
			},
		}), { runAgent, runJavascript, runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected collection split to succeed");
		const collection = result.outputRefs.ports.items;
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected workflow collection");
		expect(collection.items.map((item) => item.itemId)).toEqual(["segment-1", "segment-2"]);
		expect(collection.items[1]?.lineage).toContainEqual(expect.objectContaining({
			nodeId: "split",
			portId: "items",
			itemId: "segment-2",
		}));
	});

	it("publishes a split collection on the declared typed output port", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-split", "workflow.collection.split/v1", {
				workflowCollectionItemIdField: "assetId",
			}, "once", ["asset-items"], undefined, ["value"]),
			inputs: { value: [[{ assetId: "hero", prompt: "角色参考" }]] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected collection split to succeed");
		expect(isWorkflowCollection(result.outputRefs.ports["asset-items"])).toBe(true);
		expect(result.outputRefs.ports.items).toBeUndefined();
	});

	it("takes a deterministic prefix of a collection while preserving item identity and lineage", async () => {
		const source = createWorkflowCollection({
			collectionId: "production-plans",
			producerNodeId: "production-handoff",
			producerPortId: "production-plan",
			values: [{ clipId: "clip-000" }, { clipId: "clip-001" }, { clipId: "clip-002" }],
			itemIds: ["clip-000", "clip-001", "clip-002"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("first-video", "workflow.collection.take/v1", {
				workflowCollectionTakeCount: 1,
			}, "once", ["production-plan"], undefined, ["items"]),
			inputs: { items: [source] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected collection take to succeed");
		const selected = result.outputRefs.ports["production-plan"];
		expect(isWorkflowCollection(selected)).toBe(true);
		if (!isWorkflowCollection(selected)) throw new Error("Expected selected workflow collection");
		expect(selected.items).toHaveLength(1);
		expect(selected.items[0]).toMatchObject({ itemId: "clip-000", index: 0, value: { clipId: "clip-000" } });
		expect(selected.items[0]?.lineage).toEqual([
			expect.objectContaining({ nodeId: "production-handoff", portId: "production-plan", itemId: "clip-000" }),
			expect.objectContaining({ nodeId: "first-video", portId: "production-plan", itemId: "clip-000" }),
		]);
		expect(result.outputRefs.evidence).toMatchObject({
			sourceItemCount: 3,
			selectedItemCount: 1,
			requestedItemCount: 1,
		});
	});

	it("rejects collection take nodes without a valid structural limit", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("first-video", "workflow.collection.take/v1", {
				workflowCollectionTakeCount: 0,
			}, "once", ["items"], undefined, ["items"]),
			inputs: { items: [] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("workflowCollectionTakeCount between 1 and 1000"),
		});
	});

	it("drops an accepted prefix without renumbering the remaining item identities", async () => {
		const source = createWorkflowCollection({
			collectionId: "full-production-plan",
			producerNodeId: "handoff",
			producerPortId: "production-plan",
			values: [{ clipId: "clip-0" }, { clipId: "clip-1" }, { clipId: "clip-2" }],
			itemIds: ["clip-0", "clip-1", "clip-2"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("remainder", "workflow.collection.drop/v1", {
				workflowCollectionDropCount: 1,
			}, "once", ["production-plan"], undefined, ["production-plan"]),
			inputs: { "production-plan": [source] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected collection drop to succeed");
		const remainder = result.outputRefs.ports["production-plan"];
		expect(isWorkflowCollection(remainder)).toBe(true);
		if (!isWorkflowCollection(remainder)) throw new Error("Expected remainder collection");
		expect(remainder.items.map((item) => item.itemId)).toEqual(["clip-1", "clip-2"]);
		expect(result.outputRefs.evidence).toMatchObject({
			sourceItemCount: 3,
			droppedItemCount: 1,
			remainingItemCount: 2,
		});
	});

	it("concatenates ordered collections and preserves the launch item before the remainder", async () => {
		const launch = createWorkflowCollection({
			collectionId: "launch-video",
			producerNodeId: "launch-submit",
			producerPortId: "video-assets",
			values: [{ videoUrl: "https://assets.test/clip-0.mp4" }],
			itemIds: ["clip-0"],
		});
		const remainder = createWorkflowCollection({
			collectionId: "remainder-videos",
			producerNodeId: "video-submit",
			producerPortId: "video-assets",
			values: [
				{ videoUrl: "https://assets.test/clip-1.mp4" },
				{ videoUrl: "https://assets.test/clip-2.mp4" },
			],
			itemIds: ["clip-1", "clip-2"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("all-videos", "workflow.collection.concat/v1", {}, "once", ["video-assets"], undefined, ["items"]),
			inputs: { items: [launch, remainder] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected collection concat to succeed");
		const combined = result.outputRefs.ports["video-assets"];
		expect(isWorkflowCollection(combined)).toBe(true);
		if (!isWorkflowCollection(combined)) throw new Error("Expected combined collection");
		expect(combined.items.map((item) => item.itemId)).toEqual(["clip-0", "clip-1", "clip-2"]);
		expect(result.outputRefs.evidence).toMatchObject({
			sourceCollectionIds: ["launch-video", "remainder-videos"],
			sourceItemCounts: [1, 2],
			itemCount: 3,
		});
	});

	it("persists exact rejected input provenance instead of a text-only control failure", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node(
				"clip-fan-out",
				"video.clip-contexts/v1",
				{},
				"once",
				["clip-contexts"],
				undefined,
				["delivery-contract", "beat-sheet"],
			),
			inputs: { "delivery-contract": [{}], "beat-sheet": [{}] },
			inputProvenance: [{
				sourceNodeId: "delivery-contract",
				sourceNodeRunId: "run-delivery-contract",
				sourcePortId: "delivery-contract",
				targetPortId: "delivery-contract",
				artifacts: [{ type: "tapcanvas.delivery-contract/v2", identity: "execution-1" }],
			}],
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			outputRefs: {
				evidence: {
					executorCompleted: false,
					inputContractRejection: {
						protocolVersion: "workflow.input-contract-rejection/v1",
						consumerNodeId: "clip-fan-out",
						rejectedBindings: [{
							sourceNodeId: "delivery-contract",
							sourceNodeRunId: "run-delivery-contract",
							sourcePortId: "delivery-contract",
							targetPortId: "delivery-contract",
							expectedContract: {
								protocolVersion: "workflow.artifact-contract/v1",
								artifactType: "tapcanvas.delivery-contract/v2",
								fingerprint: expect.any(String),
							},
						}],
					},
				},
			},
		});
	});

	it("creates an explicit empty collection for a launch lane that forbids image references", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("launch-assets", "workflow.collection.empty/v1", {}, "once", ["asset-bindings"]),
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected empty collection to succeed");
		const collection = result.outputRefs.ports["asset-bindings"];
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected empty collection");
		expect(collection.items).toEqual([]);
	});

	it("projects the first Beat before writer and asset fan-out without mutating the complete BeatSheet", async () => {
		const fullBeatSheet = {
			sourceId: "chapter-1",
			protocolVersion: "tapcanvas.beat-sheet/v2",
			sourceCoveragePlan: {
				speechLedger: [
					{ lineId: "line-0", clipIndex: 0, text: "第一段" },
					{ lineId: "line-1", clipIndex: 1, text: "第二段" },
				],
			},
			beats: [
				{ clipId: "clip-0", clipIndex: 0, durationSeconds: 12 },
				{ clipId: "clip-1", clipIndex: 1, durationSeconds: 15 },
			],
		};
		const result = await executeRegisteredWorkflowNode(context({
			node: node("first-beat", "video.beat-sheet.take/v1", {
				workflowBeatSheetTakeCount: 1,
			}, "once", ["beat-sheet"], undefined, ["beat-sheet"]),
			inputs: { "beat-sheet": [{
				taskId: "beat-task",
				text: JSON.stringify(fullBeatSheet),
				assets: [],
				executionProvenance: { loadedKnowledgeSources: [{ cardId: "card-combat" }] },
				knowledgeCandidateSearch: { status: "candidate_found", candidateCount: 1, blocking: false },
			}] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected BeatSheet projection to succeed");
		const projected = result.outputRefs.ports["beat-sheet"] as {
			text: string;
			sourceTaskId: string;
			beatSheetProjection: {
				protocolVersion: string;
				selection: string;
				requestedBeatCount: number;
				selectedBeatCount: number;
				sourceBeatCount: number;
			};
		};
		const parsed = JSON.parse(projected.text) as typeof fullBeatSheet;
		expect(projected.sourceTaskId).toBe("beat-task");
		expect(projected).toMatchObject({
			executionProvenance: { loadedKnowledgeSources: [{ cardId: "card-combat" }] },
			knowledgeCandidateSearch: { status: "candidate_found", candidateCount: 1 },
		});
		expect(projected.beatSheetProjection).toEqual({
			protocolVersion: "tapcanvas.beat-sheet-projection/v1",
			selection: "prefix",
			requestedBeatCount: 1,
			selectedBeatCount: 1,
			sourceBeatCount: 2,
		});
		expect(parsed.beats).toEqual([fullBeatSheet.beats[0]]);
		expect(parsed.sourceCoveragePlan.speechLedger).toEqual([fullBeatSheet.sourceCoveragePlan.speechLedger[0]]);
		expect(fullBeatSheet.beats).toHaveLength(2);
		expect(result.outputRefs.evidence).toMatchObject({
			sourceBeatCount: 2,
			selectedBeatCount: 1,
			requestedBeatCount: 1,
		});
	});

	it("caps a full BeatSheet at the configured Clip count and succeeds without requiring the remainder", async () => {
		const fullBeatSheet = {
			sourceId: "chapter-max-clip",
			protocolVersion: "tapcanvas.beat-sheet/v2",
			sourceCoveragePlan: {
				speechLedger: [
					{ lineId: "line-0", clipIndex: 0, text: "第一段" },
					{ lineId: "line-1", clipIndex: 1, text: "第二段" },
					{ lineId: "line-2", clipIndex: 2, text: "上限之外" },
				],
			},
			beats: [
				{ clipId: "clip-0", clipIndex: 0, durationSeconds: 12 },
				{ clipId: "clip-1", clipIndex: 1, durationSeconds: 12 },
				{ clipId: "clip-2", clipIndex: 2, durationSeconds: 12 },
			],
		};
		const result = await executeRegisteredWorkflowNode(context({
			node: node("max-clip", "video.beat-sheet.take/v1", {
				workflowBeatSheetTakeCount: 2,
			}, "once", ["beat-sheet"], undefined, ["beat-sheet"]),
			inputs: { "beat-sheet": [{ taskId: "beat-task", text: JSON.stringify(fullBeatSheet), assets: [] }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected max Clip projection to succeed");
		const projected = result.outputRefs.ports["beat-sheet"] as { text: string };
		const parsed = JSON.parse(projected.text) as typeof fullBeatSheet;
		expect(parsed.beats).toEqual(fullBeatSheet.beats.slice(0, 2));
		expect(parsed.sourceCoveragePlan.speechLedger).toEqual(fullBeatSheet.sourceCoveragePlan.speechLedger.slice(0, 2));
		expect(result.outputRefs.evidence).toMatchObject({
			sourceBeatCount: 3,
			selectedBeatCount: 2,
			requestedBeatCount: 2,
		});
	});

	it("rejects BeatSheet take nodes without a valid structural limit", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("first-beat", "video.beat-sheet.take/v1", {
				workflowBeatSheetTakeCount: 0,
			}, "once", ["beat-sheet"], undefined, ["beat-sheet"]),
			inputs: { "beat-sheet": [] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("workflowBeatSheetTakeCount between 1 and 1000"),
		});
	});

	it("reads the collection from the node's declared typed input port", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-split", "workflow.collection.split/v1", {
				workflowCollectionPath: "text",
				workflowCollectionParseJson: true,
				workflowCollectionItemIdField: "assetId",
			}, "once", ["asset-items"], undefined, ["asset-plans"]),
			inputs: {
				"asset-plans": [{
					text: '[{"assetId":"character-lin","role":"character_reference"},{"assetId":"scene-rooftop","role":"scene_reference"}]',
				}],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected typed asset plan collection split to succeed");
		const collection = result.outputRefs.ports["asset-items"];
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected typed asset item collection");
		expect(collection.items.map((item) => item.itemId)).toEqual(["character-lin", "scene-rooftop"]);
	});

	it("flat-maps arrays produced by an aligned upstream collection without losing lineage", async () => {
		const plannedBatches = createWorkflowCollection({
			collectionId: "planned-batches",
			producerNodeId: "clip-planner",
			producerPortId: "result",
			itemIds: ["chunk-0001", "chunk-0002"],
			values: [
				{ text: '[{"clipId":"chunk-0001-clip-001","text":"第一段"}]' },
				{ text: '[{"clipId":"chunk-0002-clip-001","text":"第二段"},{"clipId":"chunk-0002-clip-002","text":"第三段"}]' },
			],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("clips", "workflow.collection.split/v1", {
				workflowCollectionPath: "text",
				workflowCollectionParseJson: true,
				workflowCollectionItemIdField: "clipId",
			}, "once", ["items"], undefined, ["value"]),
			inputs: { value: [plannedBatches] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected nested planned batches to flatten");
		const clips = result.outputRefs.ports.items;
		expect(isWorkflowCollection(clips)).toBe(true);
		if (!isWorkflowCollection(clips)) throw new Error("Expected flattened workflow collection");
		expect(clips.items.map((item) => item.itemId)).toEqual([
			"chunk-0001-clip-001",
			"chunk-0002-clip-001",
			"chunk-0002-clip-002",
		]);
		expect(clips.items[1]?.lineage).toContainEqual(expect.objectContaining({
			nodeId: "clip-planner",
			itemId: "chunk-0002",
		}));
	});

	it("automatically executes an each node once per aligned item and aggregates outputs", async () => {
		const runAgent = vi.fn();
		const checkpoints: WorkflowNodeOutputV1[] = [];
		const runJavascript = vi.fn(async ({ input }: Readonly<{ input: unknown }>) => ({
			output: { prompt: `视频：${String(input)}` },
			durationMs: 3,
		}));
		const segments = createWorkflowCollection({
			collectionId: "segments",
			producerNodeId: "split",
			producerPortId: "items",
			values: ["第一段", "第二段"],
			itemIds: ["segment-1", "segment-2"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("prompt", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { prompt: `视频：${input}` }",
			}, "each", ["result"]),
			inputs: { input: [segments] },
			checkpointOutputRefs: async (outputRefs) => {
				checkpoints.push(outputRefs);
			},
		}), { runAgent, runJavascript, runVideo });

		expect(runJavascript).toHaveBeenCalledTimes(2);
		expect(runJavascript.mock.calls.map(([request]) => request.input)).toEqual(["第一段", "第二段"]);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected per-item JavaScript execution to succeed");
		expect(result.outputRefs.itemRuns).toHaveLength(2);
		expect(checkpoints).toHaveLength(2);
		expect(checkpoints.map((checkpoint) => checkpoint.evidence)).toMatchObject([
			{ executorCompleted: false, completedItems: 1, settledItems: 1, totalItems: 2 },
			{ executorCompleted: false, completedItems: 2, settledItems: 2, totalItems: 2 },
		]);
		expect(result.outputRefs.itemRuns.map((run) => run.runtimeNodeId)).toEqual([
			"prompt::item::segment-1",
			"prompt::item::segment-2",
		]);
		const collection = result.outputRefs.ports.result;
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected aggregated collection");
		expect(collection.items.map((item) => item.value)).toEqual([
			{ prompt: "视频：第一段" },
			{ prompt: "视频：第二段" },
		]);
	});

	it("aggregates successful each-node ports even when optional atomic output metadata is absent", async () => {
		const segments = createWorkflowCollection({
			collectionId: "segments-without-output-metadata",
			producerNodeId: "split",
			producerPortId: "items",
			values: ["第一段"],
			itemIds: ["segment-1"],
		});
		const runJavascript = vi.fn(async ({ input }: Readonly<{ input: unknown }>) => ({
			output: { prompt: `视频：${String(input)}` },
			durationMs: 3,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("prompt", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { prompt: `视频：${input}` }",
			}, "each", []),
			inputs: { input: [segments] },
		}), { runAgent: vi.fn(), runJavascript, runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected observed each-node port to aggregate");
		const collection = result.outputRefs.ports.result;
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected observed result collection");
		expect(collection.items.map((item) => item.value)).toEqual([{ prompt: "视频：第一段" }]);
	});

	it("binds a neutral each-node result to the single canonical outgoing topology port", async () => {
		const segments = createWorkflowCollection({
			collectionId: "segments-with-canonical-edge-port",
			producerNodeId: "split",
			producerPortId: "items",
			values: ["第一段"],
			itemIds: ["segment-1"],
		});
		const runJavascript = vi.fn(async ({ input }: Readonly<{ input: unknown }>) => ({
			output: { prompt: `视频：${String(input)}` },
			durationMs: 3,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("prompt", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { prompt: `视频：${input}` }",
			}, "each", []),
			inputs: { input: [segments] },
			flowVersionData: {
				nodes: [],
				edges: [{
					id: "prompt-to-package",
					source: "prompt",
					target: "package",
					sourceHandle: "out-workflow:clip-prompts",
					targetHandle: "in-workflow:clip-prompts",
				}],
			},
		}), { runAgent: vi.fn(), runJavascript, runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected canonical topology port binding");
		expect(result.outputRefs.ports.result).toBeUndefined();
		const collection = result.outputRefs.ports["clip-prompts"];
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected canonical clip-prompts collection");
		expect(collection.items[0]?.lineage.at(-1)?.portId).toBe("clip-prompts");
		expect(collection.items.map((item) => item.value)).toEqual([{ prompt: "视频：第一段" }]);
	});

	it("binds each-mode image results to the canonical topology port when atomic output metadata is absent", async () => {
		const assets = createWorkflowCollection({
			collectionId: "asset-plans-with-canonical-edge-port",
			producerNodeId: "asset-plan",
			producerPortId: "asset-items",
			values: [{
				assetId: "asset-1",
				prompt: "一位站在屋顶的老人",
				negativePrompt: "避免身份漂移",
				referenceAssetBindings: [],
			}],
			itemIds: ["asset-1"],
		});
		const runImage = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "image::item::asset-1::output::image",
			taskId: "image-task-1",
			imageUrl: "https://assets.example/asset-1.png",
			assetId: "generated-asset-1",
			reused: false,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("image", "tapcanvas.image.generate/v1", {
				workflowImageModelKey: "nano-banana-pro",
				workflowImageAspectRatio: "16:9",
				workflowImageSize: "1024x1024",
				workflowImageReferenceAssetBindings: [],
			}, "each", []),
			inputs: { "asset-items": [assets] },
			flowVersionData: {
				nodes: [],
				edges: [{
					id: "image-to-handoff",
					source: "image",
					target: "handoff",
					sourceHandle: "out-workflow:asset-bindings",
					targetHandle: "in-workflow:asset-bindings",
				}],
			},
		}), { runAgent: vi.fn(), runImage, runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected canonical image topology port binding");
		expect(result.outputRefs.ports.image).toBeUndefined();
		expect(result.outputRefs.ports.result).toBeUndefined();
		const collection = result.outputRefs.ports["asset-bindings"];
		expect(isWorkflowCollection(collection)).toBe(true);
		if (!isWorkflowCollection(collection)) throw new Error("Expected canonical asset-bindings collection");
		expect(collection.items).toHaveLength(1);
		expect(collection.items[0]?.value).toMatchObject({
			imageUrl: "https://assets.example/asset-1.png",
			generatedAssetId: "generated-asset-1",
		});
		expect(collection.items[0]?.lineage.at(-1)?.portId).toBe("asset-bindings");
	});

	it("binds a neutral once-node result to the single canonical outgoing topology port", async () => {
		const runJavascript = vi.fn(async () => ({
			output: { protocolVersion: "tapcanvas.voice-plan/v1", entries: [] },
			durationMs: 3,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("voice-plan-agent", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return input",
			}, "once", []),
			inputs: { input: [{ speakerNames: [] }] },
			flowVersionData: {
				nodes: [],
				edges: [{
					id: "voice-plan-to-materialize",
					source: "voice-plan-agent",
					target: "voice-materialize",
					sourceHandle: "out-workflow:voice-plan",
					targetHandle: "in-workflow:voice-plan",
				}],
			},
		}), { runAgent: vi.fn(), runJavascript, runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected once-node canonical topology port binding");
		expect(result.outputRefs.ports.result).toBeUndefined();
		expect(result.outputRefs.ports["voice-plan"]).toEqual({
			protocolVersion: "tapcanvas.voice-plan/v1",
			entries: [],
		});
	});

	it("keeps a neutral result unbound when outgoing topology ports are ambiguous", async () => {
		const runJavascript = vi.fn(async () => ({ output: { value: 1 }, durationMs: 3 }));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("ambiguous", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return input",
			}, "once", []),
			flowVersionData: {
				nodes: [],
				edges: [
					{ id: "edge-a", source: "ambiguous", target: "a", sourceHandle: "out-workflow:a", targetHandle: "in-workflow:a" },
					{ id: "edge-b", source: "ambiguous", target: "b", sourceHandle: "out-workflow:b", targetHandle: "in-workflow:b" },
				],
			},
		}), { runAgent: vi.fn(), runJavascript, runVideo });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ambiguous result to remain explicit");
		expect(result.outputRefs.ports.result).toEqual({ value: 1 });
		expect(result.outputRefs.ports.a).toBeUndefined();
		expect(result.outputRefs.ports.b).toBeUndefined();
	});

	it("bounds each-node concurrency, preserves item order, and keeps partial failure evidence", async () => {
		let active = 0;
		let maxActive = 0;
		const runJavascript = vi.fn(async ({ input }: Readonly<{ input: unknown }>) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			try {
				await new Promise((resolve) => setTimeout(resolve, input === 1 ? 12 : 2));
				if (input === 2) throw new Error("第二项执行失败");
				return { output: { value: input }, durationMs: 2 };
			} finally {
				active -= 1;
			}
		});
		const items = createWorkflowCollection({
			collectionId: "bounded-items",
			producerNodeId: "split",
			producerPortId: "items",
			values: [1, 2, 3, 4],
			itemIds: ["item-1", "item-2", "item-3", "item-4"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("bounded-script", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { value: input }",
			}, "each", ["result"], 2),
			inputs: { input: [items] },
		}), { runAgent: vi.fn(), runJavascript, runVideo });

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			outputRefs: {
				evidence: { itemConcurrency: 2, completedItems: 3, totalItems: 4 },
				itemRuns: [
					{ itemId: "item-1", status: "success" },
					{ itemId: "item-2", status: "failed", errorMessage: "第二项执行失败" },
					{ itemId: "item-3", status: "success" },
					{ itemId: "item-4", status: "success" },
				],
			},
		});
		expect(maxActive).toBe(2);
		expect(runJavascript).toHaveBeenCalledTimes(4);
		if (!result.ok && result.waitingExternal !== true) {
			const collection = result.outputRefs?.ports.result;
			expect(isWorkflowCollection(collection)).toBe(true);
			if (isWorkflowCollection(collection)) {
				expect(collection.items.map((item) => item.itemId)).toEqual(["item-1", "item-3", "item-4"]);
			}
		}
	});

	it("stops dispatching new items when durable progress checkpointing fails", async () => {
		const runJavascript = vi.fn(async ({ input }: Readonly<{ input: unknown }>) => ({
			output: input,
			durationMs: 1,
		}));
		const items = createWorkflowCollection({
			collectionId: "checkpoint-items",
			producerNodeId: "split",
			producerPortId: "items",
			values: [1, 2, 3],
			itemIds: ["item-1", "item-2", "item-3"],
		});

		const result = await executeRegisteredWorkflowNode(context({
			node: node("checkpoint-script", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return input",
			}, "each", ["result"], 1),
			inputs: { input: [items] },
			checkpointOutputRefs: async () => {
				throw new Error("checkpoint unavailable");
			},
		}), { runAgent: vi.fn(), runJavascript, runVideo });
		expect(result).toMatchObject({ ok: false, errorMessage: "checkpoint unavailable" });
		expect(result.outputRefs?.itemRuns).toHaveLength(1);
		expect(result.outputRefs?.itemRuns[0]).toMatchObject({ itemId: "item-1", status: "success" });
		expect(result.outputRefs?.artifacts[0]).toMatchObject({ type: "tapcanvas.json/v1", value: 1 });
		expect(runJavascript).toHaveBeenCalledTimes(1);
	});

	it("executes the complete document-to-dynamic-prompts chain and collects verified delivery", async () => {
		const runAgent = vi.fn(async (request: {
			nodeId: string;
			inputs: Record<string, readonly unknown[]>;
			forcedAgentRole: string | null;
		}) => ({
			taskId: `task:${request.nodeId}`,
			text: request.nodeId === "clip-planner"
				? JSON.stringify([
					{ clipId: "clip-1", text: "第一段" },
					{ clipId: "clip-2", text: "第二段" },
					{ clipId: "clip-3", text: "第三段" },
				])
				: `15 秒提示词：${JSON.stringify(request.inputs.input?.[0])}`,
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: `evidence:${request.nodeId}` }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const runJavascript = vi.fn(async (request: { code: string; input: unknown }) => ({
			output: {
				fullText: request.input,
				paragraphs: [{ paragraphId: "paragraph-0001", text: request.input }],
			},
			durationMs: 4,
		}));
		const dependencies = { runAgent, runJavascript, runVideo };
		const textResult = await executeRegisteredWorkflowNode(context({
			node: node("document", "workflow.input.text/v1", { workflowTextInput: "真实长篇正文" }, "once", ["text"]),
		}), dependencies);
		expect(textResult.ok).toBe(true);
		if (!textResult.ok) throw new Error("Expected document input to complete");

		const structureResult = await executeRegisteredWorkflowNode(context({
			node: node("source-structure", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return { fullText: input, paragraphs: [{ paragraphId: 'paragraph-0001', text: input }] }",
			}, "once", ["result"]),
			inputs: { input: [textResult.outputRefs.ports.text] },
		}), dependencies);
		expect(structureResult.ok).toBe(true);
		if (!structureResult.ok) throw new Error("Expected source structure node to complete");
		expect(runJavascript).toHaveBeenCalledWith(expect.objectContaining({ input: "真实长篇正文" }));

		const plannerResult = await executeRegisteredWorkflowNode(context({
			node: node("clip-planner", "agents.logical-task/v2", {
				workflowInstruction: "动态规划 15 秒片段",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付动态片段 JSON 数组",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "gemini-3.1-pro",
			}, "once", ["result"]),
			inputs: { input: [structureResult.outputRefs.ports.result] },
		}), dependencies);
		expect(plannerResult.ok).toBe(true);
		if (!plannerResult.ok) throw new Error("Expected clip planner to complete");

		const splitResult = await executeRegisteredWorkflowNode(context({
			node: node("clips", "workflow.collection.split/v1", {
				workflowCollectionPath: "text",
				workflowCollectionParseJson: true,
				workflowCollectionItemIdField: "clipId",
			}, "once", ["items"], undefined, ["value"]),
			inputs: { value: [plannerResult.outputRefs.ports.result] },
		}), dependencies);
		expect(splitResult.ok).toBe(true);
		if (!splitResult.ok) throw new Error("Expected dynamic collection split to complete");
		const clips = splitResult.outputRefs.ports.items;
		expect(isWorkflowCollection(clips)).toBe(true);
		if (!isWorkflowCollection(clips)) throw new Error("Expected planner output to become a collection");
		expect(clips.items.map((item) => item.itemId)).toEqual(["clip-1", "clip-2", "clip-3"]);

		const promptResult = await executeRegisteredWorkflowNode(context({
			node: node("prompt-agent", "agents.logical-task/v2", {
				workflowInstruction: "生成当前 15 秒视频提示词",
				workflowAgentOutputArtifactType: "tapcanvas.video-prompt/v1",
				workflowAgentDeliveryRequirement: "交付当前数据项的一条 15 秒视频提示词",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "gemini-3.1-pro",
			}, "each", ["result"]),
			inputs: { input: [clips] },
		}), dependencies);

		expect(promptResult.ok).toBe(true);
		if (!promptResult.ok) throw new Error("Expected dynamic Agent map to complete");
		expect(runAgent).toHaveBeenCalledTimes(4);
		expect(runAgent.mock.calls[0]?.[0].forcedAgentRole).toBe("writer");
		expect(runAgent.mock.calls.slice(1).map(([request]) => request.forcedAgentRole)).toEqual([
			"video-prompt-writer",
			"video-prompt-writer",
			"video-prompt-writer",
		]);
		expect(promptResult.outputRefs.itemRuns.map((item) => item.itemId)).toEqual(["clip-1", "clip-2", "clip-3"]);
		expect(promptResult.outputRefs.itemRuns.every((item) => item.artifacts[0]?.type === "tapcanvas.video-prompt/v1")).toBe(true);
		const prompts = promptResult.outputRefs.ports.result;
		expect(isWorkflowCollection(prompts)).toBe(true);
		if (!isWorkflowCollection(prompts)) throw new Error("Expected Agent outputs to remain a collection");

		const delivery = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", {
				workflowDeliveryRequirement: "验收全部动态视频提示词",
				workflowDeliveryArtifactType: "tapcanvas.video-prompt/v1",
			}, "collect", ["delivery-evidence"]),
			inputs: { result: [prompts] },
		}), dependencies);

		expect(delivery).toMatchObject({ ok: true, outputRefs: { evidence: { verifiedItems: 3 } } });
	});

	it("fails before execution when multiple collections have different item identities", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn();
		const left = createWorkflowCollection({
			collectionId: "left",
			producerNodeId: "left-source",
			producerPortId: "items",
			values: [1, 2],
			itemIds: ["a", "b"],
		});
		const right = createWorkflowCollection({
			collectionId: "right",
			producerNodeId: "right-source",
			producerPortId: "items",
			values: [3, 4],
			itemIds: ["a", "c"],
		});
		const result = await executeRegisteredWorkflowNode(context({
			node: node("join-script", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return input",
			}, "each"),
			inputs: { input: [left, right] },
		}), { runAgent, runJavascript, runVideo });

		expect(result).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
		expect(runJavascript).not.toHaveBeenCalled();
	});

	it("executes typed text and capability configuration nodes", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn();
		const textResult = await executeRegisteredWorkflowNode(context({
			node: node("text", "workflow.input.text/v1", { workflowTextInput: "真实测试文本" }),
		}), { runAgent, runJavascript, runVideo });
		const skillResult = await executeRegisteredWorkflowNode(context({
			node: node("skill", "agents.skill.require/v1", { workflowSkillId: "tapcanvas-research" }),
		}), { runAgent, runJavascript, runVideo });

		expect(textResult).toMatchObject({ ok: true, outputRefs: { ports: { text: "真实测试文本" } } });
		expect(skillResult).toMatchObject({ ok: true, outputRefs: { ports: { skills: ["tapcanvas-research"] } } });
	});

	it("accepts an inline trigger source for text expansion workflows", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("text", "workflow.input.text/v1", { workflowTextInput: "" }, "once", ["text"]),
			inputs: { trigger: [{ source: "粗略剧情：外神降临" }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { text: "粗略剧情：外神降临" },
			},
		});
	});

	it("persists Knowledge Search candidates and requires their exact artifact for Knowledge Read", async () => {
		const candidateSet = {
			protocolVersion: "workflow.knowledge-candidates/v2" as const,
			candidateSetId: "domain_test",
			requestHash: "request-hash",
			createdAt: "2026-08-13T00:00:00.000Z",
			retrievalMode: "vector" as const,
			abstained: false,
			diagnostics: {
				vectorCandidates: 1,
				indexedCards: 1,
				availableCards: 1,
				embeddingModel: "test-embedding",
			},
			candidates: [{
				cardId: "card-1",
				sourceRoot: "builtin:agents-cli/knowledge",
				domain: "导演",
				facet: null,
				title: "镜头设计",
				roleScope: ["director"],
				contentSha256: "a".repeat(64),
				bodyBytes: 100,
				rank: 1,
				score: 0.9,
				vectorScore: 0.9,
				vectorRank: 1,
				matchedQueryIds: ["raw-user-request"],
			}],
		};
		const searchKnowledge = vi.fn(async () => candidateSet);
		const searchResult = await executeRegisteredWorkflowNode(context({
			node: node("knowledge-search", "agents.knowledge.search/v1", {
				workflowKnowledgeLimit: 5,
			}, "once", ["knowledge-candidates"], undefined, ["query"]),
			inputs: { query: ["如何设计镜头"] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, searchKnowledge });

		expect(searchKnowledge).toHaveBeenCalledWith(expect.objectContaining({
			rawUserRequest: "如何设计镜头",
			limit: 5,
		}));
		expect(searchResult).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { "knowledge-candidates": candidateSet },
				artifacts: [{ type: "workflow.knowledge-candidates/v2", identity: "domain_test" }],
			},
		});

		const readKnowledge = vi.fn(async () => ({
			protocolVersion: "workflow.knowledge-card/v1" as const,
			candidateSetId: candidateSet.candidateSetId,
			requestHash: candidateSet.requestHash,
			cardId: "card-1",
			domain: "导演",
			facet: null,
			title: "镜头设计",
			roleScope: ["director"],
			keywords: ["景别"],
			sourceUrls: [],
			body: "完整知识正文",
		}));
		const readResult = await executeRegisteredWorkflowNode(context({
			node: node("knowledge-read", "agents.knowledge.read/v1", {}, "once", ["knowledge-evidence"], undefined, ["knowledge-candidates", "card-id"]),
			inputs: { "knowledge-candidates": [candidateSet], "card-id": [{ cardId: "card-1" }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, readKnowledge });

		expect(readKnowledge).toHaveBeenCalledWith({ candidateSet, cardId: "card-1" });
		expect(readResult).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { "knowledge-evidence": { cardId: "card-1", body: "完整知识正文" } },
			},
		});
	});

	it("executes a configured tool separately from Agent tool authorization", async () => {
		const invokeTool = vi.fn(async () => ({
			toolName: "tapcanvas_project_context_get",
			content: "{\"projectId\":\"project-1\"}",
			data: { projectId: "project-1" },
			execution: { sideEffect: "none" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("tool-call", "agents.tool.invoke/v1", {
				workflowToolInvocationName: "tapcanvas_project_context_get",
				workflowToolInvocationArgs: "{\"refresh\":true}",
			}, "once", ["result"], undefined, ["arguments"]),
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, invokeTool });

		expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({
			toolName: "tapcanvas_project_context_get",
			args: { refresh: true },
			ownerId: "user-1",
		}));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { result: { projectId: "project-1" } },
				evidence: { toolName: "tapcanvas_project_context_get", completed: true },
			},
		});
	});

	it("carries upstream delivery metadata through tool invocation without sending it as tool args", async () => {
		const invokeTool = vi.fn(async () => ({
			toolName: "tapcanvas_flow_patch",
			content: "{\"ok\":true}",
			data: { ok: true },
			execution: { sideEffect: "state" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("tool-call", "agents.tool.invoke/v1", {
				workflowToolInvocationName: "tapcanvas_flow_patch",
			}, "once", ["result"], undefined, ["arguments"]),
			inputs: {
				arguments: [{
					allowOverwrite: true,
					patchNodeData: [{ id: "expanded-source", data: { content: "正文" } }],
					deliveryEvidence: { source: "agent" },
					deliveryVerification: { version: 2, status: "satisfied" },
				}],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, invokeTool });

		expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({
			toolName: "tapcanvas_flow_patch",
			args: { allowOverwrite: true, patchNodeData: [{ id: "expanded-source", data: { content: "正文" } }] },
		}));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					result: {
						ok: true,
						deliveryEvidence: { source: "agent" },
						deliveryVerification: { version: 2, status: "satisfied" },
					},
				},
			},
		});
	});

	it("persists Human Approval waiting evidence and resumes the same node after a response", async () => {
		const approvalNode = node("approval", "workflow.human.approval/v1", {
			workflowHumanPrompt: "是否允许继续发布？",
		}, "once", ["decision"], undefined, ["input"]);
		const pending = await executeRegisteredWorkflowNode(context({ node: approvalNode }), {
			runAgent: vi.fn(), runJavascript: vi.fn(), runVideo,
		});
		expect(pending).toMatchObject({
			ok: false,
			waitingExternal: true,
			externalCheck: { version: 1, mode: "signal_only" },
			outputRefs: {
				evidence: {
					executorCompleted: false,
					humanRequest: { prompt: "是否允许继续发布？", responseType: "approval" },
				},
			},
		});
		if (pending.ok || pending.waitingExternal !== true) throw new Error("Expected approval wait");
		const resumed = await executeRegisteredWorkflowNode({
			...context({ node: approvalNode }),
			resumeOnly: true,
			resumeOutputRefs: {
				...pending.outputRefs,
				evidence: {
					...pending.outputRefs.evidence,
					humanResponse: "approved",
					humanRespondedAt: "2026-08-13T00:00:00.000Z",
					humanRespondedBy: "user-1",
				},
			},
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		expect(resumed).toMatchObject({
			ok: true,
			outputRefs: { ports: { decision: { status: "approved", approved: true } } },
		});
	});

	it("emits exactly one selective port for a structural condition", async () => {
		const conditionNode = node("condition", "workflow.control.condition/v1", {
			workflowConditionPointer: "/status",
			workflowConditionOperator: "equals",
			workflowConditionExpectedJson: "\"ready\"",
		}, "once", ["matched", "unmatched"], undefined, ["value"]);
		const result = await executeRegisteredWorkflowNode(context({
			node: conditionNode,
			inputs: { value: [{ status: "ready" }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { matched: { protocolVersion: "workflow.condition-decision/v1", matched: true, pointer: "/status", operator: "equals", selectedValue: "ready" } },
				evidence: { selectedOutputPort: "matched", matched: true },
			},
		});
		if (!result.ok) throw new Error("Expected structural condition to succeed");
		expect(Object.keys(result.outputRefs.ports)).toEqual(["matched"]);
	});

	it("preserves evidence while honoring an explicit failure terminal", async () => {
		const result = await executeRegisteredWorkflowNode(context({
			node: node("terminal", "workflow.control.terminal/v1", {
				workflowTerminalOutcome: "failed",
				workflowTerminalMessage: "审批被拒绝",
			}, "once", ["result"], undefined, ["input"]),
			inputs: { input: [{ decision: "rejected" }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_explicit_failure_terminal",
			errorMessage: "审批被拒绝",
			outputRefs: { evidence: { terminalOutcome: "failed", terminalMessage: "审批被拒绝" } },
		});
	});

	it("persists one child execution identity and reconciles the pinned subworkflow", async () => {
		const subworkflowNode = node("subworkflow", "workflow.subworkflow.run/v1", {
			workflowSubflowFlowId: "flow-child",
			workflowSubflowVersionId: "version-child-pinned",
			workflowSubflowTriggerNodeId: "trigger-child",
		}, "once", ["result"], undefined, ["input"]);
		const runSubworkflow = vi.fn()
			.mockResolvedValueOnce({ status: "waiting_external", childExecutionId: "execution-child", childFlowVersionId: "version-child-runtime" })
			.mockResolvedValueOnce({
				status: "success",
				childExecutionId: "execution-child",
				childFlowVersionId: "version-child-runtime",
				nodeRuns: [{ nodeId: "output", status: "success", outputRefs: { ports: { result: "done" } } }],
			});
		const pending = await executeRegisteredWorkflowNode(context({ node: subworkflowNode, inputs: { input: [{ task: "child" }] } }), {
			runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runSubworkflow,
		});
		expect(pending).toMatchObject({ ok: false, waitingExternal: true, outputRefs: { evidence: { childExecutionId: "execution-child", targetFlowVersionId: "version-child-pinned" } } });
		if (pending.ok || pending.waitingExternal !== true) throw new Error("Expected subworkflow wait");
		const resumed = await executeRegisteredWorkflowNode({
			...context({ node: subworkflowNode, inputs: { input: [{ task: "child" }] } }),
			resumeOnly: true,
			resumeOutputRefs: pending.outputRefs,
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runSubworkflow });
		expect(runSubworkflow).toHaveBeenLastCalledWith(expect.objectContaining({
			childExecutionId: "execution-child",
			targetFlowVersionId: "version-child-pinned",
			parentFlowVersionId: "flow-version-parent",
		}));
		expect(resumed).toMatchObject({ ok: true, outputRefs: { ports: { result: { childExecutionId: "execution-child" } } } });
	});

	it("forwards frozen Workflow Skill dependencies alongside open discovery", async () => {
		const executionProvenance = {
			version: 1 as const,
			executionId: "agent-execution-1",
			agentId: "research-agent",
			depth: 0,
			model: "gemini-3.1-pro",
			apiStyle: "responses" as const,
			requiredSkills: ["tapcanvas-source-coverage", "tapcanvas-research"],
			loadedSkills: ["tapcanvas-source-coverage", "tapcanvas-research"],
			loadedKnowledgeSources: [{
				cardId: "knowledge-card-1",
				title: "研究证据卡",
				sourceUrls: ["https://example.com/source"],
				contentHash: `sha256:${"a".repeat(64)}`,
				contentChars: 128,
			}],
			startedAt: "2026-08-15T00:00:00.000Z",
		};
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-1",
			text: "完成",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
			executionProvenance,
			promptExampleCandidateSearch: {
				version: 1 as const,
				status: "candidate_found" as const,
				mediaType: "video" as const,
				attempted: true,
				remoteAttempted: true,
				candidateCount: 2,
				blocking: false as const,
				rationale: "已返回两个视频案例候选元数据。",
				toolCallId: "search-1",
			},
		}));
		const runJavascript = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			flowVersionData: { nodes: [{ id: "trigger", data: { workflowTriggerPayload: { chapterId: "chapter-1", workflowRootTaskIdentity: { version: 1, ownerId: "user-1", logicalTaskBudgetRootId: "public-turn-origin" } } } }] },
				node: node("agent", "agents.logical-task/v2", {
					workflowInstruction: "生成报告",
					workflowAgentOutputArtifactType: "tapcanvas.json/v1",
					workflowAgentDeliveryRequirement: "交付一个可解析且可追溯的 JSON 报告产物",
					workflowAgentDefinitionId: "research",
					workflowAgentModelKey: "gemini-3.1-pro",
					workflowRequiredSkills: ["tapcanvas-source-coverage", "tapcanvas-research"],
					workflowKnowledgeCardIds: ["knowledge-card-mounted", "knowledge-card-disabled"],
					workflowDisabledSkillReferences: ["tapcanvas-research"],
					workflowDisabledKnowledgeCardIds: ["knowledge-card-disabled"],
					workflowAllowedTools: ["tapcanvas_project_read"],
					workflowPromptExampleMediaType: "video",
				}),
			inputs: {
				input: ["测试输入"],
				skills: [["tapcanvas-research"]],
				tools: [["tapcanvas_canvas_read"]],
			},
		}), { runAgent, runJavascript, runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			logicalTaskBudgetRootId: "execution-family-1",
			forcedAgentRole: "research",
			modelKey: "gemini-3.1-pro",
			deliveryRequirement: "交付一个可解析且可追溯的 JSON 报告产物",
			requiredSkills: ["tapcanvas-source-coverage", "tapcanvas-research"],
			mountedKnowledgeCardIds: [],
			disabledSkills: [],
			disabledKnowledgeCardIds: [],
			allowedTools: [
				"skill_search",
				"Skill",
				"knowledge_search",
				"knowledge_candidates_page",
				"knowledge_read",
				"tapcanvas_project_read",
				"tapcanvas_canvas_read",
				"prompt_example_search",
				"prompt_example_read",
			],
			promptExampleRetrievalScope: {
				version: 3,
				mediaType: "video",
				searchPolicy: "agent_discretion",
			},
		}));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				evidence: {
					executionProvenance,
					promptExampleCandidateSearch: {
						status: "candidate_found",
						candidateCount: 2,
						toolCallId: "search-1",
					},
				},
				artifacts: [{ type: "tapcanvas.json/v1", identity: "agent-task-1", value: "完成" }],
			},
		});
	});

	it("keeps read-only retrieval tools open for typed authoring", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "typed-agent-task-1",
			text: JSON.stringify({ result: "完成" }),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-typed-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("typed-agent", "agents.logical-task/v2", {
				workflowInstruction: "生成 JSON",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付一个 JSON 对象",
				workflowAgentDefinitionId: "research",
				workflowAgentModelKey: "configured-model",
				workflowRequiredSkills: ["tapcanvas-research"],
				workflowPromptExampleMediaType: "video",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["result"],
					allowedFields: ["result"],
				},
			}),
			inputs: {
				input: [{
					executionProvenance: {
						loadedKnowledgeSources: [{ cardId: "card-combat" }],
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			mountedKnowledgeCardIds: ["card-combat"],
			allowedTools: [
				"skill_search",
				"Skill",
				"knowledge_search",
				"knowledge_candidates_page",
				"knowledge_read",
				"prompt_example_search",
				"prompt_example_read",
			],
		}));
		expect(result).toMatchObject({ ok: true });
	});

	it.each(["json_object", "json_array"])("preserves media evidence and frozen tool grants for %s authoring", async (encoding) => {
		const runAgent = vi.fn(async (_request: { allowedTools: readonly string[] }) => ({
			taskId: "media-author-1",
			text: encoding === "json_object" ? '{"result":"observed"}' : '[{"result":"observed"}]',
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "observed-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const projectContext = { ...selectedAssetProjectContext(["image-a"]), selectedAssetIds: [], selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null } };
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("media-author", "agents.logical-task/v2", {
					workflowInstruction: "Interpret authorized inputs",
					workflowAgentOutputEncoding: encoding,
					workflowAgentOutputArtifactType: "tapcanvas.test/v1",
					workflowAgentDeliveryRequirement: "Return the requested structured artifact",
					workflowAgentModelKey: "configured-model",
					workflowAgentDefinitionId: "research",
					workflowAllowedTools: ["tapcanvas_flow_get"],
					workflowAgentJsonObjectContract: { requiredStringFields: ["result"], allowedFields: ["result"] },
					workflowAgentJsonArrayContract: { itemRequiredStringFields: ["result"], itemAllowedFields: ["result"] },
				}),
			}),
			projectContext,
		}, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result.ok).toBe(true);
		const tools = runAgent.mock.calls[0]![0];
		expect(tools.allowedTools).toEqual(expect.arrayContaining(["Skill", "tapcanvas_flow_get", "tapcanvas_image_refs_get", "tapcanvas_analyze_image"]));
		expect(tools.allowedTools).not.toContain("tapcanvas_image_generate_to_canvas");
		expect(tools.allowedTools).not.toContain("tapcanvas_flow_patch");
	});

	it("mounts knowledge receipts from the clip authoring evidence packet", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "typed-agent-packet-1",
			text: JSON.stringify({ result: "完成" }),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-typed-packet-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		await executeRegisteredWorkflowNode(context({
			node: node("typed-agent-packet", "agents.logical-task/v2", {
				workflowInstruction: "生成 JSON",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
				workflowAgentDeliveryRequirement: "交付一个 Clip 提示词对象",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "configured-model",
				workflowRequiredSkills: ["tapcanvas-video-prompt-writer"],
				workflowPromptExampleMediaType: "video",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["result"],
					allowedFields: ["result"],
				},
			}),
			inputs: {
				"clip-contexts": [{
					authoringEvidencePacket: {
						dependencyProvenance: {
							loadedKnowledgeSources: [{ cardId: "card-packet-combat" }],
						},
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			mountedKnowledgeCardIds: ["card-packet-combat"],
		}));
	});

	it("scopes system-level workflow Agent nodes to the caller project and canvas", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-delivery",
			text: "完成",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent", "agents.logical-task/v2", {
					workflowInstruction: "生成报告",
					workflowAgentOutputArtifactType: "tapcanvas.json/v1",
					workflowAgentDeliveryRequirement: "交付一个可解析且可追溯的 JSON 报告产物",
					workflowAgentDefinitionId: "research",
					workflowAgentModelKey: "gemini-3.1-pro",
				}),
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "caller-flow-1",
			projectId: "caller-project-1",
			deliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
		}));
	});

	it("keeps the workflow project canvas scope when no delivery is frozen", async () => {
		const projectContext = selectedAssetProjectContext(["asset-project-candidate"]);
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-local",
			text: "完成",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-1" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		await executeRegisteredWorkflowNode(context({
			flowVersionData: { workflowProjectContext: projectContext },
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付一个可解析且可追溯的 JSON 报告产物",
				workflowAgentDefinitionId: "research",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "flow-1",
			projectId: "project-1",
			projectContext,
		}));
		expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("deliveryScope");
	});

	it("binds a system-level workflow canvas_group source to the caller canvas group", async () => {
		const readCanvasGroupFromFlow = vi.fn(async () => ({
			flowId: "caller-flow-1",
			groupId: "caller-group-1",
			group: { id: "caller-group-1", type: "groupNode", data: { label: "调用者源组" } },
			children: [
				{ id: "caller-text", type: "taskNode", parentId: "caller-group-1", data: { text: "调用者正文" } },
				{ id: "caller-img", type: "taskNode", parentId: "caller-group-1", data: { kind: "image", status: "success", imageUrl: "https://caller.tapcanvas.test/ref.png" } },
			],
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "canvas_group",
					sourceGroupId: "template-group",
				}),
				inputs: {
					trigger: [{
						sourceGroupId: "caller-group-1",
						source: "调用者正文",
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasGroupFromFlow,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasGroupFromFlow).toHaveBeenCalledWith({
			flowId: "caller-flow-1",
			ownerId: "user-1",
			groupId: "caller-group-1",
		});
		expect(result).toMatchObject({
			outputRefs: {
				evidence: { sourceGroupId: "caller-group-1", sourceFlowId: "caller-flow-1", sourceChildCount: 2 },
				artifacts: [{
					type: "tapcanvas.canvas-facts/v1",
					identity: "caller-group-1",
					value: {
						flowId: "caller-flow-1",
						groupId: "caller-group-1",
						children: [
							{ id: "caller-text", data: { text: "调用者正文" } },
							{ id: "caller-img", data: { imageUrl: "https://caller.tapcanvas.test/ref.png" } },
						],
					},
				}],
			},
		});
	});

	it("fails a system-level canvas_group source without a caller sourceGroupId", async () => {
		const readCanvasGroupFromFlow = vi.fn();
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "canvas_group",
					sourceGroupId: "template-group",
				}),
				inputs: { trigger: [{ source: "调用者正文" }] },
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasGroupFromFlow,
		});

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("triggerPayload.sourceGroupId"),
		});
		expect(readCanvasGroupFromFlow).not.toHaveBeenCalled();
	});

	it("reads a project_context source without a SmallT-planned group and preserves call configuration", async () => {
		const readCanvasProjectContextFromSnapshot = vi.fn(async () => ({
			sourceMode: "project_context" as const,
			flowId: "caller-flow-1",
			sourceNodeIds: ["caller-text"],
			nodes: [{ id: "caller-text", type: "taskNode", data: { kind: "text", content: "调用者正文" } }],
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "project_context",
				}),
				inputs: {
					trigger: [{
						targetDurationSeconds: 40,
						videoModelKey: "doubao-seedance-2.5",
						workflowVideoDurationPlan: {
							protocolVersion: "tapcanvas.workflow-video-duration-plan/v2",
							targetDurationSeconds: 40,
							modelKey: "doubao-seedance-2.5",
							durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
							maxDurationSeconds: 30,
							policy: "agent_semantic_duration_budget",
						},
					}],
			},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
				workflowProjectContext: {
					version: 3,
					projectId: "caller-project-1",
					canvasId: "caller-flow-1",
					sourceNodeId: null,
					selectedAssetIds: [],
					projectAssetIds: [],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: {
						principalId: "user-1",
						projectRead: true,
						canvasRead: true,
						assetRead: true,
						assetWrite: true,
					},
					assetSnapshot: [],
					capturedAt: "2026-08-18T00:00:00.000Z",
				},
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasProjectContextFromSnapshot,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "caller-flow-1",
			ownerId: "user-1",
		}));
		expect(result).toMatchObject({
			outputRefs: {
				evidence: {
					sourceMode: "project_context",
					sourceReadBoundary: "acceptance_snapshot",
					sourceNodeIds: ["caller-text"],
				},
				artifacts: [{
					value: {
						callConfig: {
							targetDurationSeconds: 40,
							videoModelKey: "doubao-seedance-2.5",
						},
					},
				}],
			},
		});
	});

	it("passes the server-owned accepted turn source when a public request has no text node", async () => {
		const readCanvasProjectContextFromSnapshot = vi.fn(async () => ({
			sourceMode: "project_context" as const,
			flowId: "caller-flow-1",
			sourceNodeIds: [],
			nodes: [],
			authoritativeSources: [{
				sourceId: "public-turn-1",
				content: "15秒电商视频",
				sourceFingerprint: "6c6791c32b5d6d9e9eb6a2274de056480c10600d8a06701954f356dba7bda344",
			}],
		}));
		const acceptedTurnSource = {
			protocolVersion: "tapcanvas.workflow-accepted-turn-source/v1" as const,
			kind: "public_chat_turn" as const,
			ownerId: "user-1",
			sourceId: "public-turn-1",
			text: "15秒电商视频",
			fingerprint: "6c6791c32b5d6d9e9eb6a2274de056480c10600d8a06701954f356dba7bda344",
		};
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "project_context",
				}),
				inputs: { trigger: [{ workflowAcceptedTurnSource: acceptedTurnSource }] },
			}),
			flowVersionData: {
				workflowProjectContext: {
					version: 3,
					projectId: "caller-project-1",
					canvasId: "caller-flow-1",
					sourceNodeId: null,
					selectedAssetIds: [],
					projectAssetIds: [],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
					assetSnapshot: [],
					capturedAt: "2026-08-18T00:00:00.000Z",
				},
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasProjectContextFromSnapshot,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			allowNoTextSource: true,
			acceptedTurnSource,
		}));
	});

	it("keeps canvas ProjectContext authoritative while projecting the accepted public-chat turn as userRequest", async () => {
		const readCanvasProjectContextFromSnapshot = vi.fn(async () => ({
			sourceMode: "project_context" as const,
			flowId: "caller-flow-1",
			sourceNodeIds: ["caller-text"],
			nodes: [{ nodeId: "caller-text", kind: "text", content: "画布里的视频事实：雨夜霓虹追逐" }],
			authoritativeSources: [{ sourceId: "caller-text", content: "画布里的视频事实：雨夜霓虹追逐" }],
		}));
		const acceptedSource = createWorkflowAcceptedTurnSource({
			ownerId: "user-1",
			sourceId: "public-turn-1",
			text: "创作一条二十秒的雨夜霓虹追逐视频",
		});
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "project_context",
				}),
				inputs: {
					trigger: [{
						targetDurationSeconds: 20,
						videoModelKey: "doubao-seedance-2.0",
						[WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD]: acceptedSource,
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
				workflowProjectContext: {
					version: 3,
					projectId: "caller-project-1",
					canvasId: "caller-flow-1",
					sourceNodeId: null,
					selectedAssetIds: [],
					projectAssetIds: [],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: {
						principalId: "user-1",
						projectRead: true,
						canvasRead: true,
						assetRead: true,
						assetWrite: true,
					},
					assetSnapshot: [],
					capturedAt: "2026-08-22T00:00:00.000Z",
				},
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasProjectContextFromSnapshot,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "caller-flow-1",
			ownerId: "user-1",
		}));
		expect(result).toMatchObject({
			outputRefs: {
				evidence: {
					sourceMode: "project_context",
					sourceFlowId: "caller-flow-1",
					sourceNodeIds: ["caller-text"],
				},
				artifacts: [{
					identity: "caller-flow-1:project-context",
					value: {
						sourceMode: "project_context",
						authoritativeSources: [{ sourceId: "caller-text", content: "画布里的视频事实：雨夜霓虹追逐" }],
						userRequest: {
							kind: "public_chat_turn",
							requestId: "public-turn-1",
							content: "创作一条二十秒的雨夜霓虹追逐视频",
							requestFingerprint: acceptedSource.fingerprint,
						},
						callConfig: {
							targetDurationSeconds: 20,
							videoModelKey: "doubao-seedance-2.0",
						},
					},
				}],
			},
		});
		const artifact = result.ok ? result.outputRefs.artifacts?.[0]?.value : null;
		expect(artifact).not.toHaveProperty(WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD);
	});

	it("keeps the chapter as story authority while projecting the accepted public-chat turn as userRequest", async () => {
		const readCanvasProjectContextFromSnapshot = vi.fn(async () => ({
			sourceMode: "project_context" as const,
			flowId: "chapter-36",
			sourceNodeIds: ["chapter-seed-36"],
			nodes: [{ nodeId: "chapter-seed-36", kind: "text", content: "章节原文" }],
			authoritativeSources: [{ sourceId: "chapter-seed-36", content: "章节原文" }],
		}));
		const acceptedRequest = createWorkflowAcceptedTurnSource({
			ownerId: "user-1",
			sourceId: "public-turn-ch36",
			text: "完成第36章成片，画面张力要大，使用480p",
		});
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "project_context",
				}),
				inputs: { trigger: [{
					resolution: "480p",
					[WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD]: acceptedRequest,
				}] },
			}),
			flowVersionData: {
				workflowDeliveryScope: {
					flowId: "chapter-36",
					projectId: "caller-project-1",
					chapterId: "chapter-36",
				},
				workflowProjectContext: {
					version: 3,
					projectId: "caller-project-1",
					canvasId: "chapter:chapter-36",
					sourceNodeId: "chapter-seed-36",
					selectedAssetIds: [],
					projectAssetIds: [],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: {
						principalId: "user-1",
						projectRead: true,
						canvasRead: true,
						assetRead: true,
						assetWrite: true,
					},
					assetSnapshot: [],
					capturedAt: "2026-08-23T00:00:00.000Z",
				},
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasProjectContextFromSnapshot,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "chapter-36",
			chapterId: "chapter-36",
		}));
		const artifact = result.ok ? result.outputRefs.artifacts?.[0]?.value : null;
		expect(artifact).toMatchObject({
			sourceMode: "project_context",
			authoritativeSources: [{ sourceId: "chapter-seed-36", content: "章节原文" }],
			userRequest: {
				kind: "public_chat_turn",
				requestId: "public-turn-ch36",
				content: "完成第36章成片，画面张力要大，使用480p",
				requestFingerprint: acceptedRequest.fingerprint,
			},
			callConfig: { resolution: "480p" },
		});
		expect(artifact).not.toHaveProperty(WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD);
	});

	it("rejects a forged accepted-turn source before reading project canvas content", async () => {
		const readCanvasProjectContextFromSnapshot = vi.fn();
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("canvas-source", "tapcanvas.canvas.group.read/v1", {
					workflowSourceMode: "project_context",
				}),
				inputs: {
					trigger: [{
						[WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD]: {
							protocolVersion: "tapcanvas.workflow-accepted-turn-source/v1",
							kind: "public_chat_turn",
							ownerId: "another-user",
							sourceId: "public-turn-forged",
							text: "伪造来源",
							fingerprint: "invalid",
						},
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
				workflowProjectContext: {
					version: 3,
					projectId: "caller-project-1",
					canvasId: "caller-flow-1",
					sourceNodeId: null,
					selectedAssetIds: [],
					projectAssetIds: [],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: {
						principalId: "user-1",
						projectRead: true,
						canvasRead: true,
						assetRead: true,
						assetWrite: true,
					},
					assetSnapshot: [],
					capturedAt: "2026-08-22T00:00:00.000Z",
				},
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runVideo,
			readCanvasProjectContextFromSnapshot,
		});

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("workflow_accepted_turn_source_invalid"),
		});
		expect(readCanvasProjectContextFromSnapshot).not.toHaveBeenCalled();
	});

	it("rejects an Agent node without an explicit real Agent identity", async () => {
		const runAgent = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付一个可解析 JSON 报告",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("requires an explicit agent identity"),
		});
		expect(runAgent).not.toHaveBeenCalled();
	});

	it("runs an Agent node with the frozen initiating model when the node does not pin a model", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-inherited-model",
			text: "继承模型后的完整结果",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-inherited" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			flowVersionData: {
				workflowInitiatingAgentExecution: {
					model: "gpt-5.6-luna",
					apiStyle: "responses",
				},
			},
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentOutputArtifactType: "tapcanvas.text/v1",
				workflowAgentDeliveryRequirement: "交付完整文本",
				workflowAgentDefinitionId: "workflow-transformer",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			modelKey: "gpt-5.6-luna",
		}));
		expect(result).toMatchObject({ ok: true });
	});

	it.each(["priority", "default"] as const)("inherits the complete user selection over conflicting node settings (%s)", async (serviceTier) => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-inherited-model",
			text: "继承模型后的完整结果",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-inherited" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			flowVersionData: {
				workflowInitiatingAgentExecution: {
					model: "gpt-5.6-luna",
					apiStyle: "responses",
					reasoningEffort: "xhigh", serviceTier,
				},
			},
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentModelKey: "other-model",
				workflowAgentReasoningEffort: "low",
				workflowAgentOutputArtifactType: "tapcanvas.text/v1",
				workflowAgentDeliveryRequirement: "交付完整文本",
				workflowAgentDefinitionId: "workflow-transformer",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			modelKey: "gpt-5.6-luna", reasoningEffort: "xhigh", serviceTier,
		}));
		expect(result).toMatchObject({ ok: true });
	});

	it.each([false, true])("inherits the same parent intent without a trigger input, recovery=%s", async (resumeOnly) => {
		const contract = workflowIntentFixture();
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "child-intent", text: "node artifact", assets: [],
			expectedDelivery: {}, deliveryEvidence: {}, deliveryVerification: { status: "satisfied" }, requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				flowVersionData: {
					nodes: [{ data: { workflowTriggerPayload: { workflowUserIntent: freezeWorkflowUserIntent({ ownerId: "user-1", contract }) } } }],
					workflowInitiatingAgentExecution: { model: "parent-model", apiStyle: "chat" },
				},
				inputs: { "item-context": [{ itemId: "slice-2" }] },
				node: node("child", "agents.logical-task/v2", {
					workflowInstruction: "Create this item", workflowAgentOutputArtifactType: "tapcanvas.text/v1",
					workflowAgentDeliveryRequirement: "Deliver this node's text", workflowAgentDefinitionId: "workflow-transformer",
				}),
			}),
			resumeOnly,
		}, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			userIntentContract: contract, modelKey: "parent-model", resumeOnly,
			outputArtifactType: "tapcanvas.text/v1", inputs: { "item-context": [{ itemId: "slice-2" }] },
		}));
	});

	it("unwraps a strictly typed Agent JSON artifact before exposing the text port", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-json-artifact",
			text: JSON.stringify({
				artifactType: "tapcanvas.video-prompt/v1",
				text: "15 秒可执行视频提示词正文",
			}),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "e-json" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成视频提示词",
				workflowAgentOutputArtifactType: "tapcanvas.video-prompt/v1",
				workflowAgentOutputEncoding: "json_artifact",
				workflowAgentDeliveryRequirement: "交付一条视频提示词",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ outputEncoding: "json_artifact" }));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { result: { text: "15 秒可执行视频提示词正文" } },
				artifacts: [{ type: "tapcanvas.video-prompt/v1", value: "15 秒可执行视频提示词正文" }],
			},
		});
	});

	it("ignores stale inactive JSON contracts after an Agent output encoding changes", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-plain-text-after-json",
			text: "按时序解析完成的 BeatSheet 草稿",
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet", "agents.logical-task/v2", {
				workflowInstruction: "解析节拍文本",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet-draft/v1",
				workflowAgentOutputEncoding: "plain_text",
				workflowAgentJsonObjectContract: {
					requiredFields: ["stale"],
				},
				workflowAgentDeliveryRequirement: "交付非空 BeatSheet 语义草稿",
				workflowAgentDefinitionId: "beat-sheet",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			executionFamilyId: "execution-family-1",
			outputEncoding: "plain_text",
			jsonArrayContract: null,
			jsonObjectContract: null,
		}));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { result: { text: "按时序解析完成的 BeatSheet 草稿" } },
			},
		});
	});

	it("rejects a completion summary that does not satisfy a typed Agent JSON artifact port", async () => {
		const retriedEvidence = {
			executorCompleted: false,
			retryableByDurableWorkflow: true,
			retryableFailure: "structured_output_invalid",
			workflowRetryCount: 1,
		};
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent", "agents.logical-task/v2", {
					workflowInstruction: "生成视频提示词",
					workflowAgentOutputArtifactType: "tapcanvas.video-prompt/v1",
					workflowAgentOutputEncoding: "json_artifact",
					workflowAgentDeliveryRequirement: "交付一条视频提示词",
					workflowAgentDefinitionId: "video-prompt-writer",
					workflowAgentModelKey: "gemini-3.1-pro",
				}),
			}),
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: retriedEvidence,
				itemRuns: [],
			},
		}, {
			runAgent: vi.fn(async () => ({
				taskId: "agent-summary-only",
				text: "已完成视频提示词编译。",
				assets: [],
				expectedDelivery: { active: true },
				deliveryEvidence: { physicalRetryOrdinal: 2, items: [{ evidenceId: "e-summary" }] },
				deliveryVerification: { status: "satisfied" },
				requestTerminal: { status: "succeeded" },
			})),
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				artifacts: [],
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					deliveryEvidence: { physicalRetryOrdinal: 2 },
					outputRepair: { version: 1, sourceTurnId: "agent-summary-only", candidate: "已完成视频提示词编译。" },
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
					},
				},
			},
		});
	});

	it("accepts only a non-empty top-level JSON array for a json_array Agent port", async () => {
		const baseNode = node("planner", "agents.logical-task/v2", {
			workflowInstruction: "动态拆分",
			workflowAgentOutputArtifactType: "tapcanvas.json/v1",
			workflowAgentOutputEncoding: "json_array",
			workflowAgentDeliveryRequirement: "交付动态数组",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		});
		const valid = await executeRegisteredWorkflowNode(context({ node: baseNode }), {
			runAgent: vi.fn(async () => ({
				taskId: "agent-array",
				text: '[{"clipId":"clip-001","text":"第一段"}]',
				assets: [],
				expectedDelivery: { active: true },
				deliveryEvidence: { items: [{ evidenceId: "e-array" }] },
				deliveryVerification: { status: "satisfied" },
				requestTerminal: { status: "succeeded" },
			})),
			runJavascript: vi.fn(),
			runVideo,
		});
		const summaryOnly = await executeRegisteredWorkflowNode({
			...context({ node: baseNode }),
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "planner",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: {
					executorCompleted: false,
					retryableByDurableWorkflow: true,
					retryableFailure: "structured_output_invalid",
					workflowRetryCount: 1,
				},
				itemRuns: [],
			},
		}, {
			runAgent: vi.fn(async () => ({
				taskId: "agent-array-summary",
				text: "已完成 1 段拆分。",
				assets: [],
				expectedDelivery: { active: true },
				deliveryEvidence: { items: [{ evidenceId: "e-array-summary" }] },
				deliveryVerification: { status: "satisfied" },
				requestTerminal: { status: "succeeded" },
			})),
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(valid).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { result: { text: '[{"clipId":"clip-001","text":"第一段"}]' } },
			},
		});
		expect(summaryOnly).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
					},
				},
			},
		});
	});

	it("enforces a declared exact collection schema before releasing Agent output downstream", async () => {
		const baseNode = node("planner", "agents.logical-task/v2", {
			workflowInstruction: "把输入拆成两个 15 秒片段",
			workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
			workflowAgentOutputEncoding: "json_array",
			workflowAgentJsonArrayContract: {
				expectedArrayLength: 2,
				itemRequiredStringFields: ["clipId", "text"],
				itemRequiredNumberFields: ["durationSeconds"],
				itemExactNumberFields: { durationSeconds: 15 },
				itemAllowedFields: ["clipId", "text", "durationSeconds"],
			},
			workflowAgentDeliveryRequirement: "交付两个结构化 15 秒片段",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		});
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-exact-array",
			text: JSON.stringify([
				{ clipId: "clip-001", text: "第一段", durationSeconds: 15 },
				{ clipId: "clip-002", text: "第二段", durationSeconds: 15 },
			]),
			assets: [],
			expectedDelivery: null,
			deliveryEvidence: null,
			deliveryVerification: null,
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({ node: baseNode }), {
			runAgent,
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonArrayContract: {
				expectedArrayLength: 2,
				itemRequiredStringFields: ["clipId", "text"],
				itemRequiredNumberFields: ["durationSeconds"],
				itemExactNumberFields: { durationSeconds: 15 },
				itemAllowedFields: ["clipId", "text", "durationSeconds"],
			},
		}));
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					result: {
						text: expect.stringContaining('"clip-002"'),
						deliveryVerification: { status: "satisfied" },
					},
				},
			},
		});
	});

	it("freezes BeatSheet clip count and durations from the model-max provider topology", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "beat-sheet-format-task",
			text: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 4 }, { durationSeconds: 4 }],
			}),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet-format", "agents.logical-task/v2", {
				workflowInstruction: "机械编译 BeatSheet",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["protocolVersion"],
					requiredArrayFields: ["beats"],
					allowedFields: ["protocolVersion", "beats"],
				},
				workflowAgentDeliveryRequirement: "交付冻结 BeatSheet",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
				workflowAgentReasoningEffort: "low",
			}),
			inputs: {
				"delivery-contract": [{
					canvasFacts: {
						authoritativeSources: [{
							sourceId: "source:clip-topology",
							content: "冻结两段来源",
						}],
					},
					targetDurationSeconds: 40,
					generationContract: {
						videoModel: "doubao-seedance-2.5",
						durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
						maxDurationSeconds: 30,
						clipPlanningPolicy: "agent_semantic_duration_budget",
						providerSubmissionTopology: {
							targetDurationSeconds: 40,
							expectedClipCount: 2,
							minimumClipDurations: [20, 20],
							source: "model_max_duration",
						},
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonObjectContract: expect.objectContaining({
				requiredArrayFields: ["objectRegistry", "blockingPlans", "beats"],
			}),
		}));
		expect(runAgent.mock.calls[0]?.[0].jsonObjectContract).toEqual(expect.objectContaining({
			requiredStringFields: ["protocolVersion", "sourceId", "sourceFingerprint"],
			exactStringFields: {
				protocolVersion: "tapcanvas.beat-sheet/v2",
				sourceId: "source:clip-topology",
				sourceFingerprint: sha256Hex("冻结两段来源"),
			},
			expectedArrayLengths: { beats: 2 },
			arrayItemExactNumberFields: { beats: [{ durationSeconds: 20 }, { durationSeconds: 20 }] },
			arrayItemNumberAllowedValues: {
				beats: { durationSeconds: Array.from({ length: 27 }, (_, index) => index + 4) },
			},
		}));
		expect("collectionCorrectionFields" in (runAgent.mock.calls[0]?.[0].jsonObjectContract ?? {})).toBe(false);
		expect(runAgent.mock.calls[0]?.[0].maxOutputTokens).toBe(4_096);
		expect(runAgent.mock.calls[0]?.[0].reasoningEffort).toBe("low");
		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					outputContractFailure: {
						code: "structured_output_invalid",
						message: expect.stringContaining("objectRegistry must be a non-empty array"),
						rawOutputRecorded: true,
					},
				},
			},
		});
	});

	it("states the frozen physical-clip capacity arithmetic to the BeatSheet author", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "beat-sheet-capacity-task",
			text: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 15 }],
			}),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet-author", "agents.logical-task/v2", {
				workflowInstruction: "创作整章 BeatSheet",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["protocolVersion"],
					requiredArrayFields: ["beats"],
					allowedFields: ["protocolVersion", "beats"],
				},
				workflowAgentDeliveryRequirement: "交付整章 BeatSheet",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
				inputs: {
					"delivery-contract": [{
						canvasFacts: {
							authoritativeSources: [{ sourceId: "source:chapter-1", content: "冻结第一章正文" }],
						},
						targetDurationSeconds: 60,
						sourceProfile: {
							protocolVersion: "tapcanvas.beat-sheet-source-profile/v1",
							sourceSpeechChars: 2088,
							minimumPlannedSeconds: 348,
							minimumClipCount: 24,
							speechMaxCharsPerSecond: 6,
							plannedSecondsAtNaturalPace: 522,
							plannedClipCountAtNaturalPace: 35,
							speechPlanningCharsPerSecond: 4,
						},
						generationContract: {
							videoModel: "minimax-h3-dmc",
							durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
							maxDurationSeconds: 15,
							clipPlanningPolicy: "agent_semantic_duration_budget",
						},
					}],
			},
			flowVersionData: {
				nodes: [
					{ id: "beat-sheet-author", data: { workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } },
					{ id: "max-clip", data: { workflowAtomicSpec: { executorRef: BEAT_SHEET_TAKE_EXECUTOR_REF }, workflowBeatSheetTakeCount: 24 } },
				],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		const authorInstruction = String(runAgent.mock.calls[0]?.[0].instruction ?? "");
		expect(authorInstruction).toContain("创作整章 BeatSheet");
		expect(authorInstruction).toContain("durationOptions=[4,5,6,7,8,9,10,11,12,13,14,15]");
		// 物理下限只说明"更短不可能"，不构成计划时长。
		expect(authorInstruction).toContain("物理下限：Σbeats[].durationSeconds 低于 348 秒");
		expect(authorInstruction).toContain("不构成计划时长");
		// 自然语速只用于交付窗口容量换算，不放大整章计划（否则越过生产片段预算与上游单次生成预算）。
		expect(authorInstruction).not.toContain("规划基准");
		expect(authorInstruction).not.toContain("522 秒");
			// 交付窗口只能承载自然语速下的有限内容：作者应选择内容，而不是把整章压进窗口。
			expect(authorInstruction).toContain("本次交付范围就是这一个窗口：用户冻结总时长 60 秒");
			expect(authorInstruction).toContain("只能承载约 240 字人声");
			expect(authorInstruction).toContain("不要在本窗口内压缩或改写原文人声");
			expect(authorInstruction).toContain("本次执行只生产这 4 个 clip（与窗口时长一致）");
		expect(authorInstruction).toContain("增加 beat 数量，不要拉长单个 beat");
	});

	it("invents no physical-clip capacity arithmetic when the frozen contract carries none", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "beat-sheet-no-capacity-task",
			text: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 15 }],
			}),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet-author", "agents.logical-task/v2", {
				workflowInstruction: "创作整章 BeatSheet",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["protocolVersion"],
					requiredArrayFields: ["beats"],
					allowedFields: ["protocolVersion", "beats"],
				},
				workflowAgentDeliveryRequirement: "交付整章 BeatSheet",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"delivery-contract": [{
					canvasFacts: {
						authoritativeSources: [{ sourceId: "source:chapter-1", content: "冻结第一章正文" }],
					},
					generationContract: {
						videoModel: "minimax-h3-dmc",
						durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
						maxDurationSeconds: 15,
						clipPlanningPolicy: "agent_semantic_duration_budget",
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		const authorInstruction = String(runAgent.mock.calls[0]?.[0].instruction ?? "");
		expect(authorInstruction).toContain("创作整章 BeatSheet");
		// 时长窗口来自冻结合同，必须陈述；人声容量与生产预算没有冻结来源时不得编造。
		expect(authorInstruction).toContain("durationOptions=[4,5,6,7,8,9,10,11,12,13,14,15]");
		expect(authorInstruction).not.toContain("计划总时长");
		expect(authorInstruction).not.toContain("本次执行只生产前");
	});

	it("states the frozen nested structural contract to the BeatSheet author", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "beat-sheet-structure-task",
			text: JSON.stringify({ protocolVersion: "tapcanvas.beat-sheet/v2", beats: [{ durationSeconds: 15 }] }),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet-author", "agents.logical-task/v2", {
				workflowInstruction: "创作整章 BeatSheet",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["protocolVersion"],
					requiredArrayFields: ["objectRegistry", "assetPlans", "blockingPlans", "beats"],
					allowedFields: ["protocolVersion", "objectRegistry", "assetPlans", "blockingPlans", "beats"],
				},
				workflowAgentDeliveryRequirement: "交付整章 BeatSheet",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"delivery-contract": [{
					canvasFacts: { authoritativeSources: [{ sourceId: "source:chapter-1", content: "冻结第一章正文" }] },
					generationContract: {
						videoModel: "minimax-h3-dmc",
						durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
						maxDurationSeconds: 15,
						clipPlanningPolicy: "agent_semantic_duration_budget",
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo: vi.fn() });

		const authorInstruction = String(runAgent.mock.calls[0]?.[0].instruction ?? "");
		// 校验器里的嵌套结构要求必须对作者可见，否则同一份计划会在多个窗口间反复补同一个键。
		expect(authorInstruction).toContain("运行时结构合同清单");
		expect(authorInstruction).toContain('"referenceAssetBindings"');
		expect(authorInstruction).toContain('"compositionContract"');
		expect(authorInstruction).toContain('"sceneLightingSpec"');
		expect(authorInstruction).toContain('"startState"');
		expect(authorInstruction).toContain("forbiddenTransfer/scale 是可省略字段");
		expect(authorInstruction).toContain("referenceAssetIds/referenceImageNodeIds 均为空");
		// 同一批要求还必须进入机器合同（模型看到的对象结构合同），而不是只留在散文里。
		const contract = runAgent.mock.calls[0]?.[0].jsonObjectContract as Record<string, unknown>;
		expect(contract.requiredObjectPaths).toEqual(expect.arrayContaining([
			"blockingPlans[].backgroundPlan",
		]));
		expect(contract.requiredArrayPaths).toEqual(expect.arrayContaining([
			"blockingPlans[].backgroundPlan.referenceAssetBindings",
			"beats[].objectStates",
		]));
		/*
		 * sceneCard 的要求不得出现在合同路径里：路径语法只表达"每个条目都成立"的普适要求，
		 * 而 kind 限定路径（assetPlans[role=scene|environment].sceneCard）会被模型当成字段名
		 * 原样输出成一个不存在的顶层键，场景计划因此永远落不到 assetPlans 里。逐计划的
		 * kind 校验由 inspectSceneReferencePlan 承担，并给出具体下标。
		 */
		expect(JSON.stringify(contract)).not.toContain("[role=");
		expect(contract.optionalNonEmptyStringPaths).toEqual(expect.arrayContaining(["objectRegistry[].scale"]));
	});

	it("freezes an exact BeatSheet count without inventing per-clip durations", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "beat-sheet-fixed-count-task",
			text: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 4 }],
			}),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		await executeRegisteredWorkflowNode(context({
			node: node("beat-sheet-fixed-count", "agents.logical-task/v2", {
				workflowInstruction: "编译固定八段 BeatSheet",
				workflowAgentOutputArtifactType: "tapcanvas.beat-sheet/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredStringFields: ["protocolVersion"],
					requiredArrayFields: ["beats"],
					allowedFields: ["protocolVersion", "beats"],
				},
				workflowAgentDeliveryRequirement: "交付八段 BeatSheet",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"delivery-contract": [{
					canvasFacts: {
						authoritativeSources: [{ sourceId: "source:fixed-eight", content: "固定八段来源" }],
					},
					generationContract: {
						videoModel: "doubao-seedance-2.5",
						durationOptions: [4, 5, 6, 8, 10, 12, 15, 20, 24, 30],
						maxDurationSeconds: 30,
						clipPlanningPolicy: "agent_semantic_duration_budget",
						requestedClipCount: 8,
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		const frozenContract = runAgent.mock.calls[0]?.[0].jsonObjectContract;
		expect(frozenContract).toEqual(expect.objectContaining({
			expectedArrayLengths: { beats: 8 },
			arrayItemNumberAllowedValues: {
				beats: { durationSeconds: [4, 5, 6, 8, 10, 12, 15, 20, 24, 30] },
			},
		}));
		expect("collectionCorrectionFields" in (frozenContract ?? {})).toBe(false);
		expect(frozenContract?.arrayItemExactNumberFields).toBeUndefined();
	});

	it("does not release malformed collection items even when the Agent claims success", async () => {
		const malformedNode = node("planner", "agents.logical-task/v2", {
			workflowInstruction: "把输入拆成两个 15 秒片段",
			workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
			workflowAgentOutputEncoding: "json_array",
			workflowAgentJsonArrayContract: {
				expectedArrayLength: 2,
				itemRequiredStringFields: ["clipId", "text"],
				itemRequiredNumberFields: ["durationSeconds"],
				itemExactNumberFields: { durationSeconds: 15 },
				itemAllowedFields: ["clipId", "text", "durationSeconds"],
			},
			workflowAgentDeliveryRequirement: "交付两个结构化 15 秒片段",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		});
		const result = await executeRegisteredWorkflowNode({
			...context({ node: malformedNode }),
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "planner",
				executionMode: "once",
				ports: {},
				artifacts: [],
				evidence: {
					executorCompleted: false,
					retryableByDurableWorkflow: true,
					retryableFailure: "structured_output_invalid",
					workflowRetryCount: 1,
				},
				itemRuns: [],
			},
		}, {
			runAgent: vi.fn(async () => ({
				taskId: "agent-malformed-array",
				text: '["{\\"skill\\":\\"tapcanvas-screenwriter\\"}","tool argument"]',
				assets: [],
				expectedDelivery: { active: true },
				deliveryEvidence: { items: [{ evidenceId: "e-malformed" }] },
				deliveryVerification: { status: "satisfied" },
				requestTerminal: { status: "succeeded" },
			})),
			runJavascript: vi.fn(),
			runVideo,
		});

		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				artifacts: [],
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
					},
				},
			},
		});
	});

	it("allows delivery completion only from satisfied agents-cli verification", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn();
		const satisfied = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", { workflowDeliveryRequirement: "返回报告" }),
			inputs: {
				result: [{
					deliveryEvidence: { items: [{ evidenceId: "e-1" }] },
					deliveryVerification: { status: "satisfied" },
				}],
			},
		}), { runAgent, runJavascript, runVideo });
		const unsatisfied = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", { workflowDeliveryRequirement: "返回报告" }),
			inputs: { result: [{ deliveryVerification: { status: "unsatisfied" } }] },
		}), { runAgent, runJavascript, runVideo });

		expect(satisfied).toMatchObject({ ok: true });
		expect(unsatisfied).toMatchObject({ ok: false, errorCode: "workflow_node_runtime_failed" });
	});

	it("accepts text delivery only after the configured flow target is read back", async () => {
		const targetNodeId = "expanded-source";
		const nodeConfig = {
			workflowDeliveryTargetNodeId: targetNodeId,
			workflowDeliveryRequirement: "扩写正文已写回目标节点",
		};
		const accepted = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", nodeConfig, "collect", ["delivery-evidence"], undefined, ["result"]),
			inputs: {
				result: [{
					ok: true,
					updatedAt: "2026-09-02T10:35:00.000Z",
					patchedNodeSnapshots: [{ id: targetNodeId, data: { kind: "text", content: "完整扩写正文" } }],
				}],
			},
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
		const missingReadback = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", nodeConfig, "collect", ["delivery-evidence"], undefined, ["result"]),
			inputs: { result: [{ ok: true, stats: { patchedNodes: 1 }, patchedNodeSnapshots: [] }] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });

		expect(accepted).toMatchObject({
			ok: true,
			outputRefs: { evidence: { flowPatchTargetNodeId: targetNodeId, flowPatchContentLength: 6 } },
		});
		expect(missingReadback).toMatchObject({
			ok: false,
			errorMessage: expect.stringContaining("persisted flow patch receipt"),
		});
	});

	it("does not release an Agent node whose local delivery verification is unsatisfied", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-unsatisfied",
			text: "尚未交付",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [] },
			deliveryVerification: { status: "unsatisfied" },
			requestTerminal: { status: "succeeded", reason: "agent_run_completed" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付一个可解析 JSON 报告",
				workflowAgentDefinitionId: "research",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("did not satisfy its local delivery contract"),
			outputRefs: {
				evidence: {
					taskId: "agent-task-unsatisfied",
					deliveryVerification: { status: "unsatisfied" },
				},
			},
		});
	});

	it("projects a satisfied local delivery chain from a valid atomic output and agents-cli terminal", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-atomic-output",
			text: '[{"clipId":"clip-001","text":"第一段"}]',
			assets: [],
			expectedDelivery: null,
			deliveryEvidence: null,
			deliveryVerification: null,
			requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("atomic-agent", "agents.logical-task/v2", {
				workflowInstruction: "拆分输入",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentDeliveryRequirement: "交付一个非空 JSON 数组",
				workflowAgentDefinitionId: "research",
				workflowAgentModelKey: "gemini-3.1-pro",
			}, "once", ["result"]),
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					result: {
						expectedDelivery: {
							requestedOutput: "tapcanvas.json/v1",
						},
						deliveryEvidence: {
							source: "workflow_atomic_output_contract",
							outputEncoding: "json_array",
						},
						deliveryVerification: {
							status: "satisfied",
							verifiedBy: "workflow_atomic_output_contract",
						},
					},
				},
				evidence: {
					deliveryVerification: {
						status: "satisfied",
					},
				},
			},
		});
	});

	it("persists a suspended Agent node as resumable external work instead of failing its logical task", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-window-1",
			text: "当前物理窗口结束，等待持久续跑",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: null,
			deliveryVerification: null,
			requestTerminal: { status: "suspended", reason: "root_execution_budget_exhausted" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent", "agents.logical-task/v2", {
				workflowInstruction: "生成报告",
				workflowAgentOutputArtifactType: "tapcanvas.json/v1",
				workflowAgentDeliveryRequirement: "交付一个可解析 JSON 报告",
				workflowAgentDefinitionId: "research",
				workflowAgentModelKey: "gemini-3.1-pro",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				ports: {},
				artifacts: [],
				evidence: {
					taskId: "agent-window-1",
					executorCompleted: false,
					continuationReason: "root_execution_budget_exhausted",
				},
			},
		});
	});

	it("resumes only waiting collection items and preserves completed Agent item runs", async () => {
		const collection = createWorkflowCollection({
			collectionId: "agent-inputs",
			producerNodeId: "split",
			producerPortId: "items",
			values: [{ text: "first" }, { text: "second" }],
			itemIds: ["clip-1", "clip-2"],
		});
		const agentNode = node("agent", "agents.logical-task/v2", {
			workflowInstruction: "生成提示词",
			workflowAgentOutputArtifactType: "tapcanvas.text/v1",
			workflowAgentDeliveryRequirement: "交付提示词文本",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		}, "each", ["result"], 2);
		const initial = await executeRegisteredWorkflowNode(context({
			node: agentNode,
			inputs: { input: [collection] },
		}), {
			runAgent: vi.fn(async (request: { nodeId: string }) => request.nodeId.endsWith("clip-1")
				? {
					taskId: "done-1",
					text: "prompt one",
					assets: [],
					expectedDelivery: { active: true },
					deliveryEvidence: { items: [{ evidenceId: "one" }] },
					deliveryVerification: { status: "satisfied" },
					requestTerminal: { status: "succeeded", reason: "done" },
				}
				: {
					taskId: "waiting-2",
					text: "waiting",
					assets: [],
					expectedDelivery: { active: true },
					deliveryEvidence: null,
					deliveryVerification: null,
					requestTerminal: { status: "suspended", reason: "window_end" },
			}),
			runJavascript: vi.fn(),
			runVideo,
		});
		expect(initial).toMatchObject({ ok: false, waitingExternal: true });
		if (initial.ok || initial.waitingExternal !== true) throw new Error("Expected Agent collection wait");

		const recoveredCollection = createWorkflowCollection({
			collectionId: "agent-inputs",
			producerNodeId: "split",
			producerPortId: "items",
			values: [{ text: "first" }, { text: "second" }, { text: "third" }],
			itemIds: ["clip-1", "clip-2", "clip-3"],
		});
		const resumeAgent = vi.fn(async (request: { nodeId: string; resumeOnly: boolean }) => ({
			taskId: request.nodeId.endsWith("clip-2") ? "done-2" : "done-3",
			text: request.nodeId.endsWith("clip-2") ? "prompt two" : "prompt three",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: request.resumeOnly ? "two" : "three" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "done" },
		}));
		const resumedCheckpoints: WorkflowNodeOutputV1[] = [];
		const resumed = await executeRegisteredWorkflowNode({
			...context({
				node: agentNode,
				inputs: { input: [recoveredCollection] },
				checkpointOutputRefs: async (outputRefs) => {
					resumedCheckpoints.push(outputRefs);
				},
			}),
			resumeOnly: true,
			resumeOutputRefs: initial.outputRefs,
		}, { runAgent: resumeAgent, runJavascript: vi.fn(), runVideo });

		expect(resumed.ok).toBe(true);
		expect(resumeAgent).toHaveBeenCalledTimes(2);
		expect(resumeAgent).toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-2",
			resumeOnly: true,
			previousEvidence: expect.objectContaining({ taskId: "waiting-2" }),
		}));
		expect(resumeAgent).toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-3",
			resumeOnly: false,
			previousEvidence: null,
		}));
		if (!resumed.ok) throw new Error("Expected resumed Agent collection");
		expect(resumed.outputRefs.itemRuns.map((item) => item.evidence.taskId)).toEqual(["done-1", "done-2", "done-3"]);
		expect(resumedCheckpoints.length).toBeGreaterThan(0);
		expect(resumedCheckpoints.every((checkpoint) => (
			checkpoint.itemRuns.some((item) => item.evidence.taskId === "done-1")
			&& Number(checkpoint.evidence.completedItems) >= 1
		))).toBe(true);
	});

	it("keeps a historical structured-output item failure terminal during family recovery without spending another Agent call", async () => {
		const collection = createWorkflowCollection({
			collectionId: "agent-retry-inputs",
			producerNodeId: "split",
			producerPortId: "items",
			values: [{ text: "first" }, { text: "second" }],
			itemIds: ["clip-1", "clip-2"],
		});
		const agentNode = node("agent", "agents.logical-task/v2", {
			workflowInstruction: "生成提示词",
			workflowAgentOutputArtifactType: "tapcanvas.text/v1",
			workflowAgentDeliveryRequirement: "交付提示词文本",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		}, "each", ["result"], 2);
		const retryAgent = vi.fn(async () => ({
			taskId: "done-2",
			text: "prompt two repaired",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: "two" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "done" },
		}));
		const resumed = await executeRegisteredWorkflowNode({
			...context({ node: agentNode, inputs: { input: [collection] } }),
			recoveryOfExecutionId: "failed-execution-1",
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { completedItems: 1, totalItems: 2 },
				itemRuns: [
					{
						itemId: "clip-1",
						index: 0,
						status: "success",
						runtimeNodeId: "agent::item::clip-1",
						lineage: [],
						ports: { result: { text: "prompt one" } },
						artifacts: [],
						evidence: { taskId: "done-1", executorCompleted: true },
					},
					{
						itemId: "clip-2",
						index: 1,
						status: "failed",
						runtimeNodeId: "agent::item::clip-2",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: {
							retryableByDurableWorkflow: true,
							retryableFailure: "structured_output_invalid",
							retryableFailureMessage: "required field missing",
							workflowRetryCount: 2,
						},
						errorCode: "workflow_node_runtime_failed",
						errorMessage: "required field missing",
					},
				],
			},
		}, { runAgent: retryAgent, runJavascript: vi.fn(), runVideo });

		expect(resumed).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: { completedItems: 1, failedItems: 1, waitingItems: 0 },
				itemRuns: [
					{ itemId: "clip-1", status: "success" },
					{
						itemId: "clip-2",
						status: "failed",
						evidence: {
							retryableFailure: "structured_output_invalid",
							workflowRetryCount: 2,
						},
					},
				],
			},
		});
		expect(retryAgent).not.toHaveBeenCalled();
	});

	it("replays every failed item on an explicit execution-family recovery and preserves successful siblings", async () => {
		const collection = createWorkflowCollection({
			collectionId: "agent-family-recovery-inputs",
			producerNodeId: "split",
			producerPortId: "items",
			values: [{ text: "first" }, { text: "second" }],
			itemIds: ["clip-1", "clip-2"],
		});
		const agentNode = node("agent", "agents.logical-task/v2", {
			workflowInstruction: "生成提示词",
			workflowAgentOutputArtifactType: "tapcanvas.text/v1",
			workflowAgentDeliveryRequirement: "交付提示词文本",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gpt-5.6-luna",
		}, "each", ["result"], 2);
		const recoveryAgent = vi.fn(async (request: { resumeOnly: boolean }) => ({
			taskId: "done-2-recovery",
			text: "prompt two recovered",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { items: [{ evidenceId: request.resumeOnly ? "unexpected-resume" : "fresh-recovery" }] },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "done" },
		}));
		const recovered = await executeRegisteredWorkflowNode({
			...context({ node: agentNode, inputs: { input: [collection] } }),
			recoveryOfExecutionId: "failed-execution-1",
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { completedItems: 1, failedItems: 1, totalItems: 2 },
				itemRuns: [
					{
						itemId: "clip-1",
						index: 0,
						status: "success",
						runtimeNodeId: "agent::item::clip-1",
						lineage: [],
						ports: { result: { text: "prompt one" } },
						artifacts: [],
						evidence: { taskId: "done-1", executorCompleted: true },
					},
					{
						itemId: "clip-2",
						index: 1,
						status: "failed",
						runtimeNodeId: "agent::item::clip-2",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: { terminalFailure: true },
						errorCode: "workflow_node_runtime_failed",
						errorMessage: "old runtime contract failed",
					},
				],
			},
		}, { runAgent: recoveryAgent, runJavascript: vi.fn(), runVideo });

		expect(recovered.ok).toBe(true);
		expect(recoveryAgent).toHaveBeenCalledTimes(1);
		expect(recoveryAgent).toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-2",
			resumeOnly: false,
			previousEvidence: expect.objectContaining({ terminalFailure: true }),
		}));
		if (!recovered.ok) throw new Error("Expected execution-family recovery to succeed");
		expect(recovered.outputRefs.itemRuns.map((item) => item.evidence.taskId)).toEqual([
			"done-1",
			"done-2-recovery",
		]);
	});

	it("does not turn a failed media receipt into a new paid submission during execution-family recovery", async () => {
		const collection = createWorkflowCollection({
			collectionId: "video-family-recovery-inputs",
			producerNodeId: "writer",
			producerPortId: "prompts",
			values: [{ text: "first" }, { text: "second" }],
			itemIds: ["clip-1", "clip-2"],
		});
		const videoNode = node("video", "tapcanvas.video.generate/v1", {
			workflowVideoModelKey: "video-model",
			workflowVideoDurationSeconds: 5,
			workflowVideoResolution: "480p",
			workflowVideoAspectRatio: "16:9",
		}, "each", ["video"], 2);
		const submitVideo = vi.fn();
		const recovered = await executeRegisteredWorkflowNode({
			...context({ node: videoNode, inputs: { prompt: [collection] } }),
			recoveryOfExecutionId: "failed-execution-1",
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "tapcanvas.video.generate/v1",
				nodeId: "video",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { completedItems: 1, failedItems: 1, totalItems: 2 },
				itemRuns: [
					{
						itemId: "clip-1",
						index: 0,
						status: "success",
						runtimeNodeId: "video::item::clip-1",
						lineage: [],
						ports: { video: { videoUrl: "https://assets.example/clip-1.mp4" } },
						artifacts: [{ type: "tapcanvas.video/v1", identity: "clip-1", value: "https://assets.example/clip-1.mp4" }],
						evidence: { taskId: "paid-video-1", providerStatus: "success" },
					},
					{
						itemId: "clip-2",
						index: 1,
						status: "failed",
						runtimeNodeId: "video::item::clip-2",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: { taskId: "paid-video-2", providerStatus: "failed" },
						errorCode: "workflow_node_runtime_failed",
						errorMessage: "provider terminal failure",
					},
				],
			},
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });

		expect(recovered).toMatchObject({
			ok: false,
			outputRefs: {
				itemRuns: [
					{ itemId: "clip-1", status: "success", evidence: { taskId: "paid-video-1" } },
					{ itemId: "clip-2", status: "failed", evidence: { taskId: "paid-video-2" } },
				],
			},
		});
		expect(submitVideo).not.toHaveBeenCalled();
	});

	it("retries a reconcilable media item that failed before any durable provider receipt existed", async () => {
		const collection = createWorkflowCollection({
			collectionId: "video-pre-submit-recovery-inputs",
			producerNodeId: "writer",
			producerPortId: "prompts",
			values: [{ text: "first" }],
			itemIds: ["clip-1"],
		});
		const videoNode = node("video", "tapcanvas.video.generate/v1", {
			workflowVideoModelKey: "video-model",
			workflowVideoDurationSeconds: 5,
			workflowVideoResolution: "480p",
			workflowVideoAspectRatio: "16:9",
		}, "each", ["video"], 1);
		const submitVideo = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "video-node-1",
			taskId: "provider-task-1",
			videoUrl: "https://assets.example/clip-1-recovered.mp4",
			thumbnailUrl: null,
			reused: false,
		}));
		const recovered = await executeRegisteredWorkflowNode({
			...context({ node: videoNode, inputs: { prompt: [collection] } }),
			recoveryOfExecutionId: "failed-execution-1",
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "tapcanvas.video.generate/v1",
				nodeId: "video",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { completedItems: 0, failedItems: 1, totalItems: 1 },
				itemRuns: [{
					itemId: "clip-1",
					index: 0,
					status: "failed",
					runtimeNodeId: "video::item::clip-1",
					lineage: [],
					ports: {},
					artifacts: [],
					evidence: {},
					errorCode: "workflow_node_runtime_failed",
					errorMessage: "pre-submit contract failure",
				}],
			},
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });

		expect(recovered.ok).toBe(true);
		expect(submitVideo).toHaveBeenCalledTimes(1);
		expect(submitVideo).toHaveBeenCalledWith(expect.objectContaining({
			runtimeNodeId: "video::item::clip-1",
			resumeOnly: false,
			previousEvidence: {},
		}));
		if (!recovered.ok) throw new Error("Expected pre-submit media recovery to succeed");
		expect(recovered.outputRefs.itemRuns[0]).toMatchObject({
			status: "success",
			evidence: { taskId: "provider-task-1" },
		});
	});

	it("fairly reconciles every persisted waiting item before pausing untouched collection work", async () => {
		const collection = createWorkflowCollection({
			collectionId: "agent-waiting-frontier",
			producerNodeId: "split",
			producerPortId: "items",
			values: [{ text: "first" }, { text: "second" }, { text: "untouched" }],
			itemIds: ["clip-1", "clip-2", "clip-3"],
		});
		const agentNode = node("agent", "agents.logical-task/v2", {
			workflowInstruction: "生成提示词",
			workflowAgentOutputArtifactType: "tapcanvas.text/v1",
			workflowAgentDeliveryRequirement: "交付提示词文本",
			workflowAgentDefinitionId: "writer",
			workflowAgentModelKey: "gemini-3.1-pro",
		}, "each", ["result"], 4);
		const resumeAgent = vi.fn(async (request: { nodeId: string; resumeOnly: boolean }) => ({
			taskId: `still-waiting:${request.nodeId}`,
			text: "",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { polled: true },
			deliveryVerification: null,
			requestTerminal: { status: "suspended", reason: "still_running" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({ node: agentNode, inputs: { input: [collection] } }),
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { executorCompleted: false, waitingItems: 2, totalItems: 3 },
				itemRuns: [
					{
						itemId: "clip-1",
						index: 0,
						status: "waiting_external",
						runtimeNodeId: "agent::item::clip-1",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: { taskId: "waiting-1" },
					},
					{
						itemId: "clip-2",
						index: 1,
						status: "waiting_external",
						runtimeNodeId: "agent::item::clip-2",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: { taskId: "waiting-2" },
					},
				],
			},
		}, { runAgent: resumeAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: { evidence: { waitingItems: 2, settledItems: 2, totalItems: 3 } },
		});
		expect(resumeAgent).toHaveBeenCalledTimes(2);
		expect(resumeAgent).toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-1",
			resumeOnly: true,
		}));
		expect(resumeAgent).toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-2",
			resumeOnly: true,
		}));
		expect(resumeAgent).not.toHaveBeenCalledWith(expect.objectContaining({
			nodeId: "agent::item::clip-3",
		}));
	});

	it("keeps accepted siblings owned by the collection while retaining exact failed-item evidence", async () => {
		const collection = createWorkflowCollection({
			collectionId: "video-provider-mixed-terminal",
			producerNodeId: "writer",
			producerPortId: "prompts",
			values: [{ text: "first" }, { text: "second" }],
			itemIds: ["clip-1", "clip-2"],
		});
		const videoNode = node("video", "tapcanvas.video.generate/v1", {
			workflowVideoModelKey: "video-model",
			workflowVideoDurationSeconds: 5,
			workflowVideoResolution: "480p",
			workflowVideoAspectRatio: "16:9",
		}, "each", ["video"], 2);
		const mixedVideoRun = vi.fn(async (input: { itemIndex: number }) => input.itemIndex === 0
			? {
				status: "waiting_external" as const,
				nodeId: "video-clip-1",
				taskId: "accepted-task-1",
				reused: false,
			}
			: {
				status: "failed" as const,
				nodeId: "video-clip-2",
				taskId: null,
				errorCode: "ark_moderation_rejected",
				errorMessage: "内容审核未通过：1 个参考素材被拒",
				providerRejectedReferenceIds: ["asset-rejected"],
			});

		const result = await executeRegisteredWorkflowNode(
			context({ node: videoNode, inputs: { prompt: [collection] } }),
			{ runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: mixedVideoRun },
		);

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				evidence: { failedItems: 1, waitingItems: 1, totalItems: 2 },
				itemRuns: [
					{
						itemId: "clip-1",
						status: "waiting_external",
						evidence: { taskId: "accepted-task-1" },
					},
					{
						itemId: "clip-2",
						status: "failed",
						evidence: {
							providerErrorCode: "ark_moderation_rejected",
							providerRejectedReferenceIds: ["asset-rejected"],
						},
					},
				],
			},
		});
		expect(mixedVideoRun).toHaveBeenCalledTimes(2);
	});

	it("refreshes failed receipts alongside waiting siblings during explicit recovery without new submissions", async () => {
		const collection = createWorkflowCollection({ collectionId: "recover-mixed", producerNodeId: "writer",
			producerPortId: "prompts", values: [{ text: "first" }, { text: "second" }], itemIds: ["clip-1", "clip-2"] });
		const videoNode = node("video", "tapcanvas.video.generate/v1", { workflowVideoModelKey: "video-model",
			workflowVideoDurationSeconds: 5, workflowVideoResolution: "480p", workflowVideoAspectRatio: "16:9" }, "each", ["video"], 2);
		const lookup = vi.fn(async (input: { itemIndex: number; resumeOnly?: boolean }) => ({
			status: "waiting_external" as const, nodeId: `retry-${input.itemIndex}`, taskId: `accepted-${input.itemIndex}`, reused: true,
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({ node: videoNode, inputs: { prompt: [collection] } }), resumeOnly: true, recoveryOfExecutionId: "prior",
			resumeOutputRefs: { protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1", nodeId: "video",
				executionMode: "each", ports: {}, artifacts: [], evidence: { failedItems: 1, waitingItems: 1 },
				itemRuns: ["failed", "waiting_external"].map((status, index) => ({
					itemId: `clip-${index + 1}`, index, status: status as "failed" | "waiting_external",
					runtimeNodeId: `video::item::clip-${index + 1}`, lineage: [], ports: {}, artifacts: [],
					evidence: { taskId: `original-${index}`, canvasNodeId: `original-node-${index}` },
				})),
			},
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: lookup });
		expect(lookup).toHaveBeenCalledTimes(2);
		for (const [input] of lookup.mock.calls) expect(input.resumeOnly).toBe(true);
		expect(result).toMatchObject({ ok: false, waitingExternal: true,
			outputRefs: { evidence: { waitingItems: 2, failedItems: 0, totalItems: 2 } } });
	});

	it.each([false, true])("explicit recovery refreshes a receipt in resume-only mode; ordinary polls retain failures: %s", async (recover) => {
		const assets = createWorkflowCollection({
			collectionId: "asset-inputs",
			producerNodeId: "asset-plan",
			producerPortId: "asset-items",
			values: [
				{ prompt: "第一项", negativePrompt: "避免身份漂移", referenceAssetBindings: [] },
				{ prompt: "第二项", negativePrompt: "避免身份漂移", referenceAssetBindings: [] },
			],
			itemIds: ["asset-1", "asset-2"],
		});
		const imageNode = node("image", "tapcanvas.image.generate/v1", {
			workflowImageModelKey: "nano-banana-pro",
			workflowImageAspectRatio: "16:9",
			workflowImageSize: "1024x1024",
			workflowImageReferenceAssetBindings: [],
		}, "each", ["image"], 2, ["asset-items"]);
		const runImage = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "canvas-2::family::family-1::output::image",
			taskId: "task-2-new-family",
			imageUrl: "https://assets.example/asset-2-new-family.png",
			assetId: "asset-2-new-family",
			reused: false,
		}));
		const resumed = await executeRegisteredWorkflowNode({
			...context({ node: imageNode, inputs: { "asset-items": [assets] } }),
			resumeOnly: true,
			...(recover ? { recoveryOfExecutionId: "previous-execution" } : {}),
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "tapcanvas.image.generate/v1",
				nodeId: "image",
				executionMode: "each",
				ports: {},
				artifacts: [],
				evidence: { executorCompleted: false, completedItems: 1, failedItems: 1 },
				itemRuns: [
					{
						itemId: "asset-1",
						index: 0,
						status: "success",
						runtimeNodeId: "image::item::asset-1",
						lineage: [],
						ports: { image: { imageUrl: "https://assets.example/asset-1.png" } },
						artifacts: [{ type: "tapcanvas.image/v1", identity: "asset-1", value: "https://assets.example/asset-1.png" }],
						evidence: { providerStatus: "success", taskId: "task-1", canvasNodeId: "canvas-1" },
					},
					{
						itemId: "asset-2",
						index: 1,
						status: "failed",
						runtimeNodeId: "image::item::asset-2",
						lineage: [],
						ports: {},
						artifacts: [],
						evidence: { providerStatus: "failed", taskId: "task-2", canvasNodeId: "canvas-2" },
						errorCode: "workflow_node_runtime_failed",
						errorMessage: "provider receipt failed",
					},
				],
			},
		}, { runAgent: vi.fn(), runJavascript: vi.fn(), runImage, runVideo });

		if (recover) {
			expect(resumed.ok).toBe(true);
			expect(runImage).toHaveBeenCalledTimes(1);
			expect(runImage).toHaveBeenCalledWith(expect.objectContaining({ resumeOnly: true }));
			return;
		}
		expect(resumed.ok).toBe(false);
		expect(runImage).not.toHaveBeenCalled();
		if (resumed.ok) throw new Error("Expected the terminal media collection failure to remain terminal");
		expect(resumed).toMatchObject({
			ok: false,
			errorMessage: "Workflow node image failed 1/2 item executions: provider receipt failed",
		});
	});

	it("verifies every item in a collected agents-cli delivery result", async () => {
		const runAgent = vi.fn();
		const runJavascript = vi.fn();
		const results = createWorkflowCollection({
			collectionId: "video-results",
			producerNodeId: "video",
			producerPortId: "video",
			values: [
				{ deliveryEvidence: { videoUrl: "https://assets.example/1.mp4" }, deliveryVerification: { status: "satisfied" } },
				{ deliveryEvidence: { videoUrl: "https://assets.example/2.mp4" }, deliveryVerification: { status: "satisfied" } },
			],
			itemIds: ["segment-1", "segment-2"],
		});
		const verified = await executeRegisteredWorkflowNode(context({
			node: node("delivery", "agents.delivery.verify/v2", { workflowDeliveryRequirement: "每段一个真实视频" }, "collect", ["delivery-evidence"]),
			inputs: { result: [results] },
		}), { runAgent, runJavascript, runVideo });

		expect(verified).toMatchObject({
			ok: true,
			outputRefs: { evidence: { verifiedItems: 2, sourceCollectionId: "video-results" } },
		});
	});
});

describe("workflow delivery scope and structured-output failure recording", () => {
	it("preserves the authored image brief and metadata without rebuilding a second prompt", async () => {
		const runImage = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "character-image-output",
			taskId: "character-image-task",
			imageUrl: "https://example.com/character.png",
			assetId: "character-asset",
			reused: false,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("character-image", "tapcanvas.image.generate/v1", {
				workflowImageModelKey: "nano-banana-pro",
				workflowImageAspectRatio: "1:1",
				workflowImageSize: "1024x1024",
				workflowImageReferenceAssetBindings: [],
			}),
			inputs: {
				"asset-items": [{
					role: "character://hero",
					displayName: "Hero",
					prompt: "中年女性面试官的中性四视图身份板，灰色职业装，保留独有衣领与发髻结构",
					negativePrompt: "不要出现街口和裂隙",
					referenceType: "character",
					roleName: "hero",
					characterAssetRole: "identity_anchor",
					characterProfileVersion: "character-card/v3",
					identityAnchors: ["稳定骨相", "固定发型剪影"],
					prohibitedDrift: ["不得改变脸型"],
				}],
			},
			}), { runAgent: vi.fn(), runJavascript: vi.fn(), runImage, runVideo });
		if (!result.ok) throw new Error("errorMessage" in result ? result.errorMessage : "Unexpected external wait");
		expect(runImage).toHaveBeenCalledWith(expect.objectContaining({
			prompt: "中年女性面试官的中性四视图身份板，灰色职业装，保留独有衣领与发髻结构",
			negativePrompt: "不要出现街口和裂隙",
		}));
	});

	it.each([false, true])("writes media to the caller flow and identifies generated assets when receipt reuse is %s", async (receiptReused) => {
		const runImage = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "workflow-1:asset-image-generate::item::asset-1::output::image",
			taskId: "task-1",
			imageUrl: "https://example.com/a.png",
			assetId: "asset-1",
			reused: receiptReused,
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("image-node", "tapcanvas.image.generate/v1", {
				workflowImageModelKey: "nano-banana-pro",
				workflowImageAspectRatio: "16:9",
				workflowImageSize: "1024x1024",
				workflowImageReferenceAssetBindings: [],
			}),
			inputs: {
				"asset-items": [{
					prompt: "正向",
					negativePrompt: "负向",
				}],
			},
		}), {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runImage,
			runVideo,
		});
		expect(result.ok).toBe(true);
		expect(result).toMatchObject({ outputRefs: { evidence: {
			assetOrigin: "workflow_generation", taskReceiptReused: receiptReused,
		} } });
		expect(runImage).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "flow-1",
			projectId: "project-1",
		}));

		const deliveryResult = await executeRegisteredWorkflowNode({
			...context({
				node: node("image-node-2", "tapcanvas.image.generate/v1", {
					workflowImageModelKey: "nano-banana-pro",
					workflowImageAspectRatio: "16:9",
					workflowImageSize: "1024x1024",
					workflowImageReferenceAssetBindings: [],
				}),
				inputs: {
					"asset-items": [{
						prompt: "正向",
						negativePrompt: "负向",
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runImage,
			runVideo,
		});
		expect(deliveryResult.ok).toBe(true);
		expect(runImage).toHaveBeenLastCalledWith(expect.objectContaining({
			flowId: "caller-flow-1",
			projectId: "caller-project-1",
		}));
	});

	it("reuses a caller-project asset URL declared in the asset plan without generating", async () => {
		const runImage = vi.fn();
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("image-node", "tapcanvas.image.generate/v1", {
					workflowImageModelKey: "nano-banana-pro",
					workflowImageAspectRatio: "16:9",
					workflowImageSize: "1024x1024",
					workflowImageReferenceAssetBindings: [],
				}),
				inputs: {
					"asset-items": [{
						assetId: "hero",
						role: "character",
						prompt: "正向",
						negativePrompt: "负向",
						consumerClipIds: ["clip-a"],
						existingImageUrl: "https://caller.tapcanvas.test/hero.png",
						existingNodeId: "caller-node-hero",
						existingAssetId: "asset-hero",
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runImage,
			runVideo,
		});

		expect(result.ok).toBe(true);
		expect(runImage).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			outputRefs: {
				evidence: { assetOrigin: "existing_asset", reuseSource: "caller_asset", canvasNodeId: "caller-node-hero" },
				artifacts: [{ type: "tapcanvas.image/v1", identity: "asset-hero", value: "https://caller.tapcanvas.test/hero.png" }],
			},
		});
		expect(result.ok && result.outputRefs.ports["image"]).toMatchObject({
			imageUrl: "https://caller.tapcanvas.test/hero.png",
			generatedAssetId: "asset-hero",
			nodeId: "caller-node-hero",
			taskId: null,
		});
	});

	it.each([false, true])("resolves exact existing assets without generating, including explicit adoption=%s", async (adopt) => {
		const runImage = vi.fn();
		const resolveProjectAsset = vi.fn(async () => ({
			assetId: "asset-library-hero",
			projectId: "caller-project-1",
			url: "https://assets.tapcanvas.test/library-hero.png",
			mediaKind: "image" as const,
			mimeType: "image/png",
			nodeId: null,
			flowId: null,
			styleFingerprint: null,
		}));
		const projectContext = {
			version: 3 as const,
			projectId: "caller-project-1",
			canvasId: "caller-flow-1",
			sourceNodeId: null,
			selectedAssetIds: ["asset-library-hero"],
			projectAssetIds: ["asset-library-hero"],
			timeline: { clips: [] },
			selection: { nodeIds: [], assetIds: ["asset-library-hero"], activeNodeId: null, groupId: null },
			permissions: { principalId: "user-1", projectRead: true as const, canvasRead: true as const, assetRead: true as const, assetWrite: true },
			assetSnapshot: [{
				assetId: "asset-library-hero",
				assetVersion: 3,
				assetVersionId: "asset-library-hero-v3",
				projectId: "caller-project-1",
				name: "阿乔角色卡",
				canonicalName: "阿乔",
				kind: "image",
				referenceType: "character",
				approvalStatus: "approved",
				origin: "material" as const,
				flowId: null,
				nodeId: null,
				mediaKind: "image" as const,
				state: "ready" as const,
				updatedAt: "2026-08-17T00:00:00.000Z",
			}],
			capturedAt: "2026-08-17T00:00:00.000Z",
		};
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("image-node::item::entry", "tapcanvas.image.generate/v1", {
					workflowImageModelKey: "nano-banana-pro",
					workflowImageAspectRatio: "16:9",
					workflowImageSize: "1024x1024",
					workflowImageReferenceAssetBindings: [],
				}),
				inputs: {
					"asset-items": [{
						assetId: "hero",
						prompt: "正向",
						negativePrompt: "负向",
						consumerClipIds: ["clip-a"],
						existingAssetId: adopt ? "incorrect-old-reference" : "asset-library-hero",
						existingProjectId: "caller-project-1",
					}],
				},
			}),
			flowVersionData: { workflowProjectContext: projectContext,
				...(adopt ? { workflowMediaAdoptions: [{ nodeId: "image-node", itemId: "entry", assetId: "asset-library-hero" }] } : {}) },
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runImage,
			runVideo,
			resolveProjectAsset,
		});

		expect(result.ok).toBe(true);
		expect(runImage).not.toHaveBeenCalled();
		expect(resolveProjectAsset).toHaveBeenCalledWith(expect.objectContaining({
			assetId: "asset-library-hero",
			projectId: "caller-project-1",
		}));
		expect(result.ok && result.outputRefs.ports.image).toMatchObject({
			imageUrl: "https://assets.tapcanvas.test/library-hero.png",
			generatedAssetId: "asset-library-hero",
			nodeId: "asset-library-hero",
		});
	});

	it("fails a caller-asset reuse declaration that is not a persistent URL", async () => {
		const runImage = vi.fn();
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("image-node", "tapcanvas.image.generate/v1", {
					workflowImageModelKey: "nano-banana-pro",
					workflowImageAspectRatio: "16:9",
					workflowImageSize: "1024x1024",
					workflowImageReferenceAssetBindings: [],
				}),
				inputs: {
					"asset-items": [{
						assetId: "hero",
						prompt: "正向",
						negativePrompt: "负向",
						consumerClipIds: ["clip-a"],
						existingImageUrl: "blob:local-temp",
						existingNodeId: "caller-node-hero",
					}],
				},
			}),
			flowVersionData: {
				workflowDeliveryScope: { flowId: "caller-flow-1", projectId: "caller-project-1" },
			},
		}, {
			runAgent: vi.fn(),
			runJavascript: vi.fn(),
			runImage,
			runVideo,
		});

		expect(result.ok).toBe(false);
		expect(result).toMatchObject({
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("non-persistent existingImageUrl"),
		});
		expect(runImage).not.toHaveBeenCalled();
	});

	it("defers a typed Agent after a provider 429", async () => {
		const rateLimitError = Object.assign(new Error("provider rejected this request"), {
			code: "llm_http_429",
		});
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => {
			throw rateLimitError;
		});
		const result = await executeRegisteredWorkflowNode(context({
					node: node("agent-1", "agents.logical-task/v2", {
					workflowInstruction: "输出 clips",
					workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["selfQaNote"],
						requiredObjectFields: ["creativeReview", "sourceFidelityAudit"],
						requiredArrayFields: ["clips"],
						allowedFields: ["clips", "selfQaNote", "creativeReview", "sourceFidelityAudit"],
				},
				workflowAgentDeliveryRequirement: "交付 clips",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "deepseek-v4-flash",
				workflowPromptExampleMediaType: "video",
			}),
			inputs: { "clip-contexts": [frozenSingleClipContext()] },
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				evidence: {
					executorCompleted: false,
					deliveryEvidence: {
						retryablePhysicalFailure: true,
						physicalFailureReason: "llm_http_429",
						physicalRetryOrdinal: 1,
						rateLimitDeferralCount: 1,
					},
				},
			},
		});
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			allowedTools: [
				"skill_search",
				"Skill",
				"knowledge_search",
				"knowledge_candidates_page",
				"knowledge_read",
				"prompt_example_search",
				"prompt_example_read",
			],
		}));
		expect(runAgent.mock.calls[0]?.[0]).toMatchObject({
			promptExampleRetrievalScope: {
				version: 3,
				mediaType: "video",
				searchPolicy: "required_non_blocking",
			},
		});
	});

	it("defers a typed Agent when the bridge returns a terminal pre-submission 429", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "typed-terminal-rate-limit",
			text: "",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: {
				version: 1,
				source: "agents_cli_durable_turn_status",
				state: "failed",
			},
			deliveryVerification: null,
			requestTerminal: { status: "failed", reason: "llm_http_429" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent-terminal-rate-limit", "agents.logical-task/v2", {
				workflowInstruction: "输出一个完整 clip",
				workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredArrayFields: ["clips"],
					expectedArrayLengths: { clips: 1 },
					allowedFields: ["clips"],
				},
				workflowAgentDeliveryRequirement: "交付一个完整 clip",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "gpt-5.6-sol",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				evidence: {
					executorCompleted: false,
					deliveryEvidence: {
						retryablePhysicalFailure: true,
						physicalFailureReason: "llm_http_429",
						physicalRetryOrdinal: 1,
						rateLimitDeferralCount: 1,
					},
				},
			},
		});
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("reopens the same typed item for a rate-limit retry", async () => {
		const runAgent = vi.fn(async (request: { resumeOnly: boolean }) => ({
			taskId: "typed-rate-limit-recovered",
			text: '{"clips":[{"clipIndex":0}]}',
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { resumed: request.resumeOnly },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "done" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-rate-limit-retry", "agents.logical-task/v2", {
					workflowInstruction: "输出一个完整 clip",
					workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredArrayFields: ["clips"],
						expectedArrayLengths: { clips: 1 },
						allowedFields: ["clips"],
					},
					workflowAgentDeliveryRequirement: "交付一个完整 clip",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "gpt-5.6-sol",
				}),
			}),
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent-rate-limit-retry",
				executionMode: "once",
				ports: {},
				artifacts: [],
				itemRuns: [],
				evidence: {
					executorCompleted: false,
					deliveryEvidence: {
						retryablePhysicalFailure: true,
						physicalFailureReason: "llm_http_429",
						physicalRetryOrdinal: 1,
						rateLimitDeferralCount: 1,
						retryNotBeforeAt: new Date(Date.now() - 1).toISOString(),
					},
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			resumeOnly: true,
			previousEvidence: expect.objectContaining({ executorCompleted: false }),
		}));
	});

	it("retains typed rate-limited work after three deferrals", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: {
				version: 1,
				source: "agents_cli_durable_turn_status",
				physicalFailureReason: "llm_http_429",
				physicalRetryOrdinal: 3,
				rateLimitDeferralCount: 3,
			},
			deliveryVerification: null,
			requestTerminal: { status: "failed", reason: "llm_http_429" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent-1", "agents.logical-task/v2", {
				workflowInstruction: "输出 clips",
				workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredArrayFields: ["clips"],
					allowedFields: ["clips"],
				},
				workflowAgentDeliveryRequirement: "交付 clips",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: { "clip-contexts": [frozenSingleClipContext()] },
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({ ok: false, waitingExternal: true, outputRefs: { evidence: {
			deliveryEvidence: { physicalFailureReason: "llm_http_429", rateLimitDeferralCount: 4 },
		} } });
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runVideo).not.toHaveBeenCalled();
	});

	it("reopens the same typed submission window after a runtime restart when no candidate was recorded", async () => {
		const runAgent = vi.fn(async (request: { resumeOnly: boolean }) => ({
			taskId: "typed-runtime-restart-recovered",
			text: '{"clips":[{"clipIndex":0}]}',
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { resumed: request.resumeOnly },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded", reason: "done" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-typed-runtime-restart", "agents.logical-task/v2", {
					workflowInstruction: "输出一个完整 clip",
					workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredArrayFields: ["clips"],
						expectedArrayLengths: { clips: 1 },
						allowedFields: ["clips"],
					},
					workflowAgentDeliveryRequirement: "交付一个完整 clip",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
			}),
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent-typed-runtime-restart",
				executionMode: "once",
				ports: {},
				artifacts: [],
				itemRuns: [],
				evidence: {
					executorCompleted: false,
					requestTerminal: {
						version: 1,
						terminal: false,
						status: "suspended",
						reason: "workflow_runtime_restarted",
					},
					continuationReason: "workflow_runtime_restarted",
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			resumeOnly: true,
			previousEvidence: expect.objectContaining({ continuationReason: "workflow_runtime_restarted" }),
		}));
	});

	it.each([{}, { deliveryEvidence: { retryablePhysicalFailure: true, physicalFailureReason: "provider_stream_interrupted", physicalRetryOrdinal: 4 } }])("continues a typed logical task from checkpoint %j", async (previousEvidence) => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
            taskId: "typed-checkpoint-recovered",
            text: '{"clips":[{"clipIndex":0}]}',
            assets: [],
            expectedDelivery: { active: true },
            deliveryEvidence: { resumed: true },
            deliveryVerification: { status: "satisfied" },
            requestTerminal: { status: "succeeded", reason: "done" },
        }));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-typed-resume", "agents.logical-task/v2", {
					workflowInstruction: "输出一个完整 clip",
					workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredArrayFields: ["clips"],
						expectedArrayLengths: { clips: 1 },
						allowedFields: ["clips"],
					},
					workflowAgentDeliveryRequirement: "交付一个完整 clip",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
			}),
			resumeOnly: true,
			resumeOutputRefs: {
				protocolVersion: "1",
				executorRef: "agents.logical-task/v2",
				nodeId: "agent-typed-resume",
				executionMode: "once",
				ports: {},
				artifacts: [],
				itemRuns: [],
				evidence: previousEvidence,
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

        expect(result.ok).toBe(true);
        expect(runAgent).toHaveBeenCalledTimes(1);
        expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
            previousEvidence,
        }));
    });

	it.each(['{"clips":[]}', "任务仍在处理中，系统会自动继续，无需重复提交。"])("keeps a typed Agent physical window resumable before parsing %s", async (text) => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "typed-candidate-suspended-1",
			text,
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: {
				retryablePhysicalFailure: true,
				physicalFailureReason: "provider_stream_interrupted",
				physicalRetryOrdinal: 7,
			},
			deliveryVerification: null,
			requestTerminal: { status: "suspended", reason: "root_execution_budget_exhausted" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent-typed-terminal", "agents.logical-task/v2", {
				workflowInstruction: "输出一个完整 clip",
				workflowAgentOutputArtifactType: "tapcanvas.clip-plan/v1",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredArrayFields: ["clips"],
					expectedArrayLengths: { clips: 1 },
					allowedFields: ["clips"],
				},
				workflowAgentDeliveryRequirement: "交付一个完整 clip",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: {
					executorCompleted: false,
					structuredOutputSubmissionPolicy: "repair_with_correction",
					requestTerminal: {
						status: "suspended",
						reason: "root_execution_budget_exhausted",
					},
					continuationReason: "root_execution_budget_exhausted",
				},
			},
		});
		expect("waitingExternal" in result).toBe(true);
		if (!result.ok && result.outputRefs) {
			expect(result.outputRefs.evidence).not.toHaveProperty("outputContractFailure");
		}
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("does not reinterpret a non-429 Agent rejection as backpressure", async () => {
		const failure = Object.assign(new Error("permission denied"), { code: "llm_http_403" });
		await expect(executeRegisteredWorkflowNode(context({
			node: node("agent-1", "agents.logical-task/v2", {
				workflowInstruction: "输出文本",
				workflowAgentOutputArtifactType: "tapcanvas.text/v1",
				workflowAgentOutputEncoding: "plain_text",
				workflowAgentDeliveryRequirement: "交付文本",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
		}), {
			runAgent: vi.fn(async () => { throw failure; }),
			runJavascript: vi.fn(),
			runVideo,
		})).rejects.toBe(failure);
	});

	it("records malformed asset role identities without repairing or rerunning them", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "asset-plan-task-1",
			text: JSON.stringify([{
				assetId: "hero",
				role: "沈鸦——黑束发",
				prompt: "沈鸦角色参考",
				negativePrompt: "身份漂移",
				consumerClipIds: ["clip-0"],
			}]),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { version: 1, terminal: true, status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-planner", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				// Frozen historical workflows only declared role as a non-empty string.
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: { "beat-sheet": [frozenAssetBeatSheet()] },
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonArrayContract: expect.objectContaining({
				itemStringAllowedValues: {
					role: ["character://hero", "scene://测试场景"],
				},
				itemStringArrayAllowedValues: { consumerClipIds: ["clip-a"] },
				itemExactStringFieldsByIdentity: {
					identityField: "role",
					values: {
						"character://hero": {
							referenceType: "character",
							roleName: "hero",
							characterAssetRole: "identity_anchor",
							characterProfileVersion: "character-card/v3",
						},
					},
				},
				itemRequiredNonEmptyArrayFieldsByIdentity: {
					identityField: "role",
					values: { "character://hero": ["identityAnchors", "prohibitedDrift"] },
				},
			}),
		}));

		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					outputContractFailure: {
						code: "structured_output_invalid",
						message: expect.stringContaining("role must use kind://canonical-name"),
						rawOutputRecorded: true,
					},
				},
			},
		});
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("settles asset coverage structurally without an Agent call when the frozen BeatSheet has no visual-reference roles", async () => {
		const runAgent = vi.fn();
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-planner-empty", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}, "once", ["asset-plans"], undefined, ["beat-sheet"]),
			inputs: {
				"beat-sheet": [frozenAssetBeatSheet("clip-a", [
					{ kind: "character", name: "红狐", referenceRole: "none" },
					{ kind: "scene", name: "雪松林", referenceRole: "none" },
				])],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"asset-plans": {
						text: "[]",
						requestTerminal: {
							status: "succeeded",
							reason: "frozen_asset_reference_set_empty",
						},
					},
				},
			},
		});
	});

	it("records canonical asset-role drift without recompiling the model output", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "asset-plan-task-canonical-drift",
			text: JSON.stringify([{
				assetId: "scene-zixiaogong",
				role: "scene://紫霄宮內·混元道場",
				prompt: "紫霄宫内混元道场场景参考",
				negativePrompt: "空间漂移",
				consumerClipIds: ["clip-a"],
			}]),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { version: 1, terminal: true, status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-planner", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"beat-sheet": [{
					text: JSON.stringify({
						beats: [{
							clipId: "clip-a",
							clipIndex: 0,
							durationSeconds: 5,
							characters: [],
							assetObjectContracts: [frozenWriterObjectContract({
								kind: "scene",
								name: "紫霄宫内·混元道场",
								referenceRole: "environment",
							})],
						}],
					}),
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonArrayContract: expect.objectContaining({
				itemStringAllowedValues: { role: ["scene://紫霄宫内·混元道场"] },
			}),
		}));

		expect(result).toMatchObject({
			ok: false,
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					outputContractFailure: {
						code: "structured_output_invalid",
						message: expect.stringContaining(
							"field role must use one of: scene://紫霄宫内·混元道场",
						),
						rawOutputRecorded: true,
					},
				},
			},
		});
		expect(runAgent).toHaveBeenCalledTimes(1);
	});

	it("freezes explicitly selected ready workflow images into asset-plan reuse identities", async () => {
		const runAgent = vi.fn();
		const existingNodeId = "video-workflow:asset-image-generate::item::hero::output::image";
		const existingAssetId = `project-node:project:project-1:${existingNodeId}`;
		const base = context({
			node: node("asset-planner", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					// Historical workflow snapshots did not know about runtime-frozen reuse fields.
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds", "existingAssetId", "existingNodeId"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"beat-sheet": [{ text: JSON.stringify({ beats: [{ clipId: "clip-a", clipIndex: 0,
					assetObjectContracts: [{ ...frozenWriterObjectContract({ kind: "character", name: "hero", referenceRole: "identity" }),
						referenceImageNodeIds: [existingNodeId] }],
				}] }) }],
			},
		});
		const result = await executeRegisteredWorkflowNode({
			...base,
			flowVersionData: {
				workflowProjectContext: {
					version: 3,
					projectId: "project-1",
					canvasId: "flow-1",
					sourceNodeId: null,
					selectedAssetIds: [existingAssetId],
					projectAssetIds: [existingAssetId],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [existingAssetId], activeNodeId: null, groupId: null },
					permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
					assetSnapshot: [{
						assetId: existingAssetId,
						assetVersion: 1,
						assetVersionId: "asset-version-1",
						projectId: "project-1",
						name: "Hero",
						canonicalName: "hero",
						kind: "image",
						referenceType: "character",
						approvalStatus: "approved",
						origin: "project_node",
						flowId: "flow-1",
						nodeId: existingNodeId,
						mediaKind: "image",
						state: "ready",
						productionEligible: true,
						updatedAt: "2026-08-18T00:00:00.000Z",
					}],
					capturedAt: "2026-08-18T00:00:00.000Z",
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					result: {
						text: "[]",
						requestTerminal: {
							status: "succeeded",
							reason: "all_frozen_asset_references_reused",
						},
					},
				},
			},
		});
	});

	it("exposes unselected images to the asset Agent without imposing an automatic reuse decision", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "asset-plan-fresh-run",
			text: JSON.stringify([{
				assetId: "hero-new",
				role: "character://hero",
				prompt: "生成新的角色参考图",
				negativePrompt: "身份漂移",
				consumerClipIds: ["clip-a"],
				referenceType: "character",
				roleName: "hero",
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
				identityAnchors: ["hero identity"],
				prohibitedDrift: ["不得改变身份"],
			}]),
			assets: [],
			expectedDelivery: { version: 1 },
			deliveryEvidence: { version: 1 },
			deliveryVerification: { version: 2, status: "satisfied" },
			requestTerminal: { version: 1, terminal: true, status: "succeeded", reason: "delivery_verification_satisfied" },
		}));
		const existingNodeId = "video-workflow:asset-image-generate::item::hero::output::image";
		const existingAssetId = `project-node:project:project-1:${existingNodeId}`;
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("asset-planner", "agents.logical-task/v2", {
					workflowInstruction: "输出资产计划",
					workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
					workflowAgentOutputEncoding: "json_array",
					workflowAgentJsonArrayContract: {
						itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
						itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
						itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds", "existingAssetId", "existingNodeId", "referenceType", "roleName", "characterAssetRole", "characterProfileVersion", "identityAnchors", "prohibitedDrift"],
					},
					workflowAgentDeliveryRequirement: "交付资产计划",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
				inputs: { "beat-sheet": [frozenAssetBeatSheet("clip-a", [
					{ kind: "character", name: "hero", referenceRole: "identity" },
				]) ] },
			}),
			flowVersionData: {
				workflowProjectContext: {
					version: 3,
					projectId: "project-1",
					canvasId: "flow-1",
					sourceNodeId: null,
					selectedAssetIds: [],
					projectAssetIds: [existingAssetId],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
					permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
					assetSnapshot: [{
						assetId: existingAssetId,
						assetVersion: 1,
						assetVersionId: "asset-version-1",
						projectId: "project-1",
						name: "Hero",
						canonicalName: "hero",
						kind: "image",
						referenceType: "character",
						approvalStatus: "approved",
						origin: "project_node",
						flowId: "flow-1",
						nodeId: existingNodeId,
						mediaKind: "image",
						state: "ready",
						productionEligible: true,
                        sourceFacts: { referenceType: "character", roleName: "hero", physicalIdentityKey: "hero", characterAssetRole: null, characterProfileVersion: null, identityAnchors: [], prohibitedDrift: [], sourceNodeId: existingNodeId, workflowExecutionId: null, taskId: null, prompt: "Hero reference" },
						updatedAt: "2026-08-18T00:00:00.000Z",
					}],
					capturedAt: "2026-08-18T00:00:00.000Z",
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result.ok).toBe(true);
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			instruction: expect.stringContaining(existingAssetId),
		}));
		expect(result).toMatchObject({
			outputRefs: { ports: { result: { text: expect.stringContaining("hero-new") } } },
		});
	});

	it.each([
		["nodes", true], ["assets", true], ["mixed", true],
		["nodes", false], ["assets", false], ["mixed", false],
	] as const)("resolves all original views through %s references with explicit selection=%s without replacement images", async (referenceMode, explicitlySelected) => {
		const ids = ["a", "b", "c", "d"];
		const base = selectedAssetProjectContext(ids);
		const projectContext = { ...base, selectedAssetIds: explicitlySelected ? ids : [], canvasId: "flow-1", assetSnapshot: base.assetSnapshot.map((asset) => ({
			...asset, flowId: "flow-1", nodeId: `node-${asset.assetId}`,
		})) };
		const beatSheet = { text: JSON.stringify({ assetPlans: [], beats: [["a", "b"], ["b", "c", "d"]].map((selected, clipIndex) => ({
			clipId: `clip-${clipIndex}`, clipIndex,
			assetObjectContracts: [{ ...frozenWriterObjectContract({ kind: "scene", name: "产品", referenceRole: "environment" }),
				kind: "prop", referenceRole: "identity",
				referenceImageNodeIds: referenceMode === "assets" ? [] : selected.map((id) => `node-${id}`),
				referenceAssetIds: referenceMode === "nodes" ? [] : selected }],
		})) }) };
		const runImage = vi.fn();
		const resolveProjectAsset = vi.fn(async (request: { assetId: string }) => ({
			assetId: request.assetId, projectId: "project-1", nodeId: `node-${request.assetId}`,
			url: `https://assets.example/${request.assetId}.png`, mimeType: "image/png", mediaKind: "image" as const,
			flowId: "flow-1", styleFingerprint: null,
		}));
		const deps = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo, runImage, resolveProjectAsset };
		const projected = await executeRegisteredWorkflowNode(context({
			node: node("project", "video.asset-plans.project/v1"), inputs: { "beat-sheet": [beatSheet] },
			flowVersionData: { workflowProjectContext: projectContext },
		}), deps);
		expect(projected.ok).toBe(true);
		if (!projected.ok) throw new Error(JSON.stringify(projected));
		const split = await executeRegisteredWorkflowNode(context({
			node: node("split", "video.asset-plans.split/v1"),
			inputs: { "beat-sheet": [beatSheet], "asset-plans": [projected.outputRefs.ports["asset-plans"]] },
			flowVersionData: { workflowProjectContext: projectContext },
		}), deps);
		expect(split.ok).toBe(true);
		if (!split.ok) throw new Error(JSON.stringify(split));
		const collection = split.outputRefs.ports["asset-items"];
		if (!isWorkflowCollection(collection)) throw new Error("missing collection");
		expect(collection.items.map((item) => item.itemId)).toEqual(ids.map(id => assetBindingIdentity(id, "prop://产品")));
		expect(collection.items.map((item) => (item.value as { consumerClipIds: string[] }).consumerClipIds))
			.toEqual([["clip-0"], ["clip-0", "clip-1"], ["clip-1"], ["clip-1"]]);
		const materialized: unknown[] = [];
		for (const item of collection.items) {
			const result = await executeRegisteredWorkflowNode(context({
				node: node(`resolve-${item.itemId}`, "tapcanvas.image.generate/v1", {
					workflowImageModelKey: "gpt-image-2", workflowImageAspectRatio: "16:9", workflowImageSize: "2K", workflowImageReferenceAssetBindings: [],
				}), inputs: { "asset-items": [item.value] }, flowVersionData: { workflowProjectContext: projectContext },
			}), deps);
			expect(result).toMatchObject({ ok: true, outputRefs: { evidence: { assetOrigin: "existing_asset", assetId: (item.value as { assetId: string }).assetId } } });
			if (!result.ok) throw new Error(JSON.stringify(result));
			materialized.push(result.outputRefs.ports.image);
		}
		expect(resolveProjectAsset.mock.calls.map(([request]) => request.assetId)).toEqual(ids);
		expect(runImage).not.toHaveBeenCalled();
		const carried = await executeRegisteredWorkflowNode(context({
			node: node("carry", "video.asset-plans.split/v1"),
			inputs: { "beat-sheet": [beatSheet], "asset-plans": [{ text: "[]" }],
				"asset-bindings": [createWorkflowCollection({ collectionId: "prior", producerNodeId: "resolved", producerPortId: "image",
					itemIds: ids, values: materialized })] },
			flowVersionData: { workflowProjectContext: projectContext },
		}), deps);
		expect(carried.ok).toBe(true);
		if (!carried.ok) throw new Error(JSON.stringify(carried));
		const carriedCollection = carried.outputRefs.ports["asset-items"];
		if (!isWorkflowCollection(carriedCollection)) throw new Error("missing carry collection");
		expect(carriedCollection.items.map((item) => item.itemId)).toEqual(ids.map(id => assetBindingIdentity(id, "prop://产品")));
		expect(carriedCollection.items.map((item) => (item.value as { consumerClipIds: string[] }).consumerClipIds))
			.toEqual([["clip-0"], ["clip-0", "clip-1"], ["clip-1"], ["clip-1"]]);
	});

	it("reuses an exact BeatSheet reference asset when its display name differs from the physical identity key", async () => {
		const runAgent = vi.fn();
		const existingNodeId = "launch-asset-image-generate::item::char-liu-xiu::output::image";
		const existingAssetId = `project-node:chapter:chapter-1:${existingNodeId}`;
		const referencedContract = {
			...frozenWriterObjectContract({
				kind: "character",
				name: "刘秀",
				referenceRole: "identity",
			}),
			physicalIdentityKey: "body-liu-xiu-01",
			referenceAssetIds: [existingAssetId],
		};
		const base = context({
			node: node("asset-planner", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds", "existingAssetId", "existingNodeId"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"beat-sheet": [{
					text: JSON.stringify({
						beats: [{
							clipId: "clip-a",
							clipIndex: 0,
							characters: ["刘秀"],
							assetObjectContracts: [referencedContract],
						}],
					}),
				}],
			},
		});
		const result = await executeRegisteredWorkflowNode({
			...base,
			flowVersionData: {
				workflowProjectContext: {
					version: 3,
					projectId: "project-1",
					canvasId: "flow-1",
					sourceNodeId: null,
					selectedAssetIds: [existingAssetId],
					projectAssetIds: [existingAssetId],
					timeline: { clips: [] },
					selection: { nodeIds: [], assetIds: [existingAssetId], activeNodeId: null, groupId: null },
					permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
					assetSnapshot: [{
						assetId: existingAssetId,
						assetVersion: 1,
						assetVersionId: "asset-version-1",
						projectId: "project-1",
						name: "刘秀",
						canonicalName: "刘秀",
						kind: "text",
						referenceType: null,
						approvalStatus: "needs_confirmation",
						origin: "project_node",
						flowId: "flow-1",
						nodeId: existingNodeId,
						mediaKind: "image",
						state: "ready",
						productionEligible: true,
						updatedAt: "2026-08-28T00:00:00.000Z",
					}],
					capturedAt: "2026-08-28T00:00:00.000Z",
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					result: {
						text: "[]",
						requestTerminal: { reason: "all_frozen_asset_references_reused" },
					},
				},
			},
		});
	});

	it("treats the materialized launch identity as the only reusable identity for the full-chapter planner", async () => {
		const runAgent = vi.fn();
		const launchIdentityBindings = createWorkflowCollection({
			collectionId: "launch-asset-bindings",
			producerNodeId: "launch-asset-image-generate",
			producerPortId: "asset-bindings",
			itemIds: ["identity-hero"],
			values: [{
				assetPlan: {
					assetId: "identity-hero",
					role: "character://hero",
					consumerClipIds: ["clip-launch"],
				},
				nodeId: "launch-identity-node",
				imageUrl: "https://assets.tapcanvas.test/launch-identity-hero.png",
			}],
		});
		const beatSheet = {
			text: JSON.stringify({
				beats: [
					{
						clipId: "clip-launch",
						clipIndex: 0,
						characters: ["hero"],
						assetObjectContracts: [frozenWriterObjectContract({
							kind: "character",
							name: "hero",
							referenceRole: "identity",
						})],
					},
					{
						clipId: "clip-later",
						clipIndex: 1,
						characters: ["hero"],
						assetObjectContracts: [frozenWriterObjectContract({
							kind: "character",
							name: "hero",
							referenceRole: "identity",
						})],
					},
				],
			}),
		};
		const result = await executeRegisteredWorkflowNode(context({
			node: node("asset-planner", "agents.logical-task/v2", {
				workflowInstruction: "输出资产计划",
				workflowAgentOutputArtifactType: "tapcanvas.asset-plans/v1",
				workflowAgentOutputEncoding: "json_array",
				workflowAgentJsonArrayContract: {
					itemRequiredStringFields: ["assetId", "role", "prompt", "negativePrompt"],
					itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
					itemAllowedFields: ["assetId", "role", "prompt", "negativePrompt", "consumerClipIds"],
				},
				workflowAgentDeliveryRequirement: "交付资产计划",
				workflowAgentDefinitionId: "writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}, "once", ["asset-plans"], undefined, ["beat-sheet", "asset-bindings"]),
			inputs: {
				"beat-sheet": [beatSheet],
				"asset-bindings": [launchIdentityBindings],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					"asset-plans": {
						text: "[]",
						requestTerminal: {
							status: "succeeded",
							reason: "all_frozen_asset_references_reused",
						},
					},
				},
			},
		});
	});

	it("resolves the frozen asset identity set from the clip context and injects it into the Agent request", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-1",
			text: JSON.stringify({
				clips: [{
					assetObjectContracts: [{ assetId: "asset-char-sword" }],
					shots: [{ shotNo: 1, durationSeconds: 10, visualTask: "主角在门前的空间状态", action: "主角停在门前", depictedStoryEventIndices: [0] }],
				}],
				selfQaNote: "checked",
				creativeReview: {},
				sourceFidelityAudit: {
					canonicalParticipants: ["主角"],
					preservedEntryFacts: ["主角在门前"],
					preservedOrderedEvents: ["主角停在门前"],
					preservedExitFacts: ["主角停在门前"],
					inventedFacts: [],
				},
			}),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-1", "agents.logical-task/v2", {
					workflowInstruction: "输出 clips",
					workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["selfQaNote"],
						requiredObjectFields: ["creativeReview", "sourceFidelityAudit"],
						requiredArrayFields: ["clips"],
						allowedFields: ["clips", "selfQaNote", "creativeReview", "sourceFidelityAudit"],
						itemExactAssetIds: {
							declarationPaths: ["assets", "assetObjectContracts"],
							expectedAssetPlansFromPort: "clip-contexts",
						},
					},
					workflowAgentDeliveryRequirement: "交付 clips",
					workflowAgentDefinitionId: "video-prompt-writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
				inputs: {
					"clip-contexts": [frozenSingleClipContext({
						assetPlans: [{ assetId: "asset-char-sword" }, { assetId: "asset-scene-river" }],
						assetObjectContracts: [
							frozenWriterObjectContract({ assetId: "asset-char-sword", kind: "character", name: "主角", referenceRole: "identity" }),
							frozenWriterObjectContract({ assetId: "asset-scene-river", kind: "scene", name: "河岸", referenceRole: "environment" }),
						],
					})],
				},
			}),
		}, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonObjectContract: expect.objectContaining({
				itemExactAssetIds: {
					declarationPaths: ["assetObjectContracts"],
					expected: ["asset-char-sword", "asset-scene-river"],
				},
			}),
		}));
		// writer 只负责 shots；缺失或错误的冻结资产身份由服务端从 Clip 上下文投影，
		// 不再让模型反复抄写后进入同链纠偏。
		expect(result.ok).toBe(true);
	});

	it("injects an empty frozen asset identity set for a pure T2V media-delivery clip", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-pure-t2v",
			text: JSON.stringify({ clips: [{ assetObjectContracts: [] }] }),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		await executeRegisteredWorkflowNode({
			...context({
					node: node("agent-pure-t2v", "agents.logical-task/v2", {
					workflowInstruction: "输出纯文生视频 clip",
					workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredArrayFields: ["clips"],
						allowedFields: ["clips"],
						itemExactAssetIds: {
							declarationPaths: ["assetObjectContracts"],
							expectedAssetPlansFromPort: "clip-contexts",
						},
					},
					workflowAgentDeliveryRequirement: "交付纯 T2V clip",
					workflowAgentDefinitionId: "video-prompt-writer",
					workflowAgentModelKey: "doubao-seed-2-0-lite-260428",
				}),
				inputs: {
					"clip-contexts": [frozenSingleClipContext({
						executionScope: "media_delivery",
						assetPlans: [],
					})],
				},
			}),
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonObjectContract: expect.objectContaining({
				itemExactAssetIds: {
					declarationPaths: ["assetObjectContracts"],
					expected: [],
				},
			}),
		}));
	});

	it("injects the mapped Clip duration into the writer contract before prompt-package assembly", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-duration",
			text: JSON.stringify({
				clips: [{
					durationSeconds: 12,
					shots: [{ shotNo: 1, durationSeconds: 10, visualTask: "主角位于门前", action: "主角停在门前", depictedStoryEventIndices: [0] }],
				}],
				selfQaNote: "checked",
				creativeReview: {},
				sourceFidelityAudit: {
					canonicalParticipants: ["主角"],
					preservedEntryFacts: ["主角在门前"],
					preservedOrderedEvents: ["主角停在门前"],
					preservedExitFacts: ["主角停在门前"],
					inventedFacts: [],
				},
			}),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-duration", "agents.logical-task/v2", {
					workflowInstruction: "输出单 Clip",
					workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["selfQaNote"],
						requiredObjectFields: ["creativeReview", "sourceFidelityAudit"],
						requiredArrayFields: ["clips"],
						allowedFields: ["clips", "selfQaNote", "creativeReview", "sourceFidelityAudit"],
					},
					workflowAgentDeliveryRequirement: "交付单 Clip",
					workflowAgentDefinitionId: "video-prompt-writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
				inputs: {
					"clip-contexts": [frozenSingleClipContext()],
				},
			}),
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonObjectContract: expect.objectContaining({
				expectedArrayLengths: { clips: 1 },
				arrayItemExactNumberFields: {
					clips: [{ clipIndex: 0, durationSeconds: 10 }],
				},
				arrayItemExactStringFields: {
					clips: [{ clipId: "clip-001", exitState: "主角停在门前" }],
				},
				arrayItemExactStringArrayFields: {
					clips: [{ characterRoleNames: ["主角"] }],
				},
			}),
		}));
		expect(result.ok).toBe(true);
	});

	it("keeps a deterministic Clip writer clock failure repairable in the same Agent chain", async () => {
		const frozenContext = frozenSingleClipContext({ durationSeconds: 26 });
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-boundary-failure",
			text: JSON.stringify({
				clips: [{
					shots: [
						{ shotNo: 1, durationSeconds: 9, visualTask: "第一事件", action: "完成第一事件", depictedStoryEventIndices: [0] },
						{ shotNo: 2, durationSeconds: 7, visualTask: "第二事件", action: "完成第二事件", depictedStoryEventIndices: [1] },
						{ shotNo: 3, durationSeconds: 4, visualTask: "第三事件开始", action: "从 16 秒开始推进第三事件", depictedStoryEventIndices: [1] },
						{ shotNo: 4, durationSeconds: 6, visualTask: "第三事件完成", action: "完成第三事件", depictedStoryEventIndices: [2] },
					],
				}],
			}),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode(context({
			node: node("agent-boundary", "agents.logical-task/v2", {
				workflowInstruction: "一次性输出单 Clip",
				workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
				workflowAgentOutputEncoding: "json_object",
				workflowAgentJsonObjectContract: {
					requiredArrayFields: ["clips"],
					allowedFields: ["clips"],
				},
				workflowAgentDeliveryRequirement: "交付单 Clip",
				workflowAgentDefinitionId: "video-prompt-writer",
				workflowAgentModelKey: "deepseek-v4-flash",
			}),
			inputs: {
				"clip-contexts": [{
					...frozenContext,
					beat: {
						...frozenContext.beat,
						storyEvents: [
							{ startSeconds: 0, endSeconds: 9, entryState: "开始", exitState: "第一事件完成" },
							{ startSeconds: 9, endSeconds: 16, entryState: "第一事件完成", exitState: "第二事件完成" },
							{ startSeconds: 16, endSeconds: 26, entryState: "第二事件完成", exitState: "第三事件完成" },
						],
					},
				}],
			},
		}), { runAgent, runJavascript: vi.fn(), runVideo });

		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			ok: false,
			waitingExternal: true,
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "repair_with_correction",
					continuationReason: "structured_output_repair_required",
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
						message: "clipWriter.clips[0].shots[2].depictedStoryEventIndices declares storyEvent 1 outside the shot clock interval (shot=[16,20), storyEvent=[9,16))",
					},
				},
			},
		});
	});
});

describe("workflow exact asset contract auto-injection", () => {
	it("auto-injects the asset exact contract for single-array writer nodes carrying assetPlans", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-1",
			text: JSON.stringify({
				clips: [{
					clipId: "clip-001",
					clipIndex: 0,
					durationSeconds: 10,
					characterRoleNames: ["主角", "对手"],
					exitState: "双方仍在原位",
					temporalFrameTrack: frozenTemporalFrameTrack(10, "双方进入同一交锋空间", "双方仍在原位"),
					temporalFrameCoverage: frozenTemporalFrameCoverage(10),
					assetObjectContracts: [
						frozenWriterObjectContract({ assetId: "ref-hero-001", kind: "character", name: "主角", referenceRole: "identity" }),
						frozenWriterObjectContract({ assetId: "ref-rival-001", kind: "character", name: "对手", referenceRole: "identity" }),
					],
					shots: [{ shotNo: 1, visualTask: "交锋后的距离与受力变化", action: "主角与对手交锋", durationSeconds: 10, depictedStoryEventIndices: [0] }],
					sourceEventCoverage: [{ storyEventIndex: 0, shotNos: [1] }],
				}],
				sourceFidelityAudit: {
					canonicalParticipants: ["主角", "对手"],
					preservedEntryFacts: ["双方进入同一交锋空间"],
					preservedOrderedEvents: ["双方完成一次交锋"],
					preservedExitFacts: ["双方仍在原位"],
					inventedFacts: [],
				},
			}),
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		const result = await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-1", "agents.logical-task/v2", {
					workflowInstruction: "输出 clips",
					workflowAgentOutputArtifactType: "tapcanvas.clip-prompts/v2",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredArrayFields: ["clips"],
						allowedFields: ["clips", "sourceFidelityAudit"],
						itemRequiredNonEmptyArrayFields: ["assetObjectContracts"],
					},
					workflowAgentDeliveryRequirement: "交付 clips",
					workflowAgentDefinitionId: "video-prompt-writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
				inputs: {
					"clip-contexts": [frozenSingleClipContext({
						characters: ["主角", "对手"],
						exitState: "双方仍在原位",
						assetPlans: [{ assetId: "ref-hero-001" }, { assetId: "ref-rival-001" }],
						assetObjectContracts: [
							frozenWriterObjectContract({ assetId: "ref-hero-001", kind: "character", name: "主角", referenceRole: "identity" }),
							frozenWriterObjectContract({ assetId: "ref-rival-001", kind: "character", name: "对手", referenceRole: "identity" }),
						],
					})],
				},
			}),
		}, { runAgent, runJavascript: vi.fn(), runVideo });
			expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
				jsonObjectContract: expect.objectContaining({
					itemExactAssetIds: {
						declarationPaths: ["assetObjectContracts"],
						expected: ["ref-hero-001", "ref-rival-001"],
					},
				}),
			}));
			expect(result.ok).toBe(true);
		});

	it("does not inject when the declared output is not a single top-level array", async () => {
		const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({
			taskId: "agent-task-1",
			text: '{"protocolVersion":"2","beats":[]}',
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: { ok: true },
			deliveryVerification: { status: "satisfied" },
			requestTerminal: { status: "succeeded" },
		}));
		await executeRegisteredWorkflowNode({
			...context({
				node: node("agent-1", "agents.logical-task/v2", {
					workflowInstruction: "输出 beats",
					workflowAgentOutputArtifactType: "tapcanvas.multi-field-object/v1",
					workflowAgentOutputEncoding: "json_object",
					workflowAgentJsonObjectContract: {
						requiredStringFields: ["protocolVersion"],
						requiredArrayFields: ["beats"],
						allowedFields: ["protocolVersion", "beats"],
					},
					workflowAgentDeliveryRequirement: "交付 beats",
					workflowAgentDefinitionId: "writer",
					workflowAgentModelKey: "deepseek-v4-flash",
				}),
				inputs: {
					"clip-contexts": [{
						beat: {},
						assetPlans: [{ assetId: "ref-hero-001" }],
					}],
				},
			}),
		}, { runAgent, runJavascript: vi.fn(), runVideo });
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			jsonObjectContract: expect.not.objectContaining({ itemExactAssetIds: expect.anything() }),
		}));
	});
});


describe("staged chapter authoring executors", () => {
  it("dispatches independent asset preparation before any clip output exists", async () => {
    const { shared } = stagedAuthoringFixture();
    const result = await executeRegisteredWorkflowNode({
      ...context({ node: node("prepare", "video.chapter-assets.prepare/v1", {}, "once", ["asset-items"]), inputs: { "chapter-assets": [shared] } }),
      projectContext: selectedAssetProjectContext([]),
    }, { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("errorMessage" in result ? result.errorMessage : "Unexpected external wait");
    expect(result.outputRefs.evidence).toMatchObject({ itemCount: 0, consumerBinding: "deferred_until_design" });
  });

  it("prepares shared backgrounds without waiting for clip designs or the assembled BeatSheet", async () => {
    const { shared } = stagedAuthoringFixture();
    const result = await executeRegisteredWorkflowNode(context({
      node: node("backgrounds", "tapcanvas.chapter-backgrounds.split/v1", {}, "once", ["asset-items"]),
      inputs: { "chapter-assets": [shared] },
    }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("errorMessage" in result ? result.errorMessage : "Unexpected external wait");
    const collection = result.outputRefs.ports["asset-items"];
    expect(isWorkflowCollection(collection)).toBe(true);
    if (!isWorkflowCollection(collection)) throw new Error("missing backgrounds");
    expect(collection.items).toHaveLength(shared.backgroundPlans.length);
  });

  it("fans out exact clip identities and assembles persisted per-item text outputs", async () => {
    const { chapter, shared, clip } = stagedAuthoringFixture();
    const inputs = { "chapter-plan": [{ text: JSON.stringify(chapter) }], "chapter-assets": [{ text: JSON.stringify(shared) }] };
    const split = await executeRegisteredWorkflowNode(context({ node: node("split", "video.clip-design-inputs/v1", {}, "once", ["clip-design-inputs"]), inputs }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error("errorMessage" in split ? split.errorMessage : "Unexpected external wait");
    const items = split.outputRefs.ports["clip-design-inputs"];
    expect(isWorkflowCollection(items)).toBe(true);
    if (!isWorkflowCollection(items)) throw new Error("missing collection");
    expect(items.items[0]).toMatchObject({ itemId: "source-hash:clip:0", value: { clipIndex: 0, speechLedger: [] } });
    const designs = createWorkflowCollection({ collectionId: "designs", producerNodeId: "designer", producerPortId: "clip-designs", itemIds: [items.items[0]!.itemId], values: [{ text: JSON.stringify(clip) }] });
    const assembled = await executeRegisteredWorkflowNode(context({ node: node("join", "video.beat-sheet.assemble/v1", {}, "collect", ["beat-sheet"]), inputs: { ...inputs, "clip-designs": [designs] } }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) throw new Error("errorMessage" in assembled ? assembled.errorMessage : "Unexpected external wait");
    expect(assembled.outputRefs.evidence).toMatchObject({ itemCount: 1, assembly: "identity_join" });
  });
});

it("runs each clip design with one item and a frozen schema instead of the whole chapter collection", async () => {
  const { chapter, shared, clip } = stagedAuthoringFixture();
  const runAgent = vi.fn(async (_request: WorkflowAgentRunRequest) => ({ taskId: "clip-design-task", text: JSON.stringify(clip), assets: [],
    expectedDelivery: { version: 1 }, deliveryEvidence: { version: 1 }, deliveryVerification: { version: 2, status: "satisfied" },
    requestTerminal: { status: "succeeded", reason: "delivery_verification_satisfied" } }));
  const split = await executeRegisteredWorkflowNode(context({ node: node("split", "video.clip-design-inputs/v1", {}, "once", ["clip-design-inputs"]),
    inputs: { "chapter-plan": [chapter], "chapter-assets": [shared] } }), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo });
  if (!split.ok) throw new Error("errorMessage" in split ? split.errorMessage : "Unexpected external wait");
  const result = await executeRegisteredWorkflowNode(context({ node: node("designer", "agents.logical-task/v2", {
    workflowInstruction: "Design one clip", workflowAgentOutputArtifactType: "tapcanvas.clip-design/v1", workflowAgentOutputEncoding: "json_object",
    workflowAgentJsonObjectContract: { allowedFields: ["clipIndex", "beat", "blockingPlan", "timing"], jsonSchema: { type: "object" } },
    workflowAgentModelKey: "test-model", workflowAgentDefinitionId: "writer", workflowAgentDeliveryRequirement: "Deliver one clip",
  }, "each", ["clip-designs"], 16, ["clip-design-inputs"]), inputs: { "clip-design-inputs": [split.outputRefs.ports["clip-design-inputs"]] } }), { runAgent, runJavascript: vi.fn(), runVideo });
  expect(result.ok).toBe(true);
  expect(runAgent).toHaveBeenCalledTimes(1);
  expect(runAgent.mock.calls[0]?.[0]).toMatchObject({ inputs: { "clip-design-inputs": [{ clipIndex: 0 }] }, jsonObjectContract: { jsonSchema: {
    properties: { clipIndex: { const: 0 }, blockingPlan: { properties: { backgroundObjectId: { enum: ["scene"] } } } },
  } } });
});

it("materializes one shared image once and retains both object consumers through the writer join", async () => {
  const projectContext = selectedAssetProjectContext(["shared"]);
  const objectRegistry = ["first", "second"].map(objectId => ({ objectId, kind: "prop", name: objectId,
    referenceRole: "prop", referenceAssetIds: ["shared"], referenceImageNodeIds: [] }));
  const prepared = prepareChapterAssetCollection({ assets: {objectRegistry,assetPlans:[],backgroundPlans:[]},
    projectContext,executionId:"e",nodeId:"prepare" });
  const resolveProjectAsset = vi.fn(async () => ({assetId:"shared",projectId:projectContext.projectId,
    url:"https://assets.test/shared.png",mediaKind:"image" as const,mimeType:"image/png",nodeId:"shared-node",flowId:"flow-1",styleFingerprint:null}));
  const runImage = vi.fn();
  const outputs = await Promise.all(prepared.items.map(item => executeRegisteredWorkflowNode(context({
    node: node(`image::item::${item.itemId}`,"tapcanvas.image.generate/v1",{
      workflowImageModelKey:"gpt-image-2",workflowImageAspectRatio:"16:9",workflowImageSize:"2K",workflowImageReferenceAssetBindings:[],
    }),inputs:{"asset-items":[item.value]},flowVersionData:{workflowProjectContext:projectContext},
  }),{runAgent:vi.fn(),runJavascript:vi.fn(),runVideo,runImage,resolveProjectAsset})));
  expect(resolveProjectAsset).toHaveBeenCalledTimes(1);
  expect(runImage).not.toHaveBeenCalled();
  const receipts = outputs.map(result => { if (!result.ok) throw new Error(JSON.stringify(result)); return result.outputRefs.ports.image; });
  const bound = bindMaterializedAssetConsumers(createWorkflowCollection({collectionId:"receipts",producerNodeId:"image",producerPortId:"image",itemIds:["shared"],values:receipts}),
    createWorkflowCollection({collectionId:"uses",producerNodeId:"consumers",producerPortId:"items",itemIds:["first","second"],
      values:objectRegistry.map(object=>({assetId:"shared",role:`prop://${object.name}`,consumerClipIds:["clip-a"]}))}));
  expect(bound.items).toHaveLength(2);
  expect(bound.items.map(item=>item.value)).toEqual([expect.objectContaining({nodeId:"shared-node"}),expect.objectContaining({nodeId:"shared-node"})]);
  expect(bound.items.map(item=>item.index)).toEqual([0,1]);
  const joined = enrichVideoClipContextWithMaterializedAssets({contextItem:{beat:{clipId:"clip-a"},
    assetObjectContracts:objectRegistry.map(object=>frozenWriterObjectContract({kind:"prop",name:object.name,referenceRole:"prop"}))},materializedAssetCollection:bound});
  expect(joined.assetObjectContracts).toEqual([expect.objectContaining({name:"first",assetId:"shared",referenceImageNodeIds:["shared-node"]}),
    expect.objectContaining({name:"second",assetId:"shared",referenceImageNodeIds:["shared-node"]})]);
  expect(bound.items.map(item=>(item.value as {binding:{objectId:string}}).binding.objectId)).toEqual(["first","second"]);
});
