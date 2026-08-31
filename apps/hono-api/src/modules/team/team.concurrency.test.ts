import { describe, expect, it } from "vitest";
import { assessActiveCreditReservations } from "./team.concurrency";

const NOW = Date.parse("2026-07-22T10:00:00.000Z");

function assess(input: {
  status?: string;
  hasVendorRef?: boolean;
  ledgerTerminal?: boolean;
  createdAt?: string;
}) {
  return assessActiveCreditReservations({
    reservations: [{
      taskId: "task-1",
      createdAt: input.createdAt ?? "2026-07-22T09:59:00.000Z",
    }],
    ledgerTerminalTaskIds: new Set(input.ledgerTerminal ? ["task-1"] : []),
    taskResults: input.status ? [{ taskId: "task-1", status: input.status }] : [],
    vendorRefTaskIds: new Set(input.hasVendorRef ? ["task-1"] : []),
    nowMs: NOW,
    graceMs: 10 * 60_000,
  });
}

describe("personal membership active reservation evidence", () => {
  it.each(["succeeded", "failed"])("does not count a %s task result as active", (status) => {
    expect(assess({ status })).toEqual({ activeTaskIds: [], orphanedTaskIds: [] });
  });

  it.each(["queued", "running", "claimed"])("counts a %s task result as active", (status) => {
    expect(assess({ status }).activeTaskIds).toEqual(["task-1"]);
  });

  it("counts a vendor ref without a terminal task result as active", () => {
    expect(assess({ hasVendorRef: true }).activeTaskIds).toEqual(["task-1"]);
  });

  it("counts a fresh reservation without task evidence during the submission race window", () => {
    expect(assess({}).activeTaskIds).toEqual(["task-1"]);
  });

  it("does not count an old reservation with no task evidence and reports it as orphaned", () => {
    expect(assess({ createdAt: "2026-07-22T09:00:00.000Z" })).toEqual({
      activeTaskIds: [],
      orphanedTaskIds: ["task-1"],
    });
  });

  it("lets terminal ledger evidence take precedence over other active evidence", () => {
    expect(assess({ ledgerTerminal: true, status: "running", hasVendorRef: true })).toEqual({
      activeTaskIds: [],
      orphanedTaskIds: [],
    });
  });
});
