import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_TYPES,
  getSystemPromptForAgent,
  getAgentTypeNames,
  getTeamAgentDescriptions,
  getTeamAgentTypes,
  getToolsForAgent,
  isAgentType,
} from "./types.js";

test("team agent types expose orchestration and execution roles", () => {
  const teamRoles = getTeamAgentTypes();
  assert.ok(teamRoles.includes("orchestrator"));
  assert.ok(teamRoles.includes("worker"));
  assert.ok(teamRoles.includes("reviewer"));
  assert.ok(teamRoles.includes("research"));

  const descriptions = getTeamAgentDescriptions();
  assert.match(descriptions, /orchestrator/);
  assert.match(descriptions, /worker/);
  assert.match(descriptions, /reviewer/);
});

test("orchestrator and worker receive the expected generic tool sets", () => {
  const orchestratorTools = getToolsForAgent("orchestrator");
  assert.ok(orchestratorTools.has("spawn_agent"));
  assert.ok(orchestratorTools.has("send_input"));
  assert.ok(orchestratorTools.has("resume_agent"));
  assert.ok(orchestratorTools.has("wait"));
  assert.ok(orchestratorTools.has("list_agents"));
  assert.ok(orchestratorTools.has("agent_workspace_import"));
  assert.ok(orchestratorTools.has("mailbox_send"));
  assert.ok(orchestratorTools.has("mailbox_read"));
  assert.ok(orchestratorTools.has("protocol_request"));
  assert.ok(orchestratorTools.has("protocol_get"));
  assert.ok(orchestratorTools.has("task_create"));
  assert.ok(orchestratorTools.has("task_list"));
  assert.ok(orchestratorTools.has("exec_command"));
  assert.ok(orchestratorTools.has("write_stdin"));
  assert.equal(orchestratorTools.has("tapcanvas_flow_get"), false);

  const workerTools = getToolsForAgent("worker");
  assert.ok(workerTools.has("write_file"));
  assert.ok(workerTools.has("edit_file"));
  assert.ok(workerTools.has("TodoWrite"));
  assert.ok(workerTools.has("task_update"));
  assert.ok(workerTools.has("memory_search"));
  assert.ok(workerTools.has("exec_command"));
  assert.ok(workerTools.has("write_stdin"));
  assert.ok(workerTools.has("mailbox_send"));
  assert.ok(workerTools.has("mailbox_read"));
  assert.ok(workerTools.has("protocol_read"));
  assert.ok(workerTools.has("protocol_respond"));
  assert.equal(workerTools.has("spawn_agent"), false);
  assert.equal(workerTools.has("agent_workspace_import"), false);
  assert.equal(workerTools.has("tapcanvas_flow_patch"), false);
});

test("agent type registry is the single source of truth", () => {
  const names = getAgentTypeNames();
  assert.ok(names.includes("explore"));
  assert.ok(names.includes("plan"));
  assert.ok(names.includes("code"));
  assert.ok(names.includes("writer"));
  assert.ok(names.includes("editor"));
  assert.ok(names.includes("orchestrator"));
  assert.equal(isAgentType("worker"), true);
  assert.equal(isAgentType("not-real"), false);
});

test("worker extends the base implementation tool bounds with team mailbox tools", () => {
  const codeTools = getToolsForAgent("code");
  const workerTools = getToolsForAgent("worker");

  assert.ok(codeTools.has("write_file"));
  assert.ok(codeTools.has("memory_reflect"));
  assert.equal(codeTools.has("spawn_agent"), false);
  assert.equal(codeTools.has("mailbox_send"), false);
  assert.equal(codeTools.has("protocol_request"), false);

  for (const tool of codeTools) {
    assert.ok(workerTools.has(tool));
  }
  assert.ok(workerTools.has("mailbox_send"));
  assert.ok(workerTools.has("mailbox_read"));
  assert.ok(workerTools.has("protocol_read"));
  assert.ok(workerTools.has("protocol_respond"));
});

test("non-orchestrator team child tools inherit parent grant but drop coordination controls", () => {
  const inheritedTools = getToolsForAgent("reviewer", {
    inheritedTools: [
      "bash",
      "write_file",
      "edit_file",
      "background_run",
      "memory_search",
      "task_update",
      "send_input",
      "resume_agent",
      "wait",
      "close_agent",
      "list_agents",
      "agent_workspace_import",
      "spawn_agent",
      "Task",
    ],
    blockDelegation: true,
  });

  assert.ok(inheritedTools.has("bash"));
  assert.ok(inheritedTools.has("write_file"));
  assert.ok(inheritedTools.has("edit_file"));
  assert.ok(inheritedTools.has("background_run"));
  assert.ok(inheritedTools.has("memory_search"));
  assert.ok(inheritedTools.has("task_update"));
  assert.ok(inheritedTools.has("mailbox_send"));
  assert.ok(inheritedTools.has("protocol_read"));
  assert.equal(inheritedTools.has("send_input"), false);
  assert.equal(inheritedTools.has("resume_agent"), false);
  assert.equal(inheritedTools.has("wait"), false);
  assert.equal(inheritedTools.has("close_agent"), false);
  assert.equal(inheritedTools.has("list_agents"), false);
  assert.equal(inheritedTools.has("agent_workspace_import"), false);
  assert.equal(inheritedTools.has("spawn_agent"), false);
  assert.equal(inheritedTools.has("Task"), false);
});

test("orchestrator child keeps coordination controls while still blocking further delegation", () => {
  const inheritedTools = getToolsForAgent("orchestrator", {
    inheritedTools: ["Task"],
    blockDelegation: true,
  });

  assert.ok(inheritedTools.has("send_input"));
  assert.ok(inheritedTools.has("resume_agent"));
  assert.ok(inheritedTools.has("wait"));
  assert.ok(inheritedTools.has("close_agent"));
  assert.ok(inheritedTools.has("list_agents"));
  assert.ok(inheritedTools.has("agent_workspace_import"));
  assert.equal(inheritedTools.has("spawn_agent"), false);
  assert.equal(inheritedTools.has("Task"), false);
});

test("system prompt lookup returns the per-agent role contract", () => {
  assert.equal(
    getSystemPromptForAgent("reviewer"),
    AGENT_TYPES.reviewer.prompt
  );
  assert.match(getSystemPromptForAgent("reviewer"), /inspect evidence, verify claims, and surface concrete risks/i);
});
