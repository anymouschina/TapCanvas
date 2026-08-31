import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orchestrateVideoResumePreSubmit: vi.fn(),
}));

vi.mock("./video-orchestrator.pre-submit-resume", () => ({
  orchestrateVideoResumePreSubmit: mocks.orchestrateVideoResumePreSubmit,
}));

import { resumeVideoRunAsynchronously } from "./video-orchestrator.resume-sync";

function input() {
  return {
    c: {} as Parameters<typeof resumeVideoRunAsynchronously>[0]["c"],
    requestUserId: "owner-1",
    flowId: "flow-1",
    chapterId: "chapter-1",
    bodyArgs: { runId: "run-1" },
  };
}

describe("resumeVideoRunAsynchronously", () => {
  beforeEach(() => mocks.orchestrateVideoResumePreSubmit.mockReset());

  it("preserves a deterministic recovery rejection", async () => {
    mocks.orchestrateVideoResumePreSubmit.mockResolvedValue({
      ok: false,
      code: "resume_not_safe",
    });
    await expect(resumeVideoRunAsynchronously(input())).resolves.toEqual({
      ok: false,
      code: "resume_not_safe",
    });
  });

  it("fails explicitly when the recovered run identity is missing", async () => {
    mocks.orchestrateVideoResumePreSubmit.mockResolvedValue({ ok: true });
    await expect(resumeVideoRunAsynchronously(input())).resolves.toMatchObject({
      ok: false,
      terminal: true,
      code: "video_resume_run_id_missing",
    });
  });

  it("returns accepted async without request-bound polling", async () => {
    mocks.orchestrateVideoResumePreSubmit.mockResolvedValue({
      ok: true,
      runId: "run-1",
      state: "scheduled",
    });
    const result = await resumeVideoRunAsynchronously(input());
    expect(result).toMatchObject({
      ok: true,
      code: "video_resume_accepted_async",
      terminal: false,
      runTerminal: false,
      acceptedAsync: true,
      shouldYield: true,
      turnComplete: true,
      runId: "run-1",
      waitingFor: "video_run_evidence",
    });
    expect(result).not.toHaveProperty("synchronous");
  });
});
