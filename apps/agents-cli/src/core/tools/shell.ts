import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { ToolHandler } from "./registry.js";
import {
  buildAgentShellEnv,
  enforceCapabilityShellPolicy,
  enforceProjectDataCommandPolicy,
  enforceScopedSearchPolicy,
  isDangerousShellCommand,
  isRestrictRepoKnowledgeReadEnabled,
} from "./shell-policy.js";

const execAsync = promisify(exec);

export const shellTool: ToolHandler = {
  definition: {
    name: "bash",
    description: "执行 shell 命令。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
      },
      required: ["command"],
    },
  },
  async execute(args, ctx, toolCallId) {
    const command = String(args.command ?? "");
    if (isRestrictRepoKnowledgeReadEnabled(ctx.meta)) {
      return {
        toolCallId: toolCallId || randomUUID(),
        content:
          "Error: bash is disabled under repo knowledge read restrictions. Use read_file/read_file_range on allowed roots only: assets, docs, ai-metadata, skills.",
      };
    }
    if (isDangerousShellCommand(command)) {
      return { toolCallId: toolCallId || randomUUID(), content: "Error: Dangerous command" };
    }
    const scopedSearchPolicyError = enforceScopedSearchPolicy(command, ctx.meta);
    if (scopedSearchPolicyError) {
      return { toolCallId: toolCallId || randomUUID(), content: scopedSearchPolicyError };
    }
    const projectDataPolicyError = enforceProjectDataCommandPolicy(command, ctx.meta, ctx.cwd);
    if (projectDataPolicyError) {
      return { toolCallId: toolCallId || randomUUID(), content: projectDataPolicyError };
    }
    const capabilityPolicyError = enforceCapabilityShellPolicy(command, ctx.meta, ctx.cwd);
    if (capabilityPolicyError) {
      return { toolCallId: toolCallId || randomUUID(), content: capabilityPolicyError };
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: ctx.cwd,
      env: buildAgentShellEnv(ctx.meta),
    });
    const combined = (stdout + stderr).trim() || "(no output)";
    const content = combined.slice(0, 50000);
    return {
      toolCallId: toolCallId || randomUUID(),
      content,
    };
  },
};
