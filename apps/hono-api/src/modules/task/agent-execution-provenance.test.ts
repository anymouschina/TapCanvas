import { describe, expect, it } from "vitest";

import {
  AgentExecutionProvenanceSchema,
  ParentAgentExecutionSchema,
} from "./agent-execution-provenance";

const CURRENT_PROVENANCE = {
  version: 1 as const,
  executionId: "execution-current-1",
  agentId: "root-agent",
  sessionId: "session-1",
  depth: 0,
  model: "gpt-5.6-sol",
  apiStyle: "responses" as const,
  requiredSkills: ["tapcanvas-video-workflow"],
  loadedSkills: ["tapcanvas-video-workflow"],
  loadedSkillSources: [{
    skill: "tapcanvas-video-workflow",
    name: "一键成片工作流",
    description: "从创作意图到真实视频交付的统一生产路径。",
    sourceKind: "skill" as const,
    source: "SKILL.md",
    contentHash: `sha256:${"b".repeat(64)}`,
    contentChars: 1200,
  }],
  loadedKnowledgeSources: [{
    cardId: "cinematic-lighting",
    title: "电影感布光.md",
    description: "电影感布光的核心方法。",
    domain: "视听语言演出",
    sourceUrls: [],
    contentHash: `sha256:${"a".repeat(64)}`,
    contentChars: 900,
  }],
  startedAt: "2026-08-04T06:19:31.000Z",
  userIntentContractHash: "intent-hash-1",
  intentSelectionTrace: [{
    candidateId: "tapcanvas-video-workflow",
    candidateKind: "skill" as const,
    selected: true,
    candidateSetId: "skills-1",
    recallSource: "skill_catalog" as const,
    rank: 1,
    score: 0.98,
    coversRequirementIds: ["fast-cuts"],
    conflictsRequirementIds: [],
    evidenceRefs: ["current-turn:user-request"],
    reason: "覆盖当前用户的疯切要求",
    at: "2026-08-04T06:19:32.000Z",
  }],
};

describe("agent execution provenance bridge contract", () => {
  it("accepts the current agents-cli provenance without retired knowledge evidence", () => {
    expect(ParentAgentExecutionSchema.parse({
      model: CURRENT_PROVENANCE.model,
      apiStyle: CURRENT_PROVENANCE.apiStyle,
      provenance: CURRENT_PROVENANCE,
    })).toEqual({
      model: CURRENT_PROVENANCE.model,
      apiStyle: CURRENT_PROVENANCE.apiStyle,
      provenance: CURRENT_PROVENANCE,
    });
  });

  it("rejects the retired knowledge projection instead of maintaining a second contract", () => {
    expect(AgentExecutionProvenanceSchema.safeParse({
      ...CURRENT_PROVENANCE,
      knowledge: {
        enabled: false,
      },
    }).success).toBe(false);
  });
});
