import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveWorkspaceContext } from "./assembler.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-workspace-context-"));
  tempDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

test("resolveWorkspaceContext loads persona files before project context so SOUL is not crowded out", async () => {
  const workspaceRoot = await createTempWorkspace();
  await fs.writeFile(path.join(workspaceRoot, "SOUL.md"), "S".repeat(1800), "utf8");
  await fs.mkdir(path.join(workspaceRoot, ".agents", "context"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, ".agents", "context", "PROJECT.md"),
    "P".repeat(2200),
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceRoot, ".agents", "context", "RULES.md"),
    "R".repeat(2200),
    "utf8",
  );

  const context = await resolveWorkspaceContext({
    workspaceRoot,
    cwd: workspaceRoot,
    maxCharsPerFile: 3000,
    maxTotalChars: 2500,
  });

  assert.equal(
    context.files[0]?.name === "SOUL.md" || context.files[0]?.name === "IDENTITY.md",
    true,
  );
  assert.equal(
    context.files.some((file) => file.name === "SOUL.md"),
    true,
  );
});

test("resolveWorkspaceContext separates persona context from workspace facts in prompt fragment", async () => {
  const workspaceRoot = await createTempWorkspace();
  await fs.writeFile(path.join(workspaceRoot, "IDENTITY.md"), "# identity", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "SOUL.md"), "# soul", "utf8");
  await fs.mkdir(path.join(workspaceRoot, ".agents", "context"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, ".agents", "context", "PROJECT.md"),
    "# project",
    "utf8",
  );

  const context = await resolveWorkspaceContext({
    workspaceRoot,
    cwd: workspaceRoot,
  });

  assert.match(context.promptFragment, /## Persona Context/);
  assert.match(context.promptFragment, /## Workspace Context/);
  assert.match(context.promptFragment, /以下文件定义助手身份、判断方式与协作风格/);
  assert.match(context.promptFragment, /以下文件为本次运行的项目\/工作区上下文/);
  assert.ok(
    context.promptFragment.indexOf("### SOUL.md") < context.promptFragment.indexOf("### PROJECT.md"),
  );
});

test("resolveWorkspaceContext also loads persona files from cwd when workspaceRoot points higher", async () => {
  const repoRoot = await createTempWorkspace();
  const agentsCliDir = path.join(repoRoot, "apps", "agents-cli");
  await fs.mkdir(agentsCliDir, { recursive: true });
  await fs.writeFile(path.join(agentsCliDir, "IDENTITY.md"), "# identity", "utf8");
  await fs.writeFile(path.join(agentsCliDir, "SOUL.md"), "# soul", "utf8");

  const previousCwd = process.cwd();
  process.chdir(agentsCliDir);
  try {
    const context = await resolveWorkspaceContext({
      workspaceRoot: repoRoot,
      cwd: agentsCliDir,
    });
    assert.equal(
      context.files.some((file) => file.name === "SOUL.md" && file.path.endsWith("apps/agents-cli/SOUL.md")),
      true,
    );
    assert.equal(
      context.files.some((file) => file.name === "IDENTITY.md" && file.path.endsWith("apps/agents-cli/IDENTITY.md")),
      true,
    );
  } finally {
    process.chdir(previousCwd);
  }
});
