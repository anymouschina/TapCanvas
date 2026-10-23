import assert from "node:assert/strict";
import test from "node:test";

import { BridgeRequestError } from "./contracts.js";
import { buildHarnessExecutionSessionId, HarnessRuntime } from "./harness-runtime.js";
import { RequestMcpGateway } from "./mcp-gateway.js";

const request = {
  sessionId: "public-session-1",
  userId: "user-1",
};

test("rejects invalid explicit SDK handshake timeouts before initializing runtime resources", () => {
  for (const configured of ["", "abc", "0", "-1", "1.5", "Infinity", "9007199254740992"]) {
    assert.throws(
      () => new HarnessRuntime({
        workspaceRoot: process.cwd(),
        bridgeOrigin: "http://127.0.0.1:1",
        mcpGateway: new RequestMcpGateway(),
        environment: { AGENTS_INITIALIZE_TIMEOUT_MS: configured },
      }),
      (error: unknown) => error instanceof BridgeRequestError
        && error.code === "deepseek_harness_initialize_timeout_invalid",
    );
  }
});

test("mints a distinct DeepSeek Harness session for every physical execution", () => {
  const first = buildHarnessExecutionSessionId(request, "execution-1");
  const second = buildHarnessExecutionSessionId(request, "execution-2");

  assert.notEqual(first, second);
});

test("derives the same opaque session id from the same physical execution facts", () => {
  const first = buildHarnessExecutionSessionId(request, "execution-1");
  const second = buildHarnessExecutionSessionId(request, "execution-1");

  assert.equal(first, second);
  assert.match(first, /^tapcanvas-[a-f0-9]{64}$/);
  assert.equal(first.includes(request.sessionId), false);
  assert.equal(first.includes(request.userId), false);
});

test("keeps ephemeral physical execution sessions unique without external identity", () => {
  const first = buildHarnessExecutionSessionId({}, "execution-1");
  const second = buildHarnessExecutionSessionId({}, "execution-2");

  assert.notEqual(first, second);
  assert.match(first, /^tapcanvas-[a-f0-9]{64}$/);
});
