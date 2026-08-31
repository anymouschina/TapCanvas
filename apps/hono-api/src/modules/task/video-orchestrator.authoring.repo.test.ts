import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunUpdateMany = vi.fn(async () => ({ count: 1 }));
const mockRunFindUnique = vi.fn(async (): Promise<Record<string, unknown> | null> => null);
const mockRunFindMany = vi.fn(async (_query: unknown): Promise<Array<Record<string, unknown>>> => []);
const mockRunCreate = vi.fn(async () => ({}));
const mockRunCreateMany = vi.fn(async () => ({ count: 1 }));
const mockArtifactUpsert = vi.fn(async () => ({}));
const mockArtifactFindMany = vi.fn(async (_query: unknown): Promise<Array<Record<string, unknown>>> => []);
const mockArtifactFindUnique = vi.fn(async (_query: unknown): Promise<Record<string, unknown> | null> => null);
const mockArtifactUpdateMany = vi.fn(async (_query: unknown): Promise<{ count: number }> => ({ count: 1 }));
const mockTaskStatusFindUnique = vi.fn(async (_query: unknown): Promise<Record<string, unknown> | null> => null);
const mockTaskStatusUpdateMany = vi.fn(async (_query: unknown): Promise<{ count: number }> => ({ count: 1 }));
const mockRunFindFirst = vi.fn(async (_query: unknown): Promise<Record<string, unknown> | null> => null);
const mockTransactionClient = {
	task_statuses: {
		findUnique: mockTaskStatusFindUnique,
		updateMany: mockTaskStatusUpdateMany,
	},
  video_runs: {
    findUnique: mockRunFindUnique,
	findFirst: mockRunFindFirst,
    updateMany: mockRunUpdateMany,
    create: mockRunCreate,
    createMany: mockRunCreateMany,
  },
  authoring_artifacts: {
    findUnique: mockArtifactFindUnique,
    updateMany: mockArtifactUpdateMany,
    upsert: mockArtifactUpsert,
  },
};
const mockTransaction = vi.fn(
  async (callback: (tx: typeof mockTransactionClient) => Promise<unknown>) =>
    await callback(mockTransactionClient),
);

vi.mock("../../platform/node/prisma", () => ({
  getPrismaClient: () => ({
    $transaction: mockTransaction,
    video_runs: {
      findUnique: mockRunFindUnique,
      findMany: mockRunFindMany,
      updateMany: mockRunUpdateMany,
      create: mockRunCreate,
      createMany: mockRunCreateMany,
    },
    authoring_artifacts: {
      findMany: mockArtifactFindMany,
      findUnique: mockArtifactFindUnique,
      updateMany: mockArtifactUpdateMany,
    },
  }),
}));

import {
  commitAuthoringClipContractRejection,
  commitAuthoringAssemblyVerification,
  commitBeatSheetGraphSnapshot,
  failAssetRepairRunAfterTerminalExecutor,
  settleClaimedAssetRepairContinuation,
  listActiveAuthoringRuns,
  markAuthoringArtifact,
  markAuthoringRunDriveAttempt,
  authorizeVideoSubmissionReplacement,
  resumeCancelledWriterAuthoringRun,
  resumeCollectingAssetRepairWaitRunWithFrontier,
  resumeCollectingWriterAuthoringRun,
  upsertBeatSheetRun,
} from "./video-orchestrator.authoring.repo";

