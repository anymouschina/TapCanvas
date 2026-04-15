import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readFileRangeTool, readFileTool, writeFileTool } from "./fs.js";

function createState() {
  return {
    cache: { readFile: new Map(), bash: new Map() },
    guard: { duplicateToolCallLimit: 3, duplicateToolCallCount: new Map() },
  };
}

test("read_file can access project-data only when declared in localResourcePaths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-"));
  const cwd = path.join(root, "apps", "agents-cli");
  fs.mkdirSync(cwd, { recursive: true });
  const filePath = path.join(root, "project-data", "users", "u1", "projects", "p1", "note.txt");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "hello-project-data", "utf-8");

  const ok = await readFileTool.execute(
    { path: "project-data/users/u1/projects/p1/note.txt" },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: root,
        privilegedLocalAccess: true,
        localResourcePaths: ["project-data/users/u1/projects/p1"],
      },
      state: createState(),
    },
    "tool-call-fs-1"
  );

  assert.match(ok.content, /hello-project-data/);

  assert.rejects(
    () =>
      readFileTool.execute(
        { path: "project-data/users/u1/projects/p1/note.txt" },
        {
          cwd,
          depth: 0,
          meta: { workspaceRoot: root },
          state: createState(),
        },
        "tool-call-fs-2"
      ),
    /Path not allowed outside declared local resources/
  );

  assert.rejects(
    () =>
      readFileTool.execute(
        { path: "agents.config.json" },
        {
          cwd,
          depth: 0,
          meta: {
            workspaceRoot: root,
            privilegedLocalAccess: true,
            localResourcePaths: ["project-data/users/u1/projects/p1"],
            userId: "u1",
          },
          state: createState(),
        },
        "tool-call-fs-3"
      ),
    /Path not allowed outside repo knowledge roots or declared local resources/
  );
});

test("read_file accepts absolute paths when they stay inside declared localResourcePaths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-abs-"));
  const cwd = path.join(root, "apps", "agents-cli");
  fs.mkdirSync(cwd, { recursive: true });
  const filePath = path.join(root, "project-data", "users", "u1", "projects", "p1", "chapter.txt");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "absolute-local-root-ok", "utf-8");

  const ok = await readFileTool.execute(
    { path: filePath },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: root,
        privilegedLocalAccess: true,
        localResourcePaths: ["project-data/users/u1/projects/p1"],
        userId: "u1",
      },
      state: createState(),
    },
    "tool-call-fs-abs-1"
  );

  assert.match(ok.content, /absolute-local-root-ok/);
});

test("write_file respects capability writableRoots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-write-"));
  const cwd = path.join(root, "workspace");
  const allowedDir = path.join(cwd, "allowed");
  const deniedDir = path.join(cwd, "denied");
  fs.mkdirSync(allowedDir, { recursive: true });
  fs.mkdirSync(deniedDir, { recursive: true });

  const ok = await writeFileTool.execute(
    { path: path.join(allowedDir, "note.txt"), content: "ok" },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: cwd,
        capabilityGrant: {
          tools: ["write_file"],
          readableRoots: [cwd],
          writableRoots: [allowedDir],
          network: "approved",
          budgets: {
            maxToolCalls: 8,
            maxTokens: 1000,
            maxWallTimeMs: 1000,
          },
        },
      },
      state: createState(),
    },
    "tool-call-fs-write-1"
  );

  assert.match(ok.content, /Wrote 2 bytes/);
  assert.equal(fs.readFileSync(path.join(allowedDir, "note.txt"), "utf-8"), "ok");

  assert.rejects(
    () =>
      writeFileTool.execute(
        { path: path.join(deniedDir, "blocked.txt"), content: "blocked" },
        {
          cwd,
          depth: 0,
          meta: {
            workspaceRoot: cwd,
            capabilityGrant: {
              tools: ["write_file"],
              readableRoots: [cwd],
              writableRoots: [allowedDir],
              network: "approved",
              budgets: {
                maxToolCalls: 8,
                maxTokens: 1000,
                maxWallTimeMs: 1000,
              },
            },
          },
          state: createState(),
        },
        "tool-call-fs-write-2"
      ),
    /Path not allowed outside capability writableRoots/
  );
});

