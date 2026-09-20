import { assetBindingIdentity } from "./execution.asset-identity";
import { bindWorkflowClipAssetObjectContracts, parseWorkflowClipAssetObjectContracts } from "./execution.video-workflow-continuity";
import { inspectDeclaredAssetIdsMatch } from "./execution.agent-output-contract";
import { sceneReferenceFixture } from "./execution.scene-reference-fixture";
import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import {
	assertWorkflowVideoProductionPlanReferencePolicy,
	assertWorkflowVideoReferencePolicy,
	buildVideoAssetPlanCollection,
	buildVideoClipContexts,
	buildVideoDeliveryContract,
	buildVideoProductionPlan,
	buildWorkflowPromptPackage,
	freezeWorkflowVideoDurationPlan,
	inspectWorkflowPromptPackageAdmission,
	parseFrozenWorkflowVideoDurationPlan,
	parseWorkflowAssetRole,
	projectVideoAssetPlansFromBeatSheet,
	compileWorkflowClipWriterFrozenEnvelope,
	compileWorkflowClipWriterFrozenEnvelopeText,
	enrichVideoClipContextWithMaterializedAssets,
	validateWorkflowClipWriterForContext,
	validateWorkflowAssetPlanProjectReuse,
} from "./execution.video-workflow-contract";
import { WorkflowInputContractError } from "./execution.input-contract";
import { sha256Hex } from "../asset/book-content-hash";

