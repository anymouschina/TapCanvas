export type PaidRunIdResolution =
  | { ok: true; runId: string }
  | { ok: false; code: "run_id_conflict"; message: string };

/**
 * estimate/start 的 Run 身份只解析一次。顶层与内嵌 storyPlan/plan 同时声明且不一致时显式失败；
 * parentGroupId 的稳定化规则与最终 StoryPlan 完全一致。
 */
export function resolvePaidOperationRunId(
  args: Record<string, unknown>,
  planSource: unknown,
): PaidRunIdResolution {
  const topRunId = String(args.runId ?? "").trim();
  const nestedSource = args.storyPlan;
  const nestedRecord =
    nestedSource && typeof nestedSource === "object" && !Array.isArray(nestedSource)
      ? (nestedSource as Record<string, unknown>)
      : null;
  const planRecord =
    planSource && typeof planSource === "object" && !Array.isArray(planSource)
      ? (planSource as Record<string, unknown>)
      : null;
  const nestedRunId = String(nestedRecord?.runId ?? "").trim();
  if (topRunId && nestedRunId && topRunId !== nestedRunId) {
    return {
      ok: false,
      code: "run_id_conflict",
      message: `顶层 runId=${topRunId} 与 storyPlan.runId=${nestedRunId} 不一致，禁止对一个 Run 验闸后启动另一个 Run。`,
    };
  }
  const parentGroupId = String(planRecord?.parentGroupId ?? "").trim();
  const explicitRunId = nestedRunId || topRunId || String(planRecord?.runId ?? "").trim();
  return {
    ok: true,
    runId: parentGroupId ? `video-run-${parentGroupId}`.slice(0, 120) : explicitRunId,
  };
}