beforeEach(() => {
  vi.clearAllMocks();
	mockRunFindUnique.mockReset().mockResolvedValue(null);
	mockRunFindFirst.mockReset().mockResolvedValue(null);
	mockRunFindMany.mockReset().mockResolvedValue([]);
	mockArtifactFindMany.mockReset().mockResolvedValue([]);
	mockArtifactFindUnique.mockReset().mockResolvedValue(null);
	mockArtifactUpdateMany.mockReset().mockResolvedValue({ count: 1 });
	mockTaskStatusFindUnique.mockReset().mockResolvedValue(null);
	mockTaskStatusUpdateMany.mockReset().mockResolvedValue({ count: 1 });
	mockRunUpdateMany.mockReset().mockResolvedValue({ count: 1 });
	mockRunCreateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("commitBeatSheetGraphSnapshot transaction boundary", () => {
  it("commits the run, manifest and dynamic nodes through one database transaction", async () => {
    mockRunFindUnique.mockResolvedValueOnce({
      owner_id: "owner-1",
      state: "collecting",
      authoring_state: null,
      beat_sheet: null,
    });

    await expect(commitBeatSheetGraphSnapshot({
      run: {
        runId: "run-graph",
        ownerId: "owner-1",
        beatSheetJson: "{\"version\":2}",
        nowIso: "2026-08-08T00:00:00.000Z",
      },
      artifacts: [
        {
          runId: "run-graph",
          artifactKey: "graph:manifest",
          contentHash: "manifest-hash",
          status: "ready",
          payload: "{}",
          nowIso: "2026-08-08T00:00:00.000Z",
        },
        {
          runId: "run-graph",
          artifactKey: "clip:0",
          contentHash: "clip-hash",
          status: "pending",
          nowIso: "2026-08-08T00:00:00.000Z",
        },
      ],
    })).resolves.toBe("replaced");

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockRunUpdateMany).toHaveBeenCalledOnce();
    expect(mockArtifactUpsert).toHaveBeenCalledTimes(2);
  });
});

describe("markAuthoringArtifact lifecycle CAS", () => {
  it("claims a pending artifact before remote writer dispatch", async () => {
    await expect(markAuthoringArtifact({
      runId: "run-claim",
      artifactKey: "clip:0",
      expectedStatus: "pending",
      status: "running",
      payload: "{}",
      nowIso: "2026-08-07T00:00:00.000Z",
    })).resolves.toBe(true);

    expect(mockArtifactUpdateMany).toHaveBeenCalledWith({
      where: {
        run_id: "run-claim",
        artifact_key: "clip:0",
        status: { in: ["pending"] },
      },
      data: {
        status: "running",
        payload: "{}",
        updated_at: "2026-08-07T00:00:00.000Z",
      },
    });
  });

  it("reports a lost claim so callers do not create a duplicate writer", async () => {
    mockArtifactUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(markAuthoringArtifact({
      runId: "run-claim",
      artifactKey: "clip:0",
      expectedStatus: "pending",
      status: "running",
      nowIso: "2026-08-07T00:00:00.000Z",
    })).resolves.toBe(false);
  });
});

describe("listActiveAuthoringRuns writer failure ownership", () => {
  it("keeps a failed writer submission out of the periodic recovery queue", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(1)).resolves.toEqual([]);

    // 只查询可执行队列；failed writer 与 WAITING_EXTERNAL 都不参与周期恢复。
    expect(mockRunFindMany).toHaveBeenCalledTimes(1);
    expect(mockArtifactFindMany).not.toHaveBeenCalled();
    const executableQuery = mockRunFindMany.mock.calls[0]?.[0] as {
      where?: { OR?: Array<{ authoring_state?: unknown }> };
    } | undefined;
    expect(executableQuery?.where?.OR).not.toEqual(expect.arrayContaining([
      { authoring_state: "authoring_failed" },
    ]));
  });

  it("does not hot-poll external asset waits without new evidence", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(2)).resolves.toEqual([]);

    expect(mockRunFindMany).toHaveBeenCalledTimes(1);
    const executableQuery = mockRunFindMany.mock.calls[0]?.[0] as {
      where?: { OR?: Array<{ authoring_state?: unknown }> };
    } | undefined;
    expect(executableQuery?.where?.OR).not.toEqual(expect.arrayContaining([
      { authoring_state: "asset_repair_required" },
    ]));
  });

  it("keeps a stale failed writer projection terminal even when the clip artifact is repairable historically", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(5)).resolves.toEqual([]);

    expect(mockArtifactFindMany).not.toHaveBeenCalled();
    const activeQuery = mockRunFindMany.mock.calls[0]?.[0];
    expect(activeQuery).toEqual(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.not.arrayContaining([
          { authoring_state: "authoring_failed" },
        ]),
      }),
      orderBy: [
        { last_drive_at: { sort: "asc", nulls: "first" } },
        { updated_at: "asc" },
      ],
    }));
  });

  it("does not treat an authoring failure without a failed clip artifact as active", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(5)).resolves.toEqual([]);

    const activeQuery = mockRunFindMany.mock.calls[0]?.[0] as { where?: { OR?: unknown[] } } | undefined;
    expect(activeQuery?.where?.OR).toHaveLength(1);
    expect(mockRunFindMany).toHaveBeenCalledTimes(1);
    expect(mockArtifactFindMany).not.toHaveBeenCalled();
  });

  it("keeps an explicitly unrepairable writer failure out of the active queue", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(5)).resolves.toEqual([]);

    expect(mockArtifactFindMany).not.toHaveBeenCalled();
  });

  it("does not fail open or reactivate an exhausted writer artifact from a frozen BeatSheet", async () => {
    mockRunFindMany.mockResolvedValueOnce([]);

    await expect(listActiveAuthoringRuns(5)).resolves.toEqual([]);
    expect(mockArtifactFindMany).not.toHaveBeenCalled();
  });
});

