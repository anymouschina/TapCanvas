import { describe, expect, it } from "vitest";
import {
	applyWorkflowAgentExactStringFieldsByIdentity,
	applyWorkflowArtifactJsonObjectContract,
	BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
	parseWorkflowAgentJsonArrayContract,
	parseWorkflowAgentJsonObjectContract,
	validateWorkflowAgentOutput,
	WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY,
	WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
} from "./execution.agent-output-contract";

describe("Workflow Agent output contract", () => {
	it("makes one complete submission the only structured-output policy and rejects retired correction fields", () => {
		expect(WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY).toBe("single_submission_record_and_fail");
		expect(WORKFLOW_STRUCTURED_OUTPUT_SINGLE_INFERENCE_POLICY)
			.toBe("single_inference_no_tools_record_and_fail");
		const baseContract = {
			requiredStringFields: ["protocolVersion"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "beats"],
		};
		expect(parseWorkflowAgentJsonObjectContract(baseContract)).not.toBeNull();
		expect(parseWorkflowAgentJsonObjectContract({
			...baseContract,
			failurePolicy: "bounded_correction",
		})).toBeNull();
		expect(parseWorkflowAgentJsonObjectContract({
			...baseContract,
			collectionCorrectionFields: ["beats"],
		})).toBeNull();
		expect(parseWorkflowAgentJsonObjectContract({
			...baseContract,
			arrayItemMergeKeyFields: { beats: "clipIndex" },
		})).toBeNull();
	});

	it("parses and enforces caller-frozen top-level source lineage", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["sourceId", "sourceFingerprint"],
			exactStringFields: {
				sourceId: "public-chat-turn:source-1",
				sourceFingerprint: "fingerprint-1",
			},
			allowedFields: ["sourceId", "sourceFingerprint"],
		});
		expect(contract).toEqual({
			requiredStringFields: ["sourceId", "sourceFingerprint"],
			exactStringFields: {
				sourceId: "public-chat-turn:source-1",
				sourceFingerprint: "fingerprint-1",
			},
			allowedFields: ["sourceId", "sourceFingerprint"],
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.test/v1",
			rawText: JSON.stringify({
				sourceId: "public-chat-turn:source-1",
				sourceFingerprint: "foreign-fingerprint",
			}),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_object output field sourceFingerprint must exactly preserve the frozen string fact",
		});
	});

	const writerAudit = (participants: readonly string[] = ["主角"]) => ({
		canonicalParticipants: participants,
		preservedEntryFacts: ["冻结入口事实"],
		preservedOrderedEvents: ["冻结有序事件"],
		preservedExitFacts: ["冻结退出事实"],
		inventedFacts: [],
	});
	const sceneRegistryObject = {
		objectId: "scene-continuous",
		kind: "scene",
		name: "连续战场",
		physicalIdentityKey: null,
		referenceImageNodeIds: [],
		referenceRole: "none",
		identityInvariant: "同一连续战场的空间拓扑与光照方向不变",
	};
	const sceneState = (startState: string, endState: string) => ({
		objectId: "scene-continuous",
		startState,
		spatialRelation: "主冲突始终发生在同一空间轴线上",
		driver: "冻结来源事件推进",
		stateChange: `${startState}推进为${endState}`,
		endState,
	});
	const compactBeat = <T extends Record<string, unknown>>(beat: T) => beat;
	const beatSheetTimeline = () => ({
		protocolVersion: "tapcanvas.beat-sheet/v2",
		chapterArc: {
			storyPromise: "冲突必须推进到不可逆决胜",
			protagonistThroughline: "主角从受压转为掌握主动",
			primaryPayoff: "决胜动作造成不可逆结果",
			endingHook: "结果之后仍留下后续牵引",
		},
		sourceCoveragePlan: { speechLedger: [] },
		sourceFidelityAudit: {
			sourceBeatLedger: Array.from({ length: 5 }, (_, sourceOrder) => ({
				sourceBeatId: `source-${sourceOrder}`,
				sourceOrder,
				durationSeconds: 8,
				summary: `来源节拍 ${sourceOrder + 1}`,
			})),
		},
		objectRegistry: [sceneRegistryObject],
		beats: [
			compactBeat({
				clipId: "clip-0",
				clipIndex: 0,
				dominantFunction: "建立并推进冲突直到决胜动作越界",
				causalEntry: "初始矛盾迫使双方进入冲突",
				irreversibleResult: "决胜动作沿原路径越过物理边界",
				handoffToNext: "下一段必须完成接触、反作用与后果",
				startKeyframe: "连续战场初始状态",
				endKeyframe: "决胜动作沿原路径越过物理边界",
				characters: [],
				dialogueScript: [],
				durationSeconds: 30,
				exitState: "决胜动作沿原路径越过物理边界",
				objectStates: [sceneState("初始", "决胜动作沿原路径越过物理边界")],
				storyEvents: [
					{ sourceBeatId: "source-0", startSeconds: 0, endSeconds: 8, event: "开场", entryState: "初始", exitState: "冲突触发" },
					{ sourceBeatId: "source-1", startSeconds: 8, endSeconds: 16, event: "压制", entryState: "冲突触发", exitState: "一方占优" },
					{ sourceBeatId: "source-2", startSeconds: 16, endSeconds: 24, event: "逆转", entryState: "一方占优", exitState: "位置逆转" },
					{ sourceBeatId: "source-3", startSeconds: 24, endSeconds: 30, event: "决胜起势与路径", entryState: "位置逆转", exitState: "决胜动作沿原路径越过物理边界" },
				],
			}),
			compactBeat({
				clipId: "clip-1",
				clipIndex: 1,
				dominantFunction: "完成决胜后果并建立钩子",
				causalEntry: "上一段越界动作必须发生接触与反作用",
				irreversibleResult: "不可逆结果与钩子成立",
				handoffToNext: "后续必须回应已经成立的钩子",
				startKeyframe: "决胜动作沿原路径越过物理边界",
				endKeyframe: "钩子成立",
				characters: [],
				dialogueScript: [],
				durationSeconds: 10,
				exitState: "钩子成立",
				objectStates: [sceneState("决胜动作沿原路径越过物理边界", "钩子成立")],
				storyEvents: [
					{ sourceBeatId: "source-3", startSeconds: 0, endSeconds: 2, event: "接触、反作用与不可逆结果", entryState: "决胜动作沿原路径越过物理边界", exitState: "不可逆结果成立" },
					{ sourceBeatId: "source-4", startSeconds: 2, endSeconds: 10, event: "后果与钩子", entryState: "不可逆结果成立", exitState: "钩子成立" },
				],
			}),
		],
	});

	it("enforces one source-duration timeline across model-max physical Clips", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceFidelityAudit", "sourceCoveragePlan", "chapterArc"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "chapterArc", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		expect(contract).not.toBeNull();
		expect(contract).toMatchObject({
			exactStringFields: { protocolVersion: "tapcanvas.beat-sheet/v2" },
			contractVersion: BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
		});
		expect(contract && "failurePolicy" in contract).toBe(false);
		expect(contract?.itemRequiredNonEmptyArrayFields).toBeUndefined();
		expect(contract?.allowedFields).toEqual(expect.arrayContaining([
			"protocolVersion",
			"sourceId",
			"sourceFingerprint",
			"chapterArc",
			"objectRegistry",
		]));
		expect(contract?.arrayItemAllowedFields?.beats).toEqual([
			"clipId",
			"clipIndex",
			"durationSeconds",
			"sourceSpan",
			"narrativeIntent",
			"visualIntent",
			"dominantFunction",
			"causalEntry",
			"irreversibleResult",
			"handoffToNext",
			"startKeyframe",
			"endKeyframe",
			"exitState",
			"characters",
			"speakers",
			"dialogueScript",
			"narrativeAudioPlan",
			"dialoguePaceRate",
			"storyEvents",
			"objectStates",
		]);
		expect(contract && "arrayItemMergeKeyFields" in contract).toBe(false);
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(beatSheetTimeline()),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: true });

		const reportHeavy = beatSheetTimeline();
		(reportHeavy.beats[0] as Record<string, unknown>).pacingDecision = "只供同链分析，不属于执行产物";
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(reportHeavy),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent BeatSheet compact object ledger is invalid: beats[0] contains unexpected field pacingDecision",
		});

		const duplicatedExpandedContracts = beatSheetTimeline();
		(duplicatedExpandedContracts.beats[0] as Record<string, unknown>).assetObjectContracts = [];
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(duplicatedExpandedContracts),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent BeatSheet compact object ledger is invalid: beats[0] contains unexpected field assetObjectContracts",
		});

		const compressedTail = beatSheetTimeline();
		compressedTail.beats[0]!.storyEvents[0]!.endSeconds = 15;
		compressedTail.beats[0]!.storyEvents[1]!.startSeconds = 15;
		compressedTail.beats[0]!.storyEvents[1]!.endSeconds = 22;
		compressedTail.beats[0]!.storyEvents[2]!.startSeconds = 22;
		const projectedTail = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(compressedTail),
			jsonObjectContract: contract,
		});
		expect(projectedTail).toMatchObject({ ok: true });
		if (!projectedTail.ok) throw new Error(projectedTail.errorMessage);
		const projectedLedger = (JSON.parse(projectedTail.text) as {
			sourceFidelityAudit: { sourceBeatLedger: Array<{ durationSeconds: number }> };
		}).sourceFidelityAudit.sourceBeatLedger;
		expect(projectedLedger.map((item) => item.durationSeconds)).toEqual([8, 8, 8, 8, 8]);
		expect(projectedTail.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "model_authored_consistency" }),
		]));

	});

	it("compiles only BeatSheet transport duplicates while requiring model-authored continuity", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "chapterArc"],
			requiredArrayFields: ["objectRegistry", "beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "chapterArc", "objectRegistry", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		expect(contract?.contractVersion).toBe(BEAT_SHEET_ARTIFACT_CONTRACT_VERSION);
		expect(contract?.collectionCorrectionFields).toBeUndefined();

		const compact = structuredClone(beatSheetTimeline()) as unknown as Record<string, unknown>;
		delete compact.sourceFidelityAudit;
		for (const rawBeat of compact.beats as Array<Record<string, unknown>>) {
			delete rawBeat.clipId;
			delete rawBeat.characters;
			delete rawBeat.speakers;
			delete rawBeat.dialogueScript;
		}

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(compact),
			jsonObjectContract: contract,
		});
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error(result.errorMessage);
		const compiled = JSON.parse(result.text) as {
			beats: Array<{
				clipId: string;
				exitState: string;
				characters: string[];
				dialogueScript: unknown[];
				storyEvents: Array<{ entryState: string; exitState: string }>;
				assetObjectContracts: Array<{
					physicalIdentityKey: string | null;
					referenceImageNodeIds: string[];
					referenceRole: string;
				}>;
			}>;
		};
		expect(compiled.beats[0]?.assetObjectContracts[0]).toMatchObject({
			physicalIdentityKey: null,
			referenceImageNodeIds: [],
			referenceRole: "none",
		});
		expect(compiled.beats[0]?.clipId).toBe("tapcanvas.beat-sheet/v2:clip:0");
		expect(compiled.beats[0]?.dialogueScript).toEqual([]);
		expect(compiled.beats[1]?.storyEvents[0]?.entryState).toBe(compiled.beats[0]?.exitState);

		const missingContinuity = structuredClone(compact) as Record<string, unknown>;
		const firstBeat = (missingContinuity.beats as Array<Record<string, unknown>>)[0]!;
		delete firstBeat.exitState;
		delete (firstBeat.storyEvents as Array<Record<string, unknown>>)[1]!.entryState;
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(missingContinuity),
			jsonObjectContract: contract,
		})).toMatchObject({
			ok: false,
			errorMessage: expect.stringContaining("storyEvents[1].entryState"),
		});
	});

	it("canonicalizes shared launch BeatSheet machine fields before the fast fan-out boundary", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion", "sourceId", "sourceFingerprint"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit", "chapterArc"],
			requiredArrayFields: ["beats"],
			arrayItemRequiredStringFields: {
				beats: ["clipId", "startKeyframe", "endKeyframe", "dominantFunction", "causalEntry", "irreversibleResult", "handoffToNext"],
			},
			arrayItemRequiredStringArrayFields: { beats: ["characters"] },
			arrayItemAllowedFields: { beats: [
				"clipId", "clipIndex", "durationSeconds", "sourceSpan", "narrativeIntent", "visualIntent",
				"dominantFunction", "causalEntry", "irreversibleResult", "handoffToNext", "startKeyframe",
				"endKeyframe", "exitState", "characters", "speakers", "dialogueScript", "narrativeAudioPlan",
				"dialoguePaceRate", "storyEvents", "assetObjectContracts",
			] },
			allowedFields: ["protocolVersion", "sourceId", "sourceFingerprint", "sourceCoveragePlan", "sourceFidelityAudit", "chapterArc", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.launch-beat-sheet/v1", authored);
		expect(contract?.expectedArrayLengths).toEqual({ beats: 1 });
		expect(contract && "collectionCorrectionFields" in contract).toBe(false);
		expect(contract).toMatchObject({
			contractVersion: BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
		});
		expect(contract && "failurePolicy" in contract).toBe(false);

		const sheet = beatSheetTimeline();
		sheet.protocolVersion = "2";
		const firstBeat = sheet.beats[0] as unknown as Record<string, unknown>;
		firstBeat.narrativeAudioPlan = { lines: [] };
		firstBeat.objectStates = [
			{ ...sceneState("初始", "危机成立") },
			{
				objectId: "character-liu-xiu",
				startState: "刚醒",
				spatialRelation: "义庄内",
				driver: "听见求救",
				stateChange: "走向大门",
				endState: "站在门内",
			},
			{
				objectId: "prop-gate",
				startState: "紧闭",
				spatialRelation: "人物与求救者之间",
				driver: "急促拍门",
				stateChange: "承载隔门对话",
				endState: "仍未打开",
			},
		];
		const launchSheet = {
			...sheet,
			sourceId: "chapter-1",
			sourceFingerprint: "fingerprint-1",
			objectRegistry: [
				{ ...sceneRegistryObject, referenceRole: "environment" },
				{
					objectId: "character-liu-xiu",
					kind: "character",
					name: "刘秀",
					physicalIdentityKey: "body-liu-xiu",
					referenceImageNodeIds: [],
					referenceRole: "identity",
					identityInvariant: "青色道袍的年轻道士",
				},
				{
					objectId: "prop-gate",
					kind: "prop",
					name: "义庄大门",
					physicalIdentityKey: null,
					referenceImageNodeIds: [],
					referenceRole: "prop",
					identityInvariant: "厚重木门",
				},
			],
			sourceFidelityAudit: {
				sourceBeatLedger: sheet.sourceFidelityAudit.sourceBeatLedger.slice(0, 4),
			},
			beats: [firstBeat],
		};
		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.launch-beat-sheet/v1",
			rawText: JSON.stringify(launchSheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as {
			beats: Array<{
				narrativeAudioPlan: { lines: unknown[] };
				assetObjectContracts: Array<{ referenceRole: string }>;
			}>;
		};
		expect(projected.beats[0]?.narrativeAudioPlan).toEqual({ lines: [] });
		expect(projected.beats[0]?.assetObjectContracts.map((item) => item.referenceRole))
			.toEqual(["environment", "identity", "prop"]);

		const wrongChapterArc = {
			...launchSheet,
			chapterArc: {
				openingState: "义庄清晨",
				firstClipTurn: "门外求救",
				handoffState: "刘秀准备应门",
			},
		};
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.launch-beat-sheet/v1",
			rawText: JSON.stringify(wrongChapterArc),
			jsonObjectContract: contract,
		})).toMatchObject({
			ok: true,
			diagnostics: [{
				code: "model_authored_consistency",
				message: "chapterArc.storyPromise must be non-empty",
			}],
		});

		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.launch-beat-sheet/v1",
			rawText: JSON.stringify({ ...launchSheet, beats: sheet.beats }),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_object output array field beats must contain exactly 1 items",
		});
	});

	it("rejects a prepared BeatSheet before workflow admission when its authoritative speech ledger is absent", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({ ...beatSheetTimeline(), sourceCoveragePlan: {} }),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent BeatSheet artifact cannot be executed: sourceCoveragePlan.speechLedger must be an array",
		});
	});

	it("reports one missing BeatSheet ledger leaf as a non-blocking diagnostic", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		delete (sheet.sourceFidelityAudit.sourceBeatLedger[3] as Partial<{ summary: string }>).summary;

		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		})).toMatchObject({
			ok: true,
			diagnostics: [{
				code: "model_authored_consistency",
				message: "sourceFidelityAudit.sourceBeatLedger[3].summary must be non-empty",
			}],
		});
	});

	it("projects compiler-owned BeatSheet speakers before Clip fan-out and replay validation", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		const speech = {
			lineId: "speech-001",
			speakerName: "孟川",
			text: "冥河，滚出来！",
			clipIndex: 0,
			delivery: "on_screen",
		};
		(sheet.sourceCoveragePlan as { speechLedger: unknown[] }).speechLedger = [speech];
		const firstBeat = sheet.beats[0] as unknown as Record<string, unknown>;
		firstBeat.dialogueScript = [{ ...speech, delivery: "on_screen" }];
		firstBeat.narrativeAudioPlan = { lines: [] };
		firstBeat.speakers = [];
		firstBeat.dialoguePaceRate = 4;

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as { beats: Array<{ speakers: string[] }> };
		expect(projected.beats[0]?.speakers).toEqual(["孟川"]);
	});

	it("projects stable compiler-owned BeatSheet clip identities when the Agent omits them", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		delete (sheet.beats[0] as unknown as Record<string, unknown>).clipId;
		delete (sheet.beats[1] as unknown as Record<string, unknown>).clipId;

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as { beats: Array<{ clipId: string }> };
		expect(projected.beats.map((beat) => beat.clipId)).toEqual([
			"tapcanvas.beat-sheet/v2:clip:0",
			"tapcanvas.beat-sheet/v2:clip:1",
		]);
	});

	it("preserves model-authored speech clip indexes before workflow admission", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		(sheet.sourceCoveragePlan as { speechLedger: unknown[] }).speechLedger = [
			{ lineId: "speech-1", speakerName: "甲", text: "第一句。", clipIndex: 0, delivery: "on_screen" },
			{ lineId: "speech-2", speakerName: "乙", text: "第二句。", clipIndex: 1, delivery: "off_screen" },
			{ lineId: "speech-3", speakerName: "甲", text: "第三句。", clipIndex: 0, delivery: "voice_over" },
		];

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as {
			sourceCoveragePlan: { speechLedger: Array<{ clipIndex: number }> };
			beats: Array<{ dialogueScript: Array<{ lineId: string }> }>;
		};
		expect(projected.sourceCoveragePlan.speechLedger.map((line) => line.clipIndex)).toEqual([0, 1, 0]);
		expect(projected.beats[0]?.dialogueScript.map((line) => line.lineId)).toEqual(["speech-1", "speech-3"]);
		expect(projected.beats[1]?.dialogueScript.map((line) => line.lineId)).toEqual(["speech-2"]);
	});

	it("rejects speech placement that cannot reference an authored beat", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		(sheet.sourceCoveragePlan as { speechLedger: unknown[] }).speechLedger = [
			{ lineId: "speech-final", speakerName: "旁白", text: "落在最后一拍。", clipIndex: 99, delivery: "voice_over" },
		];

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		expect(result).toEqual({
			ok: false,
			errorMessage: "Agent BeatSheet artifact cannot be executed: sourceCoveragePlan.speechLedger[0].clipIndex must reference an existing beat",
		});
	});

	it("records model-authored BeatSheet continuity drift without rewriting it", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		sheet.beats[0]!.storyEvents[1]!.entryState = "provider mechanical drift";
		delete (sheet.beats[0] as unknown as Record<string, unknown>).exitState;
		sheet.beats[1]!.storyEvents[0]!.entryState = "stale cross-clip entry";

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as typeof sheet;
		expect(projected.beats[0]!.storyEvents[1]!.entryState).toBe("provider mechanical drift");
		expect(projected.beats[0]!.exitState).toBeUndefined();
		expect(projected.beats[1]!.storyEvents[0]!.entryState).toBe("stale cross-clip entry");
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "model_authored_consistency" }),
		]));
	});

	it("records object-state prose drift without blocking or rewriting downstream input", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		const secondBeat = sheet.beats[1] as unknown as Record<string, unknown>;
		const objectStates = secondBeat.objectStates as Array<Record<string, unknown>>;
		objectStates[0] = {
			...objectStates[0],
			startState: "模型声明的另一种自然语言起始状态",
		};

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as {
			beats: Array<{ assetObjectContracts: Array<{ startState: string }> }>;
		};
		expect(projected.beats[1]?.assetObjectContracts[0]?.startState)
			.toBe("模型声明的另一种自然语言起始状态");
		expect(result.diagnostics).toEqual(expect.arrayContaining([{
			code: "model_authored_consistency",
			message: expect.stringContaining("startState differs from its previous declared endState"),
		}]));
	});

	it("keeps over-capacity BeatSheet timing model-authored and emits a diagnostic", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		const speech = {
			lineId: "speech-capacity-1",
			speakerName: "孟川",
			text: "这段冻结对白明显超过当前物理片段按照声明语速能够承载的字符容量。",
			clipIndex: 0,
			delivery: "on_screen",
		};
		(sheet.sourceCoveragePlan as { speechLedger: unknown[] }).speechLedger = [speech];
		const firstBeat = sheet.beats[0] as unknown as Record<string, unknown>;
		firstBeat.dialogueScript = [{ ...speech, delivery: "on_screen" }];
		firstBeat.narrativeAudioPlan = { lines: [] };
		firstBeat.speakers = ["孟川"];
		firstBeat.dialoguePaceRate = 1;
		const originalDurationSeconds = Number(firstBeat.durationSeconds);

		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as typeof sheet;
		expect(projected.beats[0]!.durationSeconds).toBe(originalDurationSeconds);
		expect(projected.beats[0]!.storyEvents.at(-1)!.endSeconds).toBe(projected.beats[0]!.durationSeconds);
		expect(projected.beats[0]!.dialogueScript).toEqual([{
			lineId: speech.lineId,
			speakerName: speech.speakerName,
			text: speech.text,
			delivery: "on_screen",
		}]);
		const physicalDuration = projected.beats.reduce((total, beat) => total + beat.durationSeconds, 0);
		const ledgerDuration = projected.sourceFidelityAudit.sourceBeatLedger
			.reduce((total, item) => total + item.durationSeconds, 0);
		expect(ledgerDuration).toBe(physicalDuration);
		expect(result.diagnostics?.[0]?.message).toContain("cannot carry its frozen spoken script");
	});

	it("leaves semantic pace labels to the model and records a diagnostic", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		const firstBeat = sheet.beats[0] as unknown as Record<string, unknown>;
		firstBeat.dialoguePaceRate = "偏快·急喊";

		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		})).toMatchObject({
			ok: true,
			diagnostics: [{
				code: "model_authored_consistency",
				message: expect.stringContaining("dialoguePaceRate must be a positive numeric"),
			}],
		});
	});

	it("does not gate BeatSheet delivery on semantic dialogue copies inside state prose", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const sheet = beatSheetTimeline();
		const speech = {
			lineId: "speech-state-1",
			speakerName: "孟川",
			text: "快走！",
			clipIndex: 0,
			delivery: "on_screen",
		};
		(sheet.sourceCoveragePlan as { speechLedger: unknown[] }).speechLedger = [speech];
		const firstBeat = sheet.beats[0] as unknown as Record<string, unknown>;
		firstBeat.dialogueScript = [{ ...speech, delivery: "on_screen" }];
		firstBeat.narrativeAudioPlan = { lines: [] };
		firstBeat.speakers = ["孟川"];
		firstBeat.dialoguePaceRate = 4;
		firstBeat.exitState = "孟川说完‘快走！’后站稳";
		const storyEvents = firstBeat.storyEvents as Array<Record<string, unknown>>;
		storyEvents[storyEvents.length - 1]!.exitState = firstBeat.exitState;

		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: true });
	});

	it("rejects corrupt replacement text before a prompt can be submitted", () => {
		const authored = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceFidelityAudit", "sourceCoveragePlan"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authored);
		const corrupted = beatSheetTimeline();
		corrupted.beats[0]!.storyEvents[0]!.event = "夜�launch";
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(corrupted),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: false });
	});

	it("extends a stale allow-list with caller-frozen exact identity fields", () => {
		const authoredContract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemAllowedFields: ["assetId", "role"],
		});
		expect(authoredContract).not.toBeNull();
		if (!authoredContract) throw new Error("Expected authored contract");

		const runtimeContract = applyWorkflowAgentExactStringFieldsByIdentity(authoredContract, {
			identityField: "assetId",
			values: {
				hero: {
					existingAssetId: "project-node:hero",
					existingProjectId: "project-1",
					existingNodeId: "hero-node",
				},
			},
		});

		expect(runtimeContract.itemAllowedFields).toEqual([
			"assetId",
			"role",
			"existingAssetId",
			"existingProjectId",
			"existingNodeId",
		]);
		expect(parseWorkflowAgentJsonArrayContract(runtimeContract)).not.toBeNull();
	});

	it("enforces identity-scoped non-empty arrays without burdening unrelated items", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["role"],
			itemRequiredNonEmptyArrayFieldsByIdentity: {
				identityField: "role",
				values: { "character://hero": ["identityAnchors", "prohibitedDrift"] },
			},
			itemAllowedFields: ["role", "identityAnchors", "prohibitedDrift"],
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ role: "character://hero", identityAnchors: [], prohibitedDrift: ["保持骨相"] }]),
			jsonArrayContract: contract,
		})).toMatchObject({ ok: false, errorMessage: expect.stringContaining("identityAnchors") });
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ role: "scene://courtyard" }]),
			jsonArrayContract: contract,
		})).toMatchObject({ ok: true });
	});

	it("hard-enforces the versioned clip writer asset object grammar", () => {
		const baseContract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["selfQaNote"],
			requiredObjectFields: ["creativeReview", "sourceFidelityAudit"],
			requiredArrayFields: ["clips"],
			allowedFields: ["clips", "selfQaNote", "creativeReview", "sourceFidelityAudit"],
			itemExactAssetIds: {
				declarationPaths: ["assets", "assetObjectContracts"],
				expectedAssetPlansFromPort: "clip-contexts",
			},
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.clip-prompts/v2", baseContract);
		expect(contract).toMatchObject({
			contractName: "tapcanvas.video-writer-artifact",
			contractVersion: "14",
			requiredStringFields: [],
			requiredObjectFields: [],
			itemExactAssetIds: { declarationPaths: ["assetObjectContracts"] },
		});
		expect(contract && "failurePolicy" in contract).toBe(false);
		const malformed = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.clip-prompts/v2",
				rawText: JSON.stringify({
				clips: [{
					clipId: "clip-001",
					clipIndex: 0,
					durationSeconds: 10,
					exitState: "动作完成",
					shots: [{ shotNo: 1, visualTask: "前冲后的空间距离变化", action: "主角前冲", durationSeconds: 10, depictedStoryEventIndices: [0] }],
					sourceEventCoverage: [{ storyEventIndex: 0, shotNos: [1] }],
					temporalFrameTrack: Array.from({ length: 10 }, (_, windowIndex) => ({
						windowIndex,
						startSeconds: windowIndex,
						endSeconds: windowIndex + 1,
						startState: windowIndex === 0 ? "动作开始" : `动作状态-${windowIndex}`,
						startFrame: `${windowIndex}s 起帧`,
						transition: `${windowIndex}-${windowIndex + 1}s 可见过渡`,
						carryFrame: `${windowIndex + 1}s 承帧`,
						carryState: windowIndex === 9 ? "动作完成" : `动作状态-${windowIndex + 1}`,
						storyEventIndices: [0],
					})),
					temporalFrameCoverage: Array.from({ length: 10 }, (_, windowIndex) => ({
						windowIndex,
						shotNos: [1],
					})),
					assetObjectContracts: [{ assetId: "asset-hero", role: "character://主角" }],
				}],
				selfQaNote: "已检查",
				creativeReview: {},
				sourceFidelityAudit: writerAudit(),
			}),
			jsonObjectContract: contract,
		});
		expect(malformed).toMatchObject({
			ok: false,
			errorMessage: expect.stringContaining("clips[0].assetObjectContracts[0].kind"),
		});
	});

	it("rejects invalid motion enums and incomplete shot duration allocation before prompt-package assembly", () => {
		const contract = applyWorkflowArtifactJsonObjectContract(
			"tapcanvas.clip-prompts/v2",
			parseWorkflowAgentJsonObjectContract({
				requiredArrayFields: ["clips"],
				requiredObjectFields: ["sourceFidelityAudit"],
				allowedFields: ["clips", "sourceFidelityAudit"],
			}),
		);
		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.clip-prompts/v2",
			rawText: JSON.stringify({
			sourceFidelityAudit: writerAudit(),
				clips: [{
					clipId: "clip-001",
					clipIndex: 0,
					durationSeconds: 30,
					shots: [{
						shotNo: 1,
						visualTask: "撞墙后的制动与反弹",
						depictedStoryEventIndices: [0],
						action: "主角前冲后撞墙制动",
						durationSeconds: 26,
						motionDynamics: {
							tempo: "fast",
							force: "heavy",
							direction: "向前",
							airborne: "none",
							rotation: "none",
							brakingMode: "撞墙",
							impactSurface: "墙面",
							environmentalResponse: "debris",
						},
					}],
					sourceEventCoverage: [{ storyEventIndex: 0, shotNos: [1] }],
					assetObjectContracts: [{
						assetId: "asset-hero",
						kind: "character",
						name: "主角",
						referenceRole: "identity",
						referenceImageNodeIds: [],
					}],
				}],
			}),
			jsonObjectContract: contract,
		});
		expect(result).toEqual({
			ok: false,
			errorMessage: "Agent video writer artifact is invalid: clips[0].shots[0].motionDynamics.direction direction 必须是 left/right/forward/backward/upward/downward/diagonal",
		});
	});
	it("accepts only the declared string fields for a json_object port", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["prompt", "negativePrompt"],
			allowedFields: ["prompt", "negativePrompt"],
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.image-prompt-package/v1",
			rawText: JSON.stringify({ prompt: "动态正向提示词", negativePrompt: "动态负向提示词" }),
			jsonObjectContract: contract,
		})).toEqual({
			ok: true,
			text: '{"prompt":"动态正向提示词","negativePrompt":"动态负向提示词"}',
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.image-prompt-package/v1",
			rawText: JSON.stringify({ prompt: "动态正向提示词", negativePrompt: "动态负向提示词", note: "禁止" }),
			jsonObjectContract: contract,
		})).toEqual({ ok: false, errorMessage: "Agent json_object output contains unexpected field note" });
	});

	it("rejects array item string values outside the caller-frozen set", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
			itemStringArrayAllowedValues: { consumerClipIds: ["clip-a", "clip-b"] },
			itemAllowedFields: ["assetId", "consumerClipIds"],
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", consumerClipIds: ["clip-invented"] }]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 field consumerClipIds must be a non-empty string array using only: clip-a,clip-b",
		});
	});

	it("enforces a caller-frozen scalar string set even when it is the only item contract", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemStringAllowedValues: { role: ["scene://紫霄宫内·混元道场"] },
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ role: "scene://场景卡｜紫霄宮內·混元道場" }]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 field role must use one of: scene://紫霄宫内·混元道场",
		});
	});

	it("requires caller-frozen project asset identities for matching array items", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemExactStringFieldsByIdentity: {
				identityField: "assetId",
				values: { hero: { existingAssetId: "project-node:hero", existingProjectId: "project-1" } },
			},
			itemAllowedFields: ["assetId", "existingAssetId", "existingProjectId"],
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero" }]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 identity hero requires exact string field existingAssetId",
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", existingAssetId: "project-node:hero", existingProjectId: "project-1" }]),
			jsonArrayContract: contract,
		})).toMatchObject({ ok: true });
	});

	it("validates reusable object, array and number fields without inspecting creative semantics", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredNumberFields: ["revision"],
			requiredObjectFields: ["filmBible"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "revision", "filmBible", "beats"],
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({ protocolVersion: "2", revision: 1, filmBible: {}, beats: [{ clipId: "clip-a" }] }),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: true });
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({ protocolVersion: "2", revision: 1, filmBible: [], beats: [] }),
			jsonObjectContract: contract,
		})).toEqual({ ok: false, errorMessage: "Agent json_object output requires object field filmBible" });
	});

	it("rejects BeatSheet item durations that drift from the ordered frozen plan", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
			expectedArrayLengths: { beats: 2 },
			arrayItemExactNumberFields: {
				beats: [{ durationSeconds: 30 }, { durationSeconds: 10 }],
			},
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 4 }, { durationSeconds: 4 }],
			}),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_object output beats item 1 field durationSeconds must equal 30",
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({
				protocolVersion: "tapcanvas.beat-sheet/v2",
				beats: [{ durationSeconds: 30 }, { durationSeconds: 10 }],
			}),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: true });
	});

	it("rejects BeatSheet item durations outside the live provider catalog", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "beats"],
			arrayItemNumberAllowedValues: {
				beats: { durationSeconds: [4, 10, 15, 30] },
			},
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({ protocolVersion: "tapcanvas.beat-sheet/v2", beats: [{ durationSeconds: 43 }] }),
			jsonObjectContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_object output beats item 1 field durationSeconds must use one of: 4,10,15,30",
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify({ protocolVersion: "tapcanvas.beat-sheet/v2", beats: [{ durationSeconds: 30 }] }),
			jsonObjectContract: contract,
		})).toMatchObject({ ok: true });
	});

	it("compiles BeatSheet character arrays from object states instead of preserving an obsolete authored requirement", () => {
		const authoredContract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredObjectFields: ["sourceCoveragePlan", "sourceFidelityAudit"],
			requiredArrayFields: ["beats"],
			arrayItemRequiredNonEmptyStringArrayFields: { beats: ["characters"] },
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authoredContract);
		expect(contract).not.toBeNull();
		expect(contract?.arrayItemRequiredNonEmptyStringArrayFields).toBeUndefined();
		expect(contract?.arrayItemRequiredStringArrayFields).toBeUndefined();
		const sheet = beatSheetTimeline();
		for (const beat of sheet.beats) delete (beat as Record<string, unknown>).characters;
		const result = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!result.ok) throw new Error(result.errorMessage);
		const projected = JSON.parse(result.text) as { beats: Array<{ characters: string[] }> };
		expect(projected.beats.every((beat) => (
			Array.isArray(beat.characters)
			&& beat.characters.every((name) => typeof name === "string")
		))).toBe(true);
		(sheet.beats[0] as Record<string, unknown>).characters = [{ id: "stale-provider-copy" }];
		const normalized = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!normalized.ok) throw new Error(normalized.errorMessage);
		const normalizedArtifact = JSON.parse(normalized.text) as { beats: Array<{ characters: string[] }> };
		expect(normalizedArtifact.beats[0]?.characters).toEqual(projected.beats[0]?.characters);
	});

	it("keeps compiler-owned BeatSheet arrays outside the authored workflow contract", () => {
		const authoredContract = parseWorkflowAgentJsonObjectContract({
			requiredStringFields: ["protocolVersion"],
			requiredArrayFields: ["beats"],
			allowedFields: ["protocolVersion", "sourceCoveragePlan", "sourceFidelityAudit", "beats"],
		});
		const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", authoredContract);
		expect(contract?.arrayItemRequiredStringArrayFields).toBeUndefined();
		const sheet = beatSheetTimeline();
		for (const beat of sheet.beats) delete (beat as Record<string, unknown>).characters;
		const compiledCharacters = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.beat-sheet/v2",
			rawText: JSON.stringify(sheet),
			jsonObjectContract: contract,
		});
		if (!compiledCharacters.ok) throw new Error(compiledCharacters.errorMessage);
		const projected = JSON.parse(compiledCharacters.text) as { beats: Array<{ characters: string[] }> };
		expect(projected.beats.every((beat) => Array.isArray(beat.characters))).toBe(true);
	});
	it("accepts one exact typed JSON artifact and unwraps its text", () => {
		expect(validateWorkflowAgentOutput({
			encoding: "json_artifact",
			artifactType: "tapcanvas.video-prompt/v1",
			rawText: JSON.stringify({
				artifactType: "tapcanvas.video-prompt/v1",
				text: "完整视频提示词",
			}),
		})).toEqual({ ok: true, text: "完整视频提示词" });
	});

	it("rejects trailing characters instead of truncating them locally", () => {
		expect(validateWorkflowAgentOutput({
			encoding: "json_artifact",
			artifactType: "tapcanvas.video-prompt/v1",
			rawText: '{"artifactType":"tapcanvas.video-prompt/v1","text":"正文"}"}',
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_artifact output must be one JSON object without Markdown fences or surrounding prose",
		});
	});

	it("rejects top-level fields outside the declared artifact schema", () => {
		expect(validateWorkflowAgentOutput({
			encoding: "json_artifact",
			artifactType: "tapcanvas.video-prompt/v1",
			rawText: JSON.stringify({
				artifactType: "tapcanvas.video-prompt/v1",
				text: "正文",
				note: "extra",
			}),
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_artifact output contains unexpected field note",
		});
	});

	it("parses and enforces exact collection item facts", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			expectedArrayLength: 2,
			itemRequiredStringFields: ["clipId", "text"],
			itemRequiredNumberFields: ["durationSeconds"],
			itemExactNumberFields: { durationSeconds: 15 },
			itemAllowedFields: ["clipId", "text", "durationSeconds"],
		});
		expect(contract).not.toBeNull();

		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.clip-plan/v1",
			rawText: JSON.stringify([
				{ clipId: "clip-001", text: "第一段", durationSeconds: 15 },
				{ clipId: "clip-002", text: "第二段", durationSeconds: 15 },
			]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: true,
			text: '[{"clipId":"clip-001","text":"第一段","durationSeconds":15},{"clipId":"clip-002","text":"第二段","durationSeconds":15}]',
		});
	});

	it("accepts an explicitly empty typed collection only when the caller freezes minimumArrayLength to zero", () => {
		const emptyContract = parseWorkflowAgentJsonArrayContract({
			minimumArrayLength: 0,
			itemRequiredStringFields: ["assetId"],
			itemAllowedFields: ["assetId"],
		});
		expect(emptyContract).toMatchObject({ minimumArrayLength: 0 });
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: "[]",
			jsonArrayContract: emptyContract,
		})).toEqual({ ok: true, text: "[]" });

		const nonEmptyContract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemAllowedFields: ["assetId"],
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: "[]",
			jsonArrayContract: nonEmptyContract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array output requires at least 1 item",
		});
	});

	it("requires declared non-empty array facts on every collection item", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemRequiredNonEmptyArrayFields: ["consumerClipIds"],
			itemAllowedFields: ["assetId", "consumerClipIds"],
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", consumerClipIds: ["clip-a"] }]),
			jsonArrayContract: contract,
		})).toMatchObject({ ok: true });
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", consumerClipIds: [] }]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 requires non-empty array field consumerClipIds",
		});
	});

	it("enforces the canonical asset role wire format before downstream fan-out", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId", "role"],
			itemStringFormats: { role: "asset-role-v1" },
			itemAllowedFields: ["assetId", "role"],
		});
		expect(contract).not.toBeNull();
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", role: "character://沈鸦" }]),
			jsonArrayContract: contract,
		})).toMatchObject({ ok: true });
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.asset-plans/v1",
			rawText: JSON.stringify([{ assetId: "hero", role: "沈鸦——黑束发" }]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 field role must use kind://canonical-name",
		});
	});

	it("rejects tool-argument strings, wrong item counts and mismatched numeric facts", () => {
		const contract = parseWorkflowAgentJsonArrayContract({
			expectedArrayLength: 2,
			itemRequiredStringFields: ["clipId", "text"],
			itemRequiredNumberFields: ["durationSeconds"],
			itemExactNumberFields: { durationSeconds: 15 },
			itemAllowedFields: ["clipId", "text", "durationSeconds"],
		});
		expect(contract).not.toBeNull();

		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.clip-plan/v1",
			rawText: '["{\\"skill\\":\\"tapcanvas-screenwriter\\"}","tool argument"]',
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 1 must be an object",
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.clip-plan/v1",
			rawText: '[{"clipId":"clip-001","text":"第一段","durationSeconds":15}]',
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array output requires exactly 2 items",
		});
		expect(validateWorkflowAgentOutput({
			encoding: "json_array",
			artifactType: "tapcanvas.clip-plan/v1",
			rawText: JSON.stringify([
				{ clipId: "clip-001", text: "第一段", durationSeconds: 15 },
				{ clipId: "clip-002", text: "第二段", durationSeconds: 8 },
			]),
			jsonArrayContract: contract,
		})).toEqual({
			ok: false,
			errorMessage: "Agent json_array item 2 has mismatched exact number field durationSeconds",
		});
	});

	it("rejects incoherent collection contracts before execution", () => {
		expect(parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["clipId"],
			itemExactNumberFields: { durationSeconds: 15 },
		})).toBeNull();
		expect(parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["clipId", "text"],
			itemAllowedFields: ["clipId"],
		})).toBeNull();
		expect(parseWorkflowAgentJsonArrayContract({
			itemRequiredStringFields: ["assetId"],
			itemStringFormats: { role: "asset-role-v1" },
		})).toBeNull();
	});
});

