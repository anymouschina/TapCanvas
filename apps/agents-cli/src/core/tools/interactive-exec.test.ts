import assert from "node:assert/strict";
import test from "node:test";

import { createExecCommandTool, createWriteStdinTool } from "./interactive-exec.js";
import { TerminalSessionManager } from "../terminal/session-manager.js";

function createState() {
  return {
    cache: { readFile: new Map(), bash: new Map() },
    guard: { duplicateToolCallLimit: 3, duplicateToolCallCount: new Map() },
  };
}

test("interactive exec tool returns session_id and supports polling", async () => {
  const execTool = createExecCommandTool();
  const writeTool = createWriteStdinTool();
  const manager = new TerminalSessionManager();
  const meta: Record<string, unknown> = {
    terminalSessionManager: manager,
  };
  const ctx = {
    cwd: process.cwd(),
    depth: 0,
    meta,
    state: createState(),
  };

  const started = await execTool.execute(
    {
      cmd: "sleep 0.1; printf 'ok\\n'",
      yield_time_ms: 20,
    },
    ctx,
    "tool-exec-1"
  );

  const payload = JSON.parse(started.content) as Record<string, unknown>;
  assert.equal(typeof payload.chunk_id, "string");
  assert.ok(typeof payload.session_id === "number");
  const sessionId = payload.session_id as number;

  let finished = false;
  let text = String(payload.output ?? "");
  for (let i = 0; i < 10; i += 1) {
    const polled = await writeTool.execute(
      {
        session_id: sessionId,
        chars: "",
        yield_time_ms: 80,
      },
      ctx,
      `tool-write-${i}`
    );
    const polledPayload = JSON.parse(polled.content) as Record<string, unknown>;
    text += String(polledPayload.output ?? "");
    if (typeof polledPayload.session_id !== "number") {
      finished = true;
      break;
    }
  }
  assert.equal(finished, true);
  assert.match(text, /ok/);
  manager.closeAll();
});

test("interactive exec tool blocks dangerous commands", async () => {
  const execTool = createExecCommandTool();
  const manager = new TerminalSessionManager();
  const result = await execTool.execute(
    {
      cmd: "sudo whoami",
    },
    {
      cwd: process.cwd(),
      depth: 0,
      meta: {
        terminalSessionManager: manager,
      },
      state: createState(),
    },
    "tool-exec-danger"
  );
  assert.match(result.content, /Dangerous command/);
  manager.closeAll();
});
