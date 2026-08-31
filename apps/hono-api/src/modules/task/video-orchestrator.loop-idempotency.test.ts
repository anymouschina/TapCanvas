import { describe, expect, it } from "vitest";

import {
  buildIdempotentVideoLoopReceipt,
  decideFrozenLoopExistingRun,
  readPersistedFrozenLoopIdentity,
} from "./video-orchestrator.loop-idempotency";

const identity = { revision: "revision-1", fingerprint: "fingerprint-1" };
const beatSheet = JSON.stringify({
  version: 2,
  meta: {
    preflightRevision: identity.revision,
    preflightFingerprint: identity.fingerprint,
  },
});

describe("frozen loop idempotency", () => {
  it("accepts a runId that has not been durably claimed", () => {
    expect(decideFrozenLoopExistingRun({ existing: null, requested: identity }))
      .toEqual({ kind: "accept_new" });
  });

  it("returns the existing authoring run for an exact frozen-reference replay", () => {
    expect(decideFrozenLoopExistingRun({
      existing: {
        id: "run-1",
        state: "collecting",
        authoring_state: "writing_dispatched",
        beat_sheet: beatSheet,
      },
      requested: identity,
    })).toEqual({
      kind: "return_existing",
      authoringState: "writing_dispatched",
      productionState: "collecting",
    });
  });

  it("returns the existing run when only physical preflight provenance changed the revision", () => {
    expect(decideFrozenLoopExistingRun({
      existing: {
        id: "run-1",
        state: "collecting",
        authoring_state: "writing_dispatched",
        beat_sheet: beatSheet,
      },
      requested: { revision: "revision-from-next-physical-window", fingerprint: identity.fingerprint },
    })).toEqual({
      kind: "return_existing",
      authoringState: "writing_dispatched",
      productionState: "collecting",
    });
  });

  it("rejects a different frozen reference under an already accepted runId", () => {
    const result = decideFrozenLoopExistingRun({
      existing: {
        id: "run-1",
        state: "collecting",
        authoring_state: "writing_dispatched",
        beat_sheet: beatSheet,
      },
      requested: { ...identity, fingerprint: "fingerprint-2" },
    });
    expect(result.kind).toBe("reject_conflict");
    if (result.kind === "reject_conflict") {
      expect(result.code).toBe("video_loop_run_identity_conflict");
    }
  });

  it("does not treat a non-authoring run collision as a replay", () => {
    const result = decideFrozenLoopExistingRun({
      existing: {
        id: "run-1",
        state: "scheduled",
        authoring_state: null,
        beat_sheet: null,
      },
      requested: identity,
    });
    expect(result.kind).toBe("reject_conflict");
  });

  it("builds a receipt that explicitly proves no duplicate dispatch", () => {
    expect(buildIdempotentVideoLoopReceipt({
      runId: "run-1",
      requestedMode: "loop",
      authoringState: "writing_dispatched",
      productionState: "collecting",
    })).toMatchObject({
      ok: true,
      code: "video_loop_already_accepted",
      idempotent: true,
      acceptedAsync: true,
      runId: "run-1",
    });
  });

  it("reads only complete persisted preflight identities", () => {
    expect(readPersistedFrozenLoopIdentity(beatSheet)).toEqual(identity);
    expect(readPersistedFrozenLoopIdentity("{}" )).toBeNull();
    expect(readPersistedFrozenLoopIdentity("not-json")).toBeNull();
  });
});
