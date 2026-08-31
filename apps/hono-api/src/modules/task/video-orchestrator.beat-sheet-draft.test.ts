import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore, redisGetMock, redisSetMock, redisMgetMock, redisEvalMock, redisMultiMock, redisExpireMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const setValue = (key: string, value: string): "OK" => {
    store.set(key, value);
    return "OK";
  };
  return {
    redisStore: store,
    redisGetMock: vi.fn(async (key: string) => store.get(key) ?? null),
    redisSetMock: vi.fn(async (key: string, value: string) => setValue(key, value)),
    redisMgetMock: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    redisExpireMock: vi.fn(async () => 1),
    redisEvalMock: vi.fn(async (script: string, _keyCount: number, ...args: string[]) => {
		if (script.includes("KEYS[2], ARGV[2]")) {
			const [key, repairKey, revision, repairJson] = args;
			const raw = key ? store.get(key) : null;
			if (!key || !repairKey || !raw) return 0;
			const draft = JSON.parse(raw) as Record<string, unknown>;
			if (draft.revision !== revision) return 0;
			store.set(repairKey, repairJson ?? "{}");
			return 1;
		}
		const [
			currentKey,
			currentHistoryKey,
			nextHistoryKey,
			revisionKey,
			_repairKey,
			observedRaw,
			observedRevision,
			nextRaw,
			nextRevision,
		] = args;
      const existing = store.get(currentKey) ?? "";
      if (existing !== observedRaw) return 0;
      if (existing && observedRevision) store.set(currentHistoryKey, existing);
      store.set(nextHistoryKey, nextRaw);
      store.set(currentKey, nextRaw);
      store.set(revisionKey, nextRevision);
      return 1;
    }),
    redisMultiMock: vi.fn(() => {
      const operations: Array<() => void> = [];
      const chain = {
        set(key: string, value: string) {
          operations.push(() => { store.set(key, value); });
          return chain;
        },
        del(key: string) {
          operations.push(() => { store.delete(key); });
          return chain;
        },
        async exec() {
          operations.forEach((operation) => operation());
          return [];
        },
      };
      return chain;
    }),
  };
});

vi.mock("../../platform/redis-shared", () => ({
  getSharedRedis: () => ({
    get: redisGetMock,
    set: redisSetMock,
    mget: redisMgetMock,
    eval: redisEvalMock,
    multi: redisMultiMock,
    expire: redisExpireMock,
  }),
}));

import {
  assembleBeatSheetDraft,
  assertBeatSheetDraftExecutionBinding,
  beginBeatSheetDraft as beginBoundBeatSheetDraft,
  putBeatSheetDraftBeat,
	readBeatSheetDraft,
  readBeatSheetDraftBeat,
	setBeatSheetDraftRepairActions,
} from "./video-orchestrator.beat-sheet-preflight";
import type { ParentAgentExecution } from "./agent-execution-provenance";
import {
  bindBeatSheetSourceAuthority,
  readBeatSheetSourceAuthority,
} from "./video-orchestrator.source-authority";

const TEST_EXECUTION_BINDING = {
  version: 1 as const,
  sessionId: "test-session",
  model: "deepseek-v4-flash",
  apiStyle: "chat" as const,
  initialExecutionId: "execution-initial",
};

const beginBeatSheetDraft = (
  input: Omit<Parameters<typeof beginBoundBeatSheetDraft>[0], "executionBinding">,
): ReturnType<typeof beginBoundBeatSheetDraft> => beginBoundBeatSheetDraft({
  ...input,
  executionBinding: TEST_EXECUTION_BINDING,
});

const parentExecution = (overrides: Partial<ParentAgentExecution> = {}): ParentAgentExecution => ({
  model: TEST_EXECUTION_BINDING.model,
  apiStyle: TEST_EXECUTION_BINDING.apiStyle,
  provenance: {
    version: 1,
    executionId: "execution-resumed",
    sessionId: TEST_EXECUTION_BINDING.sessionId,
    depth: 0,
    model: TEST_EXECUTION_BINDING.model,
    apiStyle: TEST_EXECUTION_BINDING.apiStyle,
    requiredSkills: [],
    loadedSkills: [],
    startedAt: "2026-08-12T00:00:00.000Z",
  },
  ...overrides,
});

