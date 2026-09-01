import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import { BridgeRequestError } from "./contracts.js";
import {
  authorize,
  errorDetails,
  requiredBodyString,
  SseWriter,
  SessionSerialGate,
} from "./http-server.js";

function fakeIncoming(headers: Record<string, string | undefined> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function fakeResponse(): { chunks: string[]; writableEnded: boolean } & ServerResponse {
  const state = { chunks: [] as string[], writableEnded: false };
  const response = {
    get chunks() {
      return state.chunks;
    },
    get writableEnded() {
      return state.writableEnded;
    },
    write(frame: string): boolean {
      state.chunks.push(frame);
      return true;
    },
    end(): void {
      state.writableEnded = true;
    },
  } as unknown as { chunks: string[]; writableEnded: boolean } & ServerResponse;
  return response;
}

test("authorize allows every request when no token is configured", () => {
  assert.equal(authorize(fakeIncoming(), undefined), true);
});

test("authorize accepts a matching Bearer token", () => {
  assert.equal(authorize(fakeIncoming({ authorization: "Bearer secret" }), "secret"), true);
});

test("authorize accepts a matching x-agents-token header", () => {
  assert.equal(authorize(fakeIncoming({ "x-agents-token": "secret" }), "secret"), true);
});

test("authorize rejects a mismatched token", () => {
  assert.equal(authorize(fakeIncoming({ authorization: "Bearer wrong" }), "secret"), false);
});

test("authorize rejects a missing token when one is configured", () => {
  assert.equal(authorize(fakeIncoming(), "secret"), false);
});

test("errorDetails maps a BridgeRequestError to its own status and code", () => {
  assert.deepEqual(errorDetails(new BridgeRequestError("bad thing", "bad_thing", 422)), {
    status: 422,
    code: "bad_thing",
    message: "bad thing",
  });
});

test("errorDetails maps JSON syntax errors to 400 invalid_json", () => {
  assert.deepEqual(errorDetails(new SyntaxError("bad json")), {
    status: 400,
    code: "invalid_json",
    message: "bad json",
  });
});

test("errorDetails maps unknown errors to a generic 500", () => {
  assert.deepEqual(errorDetails(new Error("boom")), {
    status: 500,
    code: "deepseek_harness_bridge_failed",
    message: "boom",
  });
});

test("requiredBodyString returns the trimmed non-empty value", () => {
  assert.equal(requiredBodyString({ userId: "  user-1  " }, "userId"), "user-1");
});

test("requiredBodyString rejects a non-object body", () => {
  assert.throws(() => requiredBodyString("nope", "userId"), BridgeRequestError);
});

test("requiredBodyString rejects a missing or blank key", () => {
  assert.throws(() => requiredBodyString({}, "userId"), BridgeRequestError);
  assert.throws(() => requiredBodyString({ userId: "   " }, "userId"), BridgeRequestError);
});

test("SessionSerialGate serializes tasks sharing the same key", async () => {
  const gate = new SessionSerialGate();
  const order: string[] = [];
  const first = gate.run("k", async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("first");
  });
  const second = gate.run("k", async () => {
    order.push("second");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});

test("SessionSerialGate runs distinct keys concurrently", async () => {
  const gate = new SessionSerialGate();
  let running = 0;
  let peak = 0;
  const keys = ["a", "b", "c"];
  const task = (key: string) =>
    gate.run(key, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    });
  await Promise.all(keys.map((key) => task(key)));
  assert.ok(peak >= 2, `expected concurrent execution, peak was ${peak}`);
});

test("SseWriter emits a single SSE frame in the expected format", async () => {
  const response = fakeResponse();
  const writer = new SseWriter(response);
  writer.emit({ event: "delta", data: { text: "hi" } });
  await writer.finish();
  assert.deepEqual(response.chunks, ['event: delta\ndata: {"text":"hi"}\n\n']);
  assert.equal(response.writableEnded, true);
});

test("SseWriter ignores emits after stop", async () => {
  const response = fakeResponse();
  const writer = new SseWriter(response);
  writer.stop();
  writer.emit({ event: "delta", data: { text: "hi" } });
  await writer.finish();
  assert.deepEqual(response.chunks, []);
});
