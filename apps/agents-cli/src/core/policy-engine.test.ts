import assert from "node:assert/strict";
import test from "node:test";

import { evaluateToolPolicy, recordPolicyDecision } from "./policy-engine.js";

test("policy engine denies tools outside capability grant", () => {
  const decision = evaluateToolPolicy({
    toolName: "write_file",
    meta: {
      capabilityGrant: {
        tools: ["read_file"],
        readableRoots: ["/repo"],
        writableRoots: ["/repo"],
        network: "approved",
        budgets: {
          maxToolCalls: 8,
          maxTokens: 1000,
          maxWallTimeMs: 1000,
        },
      },
    },
  });

  assert.equal(decision.verdict, "deny");
  assert.equal(decision.scope, "tool");
});

test("policy engine requires approval for remote privileged local tools", () => {
  const decision = evaluateToolPolicy({
    toolName: "exec_command",
    meta: {
      userId: "user-1",
    },
  });

  assert.equal(decision.verdict, "requires_approval");
  assert.equal(decision.source, "user");
});

test("policy engine denies writes outside writable roots", () => {
  const decision = evaluateToolPolicy({
    toolName: "write_file",
    cwd: "/repo",
    args: { path: "../outside.txt" },
    meta: {
      capabilityGrant: {
        tools: ["write_file"],
        readableRoots: ["/repo"],
        writableRoots: ["/repo/allowed"],
        network: "approved",
        budgets: {
          maxToolCalls: 8,
          maxTokens: 1000,
          maxWallTimeMs: 1000,
        },
      },
    },
  });

  assert.equal(decision.verdict, "deny");
  assert.equal(decision.scope, "path");
});

test("recordPolicyDecision accumulates policy summary in runtime meta", () => {
  const meta: Record<string, unknown> = {};
  recordPolicyDecision(meta, {
    verdict: "requires_approval",
    reason: "needs approval",
    source: "request",
    scope: "command",
  });

  assert.deepEqual(meta.policySummary, {
    totalDecisions: 1,
    allowCount: 0,
    denyCount: 0,
    requiresApprovalCount: 1,
    uniqueDeniedSignatures: ["request:command:needs approval"],
  });
});
