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
  hasBody: Object.hasOwn(options, "body")
}), {headers: {"content-type": "application/json"}});`;

function invoke(t, profile, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tapcanvas-model-catalog-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = path.join(directory, "config.json");
  fs.writeFileSync(config, JSON.stringify({version: 2, profiles: {
    local: {apiBaseUrl: "http://127.0.0.1:8788", apiKey: "fixture-key"},
    production: {apiBaseUrl: "https://catalog.example.invalid", apiKey: "fixture-key"}
  }}));
  // All fetch calls are intercepted before the CLI starts. No real config or network is used.
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(intercept)}`,
    caller, "--config", config, "--profile", profile, "--endpoint", "newApiModels", ...args],
    {encoding: "utf-8", env: {PATH: process.env.PATH}});
}

for (const profile of ["local", "production"]) {
  test(`newApiModels maps the protected ${profile} GET and exact supported query keys`, (t) => {
    const result = invoke(t, profile, ["--kind", "video", "--enabled", "false", "--refresh", "true",
      "--selectable", "true", "--include_action_models", "false", "--vendorKey", "not-supported"]);
    assert.equal(result.status, 0, result.stderr);
    const {data} = JSON.parse(result.stdout);
    const url = new URL(data.url);
    assert.equal(url.pathname, profile === "production" ? "/api/new-api-models" : "/new-api-models");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      kind: "video", enabled: "false", refresh: "true", selectable: "true", include_action_models: "false"
    });
    assert.equal(data.method, "GET");
    assert.equal(data.authenticated, true);
    assert.equal(data.hasBody, false);
  });
}

test("newApiModels permits an unfiltered catalog and rejects payload before fetch", (t) => {
  const unfiltered = invoke(t, "local");
  assert.equal(unfiltered.status, 0, unfiltered.stderr);
  assert.equal(new URL(JSON.parse(unfiltered.stdout).url).search, "");
  const mutation = invoke(t, "local", ["--payload", '{"enabled":false}']);
  assert.equal(mutation.status, 1);
  assert.ok(mutation.stderr.includes('Endpoint "newApiModels" does not accept payload.'));
  assert.equal(mutation.stdout, "");
});
