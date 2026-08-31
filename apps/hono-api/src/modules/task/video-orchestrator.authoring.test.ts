import { describe, expect, it } from "vitest";

import {
  applyParentAgentExecution,
  buildBeatVideoReferenceNodeIds,
  orchestrateVideoCommitBeats,
  readyClipArtifactSeedMatches,
  resolveCommitBeatSheetValidationPhase,
  selectAuthoritativeAdaptationContract,
  validateBeatSheetCommitTarget,
} from "./video-orchestrator.authoring";
import { mergeFilmSpecAuthority } from "./video-orchestrator.authoring.repo";
import { buildBeatSheetPreflightFingerprint } from "./video-orchestrator.beat-sheet-preflight";

const PARENT_PROVENANCE = {
  version: 1 as const,
  executionId: "parent-execution-1",
  depth: 0,
  model: "gpt-5.6-sol",
  apiStyle: "responses" as const,
  requiredSkills: ["tapcanvas-video-workflow"],
  loadedSkills: ["tapcanvas-video-workflow"],
  startedAt: "2026-07-23T00:00:00.000Z",
};

describe("applyParentAgentExecution（模型继承由运行时事实注入）", () => {
  it("覆盖 BeatSheet 自报的错误模型与 openai-responses 别名", () => {
    const sheet: Record<string, unknown> = {
      meta: {
        agentModel: "gpt-5.4",
        agentApiStyle: "openai-responses",
        aspect: "16:9",
      },
    };

    const warnings = applyParentAgentExecution(sheet, {
      model: "gpt-5.6-sol",
      apiStyle: "responses",
      provenance: PARENT_PROVENANCE,
    });

    expect(sheet.meta).toEqual({
      agentModel: "gpt-5.6-sol",
      agentApiStyle: "responses",
      aspect: "16:9",
      parentExecutionProvenance: PARENT_PROVENANCE,
    });
    expect(warnings).toHaveLength(2);
  });

  it("BeatSheet 未声明 meta 时也写入父代理真实执行配置", () => {
    const sheet: Record<string, unknown> = {};
    expect(
      applyParentAgentExecution(sheet, {
        model: "claude-opus-4-8",
        apiStyle: "chat",
      }),
    ).toEqual([]);
    expect(sheet.meta).toEqual({
      agentModel: "claude-opus-4-8",
      agentApiStyle: "chat",
    });
  });

  it("commit_beats 缺父代理执行事实时在数据库访问前显式拒绝", async () => {
    await expect(
      orchestrateVideoCommitBeats({
        bodyArgs: {
          runId: "chapter-29-v3",
          beatSheet: { runId: "chapter-29-v3" },
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        code: "parent_agent_provenance_required",
        runId: "chapter-29-v3",
      }),
    );
  });

  it("commit_beats 拒绝与外层 model 不一致的 provenance", async () => {
    const result = await orchestrateVideoCommitBeats({
      bodyArgs: {
        runId: "chapter-29-v4",
        beatSheet: { runId: "chapter-29-v4" },
      },
      parentAgentExecution: {
        model: "gpt-5.4",
        apiStyle: "responses",
        provenance: PARENT_PROVENANCE,
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "parent_agent_provenance_required",
      runId: "chapter-29-v4",
    }));
  });
});

describe("commit_beats 单一输入合同", () => {
  it("缺少显式 Keyframe BeatSheet v2 时终止，不读取持久化旧版", async () => {
    const result = await orchestrateVideoCommitBeats({
      bodyArgs: {
        runId: "chapter-30-v1",
        reuseStoredBeatSheet: true,
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      code: "beat_sheet_required",
    }));
    expect(result).not.toHaveProperty("recovery");
  });
});

describe("commit_beats 阶段边界", () => {
  it("只有已经验真的冻结 preflight 才按规划合同建立资产 DAG", () => {
    expect(resolveCommitBeatSheetValidationPhase({ verifiedFrozenPreflight: true })).toBe("planning");
    expect(resolveCommitBeatSheetValidationPhase({ verifiedFrozenPreflight: false })).toBe("execution");
  });

  it("父代理物理窗口变化不改变冻结创作合同指纹", () => {
    const first = {
      runId: "run-1",
      meta: {
        videoModel: "doubao-seedance-2.5",
        agentModel: "deepseek-v4-flash",
        agentApiStyle: "chat",
        parentExecutionProvenance: {
          version: 1,
          executionId: "physical-run-1",
          startedAt: "2026-08-09T08:00:00.000Z",
        },
      },
      beats: [{ clipIndex: 0, logline: "原文事实镜头化" }],
    };
    const resumed = {
      ...first,
      meta: {
        ...first.meta,
        parentExecutionProvenance: {
          version: 1,
          executionId: "physical-run-2",
          startedAt: "2026-08-09T08:10:00.000Z",
        },
      },
    };

    expect(buildBeatSheetPreflightFingerprint(resumed)).toBe(
      buildBeatSheetPreflightFingerprint(first),
    );
  });
});

describe("readyClipArtifactSeedMatches", () => {
  const seed = {
    targetClipIndex: 2,
    sourceRunId: "source-run",
    sourceClipIndex: 2,
    contentHash: "output-hash",
    payload: JSON.stringify({
      clipIndex: 2,
      sourceHash: "source-hash",
      outputHash: "output-hash",
      clip: { clipIndex: 2, shots: [] },
    }),
  };

  it("只复用输入指纹、绝对镜号与输出哈希全部一致的 ready 工件", () => {
    expect(readyClipArtifactSeedMatches({
      seed,
      targetClipIndex: 2,
      targetSourceHash: "source-hash",
    })).toBe(true);
  });

  it("拒绝跨镜号或输入指纹漂移的工件", () => {
    expect(readyClipArtifactSeedMatches({
      seed,
      targetClipIndex: 3,
      targetSourceHash: "source-hash",
    })).toBe(false);
    expect(readyClipArtifactSeedMatches({
      seed,
      targetClipIndex: 2,
      targetSourceHash: "changed-source-hash",
    })).toBe(false);
  });
});

describe("buildBeatVideoReferenceNodeIds", () => {
  it("把所有已声明对象合同的真实资产带入视频任务，并与精选引用去重", () => {
    expect(buildBeatVideoReferenceNodeIds({
      videoReferenceNodeIds: ["character-core", "prop-core", "character-core"],
      assetObjectContracts: [
        { referenceImageNodeIds: ["character-core", "character-side"] },
        { referenceImageNodeIds: ["prop-core"] },
      ],
    })).toEqual(["character-core", "character-side", "prop-core"]);
  });

  it("只编译业务与对象合同引用，帧节点由独立连续性合同负责", () => {
    expect(buildBeatVideoReferenceNodeIds({
      videoReferenceNodeIds: ["character-core"],
      assetObjectContracts: [
        { referenceImageNodeIds: ["character-core", "environment-core"] },
      ],
    })).toEqual(["character-core", "environment-core"]);
  });
});

describe("mergeFilmSpecAuthority", () => {
	it("persists the explicit creative adaptation mode without changing generation preferences", () => {
		const meta: Record<string, unknown> = { videoModel: "model-a", aspect: "16:9", resolution: "480p" };
		expect(mergeFilmSpecAuthority(meta, { deliveryScope: "full_chapter", adaptationMode: "creative" })).toEqual([]);
		expect(meta).toEqual({
			videoModel: "model-a",
			aspect: "16:9",
			resolution: "480p",
			deliveryScope: "full_chapter",
			adaptationMode: "creative",
		});
	});

	it("章级交付范围不覆盖当前生成规格", () => {
    const meta: Record<string, unknown> = {
      videoModel: "doubao-seedance-2.5",
      aspect: "16:9",
      resolution: "480p",
      targetDurationSeconds: 30,
    };
    expect(mergeFilmSpecAuthority(meta, { deliveryScope: "full_chapter" })).toEqual([]);
    expect(meta).toEqual({
      videoModel: "doubao-seedance-2.5",
      aspect: "16:9",
      resolution: "480p",
      deliveryScope: "full_chapter",
    });
  });

  it("指定时长只覆盖交付范围和总时长", () => {
    const meta: Record<string, unknown> = { aspect: "16:9", resolution: "480p" };
    expect(mergeFilmSpecAuthority(meta, {
      deliveryScope: "opening_duration",
      targetDurationSeconds: 60,
    })).toEqual([]);
    expect(meta).toEqual({
      aspect: "16:9",
      resolution: "480p",
      deliveryScope: "opening_duration",
      targetDurationSeconds: 60,
    });
  });
});

describe("validateBeatSheetCommitTarget", () => {
  const collecting = {
    owner_id: "owner-1",
    project_id: "project-1",
    chapter_id: "chapter-1",
    flow_id: "flow-1",
    state: "collecting",
  };

  it("allows a new run or the same collecting run", () => {
    const input = {
      ownerId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      flowId: "flow-1",
      runId: "run-1",
    };
    expect(validateBeatSheetCommitTarget({ ...input, existing: null })).toBeNull();
    expect(validateBeatSheetCommitTarget({ ...input, existing: collecting })).toBeNull();
  });

  it.each(["scheduled", "video_running", "video_success", "failed", "cancelled"])(
    "rejects production state %s without clearing existing facts",
    (state) => {
      expect(
        validateBeatSheetCommitTarget({
          existing: { ...collecting, state },
          ownerId: "owner-1",
          projectId: "project-1",
          chapterId: "chapter-1",
          flowId: "flow-1",
          runId: "run-1",
        }),
      ).toEqual(expect.objectContaining({
        code: "run_production_state_locked",
        terminal: true,
      }));
    },
  );

  it("rejects completed and cross-scope runs explicitly", () => {
    expect(
      validateBeatSheetCommitTarget({
        existing: { ...collecting, state: "concatenated" },
        ownerId: "owner-1",
        runId: "run-1",
      }),
    ).toEqual(expect.objectContaining({ code: "run_already_completed", terminal: true }));
    expect(
      validateBeatSheetCommitTarget({
        existing: collecting,
        ownerId: "owner-2",
        runId: "run-1",
      }),
    ).toEqual(expect.objectContaining({ code: "run_scope_mismatch", terminal: true }));
  });
});

const CONTRACT = {
  reversals: [
    {
      plantClipIndex: 7,
      revealClipIndex: 8,
      desc: "镜7预埋骨片感应微弱无援→镜8揭晓捏碎第一枚骨片可求援后土本人",
    },
  ],
  cuts: [{ what: "殿内内心盘算独白", why: "凝练为VO" }],
  hook: "孟川攥紧后土第一枚骨片决意求援，接下一章",
};

describe("selectAuthoritativeAdaptationContract（完整 BeatSheet 原子合同）", () => {
  it("新版本完整替换旧合同，不把矛盾揭晓镜并集回当前版本", () => {
    const next = {
      reversals: [
        { plantClipIndex: 1, revealClipIndex: 2, desc: "全新反转" },
      ],
      cuts: [{ what: "新删减", why: "视觉承载" }],
      hook: "更强的钩子",
    };
    const selected = selectAuthoritativeAdaptationContract({ previous: CONTRACT, next });
    expect(selected.contract).toEqual(next);
    expect(selected.contract.reversals).toHaveLength(1);
    expect(selected.warnings).toEqual([]);
    expect(selected.status).toBe("replaced");
  });

  it("无既有合同时创建权威版本", () => {
    expect(selectAuthoritativeAdaptationContract({ previous: null, next: CONTRACT })).toEqual({
      contract: CONTRACT,
      warnings: [],
      status: "created",
    });
  });
});