describe("video workflow atomic contracts", () => {
	it("joins materialized asset bindings into the clip authoring context", () => {
		const contextItem = {
			executionScope: "media_delivery",
			clipIndex: 0,
			beat: { clipId: "clip-0", durationSeconds: 5 },
			assetPlans: [],
			assetObjectContracts: [{
				kind: "character",
				name: "Hero",
				physicalIdentityKey: "hero-body",
				referenceImageNodeIds: [],
				referenceAssetIds: [],
				referenceRole: "identity",
				identityInvariant: "same body",
				startState: "ready",
				spatialRelation: "left",
				driver: "Hero",
				stateChange: "moves",
				endState: "forward",
			}],
		};
		const sequenceContext = {
			previous: null,
			current: { clipId: "clip-0", assetObjectContracts: contextItem.assetObjectContracts },
			next: { clipId: "clip-1", assetObjectContracts: [{ ...contextItem.assetObjectContracts[0], name: "Neighbour", physicalIdentityKey: "neighbour-body" }] },
		};
		const originalContext = structuredClone(contextItem);
		const result = enrichVideoClipContextWithMaterializedAssets({
			contextItem: { ...contextItem, sequenceContext },
			materializedAssetCollection: createWorkflowCollection({
				collectionId: "assets",
				producerNodeId: "asset-image-generate",
				producerPortId: "asset-bindings",
				itemIds: ["plan-hero"],
				values: [{
					assetPlan: { assetId: "plan-hero", role: "character://hero-body", consumerClipIds: ["clip-0"] },
					generatedAssetId: "generated-hero",
					nodeId: "image-node-hero",
					imageUrl: "https://assets.example/hero.png",
				}],
			}),
		});
		expect(result.sequenceContext).toEqual({
			previous: null,
			current: expect.objectContaining({ clipId: "clip-0", assetObjectContracts: result.assetObjectContracts }),
			next: sequenceContext.next,
		});
		expect(result.beat).toEqual(expect.objectContaining({ assetObjectContracts: result.assetObjectContracts }));
		expect(contextItem).toEqual(originalContext);
		expect(result.assetPlans).toHaveLength(1);
		expect(result.authoringAssetBindings).toEqual([expect.objectContaining({
			assetId: "plan-hero",
			generatedAssetId: "generated-hero",
			nodeId: "image-node-hero",
		})]);
		expect(result.assetObjectContracts).toEqual([expect.objectContaining({
			assetId: "plan-hero",
			referenceImageNodeIds: ["image-node-hero"],
		})]);
	});

	it.each(["environment://空座町", "wardrobe://主角战斗外套"])("rejects reference-purpose alias as object kind: %s", role => {
		expect(() => parseWorkflowAssetRole(role, "assetPlans[0].role")).toThrow();
	});

	it("keeps creative review and semantic verification as non-blocking prompt-package diagnostics", () => {
		const admission = inspectWorkflowPromptPackageAdmission({
			protocolVersion: "2",
			artifactType: "tapcanvas.prompt-package/v2",
			clips: [{ durationSeconds: 5, assetBindings: [] }],
			deliveryEvidence: {
				version: 2,
				source: "workflow_prompt_package",
				clipCount: 1,
				totalDurationSeconds: 5,
				sourceSpeechLineCount: 1,
				narrativeSpeechLineCount: 0,
				executableSpeechLineCount: 1,
				assetBindingCount: 0,
				embeddedAuthoringReviewCount: 0,
			},
			deliveryVerification: { version: 2, status: "unsatisfied" },
		});

		expect(admission).toEqual({
			structurallyValid: true,
			issues: [],
			diagnostics: {
				clipCount: 1,
				deliveryVerificationStatus: "unsatisfied",
				embeddedAuthoringReviewCount: 0,
				embeddedAuthoringReviewComplete: false,
				qualityAssessmentStatus: null,
				qualityAssessmentReviewedClipCount: null,
				qualityAssessmentComplete: null,
			},
		});
	});

	it("still rejects corrupted deterministic prompt-package counts", () => {
		const admission = inspectWorkflowPromptPackageAdmission({
			protocolVersion: "2",
			artifactType: "tapcanvas.prompt-package/v2",
			clips: [{ durationSeconds: 5, assetBindings: [] }],
			deliveryEvidence: {
				version: 2,
				source: "workflow_prompt_package",
				clipCount: 1,
				totalDurationSeconds: 5,
				sourceSpeechLineCount: 1,
				narrativeSpeechLineCount: 1,
				executableSpeechLineCount: 1,
				assetBindingCount: 0,
				embeddedAuthoringReviewCount: 0,
			},
			deliveryVerification: { version: 2, status: "satisfied" },
		});

		expect(admission.structurallyValid).toBe(false);
		expect(admission.issues).toContain("deliveryEvidence speech counts must be non-negative integers and conserve their total");
	});

	it("accepts a creative-only writer envelope and projects all compiler-owned Clip fields", () => {
		const contextItem = {
			clipIndex: 0,
			beat: {
				clipId: "clip-creative-only",
				durationSeconds: 10,
				characters: ["主角"],
				exitState: "主角已经进入门内",
				storyEvents: [{ startSeconds: 0, endSeconds: 10, entryState: "主角站在门外", exitState: "主角已经进入门内" }],
			},
			assetPlans: [],
			assetObjectContracts: [objectContract("scene", "门厅", "environment")],
			spokenScript: [],
			dialoguePaceRate: 4,
		};
		const authored = JSON.stringify({
			clips: [{
				title: "推门",
				continuity: "从门外既成站位开始",
				shots: [{
					shotNo: 1,
					visualTask: "门从关闭变为打开，主角跨入门内",
					depictedStoryEventIndices: [0],
					action: "主角推开门并跨过门槛，门板停在身后",
					durationSeconds: 10,
				}],
			}],
		});
		const projected = compileWorkflowClipWriterFrozenEnvelopeText({ text: authored, contextItem });
		expect(projected).not.toBeNull();
		expect(validateWorkflowClipWriterForContext({
			text: projected ?? "",
			itemId: "clip-creative-only",
			contextItem,
		})).toBeNull();
		const parsed = JSON.parse(projected ?? "{}") as { clips: Array<Record<string, unknown>> };
		expect(parsed.clips[0]).toMatchObject({
			clipId: "clip-creative-only",
			clipIndex: 0,
			durationSeconds: 10,
			characterRoleNames: ["主角"],
			exitState: "主角已经进入门内",
			assetObjectContracts: [objectContract("scene", "门厅", "environment")],
		});
		expect(parsed.clips[0]).toHaveProperty("sourceEventCoverage");
		expect(parsed.clips[0]).toHaveProperty("temporalFrameTrack");
		expect(parsed.clips[0]).toHaveProperty("temporalFrameCoverage");
	});

	it("derives executable shot ordinals without changing authored order, timing or event mapping", () => {
		const shots = [
			{ action: "进入", visualTask: "进入", durationSeconds: 4, depictedStoryEventIndices: [0] },
			{ shotNo: 99, action: "离开", visualTask: "离开", durationSeconds: 6, depictedStoryEventIndices: [1] },
		];
		const text = JSON.stringify({ clips: [{ shots }] });
		const result = compileWorkflowClipWriterFrozenEnvelope({ text, contextItem: {
			clipIndex: 0,
			assetObjectContracts: [],
			beat: { clipId: "ordered", durationSeconds: 10, characters: [], exitState: "离开",
				storyEvents: [
					{ startSeconds: 0, endSeconds: 4, entryState: "门外", exitState: "进入" },
					{ startSeconds: 4, endSeconds: 10, entryState: "进入", exitState: "离开" },
				],
			},
		} });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Compilation unexpectedly failed");
		const compiled = JSON.parse(result.text) as { clips: Array<{ shots: unknown[] }> };
		expect(compiled.clips[0].shots).toEqual(shots.map((shot, index) => ({ ...shot, shotNo: index + 1 })));
		expect(JSON.stringify({ clips: [{ shots }] })).toBe(text);
	});

	it("projects immutable Clip context facts and compiles machine time fields from Agent-authored shots", () => {
		const authoredTemporalFrameTrack = Array.from({ length: 10 }, (_, windowIndex) => ({
			windowIndex,
			startSeconds: windowIndex,
			endSeconds: windowIndex + 1,
			startState: windowIndex === 0 ? "门外" : `门内-${windowIndex}`,
			startFrame: `${windowIndex}s 起帧`,
			transition: `${windowIndex}-${windowIndex + 1}s 推门进入`,
			carryFrame: `${windowIndex + 1}s 承帧`,
			carryState: windowIndex === 9 ? "门内" : `门内-${windowIndex + 1}`,
			storyEventIndices: [0],
		}));
		const text = JSON.stringify({
			clips: [{
				clipId: "wrong",
				clipIndex: 99,
				durationSeconds: 1,
				characterRoleNames: ["wrong"],
				exitState: "wrong",
				assetObjectContracts: [],
				temporalFrameTrack: authoredTemporalFrameTrack,
				shots: [{ shotNo: 1, durationSeconds: 10, action: "Agent authored action", visualTask: "Agent authored frame", depictedStoryEventIndices: [0] }],
			}],
			sourceFidelityAudit: { canonicalParticipants: ["wrong"], inventedFacts: [] },
		});
		const assetObjectContracts = [{
			assetId: "asset-hero",
			kind: "character",
			name: "主角",
			referenceRole: "identity",
			referenceImageNodeIds: [],
		}];
		const repaired = compileWorkflowClipWriterFrozenEnvelopeText({
			text,
			contextItem: {
				clipIndex: 0,
				beat: {
					clipId: "clip-001",
					durationSeconds: 10,
					characters: ["主角"],
					exitState: "门内",
					storyEvents: [{ startSeconds: 0, endSeconds: 10, entryState: "门外", exitState: "门内" }],
				},
				assetObjectContracts,
			},
		});
		expect(repaired).not.toBeNull();
		const parsed = JSON.parse(repaired ?? "{}") as Record<string, unknown>;
		const clip = (parsed.clips as Record<string, unknown>[])[0];
		expect(clip).toMatchObject({
			clipId: "clip-001",
			clipIndex: 0,
			durationSeconds: 10,
			characterRoleNames: ["主角"],
			exitState: "门内",
			assetObjectContracts,
			shots: [{ shotNo: 1, durationSeconds: 10, action: "Agent authored action", visualTask: "Agent authored frame", depictedStoryEventIndices: [0] }],
		});
		expect(clip.temporalFrameTrack).not.toEqual(authoredTemporalFrameTrack);
		expect(clip.temporalFrameTrack).toHaveLength(10);
		expect((clip.temporalFrameTrack as Record<string, unknown>[])[0]).toMatchObject({
			startFrame: "Agent authored frame",
			transition: "Agent authored action",
			carryFrame: "Agent authored frame",
		});
		expect(parsed.sourceFidelityAudit).toMatchObject({ canonicalParticipants: ["wrong"] });
	});

	it("rejects an incomplete model-authored shot clock instead of rescaling it", () => {
		const contextItem = {
			clipIndex: 2,
			beat: {
				clipId: "clip-frozen-02",
				durationSeconds: 10,
				characters: ["主角"],
				exitState: "主角进入门内",
				storyEvents: [{
					startSeconds: 0,
					endSeconds: 10,
					entryState: "主角站在门外",
					exitState: "主角进入门内",
				}],
			},
			assetObjectContracts: [objectContract("scene", "门厅", "environment")],
			spokenScript: [],
			dialoguePaceRate: 4,
		};
		const repaired = compileWorkflowClipWriterFrozenEnvelopeText({
			text: JSON.stringify({
				clips: [{
					clipId: "model-wrong",
					clipIndex: 99,
					durationSeconds: 999,
					exitState: "model-wrong",
					shots: [{
						shotNo: 1,
						durationSeconds: 5,
						visualTask: "主角推门",
						depictedStoryEventIndices: [0],
						action: "主角推开门",
					}],
				}],
			}),
			contextItem,
		});
		expect(repaired).toBeNull();
	});

	it("does not rewrite relative shot timing to close the frozen Clip duration", () => {
		const contextItem = {
			clipIndex: 0,
			beat: {
				clipId: "clip-relative-clock",
				durationSeconds: 20,
				characters: [],
				exitState: "动作完成",
				storyEvents: [{ startSeconds: 0, endSeconds: 20, entryState: "动作开始", exitState: "动作完成" }],
			},
			assetObjectContracts: [objectContract("scene", "测试场景", "environment")],
			spokenScript: [],
			dialoguePaceRate: 4,
		};
		const repaired = compileWorkflowClipWriterFrozenEnvelopeText({
			text: JSON.stringify({
				clips: [{
					shots: [
						{ shotNo: 1, durationSeconds: 4, visualTask: "动作开始", action: "人物开始移动", depictedStoryEventIndices: [0] },
						{ shotNo: 2, durationSeconds: 5, visualTask: "动作完成", action: "人物完成移动", depictedStoryEventIndices: [0] },
					],
				}],
			}),
			contextItem,
		});
		expect(repaired).toBeNull();
	});

	it("reports the exact shot and story-event path when equal clock boundaries do not overlap", () => {
		const compilation = compileWorkflowClipWriterFrozenEnvelope({
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
			contextItem: {
				clipIndex: 1,
				beat: {
					clipId: "clip-boundary",
					durationSeconds: 26,
					characters: [],
					exitState: "第三事件完成",
					storyEvents: [
						{ startSeconds: 0, endSeconds: 9, entryState: "开始", exitState: "第一事件完成" },
						{ startSeconds: 9, endSeconds: 16, entryState: "第一事件完成", exitState: "第二事件完成" },
						{ startSeconds: 16, endSeconds: 26, entryState: "第二事件完成", exitState: "第三事件完成" },
					],
				},
				assetObjectContracts: [],
			},
		});

		expect(compilation).toEqual({
			ok: false,
			errorMessage: "clipWriter.clips[0].shots[2].depictedStoryEventIndices declares storyEvent 1 outside the shot clock interval (shot=[16,20), storyEvent=[9,16))",
		});
	});

	it("rejects non-positive model-authored shot timing without normalizing it", () => {
		const contextItem = {
			clipIndex: 0,
			beat: {
				clipId: "clip-repaired-clock",
				durationSeconds: 20,
				characters: [],
				exitState: "动作完成",
				storyEvents: [{ startSeconds: 0, endSeconds: 20, entryState: "动作开始", exitState: "动作完成" }],
			},
			assetObjectContracts: [objectContract("scene", "测试场景", "environment")],
			spokenScript: [],
			dialoguePaceRate: 4,
		};
		const repaired = compileWorkflowClipWriterFrozenEnvelopeText({
			text: JSON.stringify({
				clips: [{
					shots: [
						{ shotNo: 1, durationSeconds: 4, visualTask: "动作开始", action: "人物开始移动", depictedStoryEventIndices: [0] },
						{ shotNo: 2, durationSeconds: 0, visualTask: "动作完成", action: "人物完成移动", depictedStoryEventIndices: [0] },
					],
				}],
			}),
			contextItem,
		});
		expect(repaired).toBeNull();
	});

	it("compiles temporal coverage from writer-owned shot durations", () => {
		const authoredTrack = Array.from({ length: 20 }, (_, windowIndex) => ({
			windowIndex,
			startSeconds: windowIndex,
			endSeconds: windowIndex + 1,
			startState: `state-${windowIndex}`,
			startFrame: `frame-${windowIndex}`,
			transition: `transition-${windowIndex}`,
			carryFrame: `frame-${windowIndex + 1}`,
			carryState: `state-${windowIndex + 1}`,
			storyEventIndices: [0],
		}));
		const text = JSON.stringify({
			clips: [{
				clipId: "wrong",
				clipIndex: 99,
				durationSeconds: 20,
				characterRoleNames: [],
				exitState: "wrong",
				assetObjectContracts: [],
				temporalFrameTrack: authoredTrack,
				temporalFrameCoverage: [{ windowIndex: 0, shotNos: [1] }],
				shots: [
					{ shotNo: 1, durationSeconds: 8, action: "推进", visualTask: "高原", depictedStoryEventIndices: [0] },
					{ shotNo: 2, durationSeconds: 12, action: "收束", visualTask: "村落", depictedStoryEventIndices: [0] },
				],
			}],
			sourceFidelityAudit: { canonicalParticipants: [], inventedFacts: [] },
		});
		const repaired = compileWorkflowClipWriterFrozenEnvelopeText({
			text,
			contextItem: {
				clipIndex: 0,
				beat: {
					clipId: "clip-0",
					durationSeconds: 20,
					characters: [],
					exitState: "state-20",
					storyEvents: [{ startSeconds: 0, endSeconds: 20, entryState: "state-0", exitState: "state-20" }],
				},
				assetObjectContracts: [],
			},
		});
		const parsed = JSON.parse(repaired ?? "{}") as { clips: Array<{ temporalFrameCoverage: Array<{ windowIndex: number; shotNos: number[] }> }> };
		expect(parsed.clips[0]?.temporalFrameCoverage).toHaveLength(20);
		expect(parsed.clips[0]?.temporalFrameCoverage[7]).toEqual({ windowIndex: 7, shotNos: [1] });
		expect(parsed.clips[0]?.temporalFrameCoverage[8]).toEqual({ windowIndex: 8, shotNos: [2] });
	});

	const objectContract = (
		kind: string,
		name: string,
		referenceRole = "none",
		state = `${kind}:${name}:state`,
	) => ({
		kind,
		name,
		...(kind === "character" ? { physicalIdentityKey: name } : {}),
		referenceImageNodeIds: [],
		referenceRole,
		identityInvariant: `${kind}:${name}:identity`,
		startState: state,
		spatialRelation: "位于同一连续空间",
		driver: "承接冻结事件",
		stateChange: "按冻结事件发生可见变化",
		endState: state,
	});
	const defaultObjectContracts = [
		objectContract("character", "主角"),
		objectContract("scene", "测试场景"),
	];
	const temporalFrameTrack = (
		durationSeconds: number,
		storyEvents: readonly Record<string, unknown>[],
		exitState: string,
	) => {
		let state = String(storyEvents[0]?.entryState ?? "entry");
		return Array.from({ length: Math.ceil(durationSeconds) }, (_, windowIndex) => {
			const startSeconds = windowIndex;
			const endSeconds = Math.min(windowIndex + 1, durationSeconds);
			const endingEvent = storyEvents.find((event) => event.endSeconds === endSeconds);
			const carryState = String(endingEvent?.exitState ?? (endSeconds === durationSeconds ? exitState : `state-at-${endSeconds}s`));
			const window = {
				windowIndex,
				startSeconds,
				endSeconds,
				startState: state,
				startFrame: `${startSeconds}s 起帧 ${state}`,
				transition: `${startSeconds}-${endSeconds}s 可见状态变化`,
				carryFrame: `${endSeconds}s 承帧 ${carryState}`,
				carryState,
				storyEventIndices: storyEvents.flatMap((event, eventIndex) => (
					Number(event.startSeconds) < endSeconds && Number(event.endSeconds) > startSeconds ? [eventIndex] : []
				)),
			};
			state = carryState;
			return window;
		});
	};
	const temporalFrameCoverage = (durationSeconds: number, shotDurations: readonly number[]) => {
		const shotIntervals = shotDurations.map((duration, index) => ({
			shotNo: index + 1,
			start: shotDurations.slice(0, index).reduce((total, value) => total + value, 0),
			end: shotDurations.slice(0, index + 1).reduce((total, value) => total + value, 0),
		}));
		return Array.from({ length: Math.ceil(durationSeconds) }, (_, windowIndex) => ({
			windowIndex,
			shotNos: shotIntervals.flatMap((shot) => (
				shot.start < Math.min(windowIndex + 1, durationSeconds) && shot.end > windowIndex ? [shot.shotNo] : []
			)),
		}));
	};
	const beatSheet = (
		beats: readonly Record<string, unknown>[],
		endingHook: string | null = "最后状态把未完成因果交给后续",
	) => ({
		text: JSON.stringify({
			protocolVersion: "keyframe-beat-sheet/v2",
			sourceId: "workflow-test-source",
			sourceFingerprint: "workflow-test-fingerprint",
			chapterArc: {
				storyPromise: "主角必须完成当前来源中的核心任务",
				protagonistThroughline: "主角的选择按来源顺序推进",
				primaryPayoff: "来源冻结的不可逆结果得到兑现",
				endingHook,
			},
			filmBible: {},
			adaptationStrategy: {},
			castManifest: [],
			meta: {},
			sourceCoveragePlan: { speechLedger: [] },
			sequenceControlPlan: (() => {
				let cursor = 0;
				const segments = beats.map((beat, index) => {
					const startSeconds = cursor;
					cursor += Number(beat.durationSeconds);
					return {
						clipId: typeof beat.clipId === "string" ? beat.clipId : `clip-${index}`,
						startSeconds,
						endSeconds: cursor,
						temporalDirectives: [],
						transitionFromPrevious: index === 0 ? "从整章入口进入" : `承接第 ${index} 段退出`,
						transitionToNext: index === beats.length - 1 ? "保留整章出口" : `把结果交给第 ${index + 2} 段`,
					};
				});
				return { protocolVersion: "tapcanvas.sequence-control-plan/v1", totalDurationSeconds: cursor, segments };
			})(),
			beats: beats.map((beat, index) => {
				const durationSeconds = Number(beat.durationSeconds);
				const exitState = typeof beat.exitState === "string" ? beat.exitState : `clip-${index}-exit`;
				const storyEvents = Array.isArray(beat.storyEvents) ? beat.storyEvents as Record<string, unknown>[] : [{
					sourceBeatId: `source-${index}`,
					event: `event-${index}`,
					entryState: `clip-${index}-entry`,
					exitState,
					startSeconds: 0,
					endSeconds: durationSeconds,
				}];
				return {
					clipIndex: index,
					dominantFunction: `推进来源事件 ${index + 1}`,
					causalEntry: index === 0 ? "整章承诺触发首段" : `上一段结果迫使第 ${index + 1} 段发生`,
					irreversibleResult: exitState,
					handoffToNext: index === beats.length - 1 ? "把冻结结尾钩子留给后续" : `第 ${index + 2} 段必须承接当前结果`,
					characters: ["主角"],
					exitState,
					storyEvents,
					temporalFrameTrack: temporalFrameTrack(durationSeconds, storyEvents, exitState),
					assetObjectContracts: defaultObjectContracts,
					dialogueScript: [],
					narrativeAudioPlan: { strategy: "visual_only", rationale: "当前来源跨度无人声", lines: [] },
					speakers: [],
					...beat,
				};
			}),
		}),
	});
	const durationPlan = (clipDurations: readonly number[]) => ({
		targetDurationSeconds: clipDurations.reduce((total, duration) => total + duration, 0),
		modelKey: "doubao-seedance-2.5",
		durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
		maxDurationSeconds: 30,
	});
	const deliveryContract = (clipDurations: readonly number[]) => buildVideoDeliveryContract({
		executionId: "execution-1",
		workflowKey: "tapcanvas.video-production",
		executionScope: "media_delivery",
		canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
		durationPlan: durationPlan(clipDurations),
	});
	const promptOnlyDeliveryContract = (clipDurations: readonly number[]) => buildVideoDeliveryContract({
		executionId: "execution-1",
		workflowKey: "tapcanvas.video-production",
		executionScope: "prompt_only",
		canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
		durationPlan: durationPlan(clipDurations),
	});
	type TestAssetBinding = Readonly<{ assetId: string; role: string }>;
	const testObjectContracts = (assets: readonly TestAssetBinding[]) => {
		const planned = [...new Set(assets.map((asset) => asset.role))].map((role) => {
			const [kind = "", name = ""] = role.split("://");
			return {
				...objectContract(
					kind,
					name,
					kind === "character" ? "identity" : kind === "scene" ? "environment" : kind,
				),
			};
		});
		return [
			...planned,
			...(!planned.some((contract) => contract.kind === "character") ? [objectContract("character", "主角")] : []),
			...(!planned.some((contract) => contract.kind === "scene") ? [objectContract("scene", "测试场景")] : []),
		];
	};
	const clipContext = (
		clipId: string,
		durationSeconds: number,
		assetPlans: readonly Record<string, unknown>[] = [],
		clipIndex = 0,
	) => {
		const assets = assetPlans.flatMap((plan) => (
			typeof plan.assetId === "string" && typeof plan.role === "string"
				? [{ assetId: plan.assetId, role: plan.role }]
				: []
		));
		const characterRoleNames = assets
			.map(({ role }) => role.split("://"))
			.filter(([kind]) => kind === "character")
			.map(([, name]) => name || "")
			.filter(Boolean);
		const exitState = `${clipId}-exit`;
		return {
		executionScope: assetPlans.length > 0 ? "media_delivery" : "prompt_only",
		clipIndex,
		beat: {
			clipId,
			clipIndex,
			durationSeconds,
			characters: characterRoleNames.length > 0 ? characterRoleNames : ["主角"],
			exitState,
			storyEvents: [{ event: `${clipId}-event`, entryState: `${clipId}-entry`, exitState, startSeconds: 0, endSeconds: durationSeconds }],
		},
		temporalFrameTrack: temporalFrameTrack(durationSeconds, [{
			event: `${clipId}-event`, entryState: `${clipId}-entry`, exitState, startSeconds: 0, endSeconds: durationSeconds,
		}], exitState),
		spokenScript: [],
		sourceDialogueLineIds: [],
		dialoguePaceRate: 4,
		assetPlans: [],
		assetObjectContracts: testObjectContracts(assets),
	}};
	const assetPlans = (plans: readonly Record<string, unknown>[]) => createWorkflowCollection({
		collectionId: "asset-plans",
		producerNodeId: "asset-fan-out",
		producerPortId: "asset-items",
		itemIds: plans.map((plan, index) => typeof plan.assetId === "string" ? plan.assetId : `asset-${index}`),
		values: plans.map((plan) => ({
			prompt: "reference prompt",
			negativePrompt: "text, watermark",
			consumerClipIds: ["clip-a"],
			...plan,
		})),
	});
	const clipWriterResult = (
		clipId: string,
		durationSeconds: number,
		action: string,
		assets: readonly TestAssetBinding[] = [],
		shotDurations: readonly number[] = [durationSeconds],
		clipIndex = 0,
	) => ({
		text: JSON.stringify({
			clips: [{
				clipId,
				clipIndex,
				durationSeconds,
				logline: action,
				continuity: "相邻关键状态沿同一动作与空间连续推进",
				exitState: `${clipId}-exit`,
				characterRoleNames: assets.some(({ role }) => role.startsWith("character://"))
					? assets.filter(({ role }) => role.startsWith("character://")).map(({ role }) => role.slice("character://".length))
					: ["主角"],
				assets,
				speakerBindings: [],
				assetObjectContracts: testObjectContracts(assets),
				temporalFrameTrack: temporalFrameTrack(durationSeconds, [{
					event: `${clipId}-event`, entryState: `${clipId}-entry`, exitState: `${clipId}-exit`, startSeconds: 0, endSeconds: durationSeconds,
				}], `${clipId}-exit`),
				temporalFrameCoverage: temporalFrameCoverage(durationSeconds, shotDurations),
				shots: shotDurations.map((shotDuration, index) => ({
					shotNo: index + 1,
					visualTask: `${action}：状态变化 ${index + 1}`,
					depictedStoryEventIndices: [0],
					action,
					durationSeconds: shotDuration,
				})),
				sourceEventCoverage: [{
					storyEventIndex: 0,
					shotNos: shotDurations.map((_, index) => index + 1),
				}],
			}],
			selfQaNote: "发现并修复了相邻状态接力",
			creativeReview: {
				mode: "embedded_authoring",
				iterations: 1,
				summary: "补足动作路径与反作用",
				narrativeAudioAssessment: "当前跨度无人声，保持纯视觉与环境声",
			},
			sourceFidelityAudit: {
				canonicalParticipants: assets.some(({ role }) => role.startsWith("character://"))
					? assets.filter(({ role }) => role.startsWith("character://")).map(({ role }) => role.slice("character://".length))
					: ["主角"],
				preservedEntryFacts: ["冻结入口态"],
				preservedOrderedEvents: ["冻结事件"],
				preservedExitFacts: ["冻结退出态"],
				inventedFacts: [],
			},
		}),
	});
	const assetPlanResult = (plans: readonly Record<string, unknown>[]) => ({
		text: JSON.stringify(plans.map((plan) => {
			const role = typeof plan.role === "string" ? plan.role : "";
			if (!role.startsWith("character://") || typeof plan.existingAssetId === "string") return plan;
			const roleName = role.slice("character://".length);
			return {
				...plan,
				referenceType: "character",
				roleName,
				characterAssetRole: "identity_anchor",
				characterProfileVersion: "character-card/v3",
				identityAnchors: [`${roleName}的稳定骨相与发型剪影`],
				prohibitedDrift: [`不得改变${roleName}的脸型、发型和年龄感`],
			};
		})),
	});

	it("projects BeatSheet v20 asset briefs into deterministic collection input without another Agent call", () => {
		const source = beatSheet([{
			clipId: "clip-a",
			durationSeconds: 5,
			characters: ["hero"],
			assetObjectContracts: [
				objectContract("character", "hero", "identity"),
				objectContract("prop", "旧铜钥匙", "prop"),
			],
		}]);
		const sourceObject = JSON.parse(source.text) as Record<string, unknown>;
		const projected = projectVideoAssetPlansFromBeatSheet({
			text: JSON.stringify({
				...sourceObject,
				assetPlans: [{
					role: "character://hero",
					prompt: "完整的中性四视图角色设计：稳定骨相、固定发型与独有衣领细节",
					negativePrompt: "不得改变年龄；不得改变脸型；不要让街口和裂隙进入身份板",
					identityAnchors: ["稳定骨相", "固定发型剪影"],
					prohibitedDrift: ["不得改变年龄", "不得改变脸型"],
				}, {
					role: "prop://旧铜钥匙",
					prompt: "旧铜钥匙中性道具参考",
					negativePrompt: "手持表演、环境、文字",
					identityAnchors: ["旧铜材质", "固定齿形"],
					prohibitedDrift: ["不得改变钥匙齿形"],
				}],
			}),
		});
		expect(projected.assets).toEqual([]);
		expect(JSON.parse(projected.text)).toEqual([{
			assetId: expect.stringMatching(/^planned-image:[a-f0-9]{64}$/),
			objectId: "",
			role: "character://hero",
			prompt: "完整的中性四视图角色设计：稳定骨相、固定发型与独有衣领细节",
			negativePrompt: "不得改变年龄；不得改变脸型；不要让街口和裂隙进入身份板",
			consumerClipIds: ["clip-a"],
			referenceType: "character",
			roleName: "hero",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityAnchors: ["稳定骨相", "固定发型剪影"],
			prohibitedDrift: ["不得改变年龄", "不得改变脸型"],
		}, {
			assetId: expect.stringMatching(/^planned-image:[a-f0-9]{64}$/),
			objectId: "",
			role: "prop://旧铜钥匙",
			prompt: "旧铜钥匙中性道具参考",
			negativePrompt: "手持表演、环境、文字",
			consumerClipIds: ["clip-a"],
		}]);
	});

	it.each(["prop", "vfx"])("retains a shared %s plan across clips without resetting object states", (kind) => {
		const source = beatSheet(["clip-a", "clip-b"].map((clipId, index) => ({
			clipId,
			durationSeconds: 5,
			characters: [],
			assetObjectContracts: [{ ...objectContract(kind, "共享对象", kind), startState: index === 0 ? "完整" : "局部破损", endState: index === 0 ? "局部破损" : "消散" }],
		})));
		const plans = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: source,
			assetAgentResult: assetPlanResult([{
				assetId: "original-product",
				role: `${kind}://共享对象`,
				prompt: "原商品参考",
				negativePrompt: "无关对象",
				consumerClipIds: ["clip-a"],
				existingAssetId: "project-product",
				existingNodeId: "uploaded-product",
				existingImageUrl: "https://assets.tapcanvas.test/product.png",
			}]),
		});
		expect(plans.items).toHaveLength(1);
		expect(plans.items[0]?.value).toMatchObject({
			role: `${kind}://共享对象`,
			consumerClipIds: ["clip-a", "clip-b"],
			existingNodeId: "uploaded-product",
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "clips",
			deliveryContract: deliveryContract([5, 5]),
			beatSheetAgentResult: source,
		});
		const materialized = createWorkflowCollection({
			collectionId: "images",
			producerNodeId: "materialize",
			producerPortId: "asset-bindings",
			itemIds: ["original-product"],
			values: [{
				assetPlan: plans.items[0]!.value,
				generatedAssetId: "project-product",
				nodeId: "uploaded-product",
				imageUrl: "https://assets.tapcanvas.test/product.png",
			}],
		});
		for (const [index, item] of contexts.items.entries()) {
			const bound = enrichVideoClipContextWithMaterializedAssets({
				contextItem: item.value,
				materializedAssetCollection: materialized,
			});
			expect(bound.assetObjectContracts).toEqual([expect.objectContaining({
				name: "共享对象",
				referenceRole: kind,
				referenceImageNodeIds: ["uploaded-product"],
				startState: index === 0 ? "完整" : "局部破损",
				endState: index === 0 ? "局部破损" : "消散",
			})]);
		}
	});

	it("preserves scene contract through projection, fan-out and clip context without rewriting performance", () => {
		const source = beatSheet([{
			clipId: "crowded-clip", durationSeconds: 5, characters: ["乘客"],
			assetObjectContracts: [objectContract("scene", "公交车厢", "environment", "乘客贴挤、车辆摇晃")],
		}]);
		const story = JSON.parse(source.text) as Record<string, unknown>;
		const scenePlan = {
			role: "scene://公交车厢", sceneCard: sceneReferenceFixture,
			identityAnchors: ["中央过道与两侧座椅"], prohibitedDrift: ["固定门窗位置"],
		};
		const authored = { text: JSON.stringify({ ...story, assetPlans: [scenePlan] }) };
		const projected = projectVideoAssetPlansFromBeatSheet(authored);
		const collection = buildVideoAssetPlanCollection({ executionId: "scene-execution", nodeId: "assets",
			beatSheetAgentResult: authored, assetAgentResult: projected });
		expect(collection.items[0]?.value).toMatchObject({ ...scenePlan, referenceType: "scene" });
		expect(JSON.parse(authored.text).beats).toEqual(story.beats);
	});

	it("binds a canonical scene kind with environment reference purpose", () => {
		const source = beatSheet([{
			clipId: "clip-environment",
			durationSeconds: 5,
			characters: ["主角"],
			assetObjectContracts: [
				objectContract("character", "主角", "none"),
				objectContract("scene", "空座町", "environment"),
			],
		}]);
		const sourceObject = JSON.parse(source.text) as Record<string, unknown>;
		const projected = projectVideoAssetPlansFromBeatSheet({
			text: JSON.stringify({
				...sourceObject,
				assetPlans: [{
					role: "scene://空座町",
					sceneCard: sceneReferenceFixture,
					identityAnchors: ["高楼与霓虹街区"],
					prohibitedDrift: ["不得改为空间无关背景"],
				}],
			}),
		});
		expect(JSON.parse(projected.text).map((plan: Record<string, unknown>) => plan.role)).toEqual([
			"scene://空座町",
		]);
	});

	it("freezes a semantic duration window without imposing clip topology", () => {
		const frozen = freezeWorkflowVideoDurationPlan({
			targetDurationSeconds: 40,
			modelKey: "doubao-seedance-2.5",
			durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
		});
		expect(frozen).toMatchObject({
			protocolVersion: "tapcanvas.workflow-video-duration-plan/v2",
			policy: "agent_semantic_duration_budget",
		});
		expect(parseFrozenWorkflowVideoDurationPlan(frozen)).toEqual(frozen);
		expect(parseFrozenWorkflowVideoDurationPlan({
			...frozen,
			policy: "model_max_duration",
		})).toBeNull();
	});

	it("freezes canonical source speech capacity into the delivery contract for the BeatSheet agent", () => {
		const durationPlan = {
			targetDurationSeconds: null,
			modelKey: "doubao-seedance-2.0",
			durationOptions: [5, 10, 15],
			maxDurationSeconds: 15,
		};
		const withSpeech = buildVideoDeliveryContract({
			executionId: "execution-source-profile",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: {
				sourceMode: "project_context",
				authoritativeSources: [{ nodeId: "chapter-seed", sourceId: "chapter-seed", content: "第1章\n“到了吗？”\n“不要紧张，一定能过的。”\n" }],
			},
			durationPlan,
		});
		expect(withSpeech.sourceProfile).toMatchObject({
			protocolVersion: "tapcanvas.beat-sheet-source-profile/v1",
			sourceSpeechUnits: [{ verbatim: "到了吗？" }, { verbatim: "不要紧张，一定能过的。" }],
			sourceSpeechChars: "到了吗？不要紧张，一定能过的。".length,
			minimumPlannedSeconds: Math.ceil("到了吗？不要紧张，一定能过的。".length / 6),
			minimumClipCount: Math.ceil(Math.ceil("到了吗？不要紧张，一定能过的。".length / 6) / 15),
			speechMaxCharsPerSecond: 6,
		});
		const withoutSources = buildVideoDeliveryContract({
			executionId: "execution-source-profile-empty",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "project_context" },
			durationPlan,
		});
		expect(withoutSources.sourceProfile).toBeUndefined();
	});

	it("preserves an explicit clip count even when total duration remains Agent-authored", () => {
		const contract = buildVideoDeliveryContract({
			executionId: "execution-fixed-count",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "project_context" },
			durationPlan: {
				targetDurationSeconds: null,
				modelKey: "doubao-seedance-2.5",
				durationOptions: [4, 5, 6, 8, 10, 12, 15, 20, 24, 30],
				maxDurationSeconds: 30,
			},
			requestedClipCount: 8,
		});

		expect(contract).toMatchObject({
			generationContract: {
				requestedClipCount: 8,
			},
		});
		expect((contract.generationContract as Record<string, unknown>).providerSubmissionTopology).toBeUndefined();
	});

	it("round-trips the exact agent-authored clip topology for a prepared BeatSheet", () => {
		const frozen = freezeWorkflowVideoDurationPlan({
			targetDurationSeconds: 60,
			modelKey: "doubao-seedance-2.0",
			durationOptions: Array.from({ length: 12 }, (_, index) => index + 4),
			explicitDurations: [10, 10, 10, 10, 10, 10],
		});
		expect(frozen.providerSubmissionTopology).toEqual({
			targetDurationSeconds: 60,
			expectedClipCount: 6,
			minimumClipDurations: [10, 10, 10, 10, 10, 10],
			source: "user_clip_durations",
		});
		expect(parseFrozenWorkflowVideoDurationPlan(frozen)).toEqual(frozen);
		expect(buildVideoDeliveryContract({
			executionId: "execution-agent-authored",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "project_context" },
			durationPlan: frozen,
			requestedClipCount: 6,
		})).toMatchObject({
			generationContract: {
				providerSubmissionTopology: frozen.providerSubmissionTopology,
			},
		});
	});

	it("freezes only the selected model's live duration options for 40 seconds", () => {
		expect(freezeWorkflowVideoDurationPlan({
			targetDurationSeconds: 40,
			modelKey: "veo-3.1-pro",
			durationOptions: [5, 8],
		})).toMatchObject({
			modelKey: "veo-3.1-pro",
			maxDurationSeconds: 8,
			policy: "agent_semantic_duration_budget",
		});
	});

	it("freezes prompt-only delivery facts without media side effects", () => {
		const contract = buildVideoDeliveryContract({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			executionScope: "prompt_only",
			canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
			durationPlan: durationPlan([15]),
		});
		expect(contract.expectedDelivery).toMatchObject({
			artifactType: "tapcanvas.prompt-package/v2",
			requiresMediaSideEffects: false,
		});
	});

	it("leaves full-chapter total duration open when the user did not authorize a total", () => {
		const contract = buildVideoDeliveryContract({
			executionId: "execution-full-chapter",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "project_context" },
			durationPlan: {
				targetDurationSeconds: null,
				modelKey: "doubao-seedance-2.0",
				durationOptions: [5, 10, 15],
				maxDurationSeconds: 15,
			},
		});
		expect(contract).not.toHaveProperty("targetDurationSeconds");
		expect(contract.generationContract).not.toHaveProperty("providerSubmissionTopology");
		expect(contract.generationContract).toMatchObject({
			videoModel: "doubao-seedance-2.0",
			durationOptions: [5, 10, 15],
			maxDurationSeconds: 15,
		});
	});

	it("stores authoritative chapter text once in the delivery contract", () => {
		const chapterText = "第一章完整正文";
		const selectedNodeFacts = [{ nodeId: "image-1", assetIds: ["asset-1"], metadata: { kind: "image", description: "商品来源描述" } }];
		const contract = buildVideoDeliveryContract({
			executionId: "execution-full-chapter",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: {
				sourceMode: "project_context",
				nodes: [{ nodeId: "chapter-1", kind: "text", content: chapterText, label: "第一章" }],
				selectedNodeFacts,
				missingSelectedNodeIds: ["missing-image"],
				authoritativeSources: [{ nodeId: "chapter-1", content: chapterText, label: "第一章" }],
			},
			durationPlan: {
				targetDurationSeconds: null,
				modelKey: "doubao-seedance-2.0",
				durationOptions: [5, 10, 15],
				maxDurationSeconds: 15,
			},
		});
		expect(contract.canvasFacts).toEqual({
			sourceMode: "project_context",
			nodes: [{ nodeId: "chapter-1", kind: "text", label: "第一章" }],
			selectedNodeFacts,
			missingSelectedNodeIds: ["missing-image"],
			authoritativeSources: [{ nodeId: "chapter-1", sourceId: "chapter-1", sourceFingerprint: sha256Hex(chapterText.trim()), content: chapterText, label: "第一章" }],
		});
		expect(JSON.stringify(contract).split(chapterText)).toHaveLength(2);
	});

	it("accepts the Agent-authored full-chapter duration when no total was authorized", () => {
		const contract = buildVideoDeliveryContract({
			executionId: "execution-full-chapter",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "project_context" },
			durationPlan: {
				targetDurationSeconds: null,
				modelKey: "doubao-seedance-2.0",
				durationOptions: [5, 10, 15],
				maxDurationSeconds: 15,
			},
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-full-chapter",
			nodeId: "fan-out",
			deliveryContract: contract,
			beatSheetAgentResult: beatSheet([
				{ clipId: "clip-a", durationSeconds: 15, sourceText: "A" },
				{ clipId: "clip-b", durationSeconds: 10, sourceText: "B" },
				{ clipId: "clip-c", durationSeconds: 5, sourceText: "C" },
			]),
		});
		expect(contexts.items.map((item) => item.itemId)).toEqual(["clip-a", "clip-b", "clip-c"]);
	});

	it("carries upstream Skill and knowledge receipts into every clip context", () => {
		const beatSheetResult = {
			...beatSheet([{ clipId: "clip-evidence", durationSeconds: 15, sourceText: "A" }]),
			executionProvenance: {
				version: 1,
				loadedSkillSources: [{ skill: "tapcanvas-dramatic-adapter", source: "references/combat.md" }],
				loadedKnowledgeSources: [{ cardId: "card-combat", title: "战斗节奏" }],
			},
			knowledgeCandidateSearch: { status: "candidate_found", candidateCount: 2, blocking: false },
			retrievalCandidateSets: [{ candidateSetId: "set-1", candidates: [{ id: "card-combat" }] }],
		};
		const contexts = buildVideoClipContexts({
			executionId: "execution-evidence",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([15]),
			beatSheetAgentResult: beatSheetResult,
		});
		const value = contexts.items[0]?.value as Record<string, unknown> | undefined;
		expect(value?.authoringEvidencePacket).toEqual(expect.objectContaining({
			protocolVersion: "tapcanvas.authoring-evidence/v1",
			dependencyProvenance: beatSheetResult.executionProvenance,
			knowledgeCandidateSearch: beatSheetResult.knowledgeCandidateSearch,
			retrievalCandidateSets: beatSheetResult.retrievalCandidateSets,
		}));
	});

	it.each([true, false])("keeps original source evidence separate from authored beats (identity matches: %s)", (matches) => {
		const original = "  爬升再俯冲。\n卸力翻滚踩稳。  ";
		const summary = "急速滑翔，拖脚犁出五米火星";
		const authored = beatSheet([{ clipId: "clip-a", durationSeconds: 5, sourceSpan: summary }]);
		const authoredFacts = JSON.parse(authored.text) as Record<string, unknown>;
		authoredFacts.sourceFingerprint = sha256Hex(original.trim());
		const contexts = buildVideoClipContexts({
			executionId: "source-evidence", nodeId: "fan-out",
			deliveryContract: {
				...deliveryContract([5]),
				canvasFacts: { authoritativeSources: [{
					sourceId: "workflow-test-source",
					sourceFingerprint: matches ? sha256Hex(original.trim()) : "wrong-version",
					content: original,
				}] },
			},
			beatSheetAgentResult: { ...authored, text: JSON.stringify(authoredFacts) },
		});
		const context = contexts.items[0]?.value as Record<string, unknown>;
		expect(context.beat).toMatchObject({ sourceSpan: summary });
		const sourceEvidence = matches ? expect.objectContaining({ status: "matched", sources: [expect.objectContaining({ content: original })] }) : expect.objectContaining({
			status: "unavailable", diagnostic: { reason: "source_fingerprint_mismatch", blocking: false },
		});
		expect(context.sourceEvidence).toEqual(sourceEvidence);
		expect(JSON.stringify(context).split(JSON.stringify(original).slice(1, -1))).toHaveLength(matches ? 2 : 1);
		const joined = enrichVideoClipContextWithMaterializedAssets({
			contextItem: context,
			materializedAssetCollection: createWorkflowCollection({
				collectionId: "no-assets", producerNodeId: "assets", producerPortId: "asset-bindings", itemIds: [], values: [],
			}),
		});
		expect(joined.sourceEvidence).toEqual(context.sourceEvidence);
	});

	it("hands each writer exact adjacent events, speech and state facts on the same frozen timeline", () => {
		const speech = (id: string, text: string) => ({ lineId: id, speakerName: "主角", text, delivery: "on_screen" });
		const audio = (id: string, text: string) => ({
			strategy: "source_grounded_voice", rationale: "source-grounded authored speech",
			lines: [{ ...speech(id, text), afterSourceLineId: null, sourceEvidence: [id] }],
		});
		const input = beatSheet([
			{ clipId: "first", durationSeconds: 5, startKeyframe: "A", endKeyframe: "B", narrativeAudioPlan: audio("line-a", "问题") },
			{ clipId: "middle", durationSeconds: 8, startKeyframe: "B", endKeyframe: "C", narrativeAudioPlan: audio("line-b", "查找"), storyEvents: [
				{ sourceBeatId: "source-middle", event: "inspect", startSeconds: 5, endSeconds: 13, entryState: "B", exitState: "C" },
			] },
			{ clipId: "last", durationSeconds: 5, startKeyframe: "C", endKeyframe: "D", narrativeAudioPlan: audio("line-c", "结果") },
		]);
		const original = JSON.stringify(input);
		for (const executionScope of ["prompt_only", "media_delivery"] as const) {
			const contexts = buildVideoClipContexts({
				executionId: "sequence-facts", nodeId: "fan-out",
				deliveryContract: { ...deliveryContract([5, 8, 5]), executionScope },
				beatSheetAgentResult: input,
			});
			const middle = contexts.items[1]!.value as Record<string, unknown>;
			expect(middle.sequenceContext).toMatchObject({
				previous: { clipId: "first", startKeyframe: "A", endKeyframe: "B", spokenScript: [speech("line-a", "问题")], storyEvents: [{ event: "event-0" }], assetObjectContracts: defaultObjectContracts },
				current: { clipId: "middle", spokenScript: [speech("line-b", "查找")], storyEvents: [{ startSeconds: 0, endSeconds: 8, entryState: "B", exitState: "C" }] },
				next: { clipId: "last", startKeyframe: "C", endKeyframe: "D", spokenScript: [speech("line-c", "结果")], assetObjectContracts: defaultObjectContracts },
			});
			const sequence = middle.sequenceContext as Record<string, unknown>;
			expect(sequence.sequenceTimeline).toHaveLength(3);
			expect(middle.spokenScript).toEqual([speech("line-b", "查找")]);
			expect(contexts.items[0]!.value).toMatchObject({ sequenceContext: { previous: null } });
			expect(contexts.items[2]!.value).toMatchObject({ sequenceContext: { next: null } });
		}
		expect(JSON.stringify(input)).toBe(original);
	});

	it("rejects a delivery contract without an immutable execution scope", () => {
		expect(() => buildVideoDeliveryContract({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			executionScope: undefined,
			canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
			durationPlan: durationPlan([15]),
		})).toThrow("requires an explicit immutable execution scope");
	});

	it("expands the Agent BeatSheet by its actual clip array and preserves stable ids", () => {
		const contexts = buildVideoClipContexts({
				executionId: "execution-1",
				nodeId: "fan-out",
				deliveryContract: deliveryContract([5, 8]),
				beatSheetAgentResult: beatSheet([
					{ clipId: "clip-a", durationSeconds: 5, sourceText: "A" },
					{ clipId: "clip-b", durationSeconds: 8, sourceText: "B" },
				]),
		});
		expect(contexts.items.map((item) => item.itemId)).toEqual(["clip-a", "clip-b"]);
		expect(contexts.items).toHaveLength(2);
		const firstContext = contexts.items[0]?.value as Record<string, unknown> | undefined;
		expect(firstContext?.sourceReceipt).toEqual({
			protocolVersion: "keyframe-beat-sheet/v2",
			sourceId: "workflow-test-source",
			sourceFingerprint: "workflow-test-fingerprint",
		});
		expect(firstContext?.sequenceContext).toMatchObject({
			chapterArc: {
				storyPromise: "主角必须完成当前来源中的核心任务",
				protagonistThroughline: "主角的选择按来源顺序推进",
				primaryPayoff: "来源冻结的不可逆结果得到兑现",
				endingHook: "最后状态把未完成因果交给后续",
			},
			executionPolicy: "execute_frozen_beat",
			previous: null,
			current: {
				clipId: "clip-a",
				clipIndex: 0,
				dominantFunction: "推进来源事件 1",
				causalEntry: "整章承诺触发首段",
				irreversibleResult: "clip-0-exit",
				handoffToNext: "第 2 段必须承接当前结果",
			},
			next: {
				clipId: "clip-b",
				clipIndex: 1,
				dominantFunction: "推进来源事件 2",
				causalEntry: "上一段结果迫使第 2 段发生",
				irreversibleResult: "clip-1-exit",
				handoffToNext: "把冻结结尾钩子留给后续",
			},
		});
		const sequenceContext = firstContext?.sequenceContext as Record<string, unknown>;
		expect(sequenceContext.sequenceControlPlan).toMatchObject({
			protocolVersion: "tapcanvas.sequence-control-plan/v1",
			totalDurationSeconds: 13,
		});
		expect(sequenceContext.sequenceTimeline).toHaveLength(2);
		expect(firstContext?.beat).toMatchObject({
			characters: ["主角"],
			assetObjectContracts: expect.any(Array),
			storyEvents: expect.any(Array),
		});
		expect(firstContext?.beat).not.toHaveProperty("stagingPlan");
		expect(firstContext).not.toHaveProperty("beatSheetContext");
	});

	it("preserves a null chapter endingHook through Clip fan-out context", () => {
		const contexts = buildVideoClipContexts({
			executionId: "execution-no-hook",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheet([
				{ clipId: "clip-no-hook", durationSeconds: 5, sourceText: "A" },
			], null),
		});
		const firstContext = contexts.items[0]?.value as Record<string, unknown> | undefined;
		const sequenceContext = firstContext?.sequenceContext as Record<string, unknown> | undefined;
		const chapterArc = sequenceContext?.chapterArc as Record<string, unknown> | undefined;
		expect(chapterArc?.endingHook).toBeNull();
	});

	it("materializes omitted dialogueScript as [] only when the frozen speech ledger is empty", () => {
		const contexts = buildVideoClipContexts({
			executionId: "execution-empty-speech",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheet([
				{ clipId: "clip-a", durationSeconds: 5, sourceText: "A", dialogueScript: undefined },
			]),
		});
		const value = contexts.items[0]?.value as { spokenScript?: unknown; sourceDialogueLineIds?: unknown } | undefined;
		expect(value?.spokenScript).toEqual([]);
		expect(value?.sourceDialogueLineIds).toEqual([]);
	});

	it("reports invalid speech references across every beat in one repair receipt", () => {
		const candidate = beatSheet([0, 1].map((index) => ({
			clipId: `clip-${index}`, durationSeconds: 5, sourceText: "A", dialogueScript: [],
			narrativeAudioPlan: { strategy: "source_grounded_voice", rationale: "Source narration", lines: [{
				lineId: `narrative-${index}`, speakerName: "Narrator", text: "Storm approaches.",
				delivery: "voice_over", afterSourceLineId: `missing-${index}`, sourceEvidence: ["source-a"],
			}] },
		})));
		expect(() => projectVideoAssetPlansFromBeatSheet(candidate)).toThrow(/beats\[0\].*missing-0.*beats\[1\].*missing-1/);
	});

	it("derives BeatSheet speakers from the frozen spoken script instead of trusting a redundant stale array", () => {
		const contexts = buildVideoClipContexts({
			executionId: "execution-derived-speakers",
			nodeId: "fan-out",
			deliveryContract: promptOnlyDeliveryContract([5]),
			beatSheetAgentResult: beatSheet([{
				clipId: "clip-a",
				durationSeconds: 5,
				sourceText: "A",
				speakers: [],
				narrativeAudioPlan: {
					strategy: "source_grounded_voice",
					rationale: "用来源事实补充画外叙述",
					lines: [{
						lineId: "narrative-1",
						speakerName: "旁白者",
						text: "风暴逼近。",
						delivery: "voice_over",
						afterSourceLineId: null,
						sourceEvidence: ["source-a"],
					}],
				},
			}]),
		});
		const value = contexts.items[0]?.value as {
			beat?: { speakers?: unknown };
			spokenScript?: readonly Record<string, unknown>[];
		} | undefined;
		expect(value?.beat?.speakers).toEqual(["旁白者"]);
		expect(value?.spokenScript).toMatchObject([{
			lineId: "narrative-1",
			speakerName: "旁白者",
			text: "风暴逼近。",
			delivery: "voice_over",
		}]);
	});

	it("keeps visual identity placeholders in prompt-only contexts without inventing asset ids", () => {
		const promptBeat = {
			clipId: "clip-prompt-only",
			durationSeconds: 10,
			characters: ["阿乔", "大头佛"],
			assetObjectContracts: [
				{
					...objectContract("character", "阿乔", "identity"),
					referenceImageNodeIds: ["node-ajiao"],
				},
				objectContract("character", "大头佛", "identity"),
				objectContract("prop", "肩扛机关枪", "none"),
				objectContract("scene", "断墙战场", "environment"),
			],
		};
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: promptOnlyDeliveryContract([10]),
			beatSheetAgentResult: beatSheet([promptBeat]),
		});
		const value = contexts.items[0]?.value as {
			executionScope?: unknown;
			assetPlans?: readonly unknown[];
			assetObjectContracts?: readonly Record<string, unknown>[];
		} | undefined;
		expect(value?.executionScope).toBe("prompt_only");
		expect(value?.assetPlans).toEqual([]);
		expect(value?.assetObjectContracts).toHaveLength(4);
		expect(value?.assetObjectContracts?.every((contract) => contract.assetId === undefined)).toBe(true);
	});

	it("validates every paid asset plan against its real Clip consumers before fan-out", () => {
		const heroBeat = {
			clipId: "clip-a",
			durationSeconds: 5,
			sourceText: "A",
			characters: ["hero"],
			assetObjectContracts: [
				objectContract("character", "hero", "identity"),
				objectContract("scene", "测试场景"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([heroBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "character://hero",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
			}]),
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheet([heroBeat]),
		});
		expect(assets.items[0]?.value).toMatchObject({
			prompt: "角色参考",
			negativePrompt: "文字",
			referenceType: "character",
			roleName: "hero",
			characterAssetRole: "identity_anchor",
			characterProfileVersion: "character-card/v3",
			identityAnchors: ["hero的稳定骨相与发型剪影"],
			prohibitedDrift: ["不得改变hero的脸型、发型和年龄感"],
		});
		expect(contexts.items[0]?.value).toMatchObject({
			assetPlans: [],
		});
		const contextValue = contexts.items[0]?.value as { assetObjectContracts?: readonly unknown[] } | undefined;
		expect(contextValue?.assetObjectContracts?.[0]).toMatchObject({
			kind: "character",
			name: "hero",
			referenceRole: "identity",
			referenceImageNodeIds: [],
		});
	});

	it("rejects a newly generated character reference that is not a normalized identity anchor", () => {
		const heroBeat = {
			clipId: "clip-a",
			durationSeconds: 5,
			characters: ["hero"],
			assetObjectContracts: [objectContract("character", "hero", "identity")],
		};
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([heroBeat]),
			assetAgentResult: {
				text: JSON.stringify([{
					assetId: "hero",
					role: "character://hero",
					prompt: "角色参考",
					negativePrompt: "文字",
					consumerClipIds: ["clip-a"],
				}]),
			},
		})).toThrow("must author one normalized character-card/v3 identity anchor for hero");
	});

	it("accepts an empty asset collection only when the frozen BeatSheet requests no visual references", () => {
		const noReferenceBeat = {
			clipId: "clip-text-only",
			durationSeconds: 5,
			sourceText: "纯文本成片",
			characters: [],
			assetObjectContracts: [
				objectContract("scene", "雪松林", "none"),
				objectContract("character", "红狐", "none"),
			],
		};
		const collection = buildVideoAssetPlanCollection({
			executionId: "execution-text-only",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([noReferenceBeat]),
			assetAgentResult: assetPlanResult([]),
		});
		expect(collection.items).toEqual([]);

		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-needs-reference",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([{
				...noReferenceBeat,
				assetObjectContracts: [objectContract("scene", "雪松林", "environment")],
			}]),
			assetAgentResult: assetPlanResult([]),
		})).toThrow("must deliver plans for the frozen visual-reference roles");
	});

	it("preserves the BeatSheet reference role when a visual asset plan binds the same canonical object", () => {
		const wardrobeBeat = {
			clipId: "clip-wardrobe",
			durationSeconds: 5,
			sourceText: "A",
			characters: ["hero"],
			assetObjectContracts: [
				objectContract("character", "hero", "wardrobe"),
				objectContract("scene", "测试场景"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([wardrobeBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero-wardrobe",
				role: "character://hero",
				prompt: "角色妆造参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-wardrobe"],
			}]),
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheet([wardrobeBeat]),
		});
		const contextValue = contexts.items[0]?.value as {
			assetObjectContracts?: readonly Record<string, unknown>[];
		} | undefined;
		expect(contextValue?.assetObjectContracts?.[0]).toMatchObject({
			kind: "character",
			name: "hero",
			referenceRole: "wardrobe",
			referenceImageNodeIds: [],
		});
		expect(assets.items[0]?.value).toMatchObject({assetId: "hero-wardrobe"});
	});

	it("passes through a caller-project asset reuse declaration in the validated plan", () => {
		const heroBeat = {
			clipId: "clip-a",
			durationSeconds: 5,
			sourceText: "A",
			characters: ["hero"],
			assetObjectContracts: [
				objectContract("character", "hero", "identity"),
				objectContract("scene", "测试场景"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([heroBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "character://hero",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
				existingImageUrl: "https://caller.tapcanvas.test/hero.png",
				existingNodeId: "caller-node-hero",
				existingAssetId: "asset-hero",
			}]),
		});
		expect(assets.items[0]?.value).toMatchObject({
			assetId: "hero",
			existingImageUrl: "https://caller.tapcanvas.test/hero.png",
			existingNodeId: "caller-node-hero",
			existingAssetId: "asset-hero",
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheet([heroBeat]),
		});
		const contextValue = contexts.items[0]?.value as { assetPlans?: unknown } | undefined;
		expect(contextValue?.assetPlans).toEqual([]);
	});

	it("materializes exact ready project assets without asking the asset Agent to rewrite prompts", () => {
		const heroBeat = {
			clipId: "clip-ready",
			durationSeconds: 5,
			characters: ["hero"],
			assetObjectContracts: [
				objectContract("character", "hero", "identity"),
				objectContract("scene", "测试场景", "environment"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-ready",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([heroBeat]),
			assetAgentResult: assetPlanResult([]),
			reusableAssetFacts: {
				"character://hero": [{
					existingAssetId: "asset-ready-hero",
					existingProjectId: "project-ready",
					existingNodeId: "node-ready-hero",
				}],
				"scene://测试场景": [{
					existingAssetId: "asset-ready-scene",
					existingProjectId: "project-ready",
				}],
			},
		});

		expect(assets.items.map((item) => (item.value as {assetId: string}).assetId)).toEqual(["asset-ready-hero", "asset-ready-scene"]);
		expect(assets.items.map((item) => item.value)).toEqual([
			expect.objectContaining({
				role: "character://hero",
				existingAssetId: "asset-ready-hero",
				consumerClipIds: ["clip-ready"],
			}),
			expect.objectContaining({
				role: "scene://测试场景",
				existingAssetId: "asset-ready-scene",
				consumerClipIds: ["clip-ready"],
			}),
		]);
		expect(assets.items.every((item) => {
			const value = item.value as Record<string, unknown>;
			return value.prompt === undefined && value.negativePrompt === undefined;
		})).toBe(true);
	});

	it("reuses the exact materialized launch identity across every later Clip consumer", () => {
		const chapterBeats = [
			{
				clipId: "clip-launch",
				durationSeconds: 5,
				characters: ["hero"],
				assetObjectContracts: [objectContract("character", "hero", "identity")],
			},
			{
				clipId: "clip-later",
				durationSeconds: 5,
				characters: ["hero"],
				assetObjectContracts: [objectContract("character", "hero", "identity")],
			},
		];
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-launch-reuse",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet(chapterBeats),
			assetAgentResult: assetPlanResult([]),
			reusableAssetFacts: {
				"character://hero": [{
					planAssetId: "identity-hero",
					existingNodeId: "launch-image-node-hero",
					existingImageUrl: "https://assets.tapcanvas.test/identity-hero.png",
				}],
			},
		});

		expect(assets.items).toHaveLength(1);
		expect(assets.items[0]).toMatchObject({
			itemId: assetBindingIdentity("identity-hero", "character://hero"),
			value: {
				assetId: "identity-hero",
				role: "character://hero",
				existingNodeId: "launch-image-node-hero",
				existingImageUrl: "https://assets.tapcanvas.test/identity-hero.png",
				consumerClipIds: ["clip-launch", "clip-later"],
			},
		});
	});

	it("returns missing creative plans to the author instead of synthesizing paid prompts", () => {
		const bossBeat = {
			clipId: "clip-boss",
			durationSeconds: 10,
			characters: ["阿乔", "大头佛"],
			assetObjectContracts: [
				objectContract("character", "阿乔", "identity"),
				objectContract("character", "大头佛", "identity"),
				objectContract("scene", "幽暗山门"),
			],
		};
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([bossBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "asset-ajiao",
				role: "character://阿乔",
				prompt: "阿乔身份参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-boss"],
			}]),
		})).toThrow("character://大头佛 requires exactly one plan");
	});

	it("rejects a paid image plan for a text-only weapon before asset fan-out", () => {
		const gunBeat = {
			clipId: "clip-gun-image",
			durationSeconds: 10,
			characters: ["阿乔"],
			assetObjectContracts: [
				objectContract("character", "阿乔", "identity"),
				objectContract("prop", "肩扛机关枪", "none"),
				objectContract("scene", "幽暗山门"),
			],
		};
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([gunBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "asset-ajiao",
				role: "character://阿乔",
				prompt: "阿乔身份参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-gun-image"],
			}, {
				assetId: "asset-gun",
				role: "prop://肩扛机关枪",
				prompt: "孤立枪械图片",
				negativePrompt: "文字",
				consumerClipIds: ["clip-gun-image"],
			}]),
		})).toThrow("visual asset role prop://肩扛机关枪 has no frozen object requiring an authoring reference");
	});

	it("mechanically rebuilds asset consumers from the frozen visual-reference contract", () => {
		const firstBeat = {
			clipId: "clip-first",
			durationSeconds: 10,
			characters: ["阿乔"],
			assetObjectContracts: [
				objectContract("character", "阿乔", "identity"),
				objectContract("scene", "幽暗山门"),
			],
		};
		const textOnlyBeat = {
			clipId: "clip-text-only",
			durationSeconds: 10,
			characters: [],
			assetObjectContracts: [
				objectContract("character", "阿乔", "none"),
				objectContract("scene", "幽暗山门"),
			],
		};
		const thirdBeat = {
			clipId: "clip-third",
			durationSeconds: 10,
			characters: ["阿乔"],
			assetObjectContracts: [
				objectContract("character", "阿乔", "identity"),
				objectContract("scene", "幽暗山门"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([firstBeat, textOnlyBeat, thirdBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "asset-ajiao",
				role: "character://阿乔",
				prompt: "阿乔身份参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-text-only"],
			}]),
		});
		expect(assets.items[0]?.value).toMatchObject({
			consumerClipIds: ["clip-first", "clip-third"],
		});
	});

	it("binds multiple story personas in one physical body to one canonical character asset", () => {
		const bodyState = "秦小龙肉身站在义庄门内，衣着与伤势保持同一状态";
		const sharedBodyContract = (name: string) => ({
			...objectContract("character", name, "identity", bodyState),
			physicalIdentityKey: "body-qin-xiaolong",
			identityInvariant: "同一秦小龙肉身、同一骨相、体型、发型与基准服装",
			endState: bodyState,
		});
		const beat = {
			clipId: "clip-shared-body",
			durationSeconds: 10,
			characters: ["秦小龙", "张三"],
			assetObjectContracts: [
				sharedBodyContract("秦小龙"),
				sharedBodyContract("张三"),
				objectContract("scene", "义庄", "environment"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([beat]),
			assetAgentResult: assetPlanResult([
				{
					assetId: "asset-shared-body",
					role: "character://body-qin-xiaolong",
					prompt: "秦小龙肉身的中性规范身份板",
					negativePrompt: "第二张脸、双重肉身、随机换装",
					consumerClipIds: ["clip-shared-body"],
				},
				{
					assetId: "asset-yizhuang",
					role: "scene://义庄",
					sceneCard: sceneReferenceFixture,
					identityAnchors: ["义庄入口"],
					prohibitedDrift: ["固定入口"],
					prompt: sceneReferenceFixture.spacePrompt,
					negativePrompt: sceneReferenceFixture.negativePrompt,
					consumerClipIds: ["clip-shared-body"],
				},
			]),
		});

		expect(assets.items.map((item) => (item.value as {assetId: string}).assetId)).toEqual([
			"asset-shared-body",
			"asset-yizhuang",
		]);
		expect(assets.items[0]?.value).toMatchObject({
			role: "character://body-qin-xiaolong",
			consumerClipIds: ["clip-shared-body"],
		});
	});

	it("keeps a plot-bearing gun in the state ledger without generating a useless reference image", () => {
		const gunBeat = {
			clipId: "clip-gun",
			durationSeconds: 10,
			characters: ["阿乔"],
			assetObjectContracts: [
				objectContract("character", "阿乔", "identity"),
				objectContract("prop", "肩扛机关枪", "none", "枪托抵肩、枪口朝向大头佛"),
				objectContract("scene", "幽暗山门"),
			],
		};
		const assets = buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([gunBeat]),
			assetAgentResult: assetPlanResult([{
				assetId: "asset-ajiao",
				role: "character://阿乔",
				prompt: "阿乔身份参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-gun"],
			}]),
		});
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([10]),
			beatSheetAgentResult: beatSheet([gunBeat]),
		});
		const contextValue = contexts.items[0]?.value as {
			assetObjectContracts?: readonly Record<string, unknown>[];
		} | undefined;
		const gunContract = contextValue?.assetObjectContracts?.find((contract) => contract.name === "肩扛机关枪");
		expect(gunContract).toMatchObject({
			kind: "prop",
			referenceRole: "none",
			startState: "枪托抵肩、枪口朝向大头佛",
			endState: "枪托抵肩、枪口朝向大头佛",
		});
		expect(gunContract).not.toHaveProperty("assetId");
		expect(assets.items.map((item) => (item.value as {assetId: string}).assetId)).toEqual(["asset-ajiao"]);
	});

	it("preserves an adjacent Clip whose model-authored start state differs from the prior end state", () => {
		const firstCharacter = {
			...objectContract("character", "阿乔", "none", "机关枪抵肩瞄准"),
			endState: "机关枪后坐，阿乔右肩后移半步",
		};
		const secondCharacter = {
			...objectContract("character", "阿乔", "none", "阿乔双手空闲站立"),
			endState: "阿乔重新起步",
		};
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([10, 10]),
			beatSheetAgentResult: beatSheet([
				{
					clipId: "clip-a",
					durationSeconds: 10,
					characters: ["阿乔"],
					assetObjectContracts: [firstCharacter, objectContract("scene", "幽暗山门", "none", "烟尘未起")],
				},
				{
					clipId: "clip-b",
					durationSeconds: 10,
					characters: ["阿乔"],
					assetObjectContracts: [secondCharacter, objectContract("scene", "幽暗山门", "none", "烟尘未起")],
				},
			]),
		});
		expect(contexts.items).toHaveLength(2);
		expect((contexts.items[1]?.value as { assetObjectContracts?: Array<{ startState: string }> })
			.assetObjectContracts?.[0]?.startState).toBe("阿乔双手空闲站立");
	});

	it("accepts a structurally complete partial object ledger for downstream asset planning", () => {
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: promptOnlyDeliveryContract([5]),
			beatSheetAgentResult: beatSheet([{
				clipId: "clip-a",
				durationSeconds: 5,
				characters: ["主角"],
				assetObjectContracts: [objectContract("prop", "旧铜钥匙", "none")],
			}]),
		});

		const contextValue = contexts.items[0]?.value as {
			assetObjectContracts?: readonly Record<string, unknown>[];
		} | undefined;
		expect(contextValue?.assetObjectContracts).toEqual([
			expect.objectContaining({ kind: "prop", name: "旧铜钥匙" }),
		]);
	});

	it("preserves a reappearing object's model-authored state across an off-screen Clip", () => {
		const firstGun = {
			...objectContract("prop", "肩扛机关枪", "none"),
			startState: "枪托抵肩、枪口朝右",
			endState: "枪托抵肩、枪口朝右",
		};
		const driftingGun = {
			...objectContract("prop", "肩扛机关枪", "none"),
			startState: "机关枪无过渡出现在地面、枪口朝左",
			endState: "机关枪留在地面",
		};
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: promptOnlyDeliveryContract([5, 5, 5]),
			beatSheetAgentResult: beatSheet([
				{
					clipId: "clip-a",
					durationSeconds: 5,
					assetObjectContracts: [...defaultObjectContracts, firstGun],
				},
				{ clipId: "clip-b", durationSeconds: 5 },
				{
					clipId: "clip-c",
					durationSeconds: 5,
					assetObjectContracts: [...defaultObjectContracts, driftingGun],
				},
			]),
		});
		expect(contexts.items).toHaveLength(3);
		expect((contexts.items[2]?.value as { assetObjectContracts?: Array<{ name: string; startState: string }> })
			.assetObjectContracts?.find((item) => item.name === "肩扛机关枪")?.startState)
			.toBe("机关枪无过渡出现在地面、枪口朝左");
	});

	it("rejects a partial or non-persistent asset reuse declaration", () => {
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([{ clipId: "clip-a", durationSeconds: 5, sourceText: "A" }]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "character://hero",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
				existingNodeId: "caller-node-hero",
			}]),
		})).toThrow("requires existingImageUrl and existingNodeId together");

		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([{ clipId: "clip-a", durationSeconds: 5, sourceText: "A" }]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "character://hero",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
				existingImageUrl: "blob:local-temp",
				existingNodeId: "caller-node-hero",
			}]),
		})).toThrow("is not persistent HTTP(S)");
	});

	it("reports the frozen project image set when a declared reuse id is stale", () => {
		const error = validateWorkflowAssetPlanProjectReuse({
			assetAgentResult: assetPlanResult([{
				assetId: "chapter-plan-hero",
				role: "character://阿乔",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
				existingAssetId: "stale-workflow-output",
				existingProjectId: "project-1",
			}]),
			projectContext: {
				projectId: "project-1",
				assetSnapshot: [{
					assetId: "asset-ajiao-current",
					projectId: "project-1",
					canonicalName: "阿乔",
					mediaKind: "image",
					state: "ready",
					productionEligible: true,
				}],
			},
		});
		expect(error).toContain("existingAssetId=stale-workflow-output");
		expect(error).toContain('allowedAssetIds=["asset-ajiao-current"]');
	});

	it("rejects a declared reuse id outside the frozen ready project image set", () => {
		const error = validateWorkflowAssetPlanProjectReuse({
			assetAgentResult: assetPlanResult([{
				assetId: "chapter-plan-swordswoman",
				role: "character://竹林女剑客",
				prompt: "竹林女剑客身份参考",
				negativePrompt: "身份漂移",
				consumerClipIds: ["clip-a"],
				existingAssetId: "selected-but-not-frozen-node",
				existingProjectId: "project-1",
			}]),
			projectContext: {
				projectId: "project-1",
				assetSnapshot: [{
					assetId: "asset-desert-astronomer",
					projectId: "project-1",
					canonicalName: "年轻天文学家",
					mediaKind: "image",
					state: "ready",
					productionEligible: true,
				}],
			},
		});
		expect(error).toContain("existingAssetId=selected-but-not-frozen-node");
		expect(error).toContain('allowedAssetIds=["asset-desert-astronomer"]');
	});

	it("accepts an Agent-authored exact asset id across canonical-name aliases", () => {
		const error = validateWorkflowAssetPlanProjectReuse({
			assetAgentResult: assetPlanResult([{
				assetId: "chapter-plan-swordswoman",
				role: "character://竹林女剑客",
				prompt: "竹林女剑客身份参考",
				negativePrompt: "身份漂移",
				consumerClipIds: ["clip-a"],
				existingAssetId: "asset-desert-astronomer",
				existingProjectId: "project-1",
			}]),
			projectContext: {
				projectId: "project-1",
				assetSnapshot: [{
					assetId: "asset-desert-astronomer",
					projectId: "project-1",
					canonicalName: "年轻天文学家",
					mediaKind: "image",
					state: "ready",
					productionEligible: true,
				}],
			},
		});
		expect(error).toBeNull();
	});

	it("rejects an orphan asset before any paid image node can run", () => {
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([{ clipId: "clip-a", durationSeconds: 5, sourceText: "A" }]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "character://hero",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: [],
			}]),
		})).toThrow("has no declared Clip consumer");
	});

	it("rejects an ambiguous asset role before any paid image node can run", () => {
		expect(() => buildVideoAssetPlanCollection({
			executionId: "execution-1",
			nodeId: "asset-fan-out",
			beatSheetAgentResult: beatSheet([{ clipId: "clip-a", durationSeconds: 5, sourceText: "A" }]),
			assetAgentResult: assetPlanResult([{
				assetId: "hero",
				role: "主角",
				prompt: "角色参考",
				negativePrompt: "文字",
				consumerClipIds: ["clip-a"],
			}]),
		})).toThrow("must use kind://canonical-name");
	});

	it("conserves source dialogue and materializes writer Unicode coordinates before paid submission", () => {
		const lineText = "木材怎么够了？";
		const loginExitState = "阿乔确认木材数值异常";
		const loginStoryEvents = [{
			sourceBeatId: "source-001",
			event: "阿乔完成登录后发现木材数值异常增加",
			entryState: "登录界面刚完成加载",
			exitState: loginExitState,
			startSeconds: 0,
			endSeconds: 5,
		}];
		const beatSheetResult = {
			text: JSON.stringify({
				protocolVersion: "keyframe-beat-sheet/v2",
				sourceId: "workflow-test-source",
				sourceFingerprint: "workflow-test-fingerprint",
				chapterArc: {
					storyPromise: "阿乔登录后必须确认资源异常",
					protagonistThroughline: "阿乔从登录转为主动核验",
					primaryPayoff: "资源异常被阿乔确认",
					endingHook: "异常来源仍待追查",
				},
				filmBible: {},
				adaptationStrategy: {},
				castManifest: [],
				meta: {},
				sourceCoveragePlan: {
					speechLedger: [{ lineId: "source-001", speakerName: "阿乔", text: lineText }],
				},
				sequenceControlPlan: {
					protocolVersion: "tapcanvas.sequence-control-plan/v1",
					totalDurationSeconds: 5,
					segments: [{ clipId: "login-reveal", startSeconds: 0, endSeconds: 5, temporalDirectives: [], transitionFromPrevious: "从登录完成进入", transitionToNext: "把异常确认交给追查" }],
				},
				beats: [{
					clipId: "login-reveal",
					clipIndex: 0,
					dominantFunction: "揭示资源异常",
					causalEntry: "登录完成使资源栏可见",
					irreversibleResult: "阿乔确认资源数值异常",
					handoffToNext: "阿乔必须追查异常来源",
					durationSeconds: 5,
					characters: ["阿乔"],
					exitState: loginExitState,
					storyEvents: loginStoryEvents,
					temporalFrameTrack: temporalFrameTrack(5, loginStoryEvents, loginExitState),
					assetObjectContracts: [
						objectContract("character", "阿乔"),
						objectContract("scene", "登录界面"),
					],
					dialogueScript: [{ lineId: "source-001", speakerName: "阿乔", text: lineText, delivery: "on_screen" }],
					narrativeAudioPlan: { strategy: "source_speech_only", rationale: "保留登录后的第一句反应", lines: [] },
					speakers: ["阿乔"],
					dialoguePaceRate: 4,
				}],
			}),
		};
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5]),
			beatSheetAgentResult: beatSheetResult,
		});
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["login-reveal"],
			values: [{
				text: JSON.stringify({
					clips: [{
						clipId: "login-reveal",
						clipIndex: 0,
						durationSeconds: 5,
						logline: "阿乔登录方舟后发现资源异常增加",
						continuity: "登录界面消隐，阿乔视线落到资源栏",
						exitState: "阿乔确认木材数值异常",
						characterRoleNames: ["阿乔"],
						assetObjectContracts: [
							objectContract("character", "阿乔"),
							objectContract("scene", "登录界面"),
						],
						speakerBindings: [{ name: "阿乔", assetKind: "character" }],
						speechEvents: [{
							speechEventId: "speech-source-001",
							lineId: "source-001",
							startOffset: 0,
							endOffset: Array.from(lineText).length,
							startSeconds: 1,
							endSeconds: 5,
							speakerName: "阿乔",
							delivery: "on_screen",
							performance: "惊讶后压低声音确认",
						}],
						shots: [{
							shotNo: 1,
							visualTask: "从登录完成推进到资源异常揭示",
							depictedStoryEventIndices: [0],
							action: "方舟界面在阿乔眼前展开，他看见木材数值跳升并脱口而出",
							durationSeconds: 5,
							speechEventIds: ["speech-source-001"],
							}],
							sourceEventCoverage: [{ storyEventIndex: 0, shotNos: [1] }],
							temporalFrameTrack: temporalFrameTrack(5, loginStoryEvents, loginExitState),
							temporalFrameCoverage: temporalFrameCoverage(5, [5]),
						}],
					selfQaNote: "已逐字核对来源对白、说话人和镜头容量",
					creativeReview: {
						mode: "embedded_authoring",
						iterations: 1,
						summary: "补足登录完成到资源异常的因果桥",
						narrativeAudioAssessment: "保留角色原话，不新增旁白",
					},
					sourceFidelityAudit: {
						canonicalParticipants: ["阿乔"],
						preservedEntryFacts: ["登录界面刚完成加载"],
						preservedOrderedEvents: ["阿乔发现木材数值异常增加"],
						preservedExitFacts: ["阿乔确认木材数值异常"],
						inventedFacts: [],
					},
				}),
			}],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});
		expect(promptPackage.clips[0]?.structuredClip).toMatchObject({
			speechEvents: [{ spokenText: lineText, speakerName: "阿乔", delivery: "on_screen" }],
			shots: [{ speechEventIds: ["speech-source-001"] }],
		});
		expect(promptPackage.clips[0]?.prompt).toContain(lineText);
		expect(promptPackage.deliveryEvidence).toMatchObject({
			sourceSpeechLineCount: 1,
			narrativeSpeechLineCount: 0,
			executableSpeechLineCount: 1,
			embeddedAuthoringReviewCount: 1,
			writerEnvelopeCharacters: expect.any(Number),
			providerPromptCharacters: expect.any(Number),
			providerToEnvelopeRatio: expect.any(Number),
		});
		expect(promptPackage.clips[0]?.promptMetrics.writerEnvelopeCharacters).toBeGreaterThan(0);
		expect(promptPackage.clips[0]?.promptMetrics.providerPromptCharacters).toBeGreaterThan(0);
		expect(promptPackage.deliveryEvidence.writerEnvelopeCharacters).toBe(
			promptPackage.clips[0]?.promptMetrics.writerEnvelopeCharacters,
		);
		expect(promptPackage.qualityAssessment).toMatchObject({
			status: "reviewed",
			verdict: "not_scored",
			clipCount: 1,
			reviewedClipCount: 1,
			unreviewedClipIndices: [],
		});
	});

	it("projects speech-shot references and frozen speaker asset kinds before validation", () => {
		const contextItem = {
			clipIndex: 0,
			beat: {
				clipId: "speech-projection",
				durationSeconds: 10,
				characters: ["阿乔"],
				exitState: "阿乔完成确认",
				storyEvents: [{
					entryState: "阿乔抬眼",
					exitState: "阿乔完成确认",
					startSeconds: 0,
					endSeconds: 10,
				}],
			},
			assetObjectContracts: [
				objectContract("character", "阿乔"),
				objectContract("scene", "控制室", "environment"),
			],
			spokenScript: [{
				lineId: "line-1",
				speakerName: "阿乔",
				text: "确认异常。",
				delivery: "on_screen",
			}],
			dialoguePaceRate: 4,
		};
		const projected = compileWorkflowClipWriterFrozenEnvelopeText({
			text: JSON.stringify({
				clips: [{
					speakerBindings: [{ name: "阿乔", assetKind: "not-a-kind" }],
					speechEvents: [{
						speechEventId: "speech-line-1",
						lineId: "line-1",
						startOffset: 0,
						endOffset: 5,
						startSeconds: 2,
						endSeconds: 5,
						speakerName: "阿乔",
						delivery: "on_screen",
						performance: "压低声音确认",
					}],
					shots: [
						{ shotNo: 1, durationSeconds: 2, visualTask: "抬眼", action: "抬眼", depictedStoryEventIndices: [0], speechEventIds: [] },
						{ shotNo: 2, durationSeconds: 3, visualTask: "确认", action: "确认", depictedStoryEventIndices: [0], speechEventIds: ["wrong-id"] },
						{ shotNo: 3, durationSeconds: 5, visualTask: "收束", action: "放下终端", depictedStoryEventIndices: [0], speechEventIds: [] },
					],
				}],
			}),
			contextItem,
		});
		expect(projected).not.toBeNull();
		expect(validateWorkflowClipWriterForContext({
			text: projected ?? "",
			itemId: "speech-projection",
			contextItem,
		})).toBeNull();
	});

	it("persists prompt package order, lineage and generic delivery verification", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a", "clip-b"],
			values: [clipWriterResult("clip-a", 5, "提示词 A"), clipWriterResult("clip-b", 8, "提示词 B", [], [8], 1)],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a", "clip-b"],
			values: [
				clipContext("clip-a", 5),
				clipContext("clip-b", 8, [], 1),
			],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});
		expect(promptPackage.clips.map((clip) => clip.itemId)).toEqual(["clip-a", "clip-b"]);
		expect(promptPackage.clips[0]?.prompt).toContain("提示词 A");
		expect(promptPackage.clips[0]?.prompt).not.toContain("selfQaNote");
		expect(promptPackage.clips[0]?.prompt).not.toContain("creativeReview");
		expect(promptPackage.clips[0]?.prompt).not.toContain('"clips"');
		expect(promptPackage.clips[0]?.structuredClip).toMatchObject({
			durationSeconds: 5,
			shots: [{ shotNo: 1, durationSeconds: 5 }],
		});
		expect(promptPackage.deliveryVerification.status).toBe("satisfied");
		expect(promptPackage.qualityAssessment).toMatchObject({
			status: "reviewed",
			reviewedClipCount: 2,
			unreviewedClipIndices: [],
			verdict: "not_scored",
		});
	});

	it("does not call an unreviewed prompt package quality-approved", () => {
		const writer = clipWriterResult("clip-unreviewed", 5, "未提供复盘证据");
		const parsed = JSON.parse(writer.text) as Record<string, unknown>;
		delete parsed.creativeReview;
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts-unreviewed",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-unreviewed"],
			values: [{ text: JSON.stringify(parsed) }],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts-unreviewed",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-unreviewed"],
			values: [clipContext("clip-unreviewed", 5)],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-unreviewed",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});
		expect(promptPackage.deliveryVerification.status).toBe("satisfied");
		expect(promptPackage.qualityAssessment).toMatchObject({
			status: "unreviewed",
			verdict: "not_scored",
			clipCount: 1,
			reviewedClipCount: 0,
			unreviewedClipIndices: [0],
		});
	});

	it("does not trust malformed quality assessment evidence", () => {
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-quality-malformed",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: createWorkflowCollection({
				collectionId: "clip-prompts-quality-malformed",
				producerNodeId: "writer",
				producerPortId: "clip-prompts",
				itemIds: ["clip-a"],
				values: [clipWriterResult("clip-a", 5, "有效提示词")],
			}),
			clipContextCollection: createWorkflowCollection({
				collectionId: "clip-contexts-quality-malformed",
				producerNodeId: "fan-out",
				producerPortId: "clip-contexts",
				itemIds: ["clip-a"],
				values: [clipContext("clip-a", 5)],
			}),
		});
		const malformed = {
			...promptPackage,
			qualityAssessment: {
				...promptPackage.qualityAssessment,
				status: "reviewed",
				unreviewedClipIndices: [0],
			},
		};
		const admission = inspectWorkflowPromptPackageAdmission(malformed);
		expect(admission.structurallyValid).toBe(true);
		expect(admission.diagnostics.qualityAssessmentStatus).toBeNull();
		expect(admission.diagnostics.qualityAssessmentReviewedClipCount).toBeNull();
		expect(admission.diagnostics.qualityAssessmentComplete).toBeNull();
	});

	it("preserves frozen visual object contracts when the asset-plan input is structurally omitted", () => {
		const frozenVisualRoles = [{ assetId: "hero", role: "character://主角" }];
		const prompts = createWorkflowCollection({
			collectionId: "launch-clip-prompts",
			producerNodeId: "launch-writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 5, "首段纯文生视频", frozenVisualRoles)],
		});
		const contexts = createWorkflowCollection({
			collectionId: "launch-clip-contexts",
			producerNodeId: "launch-fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5, frozenVisualRoles)],
		});

		const promptPackage = buildWorkflowPromptPackage({
			executionId: "launch-execution",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});

		expect(promptPackage.clips[0]?.assetBindings).toEqual([]);
		expect(promptPackage.clips[0]?.structuredClip.assetObjectContracts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "character", name: "主角", referenceRole: "identity" }),
			]),
		);
	});

	it("keeps visual plan coverage strict when an empty asset-plan collection is explicitly connected", () => {
		const frozenVisualRoles = [{ assetId: "hero", role: "character://主角" }];
		const prompts = createWorkflowCollection({
			collectionId: "strict-clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 5, "正式资产分支", frozenVisualRoles)],
		});
		const contexts = createWorkflowCollection({
			collectionId: "strict-clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5, frozenVisualRoles)],
		});
		const explicitlyEmptyPlans = createWorkflowCollection({
			collectionId: "empty-asset-plans",
			producerNodeId: "asset-planner",
			producerPortId: "asset-items",
			values: [],
		});

		expect(() => buildWorkflowPromptPackage({
			executionId: "strict-execution",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
			assetPlanCollection: explicitlyEmptyPlans,
		})).toThrow("requires one visual asset plan");
	});

	it("rejects a writer result mapped to the wrong physical Clip identity", () => {
		const writer = clipWriterResult("clip-a", 5, "提示词 A");
		const parsed = JSON.parse(writer.text) as { clips: Array<Record<string, unknown>> };
		if (!parsed.clips[0]) throw new Error("Expected one test clip");
		parsed.clips[0].clipIndex = 1;
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [{ text: JSON.stringify(parsed) }],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5)],
		});
		expect(() => buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		})).toThrow("clipIndex must equal frozen physical order 0");
	});

	it("rejects a dense-looking writer result that omits a frozen story event mapping", () => {
		const writer = clipWriterResult("clip-a", 5, "提示词 A");
		const parsed = JSON.parse(writer.text) as { clips: Array<Record<string, unknown>> };
		if (!parsed.clips[0]) throw new Error("Expected one test clip");
		parsed.clips[0].sourceEventCoverage = [];
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [{ text: JSON.stringify(parsed) }],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5)],
		});
		expect(() => buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		})).toThrow("must contain exactly one entry for every frozen storyEvent");
	});

	it("preserves every authored shot phase and cumulative time range in the final prompt", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 5, "动作段", [], [2, 3])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5)],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});
		const prompt = promptPackage.clips[0]?.prompt ?? "";
		expect(prompt).toContain("镜头1（0-2s）");
		expect(prompt).toContain("镜头2（2-5s）");
		expect(prompt.split("动作段").length - 1).toBe(2);
		expect(prompt).not.toContain("状态变化");
		expect(prompt).not.toContain("VISUAL_ONLY");
	});

	it("rejects a structured Clip whose shot durations do not equal the frozen Clip duration", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 10, "动作链", [], [6, 6])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 10)],
		});
		expect(() => buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		})).toThrow("durationSeconds 加总必须精确等于 clip.durationSeconds=10");
	});

	it("rejects an ambiguous asset role before prompt compilation", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 5, "动作链", [{ assetId: "hero", role: "character://剑修" }])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 5, [{ assetId: "hero", role: "character" }])],
		});
		expect(() => buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
			assetPlanCollection: assetPlans([{ assetId: "hero", role: "character" }]),
		})).toThrow("must use kind://canonical-name");
	});

	it("carries the Agent-declared generated image nodes into the paid video production plan", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 30, "成片提示词", [
				{ assetId: "hero", role: "character://剑修" },
				{ assetId: "forest", role: "scene://月夜竹林" },
			])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 30, [
					{ assetId: "hero", role: "character://剑修" },
					{ assetId: "forest", role: "scene://月夜竹林" },
				])],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
			assetPlanCollection: assetPlans([
				{ assetId: "hero", role: "character://剑修" },
				{ assetId: "forest", role: "scene://月夜竹林" },
			]),
		});
		expect(promptPackage.clips[0]).toMatchObject({ declaredAssetIds: ["hero", "forest"] });
		const assetBindings = createWorkflowCollection({
			collectionId: "visual-assets",
			producerNodeId: "image-generator",
			producerPortId: "asset-bindings",
			itemIds: ["hero", "forest"],
			values: [
				{ assetPlan: { assetId: "hero" }, nodeId: "image-node-hero", imageUrl: "https://assets.tapcanvas.test/hero.png" },
				{ assetPlan: { assetId: "forest" }, nodeId: "image-node-forest", imageUrl: "https://assets.tapcanvas.test/forest.png" },
			],
		});
		const productionPlan = buildVideoProductionPlan({
			executionId: "execution-1",
			nodeId: "handoff",
			promptPackage,
			estimate: {
				estimateIdentity: "estimate-1",
				modelKey: "doubao-seedance-2.5",
				resolution: "480p",
				aspectRatio: "16:9",
			},
			generationContract: {
				videoModel: "doubao-seedance-2.5",
				durationOptions: [5, 10, 15],
				maxDurationSeconds: 15,
				referenceAudioPolicy: {
					minimumDurationSeconds: 1.8,
					maximumDurationSeconds: 30.2,
					maximumTotalDurationSeconds: 15.2,
				},
			},
			assetBindings,
			voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		});
		expect(productionPlan.items[0]?.value).toMatchObject({
			videoReferencePolicy: "forbidden",
			generationContract: {
				videoModel: "doubao-seedance-2.5",
				},
			referenceImageNodeIds: ["image-node-hero", "image-node-forest"],
			structuredClip: {
				assetObjectContracts: [
					{ kind: "character", name: "剑修", referenceImageNodeIds: ["image-node-hero"] },
					{ kind: "scene", name: "月夜竹林", referenceImageNodeIds: ["image-node-forest"] },
				],
			},
		});
		expect((productionPlan.items[0]?.value as { prompt?: string }).prompt).not.toContain("negativePrompt");
	});

	it("preserves every original view of one object in the compiled provider input", () => {
		const ids = ["original-a", "original-b", "original-c", "original-d"];
		const bindings = ids.map((assetId) => ({ assetId, role: "scene://原物空间" }));
		const prompts = createWorkflowCollection({ collectionId: "prompts", producerNodeId: "writer", producerPortId: "clip-prompts",
			itemIds: ["clip-a"], values: [clipWriterResult("clip-a", 10, "原物的连续展示", bindings)] });
		const contexts = createWorkflowCollection({ collectionId: "contexts", producerNodeId: "fan-out", producerPortId: "clip-contexts",
			itemIds: ["clip-a"], values: [clipContext("clip-a", 10, bindings)] });
		const plans = assetPlans(bindings.map((binding) => ({ ...binding, existingAssetId: binding.assetId, existingProjectId: "project-1" })));
		const promptPackage = buildWorkflowPromptPackage({ executionId: "execution-1", workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts, clipContextCollection: contexts, assetPlanCollection: plans });
		expect(promptPackage.clips[0]?.declaredAssetIds).toEqual(ids);
		const production = buildVideoProductionPlan({ executionId: "execution-1", nodeId: "handoff", promptPackage,
			estimate: { estimateIdentity: "estimate-1", modelKey: "seedance20", resolution: "720p", aspectRatio: "16:9" },
			assetBindings: createWorkflowCollection({ collectionId: "resolved", producerNodeId: "resolver", producerPortId: "asset-bindings",
				itemIds: ids, values: ids.map((assetId) => ({ assetPlan: { assetId }, generatedAssetId: assetId,
					nodeId: `node-${assetId}`, imageUrl: `https://assets.example/${assetId}.png` })) }),
			voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		});
		expect(production.items[0]?.value).toMatchObject({ referenceAssetIds: ids, referenceImageNodeIds: [],
			structuredClip: { assetObjectContracts: expect.arrayContaining([expect.objectContaining({ name: "原物空间", referenceAssetIds: ids })]) } });
	});

	it("keeps a multi-clip reference allocation intact through the final provider plan", () => {
		const groups = [["view-2", "view-1", "view-3"], ["view-4", "view-5"], ["view-6", "view-7"], ["view-8", "view-9"]];
		const bindings = groups.map((ids, index) => [
			...ids.map((assetId) => ({ assetId, role: "character://model" })),
			{ assetId: `scene-${index}`, role: `scene://location-${index}` },
		]);
		const clipIds = groups.map((_, index) => `clip-${index}`);
		const contexts = bindings.map((items, index) => {
			const context = clipContext(clipIds[index]!, 15, items, index);
			return { ...context, assetObjectContracts: context.assetObjectContracts.map((contract) => ({ ...contract,
				referenceAssetIds: items.filter((item) => item.role === `${contract.kind}://${contract.name}`).map((item) => item.assetId),
			})) };
		});
		const all = bindings.flat();
		const plans = assetPlans([...all].reverse().map((binding) => ({ ...binding, existingAssetId: binding.assetId,
			existingProjectId: "project-1", consumerClipIds: clipIds.filter((_, index) => bindings[index]!.some((item) => item.assetId === binding.assetId)) })));
		const promptPackage = buildWorkflowPromptPackage({ executionId: "e", workflowKey: "video",
			clipPromptCollection: createWorkflowCollection({ collectionId: "prompts", producerNodeId: "writer", producerPortId: "prompts",
				itemIds: clipIds, values: bindings.map((items, index) => clipWriterResult(clipIds[index]!, 15, "展示本段服装状态", items, [15], index)) }),
			clipContextCollection: createWorkflowCollection({ collectionId: "contexts", producerNodeId: "fan-out", producerPortId: "contexts", itemIds: clipIds, values: contexts }),
			assetPlanCollection: plans,
		});
		const production = buildVideoProductionPlan({ executionId: "e", nodeId: "handoff", promptPackage,
			estimate: { estimateIdentity: "estimate", modelKey: "seedance20", resolution: "720p", aspectRatio: "9:16" },
			assetBindings: createWorkflowCollection({ collectionId: "resolved", producerNodeId: "resolver", producerPortId: "assets",
				itemIds: all.map((item) => item.assetId), values: all.map(({ assetId }) => ({ assetPlan: { assetId }, generatedAssetId: assetId,
					nodeId: `node-${assetId}`, imageUrl: `https://assets.example/${assetId}.png` })) }),
			voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		});
		expect(production.items.map((item) => (item.value as { referenceAssetIds: string[] }).referenceAssetIds))
			.toEqual(bindings.map((items) => items.map((item) => item.assetId)));
		expect(production.items.map((item) => (item.value as { durationSeconds: number }).durationSeconds)).toEqual([15, 15, 15, 15]);
	});

	it("rejects video-reference protocol fields at the paid workflow boundary", () => {
		expect(() => assertWorkflowVideoReferencePolicy({
			videoReferencePolicy: "forbidden",
			referenceVideoUrl: "https://assets.tapcanvas.test/reference.mp4",
		}, "production-plan")).toThrow("referenceVideoUrl is forbidden");
		const productionPlan = createWorkflowCollection({
			collectionId: "production-plan",
			producerNodeId: "handoff",
			producerPortId: "production-plan",
			values: [
				{ videoReferencePolicy: "forbidden" },
				{ videoReferencePolicy: "forbidden", sourceVideoUrl: "https://assets.tapcanvas.test/source.mp4" },
			],
		});
		expect(() => assertWorkflowVideoProductionPlanReferencePolicy(
			productionPlan,
			"production-plan",
		)).toThrow("production-plan.items[1].value.sourceVideoUrl is forbidden");
	});

	it("preserves project and generated asset identities for cross-canvas paid reference resolution", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 30, "成片提示词", [{ assetId: "hero", role: "character://剑修" }])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 30, [{ assetId: "hero", role: "character://剑修" }])],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
			assetPlanCollection: assetPlans([{ assetId: "hero", role: "character://剑修" }]),
		});
		const assetBindings = createWorkflowCollection({
			collectionId: "visual-assets",
			producerNodeId: "image-generator",
			producerPortId: "asset-bindings",
			itemIds: ["hero"],
			values: [{
				assetPlan: { assetId: "hero" },
				nodeId: "project-character-node",
				generatedAssetId: "project-node:project:project-1:project-character-node",
				imageUrl: "https://assets.tapcanvas.test/hero.png",
			}],
		});
		const productionPlan = buildVideoProductionPlan({
			executionId: "execution-1",
			nodeId: "handoff",
			promptPackage,
			estimate: {
				estimateIdentity: "estimate-1",
				modelKey: "doubao-seedance-2.5",
				resolution: "480p",
				aspectRatio: "16:9",
			},
			assetBindings,
			voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		});
		expect(productionPlan.items[0]?.value).toMatchObject({
			referenceImageNodeIds: [],
			referenceAssetIds: ["project-node:project:project-1:project-character-node"],
		});
		const productionValue = productionPlan.items[0]?.value as {
			structuredClip?: { assetObjectContracts?: readonly unknown[] };
		} | undefined;
		expect(productionValue?.structuredClip?.assetObjectContracts?.[0]).toMatchObject({
			kind: "character",
			name: "剑修",
			referenceImageNodeIds: [],
			referenceAssetIds: ["project-node:project:project-1:project-character-node"],
		});
	});

	it("does not let a writer invent a machine asset binding", () => {
		const writer = clipWriterResult("clip-a", 30, "成片提示词");
		const writerEnvelope = JSON.parse(writer.text) as { clips: Array<Record<string, unknown>> };
		if (!writerEnvelope.clips[0]) throw new Error("Expected one writer clip");
		writerEnvelope.clips[0].assets = [{ assetId: "missing-hero", role: "character://主角" }];
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [{ text: JSON.stringify(writerEnvelope) }],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 30)],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
		});
		expect(promptPackage.clips[0]?.declaredAssetIds).toEqual([]);
	});

	it("rejects a generated image that no Clip actually consumes before video submission", () => {
		const prompts = createWorkflowCollection({
			collectionId: "clip-prompts",
			producerNodeId: "writer",
			producerPortId: "clip-prompts",
			itemIds: ["clip-a"],
			values: [clipWriterResult("clip-a", 30, "成片提示词", [{ assetId: "hero", role: "character://剑修" }])],
		});
		const contexts = createWorkflowCollection({
			collectionId: "clip-contexts",
			producerNodeId: "fan-out",
			producerPortId: "clip-contexts",
			itemIds: ["clip-a"],
			values: [clipContext("clip-a", 30, [{ assetId: "hero", role: "character://剑修" }])],
		});
		const promptPackage = buildWorkflowPromptPackage({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			clipPromptCollection: prompts,
			clipContextCollection: contexts,
			assetPlanCollection: assetPlans([{ assetId: "hero", role: "character://剑修" }]),
		});
		const assetBindings = createWorkflowCollection({
			collectionId: "visual-assets",
			producerNodeId: "image-generator",
			producerPortId: "asset-bindings",
			itemIds: ["hero", "unused-forest"],
			values: [
				{ assetPlan: { assetId: "hero" }, nodeId: "image-node-hero", imageUrl: "https://assets.tapcanvas.test/hero.png" },
				{ assetPlan: { assetId: "unused-forest" }, nodeId: "image-node-forest", imageUrl: "https://assets.tapcanvas.test/forest.png" },
			],
		});

		expect(() => buildVideoProductionPlan({
			executionId: "execution-1",
			nodeId: "handoff",
			promptPackage,
			estimate: {
				estimateIdentity: "estimate-1",
				modelKey: "doubao-seedance-2.5",
				resolution: "480p",
				aspectRatio: "16:9",
			},
			assetBindings,
			voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		})).toThrow("Generated assets have no Clip consumer: unused-forest");
	});

	it("fails on duplicate BeatSheet clip identities", () => {
		expect(() => buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([5, 5]),
			beatSheetAgentResult: beatSheet([
				{ clipId: "same", durationSeconds: 5 },
				{ clipId: "same", durationSeconds: 5 },
			]),
		})).toThrow("BeatSheet clipId values must be unique");
	});

	it("reports a rejected BeatSheet port with the exact live contract fingerprint", () => {
		const readFailure = (contract: unknown) => {
			try {
				buildVideoClipContexts({
					executionId: "execution-1",
					nodeId: "fan-out",
					deliveryContract: contract,
					beatSheetAgentResult: beatSheet([{ clipId: "clip-a", durationSeconds: 43 }]),
				});
				throw new Error("Expected BeatSheet contract rejection");
			} catch (error: unknown) {
				expect(error).toBeInstanceOf(WorkflowInputContractError);
				return error as WorkflowInputContractError;
			}
		};
		const first = readFailure(deliveryContract([30, 13]));
		const second = readFailure(buildVideoDeliveryContract({
			executionId: "execution-1",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
			durationPlan: {
				targetDurationSeconds: 15,
				modelKey: "another-video-model",
				durationOptions: [5, 10, 15],
				maxDurationSeconds: 15,
			},
		}));
		expect(first.targetPortId).toBe("beat-sheet");
		expect(first.expectedContract.constraints.durationOptions).toContain(30);
		expect(second.expectedContract.constraints.durationOptions).toEqual([5, 10, 15]);
		expect(first.expectedContract.fingerprint).not.toBe(second.expectedContract.fingerprint);
	});

	it("rejects semantic BeatSheet durations whose sum differs from the authorized total", () => {
		expect(() => buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([30, 10]),
			beatSheetAgentResult: beatSheet([
				{ clipId: "clip-a", durationSeconds: 20 },
				{ clipId: "clip-b", durationSeconds: 15 },
			]),
		})).toThrow("expected=40:actual=35");
	});

	it("rejects a BeatSheet that redistributes an explicit ordered clip duration contract", () => {
		const explicitContract = buildVideoDeliveryContract({
			executionId: "execution-explicit-durations",
			workflowKey: "tapcanvas.video-production",
			executionScope: "media_delivery",
			canvasFacts: { sourceMode: "inline_text", text: "雨夜归途" },
			durationPlan: freezeWorkflowVideoDurationPlan({
				targetDurationSeconds: 10,
				modelKey: "doubao-seedance-2.5",
				durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
				explicitDurations: [5, 5],
			}),
			requestedClipCount: 2,
		});
		expect(() => buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: explicitContract,
			beatSheetAgentResult: beatSheet([
				{ clipId: "clip-a", durationSeconds: 6 },
				{ clipId: "clip-b", durationSeconds: 4 },
			]),
		})).toThrow('expected=[5,5]:actual=[6,4]');
	});

	it("accepts an explicitly projected BeatSheet prefix below the authorized total", () => {
		const source = beatSheet([{ clipId: "clip-a", durationSeconds: 15 }]);
		const contexts = buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([20]),
			beatSheetAgentResult: {
				...source,
				beatSheetProjection: {
					protocolVersion: "tapcanvas.beat-sheet-projection/v1",
					selection: "prefix",
					requestedBeatCount: 1,
					selectedBeatCount: 1,
					sourceBeatCount: 1,
				},
			},
		});

		expect(contexts.items.map((item) => item.itemId)).toEqual(["clip-a"]);
	});

	it("rejects an explicitly projected BeatSheet prefix above the authorized total", () => {
		const source = beatSheet([{ clipId: "clip-a", durationSeconds: 15 }]);
		expect(() => buildVideoClipContexts({
			executionId: "execution-1",
			nodeId: "fan-out",
			deliveryContract: deliveryContract([10]),
			beatSheetAgentResult: {
				...source,
				beatSheetProjection: {
					protocolVersion: "tapcanvas.beat-sheet-projection/v1",
					selection: "prefix",
					requestedBeatCount: 1,
					selectedBeatCount: 1,
					sourceBeatCount: 1,
				},
			},
		})).toThrow("expectedAtMost=10:actual=15");
	});
});

