/**
 * 图片生成「同步 vs 异步返回」策略（纯函数）。镜像 video-return-policy.ts。
 *
 * 根因修复（A1）：raw `tapcanvas_image_generate_to_canvas` 提交后再同步 await(awaitImageResult
 * 最长 300s)。gpt-image-2 2K/4K 带参考图的重图 > 这个窗口 → 抛 504 `agents_tool_image_generate_timeout`，
 * 但上游任务其实仍在 running、后台 job 会落 task_results；节点写回在 await 之后 → **节点永远丢失**，
 * 整条编排在 generate_storyboard 步直接死（实测卡掉电商/复刻的导演故事板）。
 *
 * 解法：默认【提交即返回】(async)，写一个 status:"running" 占位节点，结果靠前端轮询 / reconcile 回写。只有：
 *  - 没有上游 taskId（无从轮询回写）→ 退回同步兜底（awaitImageResult 处理 inline-succeeded 或抛错）；
 *  - chapter 内嵌画布且服务端 sweep 被显式关闭 → 同步，避免永远停在 running；
 *  - 显式 waitForResult:true（少数确需 inline 拿到 URL 的调用）→ 同步。
 */
/**
 * 项目根/章节图片节点的后台 reconcile sweep 是否开启（IMAGE_NODE_RECONCILE_SWEEP，默认 ON）。
 * 放在本 leaf 文件，供 policy 决策与 image-orphan-recovery / handler 共用，避免循环依赖。
 */
export function isImageReconcileSweepEnabled(env: unknown): boolean {
  const raw = String(
    (env as Record<string, unknown>)?.IMAGE_NODE_RECONCILE_SWEEP ??
      globalThis.process?.env?.IMAGE_NODE_RECONCILE_SWEEP ??
      "",
  )
    .trim()
    .toLowerCase();
  // 默认开（2026-07-02）：未显式设置时按 ON——章节出图走异步占位（提交即返、写 status:"running"
  // 占位节点 + 后台 sweepRunningImageNodes 回收），消灭「章节出图同步阻塞最长 300s、画布无占位、
  // 对话工具长挂 running」的黑盒。异步回写闭环（前端 4s tick syncImageNodeOnce + finalizer sweep）
  // 与项目根 flow 早已默认走的路径完全一致，仅章节此前保守关闭。仅显式 0/false/off 才回旧同步行为。
  if (!raw) return true;
  return !(raw === "0" || raw === "false" || raw === "off");
}

export function shouldReturnImageAsync(input: {
  taskId?: string;
  chapterId?: string;
  /** 三态：true=强制同步；false=强制异步（调用方自带 reconcile，如 orchestrator）；undefined=默认策略。 */
  waitForResult?: boolean;
  /**
   * 章节画布是否已有后台 reconcile 兜底（IMAGE_NODE_RECONCILE_SWEEP）。
   * 开启后章节也能安全异步——running 节点会被 finalizer tick 的 sweepRunningImageNodes 回收，
   * 不再永远停在 running。默认 false（逐字等价旧行为：章节强制同步）。
   */
  chapterReconcileSweepEnabled?: boolean;
}): boolean {
  const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
  const chapterId = typeof input.chapterId === "string" ? input.chapterId.trim() : "";
  // 无上游 task_id → 无从轮询回写 → 退回同步。
  if (!taskId) return false;
  // 显式 waitForResult:false = 调用方自带对账闭环（orchestrator 的 await_storyboard_result 步），
  // 准许异步——含章节画布。这是治「同步长等把 drive tick 撑过僵尸阈值 + 超时后重复付费」的根：
  // 提交即返、taskId 钉在占位节点上，后续 tick 轮询同一任务，绝不重复提交。
  if (input.waitForResult === false) return true;
  // 章节内嵌画布：默认没有自动 reconcile 循环兜底，保持同步（避免节点永远停在 running）。
  // 但当 IMAGE_NODE_RECONCILE_SWEEP 已开启、有后台 sweep 兜底时，章节也准许异步（治长同步拖断对话）。
  if (chapterId && !input.chapterReconcileSweepEnabled) return false;
  // flows（或已有 sweep 兜底的章节）默认异步；仅当显式 waitForResult:true 才同步长等。
  return input.waitForResult !== true;
}