describe("Workflow Agent exact asset declaration contract", () => {
	it("parses the config shape and resolves the frozen identity set from the input port", async () => {
		const { resolvePlannedAssetIdsFromPort } = await import("./execution.agent-output-contract");
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredArrayFields: ["clips"],
			allowedFields: ["clips"],
			itemExactAssetIds: {
				declarationPaths: ["assets", "assetObjectContracts"],
				expectedAssetPlansFromPort: "clip-contexts",
			},
		});
		expect(contract).not.toBeNull();
		expect(resolvePlannedAssetIdsFromPort({
			"clip-contexts": [{
				beat: {},
				assetPlans: [
					{ assetId: "asset-char-sword" },
					{ assetId: "asset-scene-river" },
				],
			}],
		}, "clip-contexts")).toEqual(["asset-char-sword", "asset-scene-river"]);
		expect(() => resolvePlannedAssetIdsFromPort({}, "clip-contexts")).toThrow(/assetPlans/);
		expect(resolvePlannedAssetIdsFromPort({
			"clip-contexts": [{ executionScope: "media_delivery", assetPlans: [] }],
		}, "clip-contexts")).toEqual([]);
		expect(resolvePlannedAssetIdsFromPort({
			"clip-contexts": [{ executionScope: "prompt_only", assetPlans: [] }],
		}, "clip-contexts")).toEqual([]);
	});

	it("rejects contract shapes that mix exact asset ids with non-single array shape", () => {
		expect(parseWorkflowAgentJsonObjectContract({
			requiredArrayFields: ["clips", "extra"],
			allowedFields: ["clips", "extra"],
			itemExactAssetIds: {
				declarationPaths: ["assets"],
				expectedAssetPlansFromPort: "clip-contexts",
			},
		})).toBeNull();
		expect(parseWorkflowAgentJsonObjectContract({
			requiredArrayFields: ["clips"],
			allowedFields: ["clips"],
			itemExactAssetIds: {
				declarationPaths: [],
				expectedAssetPlansFromPort: "clip-contexts",
			},
		})).toBeNull();
	});

	it("validates delivered clip asset declarations against the frozen plan", () => {
		const contract = parseWorkflowAgentJsonObjectContract({
			requiredArrayFields: ["clips"],
			allowedFields: ["clips"],
		});
		expect(contract).not.toBeNull();
		const resolved = contract
			? { ...contract, itemExactAssetIds: { declarationPaths: ["assets", "assetObjectContracts"], expected: ["asset-char-sword", "asset-scene-river"] } }
			: null;
		expect(validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.clip-prompts/v2",
			rawText: JSON.stringify({ clips: [{ assets: [{ assetId: "asset-char-sword" }, { assetId: "asset-scene-river" }] }] }),
			jsonObjectContract: resolved,
		})).toMatchObject({ ok: true });
		const failed = validateWorkflowAgentOutput({
			encoding: "json_object",
			artifactType: "tapcanvas.clip-prompts/v2",
			rawText: JSON.stringify({ clips: [{ assets: [{ assetId: "asset-char-sword" }] }] }),
			jsonObjectContract: resolved,
		});
		expect(failed.ok).toBe(false);
		if (!failed.ok) expect(failed.errorMessage).toMatch(/asset-scene-river/);
	});
});