it("preserves all selected plans for one object through binding, parsing and exact verification", () => {
 const contracts = parseWorkflowClipAssetObjectContracts([{
  kind: "character", name: "Hero", physicalIdentityKey: "body", referenceRole: "identity",
  referenceImageNodeIds: [], identityInvariant: "one person", startState: "standing",
  spatialRelation: "left", driver: "walk", stateChange: "step", endState: "right",
 }], "test");
 const bound = bindWorkflowClipAssetObjectContracts({ contracts, field: "test", assetBindings: [
  { assetId: "front-plan", kind: "character", name: "body", nodeId: "front-node" },
  { assetId: "side-plan", kind: "character", name: "body", nodeId: "side-node" },
 ] });
 expect(bound[0]?.assetIds).toEqual(["front-plan", "side-plan"]);
 expect(bound[0]?.referenceImageNodeIds).toEqual(["front-node", "side-node"]);
 const parsed = parseWorkflowClipAssetObjectContracts(bound, "roundTrip");
 expect(inspectDeclaredAssetIdsMatch([{ assetObjectContracts: parsed }], ["assetObjectContracts"], ["front-plan", "side-plan"])).toBeNull();
 expect(inspectDeclaredAssetIdsMatch([{ assetObjectContracts: parsed }], ["assetObjectContracts"], ["front-plan", "side-plan", "missing-plan"])).toContain("missing-plan");
});