describe("markAuthoringRunDriveAttempt", () => {
  it("advances only the scheduling watermark without mutating lifecycle state", async () => {
    await expect(markAuthoringRunDriveAttempt({
      runId: "run-fairness",
      nowIso: "2026-08-01T01:00:00.000Z",
    })).resolves.toBeUndefined();

    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "run-fairness",
        authoring_state: { not: null },
      },
      data: { last_drive_at: "2026-08-01T01:00:00.000Z" },
    });
  });
});

describe("failAssetRepairRunAfterTerminalExecutor", () => {
  it("closes only the exact collecting repair wait while preserving its durable artifacts", async () => {
    await expect(failAssetRepairRunAfterTerminalExecutor({
      runId: "repair-run-1",
      ownerId: "owner-1",
      projectId: "project-1",
      flowId: "flow-1",
      chapterId: null,
      errorMessage: "asset_repair_executor_terminal:continuation=cont-1:failure=llm_http_402",
      nowIso: "2026-08-22T02:00:00.000Z",
    })).resolves.toBe(true);

    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "repair-run-1",
        owner_id: "owner-1",
        project_id: "project-1",
        flow_id: "flow-1",
        chapter_id: null,
        state: "collecting",
        authoring_state: "asset_repair_required",
      },
      data: {
        authoring_state: "authoring_failed",
        error_message: "asset_repair_executor_terminal:continuation=cont-1:failure=llm_http_402",
        last_drive_at: null,
        updated_at: "2026-08-22T02:00:00.000Z",
      },
    });
  });

  it("reports a lost lifecycle CAS without overwriting a newer run state", async () => {
    mockRunUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(failAssetRepairRunAfterTerminalExecutor({
      runId: "repair-run-raced",
      ownerId: "owner-1",
      projectId: "project-1",
      flowId: "flow-1",
      chapterId: "chapter-1",
      errorMessage: "asset_repair_executor_terminal:continuation=cont-1:failure=failed",
      nowIso: "2026-08-22T02:00:00.000Z",
    })).resolves.toBe(false);
  });
});

