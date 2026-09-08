import assert from "node:assert/strict";
import test from "node:test";

import { TerminalSessionManager } from "./session-manager.js";

function nodeEvalCommand(source: string): string {
  const encoded = Buffer.from(source, "utf8").toString("base64");
  return `"${process.execPath}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}

test("TerminalSessionManager supports session polling via empty write_stdin", async () => {
  const manager = new TerminalSessionManager();
  const started = await manager.execCommand({
    command: nodeEvalCommand("setTimeout(() => console.log('done'), 100)"),
    cwd: process.cwd(),
    yieldTimeMs: 20,
  });
  assert.equal(typeof started.chunk_id, "string");
  assert.equal(typeof started.wall_time_seconds, "number");
  assert.equal(typeof started.output, "string");
  assert.ok(typeof started.session_id === "number");

  const sessionId = started.session_id as number;
  const outputs: string[] = [started.output];
  let completed = false;
  for (let i = 0; i < 10; i += 1) {
    const polled = await manager.writeStdin({
      sessionId,
      chars: "",
      yieldTimeMs: 80,
    });
    outputs.push(polled.output);
    if (typeof polled.session_id !== "number") {
      completed = true;
      break;
    }
  }

  assert.equal(completed, true);
  assert.match(outputs.join(""), /done/);
  assert.equal(manager.list().some((session) => session.id === sessionId), false);
});

test("TerminalSessionManager rejects non-tty stdin writes", async () => {
  const manager = new TerminalSessionManager();
  const started = await manager.execCommand({
    command: nodeEvalCommand("setTimeout(() => undefined, 200)"),
    cwd: process.cwd(),
    yieldTimeMs: 10,
  });
  assert.ok(typeof started.session_id === "number");
  const sessionId = started.session_id as number;

  await assert.rejects(
    manager.writeStdin({
      sessionId,
      chars: "hello",
      yieldTimeMs: 10,
    }),
    /stdin is closed/
  );
  manager.closeAll();
});
