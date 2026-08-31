import type { AppContext } from "../../types";
import { orchestrateVideoResumePreSubmit } from "./video-orchestrator.pre-submit-resume";

function readRunId(result: Record<string, unknown>): string {
  return typeof result.runId === "string" ? result.runId.trim() : "";
}

/**
 * Reset a structurally verified pre-submit failure and return the stable run
 * identity immediately. The durable production worker owns all later retries
 * and evidence collection.
 */
export async function resumeVideoRunAsynchronously(input: {
  c: AppContext;
  requestUserId: string;
  flowId: string;
  chapterId?: string;
  bodyArgs: unknown;
}): Promise<Record<string, unknown>> {
  const resumeResult = await orchestrateVideoResumePreSubmit(input);
  if (resumeResult.ok !== true) return resumeResult;

  const runId = readRunId(resumeResult);
  if (!runId) {
    return {
      ...resumeResult,
      ok: false,
      mode: "resume_pre_submit",
      terminal: true,
      code: "video_resume_run_id_missing",
      message:
        "提交前恢复已写入，但结果缺少 runId，无法建立持久异步恢复身份，已明确失败。",
    };
  }
  return {
    ...resumeResult,
    ok: true,
    mode: "resume_pre_submit",
    code: "video_resume_accepted_async",
    terminal: false,
    runTerminal: false,
    acceptedAsync: true,
    shouldYield: true,
    turnComplete: true,
    runId,
    waitingFor: "video_run_evidence",
    message:
      "提交前失败证据已验真，同一 run 已恢复为可调度状态。" +
      "本请求按 waiting_for_evidence 收口，后台 worker 将保留已受理资产并继续幂等推进。",
  };
}
