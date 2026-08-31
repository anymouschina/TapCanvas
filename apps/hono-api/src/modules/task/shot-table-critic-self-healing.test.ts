import { describe, expect, it } from "vitest";

import {
  evaluateShotTableCriticWithSelfHealing,
  type ShotTableCriticInvocation,
} from "./shot-table-critic-self-healing";
import {
  parseShotTableCriticOutput,
  SHOT_TABLE_CRITIC_DIMENSIONS,
} from "./shot-table-critic-output";

function completeVerdict(): Record<string, unknown> {
  return {
    pass: true,
    score: 100,
    dims: Object.fromEntries(
      SHOT_TABLE_CRITIC_DIMENSIONS.map((dimension) => [dimension, "ok"]),
    ),
    issues: [],
    topFixes: [],
    affectedClipIndexes: [],
  };
}

describe("shot-table critic balanced JSON extraction", () => {
  it("finds a complete verdict among prose and unrelated JSON objects", () => {
    const verdict = completeVerdict();
    const raw = [
      "分析摘要 {\"trace\":{\"note\":\"brace } inside a string\"}}",
      JSON.stringify(verdict),
      "尾部诊断 {\"usage\":12}",
    ].join("\n");

    const parsed = parseShotTableCriticOutput(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.verdict).toEqual(verdict);
    expect(parsed.candidateCount).toBeGreaterThan(1);
  });

  it("returns structural failure facts without copying raw model text", () => {
    const marker = "sensitive-invalid-output-marker";
    const parsed = parseShotTableCriticOutput(`{\"pass\":true,\"note\":\"${marker}\"}`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.diagnostic.failureReason).toBe("critic_schema_invalid");
    expect(parsed.diagnostic.missingCriteria).toContain("score:number");
    expect(JSON.stringify(parsed.diagnostic)).not.toContain(marker);
  });
});

describe("shot-table critic same-model self-healing", () => {
  const execution = { model: "deepseek-v4-flash", apiStyle: "chat" as const };

  it("repairs one invalid response using the exact inherited model and apiStyle", async () => {
    const invocations: ShotTableCriticInvocation[] = [];
    const result = await evaluateShotTableCriticWithSelfHealing({
      rubric: "critic rubric",
      userMessage: "review this final shot table",
      execution,
      invoke: async (invocation) => {
        invocations.push(invocation);
        return invocation.attempt === 1
          ? '{"pass":true,"score":100,"dims":{"blocking":"ok"}}'
          : JSON.stringify(completeVerdict());
      },
    });

    expect(result.verdict).not.toBeNull();
    expect(result.attemptsUsed).toBe(2);
    expect(result.repaired).toBe(true);
    expect(invocations).toHaveLength(2);
    expect(invocations.map(({ model, apiStyle }) => ({ model, apiStyle }))).toEqual([
      execution,
      execution,
    ]);
    expect(invocations[1]?.phase).toBe("same_model_structure_repair");
    expect(invocations[1]?.system).toContain("<runtime_critic_self_repair>");
    expect(invocations[1]?.system).toContain("critic_schema_invalid");
    expect(invocations[1]?.system).toContain("dims.missing:");
  });

  it("uses one bounded same-model retry after an upstream request failure", async () => {
    const invocations: ShotTableCriticInvocation[] = [];
    const result = await evaluateShotTableCriticWithSelfHealing({
      rubric: "critic rubric",
      userMessage: "review this final shot table",
      execution,
      invoke: async (invocation) => {
        invocations.push(invocation);
        if (invocation.attempt === 1) throw new Error("relay failed: 502");
        return JSON.stringify(completeVerdict());
      },
    });

    expect(result.verdict).not.toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.diagnostics[0]).toMatchObject({
      failureReason: "critic_upstream_request_failed",
      model: execution.model,
      apiStyle: execution.apiStyle,
    });
    expect(invocations.map((invocation) => invocation.model)).toEqual([
      execution.model,
      execution.model,
    ]);
  });

  it("stops after exactly two attempts and keeps only sanitized diagnostics", async () => {
    const marker = "raw-output-must-not-enter-diagnostics";
    let invocationCount = 0;
    const result = await evaluateShotTableCriticWithSelfHealing({
      rubric: "critic rubric",
      userMessage: "review this final shot table",
      execution,
      invoke: async () => {
        invocationCount += 1;
        return `{\"note\":\"${marker}\"}`;
      },
    });

    expect(result.verdict).toBeNull();
    expect(result.attemptsUsed).toBe(2);
    expect(result.repaired).toBe(false);
    expect(invocationCount).toBe(2);
    expect(result.diagnostics).toHaveLength(2);
    expect(JSON.stringify(result.diagnostics)).not.toContain(marker);
  });
});