describe("settleClaimedAssetRepairContinuation", () => {
	it("retries the database-only settlement transaction after a serializable conflict", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mockTransaction.mockRejectedValueOnce({ code: "P2034" });
		mockTaskStatusFindUnique.mockResolvedValueOnce({
			status: "completed",
			data: JSON.stringify({ claimToken: "claim-token-already-settled" }),
		});

		await expect(settleClaimedAssetRepairContinuation({
			continuationId: "continuation-raced",
			continuationProvider: "agents_async_continuation",
			continuationUserId: "owner-1",
			continuationClaimToken: "claim-token-raced",
			continuationData: { id: "continuation-raced" },
			requestedStatus: "failed",
			runs: [],
			errorMessage: "asset_repair_executor_terminal:continuation=continuation-raced:failure=deadline",
			nowIso: "2026-08-29T02:00:00.000Z",
		})).resolves.toEqual({ terminalized: false, settledRunIds: [], status: "failed" });

		expect(mockTransaction).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledWith(
			"[continuation-settlement] transient transaction conflict; retrying exact claim",
			expect.objectContaining({
				attempt: 1,
				errorCodes: ["P2034"],
				continuationId: "continuation-raced",
			}),
		);
		warn.mockRestore();
	});

	it("commits the claimed continuation and repair run terminal facts atomically", async () => {
		mockTaskStatusFindUnique.mockResolvedValueOnce({
			status: "claimed",
			data: JSON.stringify({ claimToken: "claim-token-1" }),
		});
		mockArtifactFindUnique
			.mockResolvedValueOnce({
				status: "waiting_external",
				payload: JSON.stringify({
					version: 3,
					runId: "repair-run-1",
					executionGeneration: "repair-generation-1",
					progress: { revision: 0 },
				}),
			})
			.mockResolvedValueOnce({
				id: "owner-artifact-1",
				status: "waiting_external",
				payload: JSON.stringify({
					version: 1,
					runId: "repair-run-1",
					repairGeneration: "repair-generation-1",
					continuationId: "continuation-1",
					ownerId: "owner-1",
					projectId: "project-1",
					flowId: "flow-1",
					chapterId: null,
				}),
			});
		mockRunFindFirst.mockResolvedValueOnce({ id: "repair-run-1" });
		await expect(settleClaimedAssetRepairContinuation({
			continuationId: "continuation-1",
			continuationProvider: "agents_async_continuation",
			continuationUserId: "owner-1",
			continuationClaimToken: "claim-token-1",
			continuationData: { id: "continuation-1", lastFailure: { code: "llm_http_402" } },
			requestedStatus: "failed",
			runs: [{
				runId: "repair-run-1",
				repairGeneration: "repair-generation-1",
				ownerId: "owner-1",
				projectId: "project-1",
				flowId: "flow-1",
				chapterId: null,
			}],
			errorMessage: "asset_repair_executor_terminal:continuation=continuation-1:failure=llm_http_402",
			nowIso: "2026-08-22T02:00:00.000Z",
		})).resolves.toEqual({ terminalized: true, settledRunIds: ["repair-run-1"], status: "failed" });

		expect(mockTransaction).toHaveBeenCalledOnce();
		expect(mockTaskStatusUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ status: "claimed" }),
			data: expect.objectContaining({ status: "failed" }),
		}));
		expect(mockRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({
				id: "repair-run-1",
				authoring_state: "asset_repair_required",
			}),
		}));
	});

	it("does not mutate a run when the continuation claim was cancelled or lost", async () => {
		mockTaskStatusFindUnique.mockResolvedValueOnce({
			status: "claimed",
			data: JSON.stringify({ claimToken: "claim-token-raced" }),
		});
		mockTaskStatusUpdateMany.mockResolvedValueOnce({ count: 0 });

		await expect(settleClaimedAssetRepairContinuation({
			continuationId: "continuation-raced",
			continuationProvider: "agents_async_continuation",
			continuationUserId: "owner-1",
			continuationClaimToken: "claim-token-raced",
			continuationData: { id: "continuation-raced" },
			requestedStatus: "failed",
			runs: [{
				runId: "repair-run-raced",
				repairGeneration: "repair-generation-raced",
				ownerId: "owner-1",
				projectId: "project-1",
				flowId: "flow-1",
				chapterId: null,
			}],
			errorMessage: "asset_repair_executor_terminal:continuation=continuation-raced:failure=cancelled",
			nowIso: "2026-08-22T02:00:00.000Z",
		})).resolves.toEqual({ terminalized: false, settledRunIds: [], status: "failed" });

		expect(mockRunUpdateMany).not.toHaveBeenCalled();
	});
});