describe("durable BeatSheet per-beat draft graph", () => {
  const header = (videoModel = "doubao-seedance-2.5"): Record<string, unknown> => ({
    version: 2,
    storyFactsContext: {
      mode: "task_context",
      sourceLabel: "test-task-context",
      bookId: null,
      ledgerRevision: null,
      effectiveAt: null,
      consumedFactIds: [],
      consumedContextKeys: [],
    },
    meta: { executionScope: "media_delivery", videoModel, deliveryScope: "full_chapter" },
  });
  const beat = (clipIndex: number, logline = `beat-${clipIndex}`): Record<string, unknown> => ({
    clipIndex,
    logline,
    durationBudget: 12,
    characterRoleNames: [],
    speakerNames: [],
    dialogueScript: [],
    propNames: [],
    vfxNames: [],
    videoReferenceNodeIds: [],
    sceneName: "测试场景",
    assetObjectContracts: [{
      kind: "scene",
      name: "测试场景",
      referenceImageNodeIds: [],
      referenceRole: "environment",
      forbiddenTransfer: "不迁移卡图构图",
      identityInvariant: "保持测试场景身份",
      startState: "场景进入态",
      spatialRelation: "人物位于场景中央",
      scale: "中景空间尺度",
      driver: "承载当前剧情动作",
      stateChange: "环境响应当前动作",
      endState: "场景退出态",
    }],
    continuityMode: "editorial_cut",
    pacingDecision: {
      sourceTreatment: "retain",
      essentialCausality: ["测试因果"],
      causalProvenance: [{ evidenceType: "necessary_physical_result", sourceMarker: "测试结果" }],
      handoffToNext: "测试交棒",
    },
    storyFactLocks: {
      effectiveAt: null,
      bindings: [],
      revealGuards: [],
    },
  });

  it("freezes one explicit source snapshot for the full durable run", async () => {
    const first = await bindBeatSheetSourceAuthority({
      ownerId: "owner-source",
      runId: "run-source",
      kind: "canvas_text_node",
      sourceId: "flow-1:text-1",
      text: "15 秒餐饮获客视频创作源",
    });
    const repeated = await bindBeatSheetSourceAuthority({
      ownerId: "owner-source",
      runId: "run-source",
      kind: "canvas_text_node",
      sourceId: "flow-1:text-1",
      text: "15 秒餐饮获客视频创作源",
    });

    expect(repeated).toEqual(first);
    await expect(readBeatSheetSourceAuthority("owner-source", "run-source"))
      .resolves.toEqual(first);
    await expect(bindBeatSheetSourceAuthority({
      ownerId: "owner-source",
      runId: "run-source",
      kind: "canvas_text_node",
      sourceId: "flow-1:text-2",
      text: "另一份来源",
    })).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
      message: expect.stringContaining("禁止在续跑中切换来源"),
    });
  });

  it("binds mutations to the logical session/model/api style while allowing a resumed physical execution", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-binding",
      runId: "run-binding",
      expectedBeatCount: 1,
      header: header(),
    });

    expect(() => assertBeatSheetDraftExecutionBinding(draft, parentExecution())).not.toThrow();
    expect(() => assertBeatSheetDraftExecutionBinding(draft, parentExecution({
      model: "another-model",
      provenance: {
        ...parentExecution().provenance!,
        model: "another-model",
      },
    }))).toThrow(/执行身份不匹配/);
  });

  it("rejects durable drafts without an execution binding after the hard cutover", async () => {
    await beginBeatSheetDraft({
      ownerId: "owner-unbound",
      runId: "run-unbound",
      expectedBeatCount: 1,
      header: header(),
    });
    const key = "video:beat-sheet-draft:v1:owner-unbound:run-unbound";
    const stored = JSON.parse(redisStore.get(key) ?? "{}") as Record<string, unknown>;
    delete stored.executionBinding;
    redisStore.set(key, JSON.stringify(stored));

    await expect(readBeatSheetDraft("owner-unbound", "run-unbound")).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
    });
  });

  it("distinguishes an absent draft from a missing beat or committed preflight", async () => {
    await expect(readBeatSheetDraft("owner-absent", "run-absent")).rejects.toMatchObject({
      code: "beat_sheet_draft_not_found",
    });
  });

	it("persists the deterministic repair frontier without rewriting the business draft", async () => {
		const first = await beginBeatSheetDraft({
			ownerId: "owner-repair",
			runId: "run-repair",
			expectedBeatCount: 2,
			header: header(),
		});
		await setBeatSheetDraftRepairActions({
			ownerId: "owner-repair",
			runId: "run-repair",
			revision: first.revision,
			repairActions: ["preflight_get_header", "preflight_begin", "preflight_commit"],
			repairIssues: ["beats[1].sceneName 必填"],
			repairClipIndexes: [1],
		});
		const repairDraft = await readBeatSheetDraft("owner-repair", "run-repair");
		expect(repairDraft.repairActions).toEqual([
			"preflight_get_header",
			"preflight_begin",
			"preflight_commit",
		]);
		expect(repairDraft.repairIssues).toEqual(["beats[1].sceneName 必填"]);
		expect(repairDraft.repairClipIndexes).toEqual([1]);
		expect(repairDraft.header.storyFactsContext).toMatchObject({
			consumedFactIds: [],
			consumedContextKeys: [],
		});

		const replaced = await beginBeatSheetDraft({
			ownerId: "owner-repair",
			runId: "run-repair",
			expectedBeatCount: 3,
			header: header("doubao-seedance-2.5-revised"),
			replaceRevision: first.revision,
		});
		expect(replaced.repairActions).toEqual([]);
		expect(replaced.repairIssues).toEqual([]);
		expect(replaced.repairClipIndexes).toEqual([]);
		expect((await readBeatSheetDraft("owner-repair", "run-repair")).repairActions).toEqual(replaced.repairActions);
	});

	it("invalidates repair evidence produced by an older validation contract", async () => {
		const draft = await beginBeatSheetDraft({
			ownerId: "owner-stale-repair",
			runId: "run-stale-repair",
			expectedBeatCount: 1,
			header: header(),
		});
		const repairKey = [...redisStore.keys()].find((candidate) => candidate.endsWith("run-stale-repair:repair"));
		expect(repairKey).toBeUndefined();
		const draftKey = [...redisStore.keys()].find((candidate) => candidate.endsWith("run-stale-repair"));
		expect(draftKey).toBeTruthy();
		redisStore.set(`${draftKey}:repair`, JSON.stringify({
			revision: draft.revision,
			repairContractVersion: draft.repairContractVersion - 1,
			repairActions: ["preflight_patch_beat"],
			repairIssues: ["obsolete issue"],
			repairClipIndexes: [0],
			repairHeader: true,
		}));

		const restored = await readBeatSheetDraft("owner-stale-repair", "run-stale-repair");
		expect(restored.repairActions).toEqual([]);
		expect(restored.repairIssues).toEqual([]);
		expect(restored.repairClipIndexes).toEqual([]);
		expect(restored.repairHeader).toBe(false);
	});

	it("keeps the validation repair frontier across partial beat mutations", async () => {
		const draft = await beginBeatSheetDraft({
			ownerId: "owner-mutated-repair",
			runId: "run-mutated-repair",
			expectedBeatCount: 1,
			header: header(),
		});
		const initial = await putBeatSheetDraftBeat({
			ownerId: "owner-mutated-repair",
			runId: "run-mutated-repair",
			revision: draft.revision,
			beat: beat(0, "before repair"),
		});
		await setBeatSheetDraftRepairActions({
			ownerId: "owner-mutated-repair",
			runId: "run-mutated-repair",
			revision: draft.revision,
			repairActions: ["preflight_patch_beat"],
			repairIssues: ["beats[0].durationBudget invalid"],
			repairClipIndexes: [0],
		});

		const replaced = await putBeatSheetDraftBeat({
			ownerId: "owner-mutated-repair",
			runId: "run-mutated-repair",
			revision: draft.revision,
			replaceBeatRevision: initial.beatRevision,
			beat: beat(0, "after repair"),
		});

		expect(replaced.draft.repairActions).toEqual(["preflight_patch_beat"]);
		expect(replaced.draft.repairIssues).toEqual(["beats[0].durationBudget invalid"]);
		expect(replaced.draft.repairClipIndexes).toEqual([0]);
		await expect(readBeatSheetDraft("owner-mutated-repair", "run-mutated-repair"))
			.resolves.toMatchObject({
				repairActions: ["preflight_patch_beat"],
				repairIssues: ["beats[0].durationBudget invalid"],
				repairClipIndexes: [0],
				repairHeader: false,
			});
	});

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
  });

  it("stores the header without beats and assembles independently written beats in clip order", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-1",
      runId: "run-1",
      expectedBeatCount: 2,
      header: {
        ...header(),
        runId: "untrusted-run",
        beats: [{ clipIndex: 99 }],
      },
    });

    expect(draft.header).not.toHaveProperty("beats");
    expect(draft.header.runId).toBe("run-1");

    await Promise.all([
      putBeatSheetDraftBeat({
        ownerId: "owner-1",
        runId: "run-1",
        revision: draft.revision,
        beat: beat(1, "second"),
      }),
      putBeatSheetDraftBeat({
        ownerId: "owner-1",
        runId: "run-1",
        revision: draft.revision,
        beat: beat(0, "first"),
      }),
    ]);

    const assembled = await assembleBeatSheetDraft({
      ownerId: "owner-1",
      runId: "run-1",
      revision: draft.revision,
    });

    expect(assembled.missingClipIndexes).toEqual([]);
    expect(assembled.beatSheet?.beats).toEqual([beat(0, "first"), beat(1, "second")]);
  });

  it("returns exact missing clip indexes without inventing nodes", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-2",
      runId: "run-2",
      expectedBeatCount: 3,
      header: header(),
    });
    await putBeatSheetDraftBeat({
      ownerId: "owner-2",
      runId: "run-2",
      revision: draft.revision,
      beat: beat(1),
    });

    const assembled = await assembleBeatSheetDraft({
      ownerId: "owner-2",
      runId: "run-2",
      revision: draft.revision,
    });

    expect(assembled.beatSheet).toBeNull();
    expect(assembled.missingClipIndexes).toEqual([0, 2]);
  });

  it("returns an identical begin idempotently and fences a changed header", async () => {
    const first = await beginBeatSheetDraft({
      ownerId: "owner-3",
      runId: "run-3",
      expectedBeatCount: 1,
      header: header("model-a"),
    });
    const repeated = await beginBeatSheetDraft({
      ownerId: "owner-3",
      runId: "run-3",
      expectedBeatCount: 1,
      header: header("model-a"),
    });
    expect(repeated.revision).toBe(first.revision);

    await expect(beginBeatSheetDraft({
      ownerId: "owner-3",
      runId: "run-3",
      expectedBeatCount: 1,
      header: header("model-b"),
    })).rejects.toMatchObject({ code: "beat_sheet_preflight_invalid" });
  });

  it("allows an explicit revision-fenced header replacement and invalidates old beat writes", async () => {
    const first = await beginBeatSheetDraft({
      ownerId: "owner-4",
      runId: "run-4",
      expectedBeatCount: 1,
      header: header("model-a"),
    });
    await putBeatSheetDraftBeat({
      ownerId: "owner-4",
      runId: "run-4",
      revision: first.revision,
      beat: beat(0, "preserved-across-header-revision"),
    });
    const replacement = await beginBeatSheetDraft({
      ownerId: "owner-4",
      runId: "run-4",
      expectedBeatCount: 1,
      header: header("model-b"),
      replaceRevision: first.revision,
    });
    expect(replacement.revision).not.toBe(first.revision);

    const assembledReplacement = await assembleBeatSheetDraft({
      ownerId: "owner-4",
      runId: "run-4",
      revision: replacement.revision,
    });
    expect(assembledReplacement.beatSheet?.beats).toEqual([
      beat(0, "preserved-across-header-revision"),
    ]);

    const historical = await readBeatSheetDraftBeat({
      ownerId: "owner-4",
      runId: "run-4",
      revision: replacement.revision,
      sourceRevision: first.revision,
      clipIndex: 0,
    });
    expect(historical.current).toBe(false);
    expect(historical.beat).toEqual(beat(0, "preserved-across-header-revision"));

    await expect(putBeatSheetDraftBeat({
      ownerId: "owner-4",
      runId: "run-4",
      revision: first.revision,
      beat: beat(0),
    })).rejects.toMatchObject({ code: "beat_sheet_preflight_invalid" });
  });

  it("requires a beat revision fence before replacing a node and keeps immutable history", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-5",
      runId: "run-5",
      expectedBeatCount: 1,
      header: header(),
    });
    const first = await putBeatSheetDraftBeat({
      ownerId: "owner-5",
      runId: "run-5",
      revision: draft.revision,
      beat: beat(0, "source-grounded"),
    });

    await expect(putBeatSheetDraftBeat({
      ownerId: "owner-5",
      runId: "run-5",
      revision: draft.revision,
      beat: beat(0, "blind replacement"),
    })).rejects.toMatchObject({ code: "beat_sheet_preflight_invalid" });

    const current = await readBeatSheetDraftBeat({
      ownerId: "owner-5",
      runId: "run-5",
      revision: draft.revision,
      clipIndex: 0,
    });
    expect(current.beat).toEqual(beat(0, "source-grounded"));
    expect(current.beatRevision).toBe(first.beatRevision);

    const replacement = await putBeatSheetDraftBeat({
      ownerId: "owner-5",
      runId: "run-5",
      revision: draft.revision,
      replaceBeatRevision: current.beatRevision,
      beat: beat(0, "grounded repair"),
    });
    expect(replacement.beatRevision).not.toBe(first.beatRevision);

    const historical = await readBeatSheetDraftBeat({
      ownerId: "owner-5",
      runId: "run-5",
      revision: draft.revision,
      clipIndex: 0,
      beatRevision: first.beatRevision,
    });
    expect(historical.current).toBe(false);
    expect(historical.beat).toEqual(beat(0, "source-grounded"));
  });

  it("rejects an incomplete beat before it can poison the durable graph", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-6",
      runId: "run-6",
      expectedBeatCount: 1,
      header: header(),
    });

    await expect(putBeatSheetDraftBeat({
      ownerId: "owner-6",
      runId: "run-6",
      revision: draft.revision,
      beat: { clipIndex: 0, logline: "uses clip fields instead of beat fields", durationSeconds: 12 },
    })).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
      message: expect.stringContaining("durationBudget"),
    });

    const assembled = await assembleBeatSheetDraft({
      ownerId: "owner-6",
      runId: "run-6",
      revision: draft.revision,
    });
    expect(assembled.missingClipIndexes).toEqual([0]);
  });

  it("persists a minimal executable beat without creative metadata", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-source-treatment",
      runId: "run-source-treatment",
      expectedBeatCount: 1,
      header: header(),
    });
    const incompleteBeat = beat(0);
    delete incompleteBeat.pacingDecision;

    const receipt = await putBeatSheetDraftBeat({
      ownerId: "owner-source-treatment",
      runId: "run-source-treatment",
      revision: draft.revision,
      beat: incompleteBeat,
    });
    expect(receipt.clipIndex).toBe(0);
    const persisted = await readBeatSheetDraftBeat({
      ownerId: "owner-source-treatment",
      runId: "run-source-treatment",
      revision: draft.revision,
      clipIndex: 0,
    });
    expect(persisted.beat).not.toHaveProperty("pacingDecision");
  });

  it("rejects commit-only structural errors at the individual beat write boundary", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-structural",
      runId: "run-structural",
      expectedBeatCount: 1,
      header: header(),
    });

    await expect(putBeatSheetDraftBeat({
      ownerId: "owner-structural",
      runId: "run-structural",
      revision: draft.revision,
      beat: {
        ...beat(0),
        speakerNames: ["沈知夏"],
        dialogueScript: [{ lineId: "", speakerName: "沈知夏", text: "不离婚了", delivery: "on_screen" }],
        storyFactLocks: { effectiveAt: "now", bindings: {}, revealGuards: {} },
      },
    })).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
      message: expect.stringMatching(/dialogueScript.*lineId.*非空字符串.*effectiveAt.*null.*bindings.*数组.*revealGuards.*数组/),
    });

    const assembled = await assembleBeatSheetDraft({
      ownerId: "owner-structural",
      runId: "run-structural",
      revision: draft.revision,
    });
    expect(assembled.missingClipIndexes).toEqual([0]);
  });

  it("rejects asset-object and provider-duration errors before persisting an individual beat", async () => {
    const draft = await beginBeatSheetDraft({
      ownerId: "owner-node-contract",
      runId: "run-node-contract",
      expectedBeatCount: 1,
      header: header(),
    });

    await expect(putBeatSheetDraftBeat({
      ownerId: "owner-node-contract",
      runId: "run-node-contract",
      revision: draft.revision,
      beat: {
        ...beat(0),
        durationBudget: 11,
        sceneName: "军属宿舍",
        assetObjectContracts: [{
          assetKey: "scene:军属宿舍",
          driver: "承载剧情",
          endState: "剧情结束",
        }],
      },
      generationContract: {
        videoModel: "model-a",
        durationOptions: [10, 12],
        maxDurationSeconds: 12,
        referenceImagePolicy: {
          countUnit: "unique_url",
          maximumTotalImages: 30,
          maximumBusinessImages: 30,
        },
        referenceAudioPolicy: {
          minimumDurationSeconds: 1.8,
          maximumDurationSeconds: 30,
        },
      },
    })).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
      message: expect.stringMatching(/durationBudget.*10\/12.*assetKey.*不是允许字段.*sceneName 必填/),
    });

    const assembled = await assembleBeatSheetDraft({
      ownerId: "owner-node-contract",
      runId: "run-node-contract",
      revision: draft.revision,
    });
    expect(assembled.missingClipIndexes).toEqual([0]);
  });

  it("rejects an invalid header before it can replace the durable graph", async () => {
    const first = await beginBeatSheetDraft({
      ownerId: "owner-7",
      runId: "run-7",
      expectedBeatCount: 1,
      header: header(),
    });

    await expect(beginBeatSheetDraft({
      ownerId: "owner-7",
      runId: "run-7",
      expectedBeatCount: 1,
      replaceRevision: first.revision,
      header: {
        ...header(),
        storyFactsContext: {
          mode: "task_context",
          bookTitle: "forbidden legacy field",
        },
      },
    })).rejects.toMatchObject({
      code: "beat_sheet_preflight_invalid",
      message: expect.stringContaining("storyFactsContext.bookTitle 不允许字段"),
    });

    const stored = JSON.parse(
      redisStore.get("video:beat-sheet-draft:v1:owner-7:run-7") ?? "{}",
    ) as { revision?: string };
    expect(stored.revision).toBe(first.revision);
  });
});
