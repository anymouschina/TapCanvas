import { describe, expect, it, vi } from "vitest";
import { createWorkflowCollection, isWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import {
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
			displayName: "五指巷小义庄",
		})).toEqual({
			referenceType: "scene",
			canonicalName: "五指巷小义庄",
			displayName: "五指巷小义庄",
			sceneName: "五指巷小义庄",
		});
		expect(workflowImageAssetMetadata({
			role: "character://body-liu-xiu-001",
			displayName: "刘秀",
			referenceType: "character",
			roleName: "body-liu-xiu-001",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityAnchors: ["固定骨相"],
			prohibitedDrift: ["不得换脸"],
		})).toEqual(expect.objectContaining({
			referenceType: "character",
			canonicalName: "body-liu-xiu-001",
			displayName: "刘秀",
			physicalIdentityKey: "body-liu-xiu-001",
		}));
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
	kind: "character" | "scene";
	name: string;
	referenceRole: "identity" | "environment" | "none";
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
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });
		expect(submitted.ok).toBe(true);
		expect(submitVideo).toHaveBeenCalledTimes(2);
		expect(submitVideo).toHaveBeenNthCalledWith(1, expect.objectContaining({
			estimateIdentity: "execution-1:estimate",
			modelKey: "video-model",
			itemIndex: 0,
			referenceImageNodeIds: ["image-node-hero"],
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
		if (!concatenated.ok) throw new Error(concatenated.errorMessage);
		expect(concatenated).toMatchObject({ ok: true, outputRefs: { ports: { "master-video": { videoUrl: "https://assets.example/master.mp4" } } } });
		expect(projectWorkflowFilm).toHaveBeenCalledWith(expect.objectContaining({
		videoUrl: "https://assets.example/master.mp4",
		assetId: "asset-master-1",
		clipCount: 2,
		targetDurationSeconds: 13,
		aspectRatio: "16:9",
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
			reused: false,
		}));
		const first = await executeRegisteredWorkflowNode(context({
			node: videoNode,
			inputs: { prompt: [collection] },
		}), { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: submitVideo });
		expect(first).toMatchObject({ ok: false, waitingExternal: true });
		if (first.ok || first.waitingExternal !== true) throw new Error("Expected external wait");
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
			inputs: { "beat-sheet": [{ taskId: "beat-task", text: JSON.stringify(fullBeatSheet), assets: [] }] },
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

		await expect(executeRegisteredWorkflowNode(context({
			node: node("checkpoint-script", "workflow.script.javascript/v1", {
				workflowJavascriptCode: "return input",
			}, "each", ["result"], 1),
			inputs: { input: [items] },
			checkpointOutputRefs: async () => {
				throw new Error("checkpoint unavailable");
			},
		}), { runAgent: vi.fn(), runJavascript, runVideo })).rejects.toThrow("checkpoint unavailable");
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

	it("persists Knowledge Search candidates and requires their exact artifact for Knowledge Read", async () => {
		const candidateSet = {
			protocolVersion: "workflow.knowledge-candidates/v1" as const,
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
				keywords: ["景别"],
				sourceUrls: [],
				bodyPreview: "知识预览",
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
				artifacts: [{ type: "workflow.knowledge-candidates/v1", identity: "domain_test" }],
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

	it("forwards frozen Workflow Skill dependencies alongside bounded discovery", async () => {
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
		const runAgent = vi.fn(async () => ({
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
			forcedAgentRole: "research",
			modelKey: "gemini-3.1-pro",
			deliveryRequirement: "交付一个可解析且可追溯的 JSON 报告产物",
			requiredSkills: ["tapcanvas-source-coverage", "tapcanvas-research"],
			mountedKnowledgeCardIds: [],
			disabledSkills: [],
			disabledKnowledgeCardIds: [],
			allowedTools: [
				"Skill",
				"knowledge_search",
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

	it("scopes system-level workflow Agent nodes to the caller project and canvas", async () => {
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
		const readCanvasProjectContextFromFlow = vi.fn(async () => ({
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
			readCanvasProjectContextFromFlow,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromFlow).toHaveBeenCalledWith(expect.objectContaining({
			flowId: "caller-flow-1",
			ownerId: "user-1",
		}));
		expect(result).toMatchObject({
			outputRefs: {
				evidence: {
					sourceMode: "project_context",
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

	it("uses the immutable accepted public-chat turn as the sole project_context source", async () => {
		const readCanvasProjectContextFromFlow = vi.fn();
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
			readCanvasProjectContextFromFlow,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromFlow).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			outputRefs: {
				evidence: {
					sourceMode: "public_chat_turn",
					sourceId: "public-turn-1",
					sourceFingerprint: acceptedSource.fingerprint,
				},
				artifacts: [{
					identity: "public-turn-1",
					value: {
						sourceMode: "public_chat_turn",
						sourceId: "public-turn-1",
						text: "创作一条二十秒的雨夜霓虹追逐视频",
						sourceNodeIds: [],
						nodes: [],
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
		const readCanvasProjectContextFromFlow = vi.fn(async () => ({
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
			readCanvasProjectContextFromFlow,
		});

		expect(result.ok).toBe(true);
		expect(readCanvasProjectContextFromFlow).toHaveBeenCalledWith(expect.objectContaining({
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
		const readCanvasProjectContextFromFlow = vi.fn();
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
			readCanvasProjectContextFromFlow,
		});

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("workflow_accepted_turn_source_invalid"),
		});
		expect(readCanvasProjectContextFromFlow).not.toHaveBeenCalled();
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
		const runAgent = vi.fn(async () => ({
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

	it("unwraps a strictly typed Agent JSON artifact before exposing the text port", async () => {
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
				deliveryEvidence: { items: [{ evidenceId: "e-summary" }] },
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
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
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
				requiredArrayFields: ["objectRegistry", "beats"],
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
					outputContractFailure: {
						code: "structured_output_invalid",
						message: expect.stringContaining("objectRegistry must be a non-empty array"),
						rawOutputRecorded: true,
					},
				},
			},
		});
	});

	it("freezes an exact BeatSheet count without inventing per-clip durations", async () => {
		const runAgent = vi.fn(async () => ({
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
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

	it("does not release an Agent node whose local delivery verification is unsatisfied", async () => {
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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

	it("terminalizes a collection immediately when one provider item fails while accepted siblings remain recoverable", async () => {
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
			errorMessage: "Workflow node video failed 1/2 item executions: 内容审核未通过：1 个参考素材被拒",
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

	it("preserves a terminal media failure without re-entering a paid executor", async () => {
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

describe("workflow delivery scope and single-submission failure recording", () => {
	it("writes media nodes to the caller delivery flow instead of the workflow flow", async () => {
		const runImage = vi.fn(async () => ({
			status: "success" as const,
			nodeId: "workflow-1:asset-image-generate::item::asset-1::output::image",
			taskId: "task-1",
			imageUrl: "https://example.com/a.png",
			assetId: "asset-1",
			reused: false,
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
				evidence: { reused: true, reuseSource: "caller_asset", canvasNodeId: "caller-node-hero" },
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

	it("resolves an ID-only material-library asset at execution time without requiring a canvas node", async () => {
		const runImage = vi.fn();
		const resolveProjectAsset = vi.fn(async () => ({
			assetId: "asset-library-hero",
			projectId: "caller-project-1",
			url: "https://assets.tapcanvas.test/library-hero.png",
			mediaKind: "image" as const,
			mimeType: "image/png",
			nodeId: null,
			flowId: null,
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
						existingAssetId: "asset-library-hero",
						existingProjectId: "caller-project-1",
					}],
				},
			}),
			flowVersionData: { workflowProjectContext: projectContext },
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

	it("fails a typed Agent immediately when the provider rejects its only submission with 429", async () => {
		const rateLimitError = Object.assign(new Error("provider rejected this request"), {
			code: "llm_http_429",
		});
		const runAgent = vi.fn(async () => {
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
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("before its single structured submission: llm_http_429"),
			outputRefs: {
				evidence: {
					executorCompleted: false,
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
					requestTerminal: { terminal: true, status: "failed", reason: "llm_http_429" },
					agentExecutionFailure: {
						code: "llm_http_429",
						phase: "before_structured_submission",
						retryable: false,
					},
				},
			},
		});
		expect("waitingExternal" in result).toBe(false);
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({
			allowedTools: [],
		}));
		expect(runAgent.mock.calls[0]?.[0]).not.toHaveProperty("promptExampleRetrievalScope");
	});

	it("keeps a typed terminal 429 failed instead of converting it into backpressure", async () => {
		const runAgent = vi.fn(async () => ({
			taskId: "workflow:execution-1:agent-1",
			text: "",
			assets: [],
			expectedDelivery: { active: true },
			deliveryEvidence: {
				version: 1,
				source: "agents_cli_durable_turn_status",
				physicalRetryOrdinal: 2,
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

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("before its single structured submission: llm_http_429"),
			outputRefs: {
				evidence: {
					requestTerminal: { terminal: true, status: "failed", reason: "llm_http_429" },
					agentExecutionFailure: {
						code: "llm_http_429",
						phase: "before_structured_submission",
						retryable: false,
					},
				},
			},
		});
		expect("waitingExternal" in result).toBe(false);
		expect(runAgent).toHaveBeenCalledTimes(1);
		if (result.ok || !result.outputRefs) throw new Error("Expected typed terminal failure evidence");
		expect(result.outputRefs.evidence).not.toHaveProperty("outputContractFailure");
		expect(result.outputRefs.evidence).not.toHaveProperty("deliveryEvidence");
	});

	it("closes a legacy typed physical-retry checkpoint without reopening the model", async () => {
		const runAgent = vi.fn();
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
				evidence: {
					deliveryEvidence: {
						retryablePhysicalFailure: true,
						physicalFailureReason: "provider_stream_interrupted",
						physicalRetryOrdinal: 4,
					},
				},
			},
		}, { runAgent, runJavascript: vi.fn(), runVideo });

		expect(result).toMatchObject({
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("cannot reopen a typed submission window"),
			outputRefs: {
				evidence: {
					requestTerminal: {
						terminal: true,
						status: "failed",
						reason: "structured_submission_window_closed",
					},
					agentExecutionFailure: {
						code: "structured_submission_window_closed",
						retryable: false,
					},
				},
			},
		});
		expect("waitingExternal" in result).toBe(false);
		expect(runAgent).not.toHaveBeenCalled();
	});

	it("fails a recorded typed candidate immediately even when the Agent terminal claims suspension", async () => {
		const runAgent = vi.fn(async () => ({
			taskId: "typed-candidate-suspended-1",
			text: '{"clips":[]}',
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
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining("violated its json_object output contract"),
			outputRefs: {
				evidence: {
					executorCompleted: false,
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
					requestTerminal: {
						terminal: true,
						status: "failed",
						reason: "structured_output_invalid",
					},
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
					},
				},
			},
		});
		expect("waitingExternal" in result).toBe(false);
		if (!result.ok && result.outputRefs) {
			expect(result.outputRefs.evidence).not.toHaveProperty("deliveryEvidence");
			expect(result.outputRefs.evidence).not.toHaveProperty("continuationReason");
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
		const runAgent = vi.fn(async () => ({
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
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
		const runAgent = vi.fn(async () => ({
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
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
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

	it("freezes visible ready workflow images into asset-plan reuse identities", async () => {
		const runAgent = vi.fn();
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
				"beat-sheet": [frozenAssetBeatSheet("clip-a", [
					{ kind: "character", name: "hero", referenceRole: "identity" },
				])],
			},
		});
		const existingNodeId = "video-workflow:asset-image-generate::item::hero::output::image";
		const existingAssetId = `project-node:project:project-1:${existingNodeId}`;
		const result = await executeRegisteredWorkflowNode({
			...base,
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
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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

	it("persists the exact deterministic Clip writer clock failure without reopening the model", async () => {
		const frozenContext = frozenSingleClipContext({ durationSeconds: 26 });
		const runAgent = vi.fn(async () => ({
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
			errorCode: "workflow_node_runtime_failed",
			errorMessage: expect.stringContaining(
				"clipWriter.clips[0].shots[2].depictedStoryEventIndices declares storyEvent 1 outside the shot clock interval",
			),
			outputRefs: {
				evidence: {
					structuredOutputSubmissionPolicy: "single_submission_record_and_fail",
					requestTerminal: {
						terminal: true,
						status: "failed",
						reason: "structured_output_invalid",
					},
					outputContractFailure: {
						code: "structured_output_invalid",
						rawOutputRecorded: true,
						message: "clipWriter.clips[0].shots[2].depictedStoryEventIndices declares storyEvent 1 outside the shot clock interval",
					},
				},
			},
		});
	});
});

describe("workflow exact asset contract auto-injection", () => {
	it("auto-injects the asset exact contract for single-array writer nodes carrying assetPlans", async () => {
		const runAgent = vi.fn(async () => ({
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
		const runAgent = vi.fn(async () => ({
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