describe("resumeCancelledWriterAuthoringRun", () => {
  it("reopens only the same zero-production cancelled authoring run", async () => {
    const resumed = {
      id: "writer-run-1",
      owner_id: "owner-1",
      state: "collecting",
      authoring_state: "beats_committed",
    };
    mockRunFindUnique.mockResolvedValueOnce(resumed);

    await expect(resumeCancelledWriterAuthoringRun({
      runId: "writer-run-1",
      ownerId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      nowIso: "2026-08-07T10:00:00.000Z",
    })).resolves.toEqual(resumed);

    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "writer-run-1",
        owner_id: "owner-1",
        state: "cancelled",
        authoring_state: "authoring_failed",
        total_clips: 0,
        clips_done: 0,
        project_id: "project-1",
        chapter_id: "chapter-1",
      },
      data: {
        state: "collecting",
        authoring_state: "beats_committed",
        error_message: null,
        completed_at: null,
        last_drive_at: null,
        updated_at: "2026-08-07T10:00:00.000Z",
      },
    });
  });
});

describe("resumeCollectingWriterAuthoringRun", () => {
  it("keeps authoring_failed so one recovery cycle can consume pending and failed writer slots", async () => {
    const resumed = {
      id: "writer-run-collecting",
      owner_id: "owner-1",
      state: "collecting",
      authoring_state: "authoring_failed",
    };
    mockRunFindUnique.mockResolvedValueOnce(resumed);

    await expect(resumeCollectingWriterAuthoringRun({
      runId: "writer-run-collecting",
      ownerId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      nowIso: "2026-08-07T12:50:00.000Z",
    })).resolves.toEqual(resumed);

    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "writer-run-collecting",
        owner_id: "owner-1",
        state: "collecting",
        authoring_state: "authoring_failed",
        total_clips: 0,
        clips_done: 0,
        project_id: "project-1",
        chapter_id: "chapter-1",
      },
      data: {
        authoring_state: "authoring_failed",
        error_message: null,
        completed_at: null,
        last_drive_at: null,
        updated_at: "2026-08-07T12:50:00.000Z",
      },
    });
  });
});

describe("resumeCollectingAssetRepairWaitRunWithFrontier", () => {
  it("restores only the zero-production wait state closed by the former stall timer", async () => {
    const resumed = {
      id: "asset-wait-run",
      owner_id: "owner-1",
      state: "collecting",
      authoring_state: "asset_repair_required",
    };
    mockRunFindUnique.mockResolvedValueOnce(resumed);

    await expect(resumeCollectingAssetRepairWaitRunWithFrontier({
      runId: "asset-wait-run",
      ownerId: "owner-1",
      projectId: "project-1",
      chapterId: "chapter-1",
	  executionGeneration: "repair-generation-resumed",
	  declaration: {
		version: 3,
		runId: "asset-wait-run",
		executionGeneration: "repair-generation-resumed",
		progress: { revision: 0 },
	  },
      nowIso: "2026-08-09T01:00:00.000Z",
    })).resolves.toEqual(resumed);

    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-wait-run",
        owner_id: "owner-1",
        state: "collecting",
        authoring_state: "authoring_failed",
        total_clips: 0,
        clips_done: 0,
        OR: [
          {
            error_message: {
              startsWith: "authoring_no_progress_timeout: state=asset_repair_required,",
            },
          },
          {
            error_message: {
              startsWith: "asset_repair_executor_terminal:",
            },
          },
        ],
        project_id: "project-1",
        chapter_id: "chapter-1",
      },
      data: {
        authoring_state: "asset_repair_required",
        error_message: null,
        last_drive_at: null,
        updated_at: "2026-08-09T01:00:00.000Z",
      },
    });
  });
});

