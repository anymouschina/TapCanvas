import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { shellTool } from "./shell.js";

function createState() {
  return {
    cache: { readFile: new Map(), bash: new Map() },
    guard: { duplicateToolCallLimit: 3, duplicateToolCallCount: new Map() },
  };
}

test("bash restricts project-data access to declared localResourcePaths", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-shell-"));
  const cwd = path.join(root, "apps", "agents-cli");
  fs.mkdirSync(cwd, { recursive: true });
  const filePath = path.join(root, "project-data", "users", "u1", "projects", "p1", "note.txt");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "hello-shell-project-data", "utf-8");

  const allowed = await shellTool.execute(
    {
      command:
        `cd ${root} && cat project-data/users/u1/projects/p1/note.txt`,
    },
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
    "tool-call-shell-1"
  );

  assert.match(allowed.content, /hello-shell-project-data/);

  const denied = await shellTool.execute(
    {
      command: "find project-data -maxdepth 3 -type f",
    },
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
    "tool-call-shell-2"
  );

  assert.match(denied.content, /must target a specific declared project-data subtree/);

  const deniedTraversal = await shellTool.execute(
    {
      command: "find . -maxdepth 3 -type f",
    },
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
    "tool-call-shell-3"
  );

  assert.match(deniedTraversal.content, /escapes scoped local evidence gathering/);
});

test("bash allows quoted declared project-data paths for filesystem commands", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-shell-quoted-"));
  const cwd = path.join(root, "apps", "agents-cli");
  fs.mkdirSync(cwd, { recursive: true });
  const filePath = path.join(root, "project-data", "users", "u1", "projects", "p1", "shot.txt");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "quoted-project-data-ok", "utf-8");

  const allowed = await shellTool.execute(
    {
      command: `cat '${filePath}'`,
    },
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
    "tool-call-shell-quoted-1"
  );

  assert.match(allowed.content, /quoted-project-data-ok/);
});

test("bash does not block plain quoted project-data text when no filesystem command runs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-shell-printf-"));
  const cwd = path.join(root, "apps", "agents-cli");
  fs.mkdirSync(cwd, { recursive: true });

  const allowed = await shellTool.execute(
    {
      command: "printf '%s' 'project-data/users/u1/projects/p1'",
    },
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
    "tool-call-shell-printf-1"
  );

  assert.match(allowed.content, /project-data\/users\/u1\/projects\/p1/);
});

test("bash blocks writes when capability writableRoots are empty", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-shell-cap-"));
  const cwd = path.join(root, "workspace");
  fs.mkdirSync(cwd, { recursive: true });

  const denied = await shellTool.execute(
    {
      command: "touch blocked.txt",
    },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: cwd,
        capabilityGrant: {
          tools: ["bash"],
          readableRoots: [cwd],
          writableRoots: [],
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
    "tool-call-shell-cap-1"
  );

  assert.match(denied.content, /blocked by capability writableRoots/);
});

test("bash blocks read paths outside capability readableRoots", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-shell-cap-read-"));
  const cwd = path.join(root, "workspace");
  const allowedDir = path.join(cwd, "allowed");
  const deniedDir = path.join(cwd, "denied");
  fs.mkdirSync(allowedDir, { recursive: true });
  fs.mkdirSync(deniedDir, { recursive: true });
  fs.writeFileSync(path.join(allowedDir, "ok.txt"), "ok", "utf-8");
  fs.writeFileSync(path.join(deniedDir, "no.txt"), "no", "utf-8");

  const allowed = await shellTool.execute(
    {
      command: `cat ${path.join(allowedDir, "ok.txt")}`,
    },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: cwd,
        capabilityGrant: {
          tools: ["bash"],
          readableRoots: [allowedDir],
          writableRoots: [],
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
    "tool-call-shell-cap-2"
  );

  assert.match(allowed.content, /^ok$/);

  const denied = await shellTool.execute(
    {
      command: `cat ${path.join(deniedDir, "no.txt")}`,
    },
    {
      cwd,
      depth: 0,
      meta: {
        workspaceRoot: cwd,
        capabilityGrant: {
          tools: ["bash"],
          readableRoots: [allowedDir],
          writableRoots: [],
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
    "tool-call-shell-cap-3"
  );

  assert.match(denied.content, /outside capability readableRoots/);
});
