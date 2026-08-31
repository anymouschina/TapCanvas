import { describe, expect, it } from "vitest";
import {
  assertInternalWorkerTickSucceeded,
  buildInternalWorkerStageFailure,
} from "./internal-worker-diagnostics";

describe("internal worker diagnostics", () => {
  it("preserves the concrete stage and error without inventing progress", () => {
    expect(buildInternalWorkerStageFailure("video_run_drive", new Error("database unavailable")))
      .toEqual({
        enabled: true,
        failed: true,
        stage: "video_run_drive",
        errorName: "Error",
        errorMessage: "database unavailable",
      });
  });

  it("turns a recorded lane failure into a failed BullMQ job without killing the worker", () => {
    const failure = buildInternalWorkerStageFailure(
      "authoring_drive",
      new Error("database unavailable"),
    );
    expect(() =>
      assertInternalWorkerTickSucceeded("video drive", {
        ok: false,
        failures: [failure],
      }),
    ).toThrow("video drive tick failed: authoring_drive: database unavailable");
  });

  it("accepts a tick only when every stage completed", () => {
    expect(() =>
      assertInternalWorkerTickSucceeded("finalizer", {
        ok: true,
        failures: [],
      }),
    ).not.toThrow();
  });
});