describe("authorizeVideoSubmissionReplacement", () => {
  it("preserves the old provider evidence while opening a fresh claim boundary", async () => {
    mockArtifactFindUnique.mockResolvedValueOnce({
      id: "artifact-1",
      run_id: "run-replace",
      artifact_key: "video-submission:1",
      content_hash: "old-hash",
      derived_from: "[\"beat_sheet\",\"clip:1\"]",
      status: "ready",
      payload: JSON.stringify({
        kind: "provider_task_accepted",
        phase: "provider_accepted",
        runId: "run-replace",
        clipIndex: 1,
        providerRequestAttempted: true,
        providerAccepted: true,
        taskId: "task-old",
        vendor: "newapi",
      }),
      error: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:01:00.000Z",
    });

    await expect(authorizeVideoSubmissionReplacement({
      runId: "run-replace",
      clipIndex: 1,
      reason: "explicit_replaceAtIndex_rework",
      nowIso: "2026-08-01T00:02:00.000Z",
    })).resolves.toBe(true);

    const update = mockArtifactUpdateMany.mock.calls[0]?.[0] as {
      data?: { payload?: string; status?: string; error?: string };
    } | undefined;
    expect(update?.data).toEqual(expect.objectContaining({
      status: "stale",
      error: "explicit_replacement_authorized",
    }));
    const payload = JSON.parse(update?.data?.payload ?? "{}") as Record<string, unknown>;
    expect(payload.kind).toBe("explicit_replacement_authorized");
    expect(payload.phase).toBe("replacement_ready");
    const previous = payload.previousSubmission as Record<string, unknown>;
    expect(previous.status).toBe("ready");
    expect(previous.contentHash).toBe("old-hash");
    expect((previous.payload as Record<string, unknown>).taskId).toBe("task-old");
  });

  it("is a no-op success when the old clip never created a durable intent", async () => {
    await expect(authorizeVideoSubmissionReplacement({
      runId: "run-without-intent",
      clipIndex: 0,
      reason: "explicit_replaceAtIndex_rework",
      nowIso: "2026-08-01T00:03:00.000Z",
    })).resolves.toBe(true);
    expect(mockArtifactUpdateMany).not.toHaveBeenCalled();
  });
});

describe("upsertBeatSheetRun production-state protection", () => {
  const input = {
    runId: "run-commit",
    ownerId: "owner-1",
    flowId: "flow-1",
    projectId: "project-1",
    chapterId: "chapter-1",
    beatSheetJson: '{"version":2}',
    filmBibleJson: "{}",
    adaptationStrategyJson: "{}",
    nowIso: "2026-07-21T00:00:00.000Z",
  };

  it("updates only the same owner's collecting run with a CAS", async () => {
    mockRunFindUnique.mockResolvedValueOnce({ owner_id: "owner-1", state: "collecting" });

    await expect(upsertBeatSheetRun(input)).resolves.toBe("replaced");

    expect(mockRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run-commit",
          owner_id: "owner-1",
          state: "collecting",
        },
        data: expect.objectContaining({
          authoring_state: "beats_committed",
          error_message: null,
        }),
      }),
    );
    expect(mockRunCreateMany).not.toHaveBeenCalled();
  });

  it.each(["scheduled", "video_running", "video_success", "failed", "cancelled", "concatenated"])(
    "rejects %s without updating or creating the run",
    async (state) => {
      mockRunFindUnique.mockResolvedValueOnce({ owner_id: "owner-1", state });

      await expect(upsertBeatSheetRun(input)).rejects.toThrow(
        `beat_sheet_run_production_state_locked:${state}`,
      );

      expect(mockRunUpdateMany).not.toHaveBeenCalled();
      expect(mockRunCreateMany).not.toHaveBeenCalled();
    },
  );

  it("creates a collecting placeholder for a new run", async () => {
    await expect(upsertBeatSheetRun(input)).resolves.toBe("created");

    expect(mockRunCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: "run-commit",
        owner_id: "owner-1",
        state: "collecting",
        authoring_state: "beats_committed",
      })],
      skipDuplicates: true,
    });
    expect(mockRunUpdateMany).not.toHaveBeenCalled();
  });
});