test("read_file can resolve shared workspace code roots from agent work root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-shared-"));
  const sharedWorkspaceRoot = path.join(root, "repo");
  const agentWorkRoot = path.join(root, "agent-work");
  const targetFile = path.join(sharedWorkspaceRoot, "apps", "demo", "index.ts");
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.mkdirSync(agentWorkRoot, { recursive: true });
  fs.writeFileSync(targetFile, "export const demo = 1;\n", "utf-8");

  const ok = await readFileTool.execute(
    { path: "apps/demo/index.ts" },
    {
      cwd: agentWorkRoot,
      depth: 0,
      meta: {
        workspaceRoot: agentWorkRoot,
        sharedWorkspaceRoot,
        capabilityGrant: {
          tools: ["read_file"],
          readableRoots: [sharedWorkspaceRoot, agentWorkRoot],
          writableRoots: [agentWorkRoot],
          network: "approved",
          budgets: {
            maxToolCalls: 8,
            maxTokens: 1000,
            maxWallTimeMs: 1000,
          },
        },
      },
      state: createState(),
    },
    "tool-call-fs-shared-1"
  );

  assert.match(ok.content, /export const demo = 1/);
});

test("read_file blocks rereading a file after a full-file read in the same run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-budget-full-"));
  const cwd = path.join(root, "workspace");
  const filePath = path.join(cwd, "notes.txt");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(filePath, "line-1\nline-2\nline-3\n", "utf-8");

  const state = createState();
  await readFileTool.execute(
    { path: "notes.txt" },
    {
      cwd,
      depth: 0,
      state,
    },
    "tool-call-fs-budget-full-1"
  );

  await assert.rejects(
    () =>
      readFileTool.execute(
        { path: "notes.txt", limit: 2 },
        {
          cwd,
          depth: 0,
          state,
        },
        "tool-call-fs-budget-full-2"
      ),
    /already covers/,
  );
});

test("read_file_range blocks rereading an already covered range in the same run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-budget-range-"));
  const cwd = path.join(root, "workspace");
  const filePath = path.join(cwd, "notes.txt");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(filePath, "1\n2\n3\n4\n5\n6\n", "utf-8");

  const state = createState();
  await readFileTool.execute(
    { path: "notes.txt", limit: 4 },
    {
      cwd,
      depth: 0,
      state,
    },
    "tool-call-fs-budget-range-1"
  );

  await assert.rejects(
    () =>
      readFileTool.execute(
        { path: "notes.txt", limit: 2 },
        {
          cwd,
          depth: 0,
          state,
        },
        "tool-call-fs-budget-range-2"
      ),
    /already covers/,
  );

  await assert.rejects(
    () =>
      readFileRangeTool.execute(
        { path: "notes.txt", start_line: 2, end_line: 3 },
        {
          cwd,
          depth: 0,
          state,
        },
        "tool-call-fs-budget-range-3"
      ),
    /already covers/,
  );
});

test("read_file_range enforces the per-file read budget across distinct windows", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-fs-budget-cap-"));
  const cwd = path.join(root, "workspace");
  const filePath = path.join(cwd, "notes.txt");
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(filePath, "1\n2\n3\n4\n5\n6\n7\n8\n9\n", "utf-8");

  const state = createState();
  await readFileRangeTool.execute(
    { path: "notes.txt", start_line: 1, end_line: 2 },
    {
      cwd,
      depth: 0,
      state,
    },
    "tool-call-fs-budget-cap-1"
  );
  await readFileRangeTool.execute(
    { path: "notes.txt", start_line: 3, end_line: 4 },
    {
      cwd,
      depth: 0,
      state,
    },
    "tool-call-fs-budget-cap-2"
  );
  await readFileRangeTool.execute(
    { path: "notes.txt", start_line: 5, end_line: 6 },
    {
      cwd,
      depth: 0,
      state,
    },
    "tool-call-fs-budget-cap-3"
  );

  await assert.rejects(
    () =>
      readFileRangeTool.execute(
        { path: "notes.txt", start_line: 7, end_line: 8 },
        {
          cwd,
          depth: 0,
          state,
        },
        "tool-call-fs-budget-cap-4"
      ),
    /exceeded per-file budget/,
  );
});
