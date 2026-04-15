import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveRuntimeSessionKey,
  resolveRuntimeSessionStoreDir,
} from "./session.js";

test("resolveRuntimeSessionKey prefers explicit CLI session id", () => {
  process.env.AGENTS_TASK_ID = "task-from-env";
  assert.equal(resolveRuntimeSessionKey(" cli-session "), "cli-session");
});

test("resolveRuntimeSessionKey falls back to AGENTS_TASK_ID", () => {
  process.env.AGENTS_TASK_ID = "task-from-env";
  assert.equal(resolveRuntimeSessionKey(undefined), "task-from-env");
});

test("resolveRuntimeSessionStoreDir prefers AGENTS_REPO_PATH when it points to a directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-runtime-session-"));
  const repoDir = path.join(tempDir, "repo");
  fs.mkdirSync(repoDir, { recursive: true });
  process.env.AGENTS_REPO_PATH = repoDir;

  const resolved = resolveRuntimeSessionStoreDir({
    cwd: tempDir,
    memoryDir: ".agents/memory",
  });

  assert.equal(resolved, path.join(repoDir, ".agents/memory", "sessions"));
});

test("resolveRuntimeSessionStoreDir falls back to cwd memory sessions when AGENTS_REPO_PATH is invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-runtime-session-"));
  process.env.AGENTS_REPO_PATH = path.join(tempDir, "missing-repo");

  const resolved = resolveRuntimeSessionStoreDir({
    cwd: tempDir,
    memoryDir: ".agents/memory",
  });

  assert.equal(resolved, path.join(tempDir, ".agents/memory", "sessions"));
});