describe("commitAuthoringAssemblyVerification", () => {
  it("atomically records deterministic assembly success and approves the script", async () => {
    const committed = await commitAuthoringAssemblyVerification({
      runId: "run-assembly",
      valid: true,
      contentHash: "assembly-hash",
      derivedFrom: ["clip:0", "clip:1"],
      payload: JSON.stringify({ clipIndexes: [0, 1] }),
      nowIso: "2026-07-21T00:00:00.000Z",
    });

    expect(committed).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: { id: "run-assembly", authoring_state: "assembled" },
      data: {
        authoring_state: "script_approved",
        updated_at: "2026-07-21T00:00:00.000Z",
        error_message: null,
      },
    });
    expect(mockArtifactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          run_id_artifact_key: {
            run_id: "run-assembly",
            artifact_key: "assembly:verification",
          },
        },
        create: expect.objectContaining({
          status: "ready",
          derived_from: JSON.stringify(["clip:0", "clip:1"]),
        }),
        update: expect.objectContaining({ status: "ready" }),
      }),
    );
  });

  it("records structural assembly failure without mutating any clip artifact", async () => {
    const committed = await commitAuthoringAssemblyVerification({
      runId: "run-invalid",
      valid: false,
      contentHash: "invalid-hash",
      derivedFrom: ["clip:0", "clip:1"],
      payload: JSON.stringify({ clipIndexes: [0] }),
      error: "assembly_verification_failed",
      nowIso: "2026-07-21T00:01:00.000Z",
    });

    expect(committed).toBe(true);
    expect(mockRunUpdateMany).toHaveBeenCalledWith({
      where: { id: "run-invalid", authoring_state: "assembled" },
      data: {
        authoring_state: "authoring_failed",
        updated_at: "2026-07-21T00:01:00.000Z",
        error_message: "assembly_verification_failed",
      },
    });
    expect(mockArtifactUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "failed" }),
        update: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(mockArtifactUpdateMany).not.toHaveBeenCalled();
  });

  it("does not write verification evidence after losing the assembled CAS", async () => {
    mockRunUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      commitAuthoringAssemblyVerification({
        runId: "run-raced",
        valid: true,
        contentHash: "hash",
        derivedFrom: ["clip:0"],
        payload: "{}",
        nowIso: "2026-07-21T00:02:00.000Z",
      }),
    ).resolves.toBe(false);

    expect(mockArtifactUpsert).not.toHaveBeenCalled();
  });
});

describe("commitAuthoringClipContractRejection", () => {
  it("atomically reopens exactly one ready writer slot and invalidates downstream pre-provider nodes", async () => {
    mockArtifactFindUnique.mockResolvedValueOnce({ status: "pending" });
    await expect(commitAuthoringClipContractRejection({
      runId: "run-contract-repair",
      artifactKey: "clip:8",
      expectedAuthoringStates: ["assets_ready"],
      failedPayload: JSON.stringify({
        clipIndex: 8,
        sourceHash: "source-8",
        repairable: true,
      }),
      error: "writer clip 失败: clips[8].shots[1].motionDynamics.direction invalid",
      evidenceArtifactKey: "contract-rejection:clip:8:hash",
      evidenceContentHash: "hash",
      evidencePayload: JSON.stringify({ clipIndex: 8 }),
      nowIso: "2026-08-10T16:00:00.000Z",
    })).resolves.toBe(true);

    expect(mockRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "run-contract-repair",
        state: "collecting",
        authoring_state: { in: ["assets_ready"] },
      }),
      data: expect.objectContaining({ authoring_state: "authoring_failed" }),
    }));
    expect(mockArtifactUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        run_id: "run-contract-repair",
        artifact_key: "clip:8",
        status: "ready",
      }),
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(mockArtifactUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        artifact_key: { in: ["assembly:verification", "estimate:auto"] },
      }),
      data: expect.objectContaining({ status: "pending" }),
    }));
    expect(mockArtifactUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ artifact_key: "contract-rejection:clip:8:hash" }),
    }));
  });

  it("refuses to reopen a clip after production handoff evidence exists", async () => {
    mockArtifactFindUnique.mockResolvedValueOnce({ status: "ready" });
    await expect(commitAuthoringClipContractRejection({
      runId: "run-handed-off",
      artifactKey: "clip:1",
      expectedAuthoringStates: ["assets_ready"],
      failedPayload: "{}",
      error: "contract invalid",
      evidenceArtifactKey: "contract-rejection:clip:1:hash",
      evidenceContentHash: "hash",
      evidencePayload: "{}",
      nowIso: "2026-08-10T16:01:00.000Z",
    })).resolves.toBe(false);
    expect(mockRunUpdateMany).not.toHaveBeenCalled();
    expect(mockArtifactUpdateMany).not.toHaveBeenCalled();
  });
});
