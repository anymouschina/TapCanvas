/**
 * 视频生成「同步 vs 异步返回」策略（纯函数）。
 *
 * 根因修复（Q1）：raw `tapcanvas_video_generate_to_canvas` 旧默认走同步长等（awaitVideoResult
 * 最长 600s）。agents-cli↔hono 的长连在这期间被掐断 → 客户端抛 `fetch failed`，而服务端任务其实
 * 已提交并跑到 success。小T 收到「假失败」后又重试，造成重复 orphan 任务。
 *
 * 解法：只要拿到真实 taskId 就【提交即返回】(async)，成片由 reconcile / 后台 orphan recovery
 * 查询并回写。章节画布与普通 flow 都具备 taskId 节点回收通道，不允许调用参数重新启用同步长等。
 * 没有 taskId 时才进入 inline 结果收口；此时不存在可供后台查询的异步任务。
 */
export function shouldReturnVideoAsync(input: {
  billingTaskId?: string;
}): boolean {
  const billingTaskId = typeof input.billingTaskId === "string" ? input.billingTaskId.trim() : "";
  return Boolean(billingTaskId);
}
