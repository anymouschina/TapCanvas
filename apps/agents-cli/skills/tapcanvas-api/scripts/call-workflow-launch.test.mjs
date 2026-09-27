import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const caller = fileURLToPath(new URL("./call.mjs", import.meta.url));
const intercept = `globalThis.fetch = async (url, options) => new Response(JSON.stringify({
  url, method: options.method, authenticated: options.headers.Authorization === "Bearer fixture-key",
  body: options.body ? JSON.parse(options.body) : null
}), {headers: {"content-type": "application/json"}});`;

function invoke(t, profile, args) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tapcanvas-workflow-launch-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = path.join(directory, "config.json");
  fs.writeFileSync(config, JSON.stringify({ version: 2, profiles: {
    local: { apiBaseUrl: "http://127.0.0.1:8788", apiKey: "fixture-key" },
    production: { apiBaseUrl: "https://workflow.example.invalid", apiKey: "fixture-key" },
  } }));
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(intercept)}`,
    caller, "--config", config, "--profile", profile, "--endpoint", "capabilityBayWorkflowRun", ...args],
  { encoding: "utf-8", env: { PATH: process.env.PATH } });
}

for (const profile of ["local", "production"]) {
  test(`manual equipped workflow launch uses the protected ${profile} path and exact request`, (t) => {
    const payload = {
      intent: "run_selected_equipped_workflow", attachmentId: "attachment-1",
      executionVariant: "full_video", projectId: "project-1", chapterId: "chapter-1",
      idempotencyKey: "launch-1", agentModelKey: "selected-model",
      triggerPayload: { onlyVideoNodes: true },
    };
    const result = invoke(t, profile, ["--payload", JSON.stringify(payload)]);
    assert.equal(result.status, 0, result.stderr);
    const { data } = JSON.parse(result.stdout);
    assert.equal(new URL(data.url).pathname,
      `${profile === "production" ? "/api" : ""}/agents/capability-bay/workflows/run`);
    assert.equal(data.method, "POST");
    assert.equal(data.authenticated, true);
    assert.deepEqual(data.body, payload);
    assert.equal(Object.hasOwn(data.body, "parentAgentExecution"), false);
  });
}

test("manual equipped workflow launch requires an explicit payload before any request", (t) => {
  const result = invoke(t, "local", []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /payload/i);
  assert.equal(result.stdout, "");
});