/*
 * 资产计划与绑定按 `kind://physicalIdentityName` 命名（角色取 physicalIdentityKey），
 * 而 `assetObjectContracts[].name` 保留显示名。两处只比一种写法时，一个完全正常的产物
 * （计划角色用物理身份键、合同 name 用显示名）会在 clip 阶段被判成"没有资产计划"——
 * ch2 实测 25/30 段因此失败。这里钉住两种精确写法都能匹配。
 */
describe("clip asset binding identity", () => {
  const contracts = parseWorkflowClipAssetObjectContracts([{
    kind: "character", name: "白真真", physicalIdentityKey: "char_bai_zhenzhen_genius_girl",
    referenceRole: "identity", referenceImageNodeIds: [], identityInvariant: "16岁少女",
    startState: "站", spatialRelation: "左", driver: "走", stateChange: "转身", endState: "右",
  }], "test");

  it("matches a binding that uses the physical identity key", () => {
    const bound = bindWorkflowClipAssetObjectContracts({ contracts, field: "test", assetBindings: [
      { assetId: "plan-canonical", kind: "character", name: "char_bai_zhenzhen_genius_girl", nodeId: "node-canonical" },
    ] });
    expect(bound[0]?.assetId).toBe("plan-canonical");
  });

  it("matches a binding that uses the display name", () => {
    const bound = bindWorkflowClipAssetObjectContracts({ contracts, field: "test", assetBindings: [
      { assetId: "plan-display", kind: "character", name: "白真真", nodeId: "node-display" },
    ] });
    expect(bound[0]?.assetId).toBe("plan-display");
  });

  it("still rejects a binding that matches no contract identity", () => {
    expect(() => bindWorkflowClipAssetObjectContracts({ contracts, field: "test", assetBindings: [
      { assetId: "plan-other", kind: "character", name: "另一个人", nodeId: "node-other" },
    ] })).toThrow(/has no matching BeatSheet object contract/);
  });
});
