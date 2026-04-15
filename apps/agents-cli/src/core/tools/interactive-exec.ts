import { randomUUID } from "node:crypto";
import { ToolHandler } from "./registry.js";
import { TerminalSessionManager } from "../terminal/session-manager.js";
import {
  buildAgentShellEnv,
  enforceCapabilityShellPolicy,
  enforceProjectDataCommandPolicy,
  enforceScopedSearchPolicy,
  isDangerousShellCommand,
  isRestrictRepoKnowledgeReadEnabled,
} from "./shell-policy.js";

function readTerminalManager(meta: Record<string, unknown> | undefined): TerminalSessionManager {
  const manager = meta?.terminalSessionManager;
  if (!(manager instanceof TerminalSessionManager)) {
    throw new Error("interactive terminal manager unavailable");
  }
  return manager;
}

function parseCwd(args: Record<string, unknown>, fallbackCwd: string): string {
  const raw = String(args.workdir ?? "").trim();
  return raw || fallbackCwd;
}

export function createExecCommandTool(): ToolHandler {
  return {
    definition: {
      name: "exec_command",
      description: "Runs a command in a terminal session, returning output and optional session_id for follow-up polling.",
      parameters: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "Shell command to execute." },
          workdir: { type: "string", description: "Optional working directory for this command." },
          tty: { type: "boolean", description: "Whether to treat the session as interactive tty input." },
          yield_time_ms: {
            type: "number",
            description: "How long to wait before returning output for this call.",
          },
          max_output_tokens: {
            type: "number",
            description: "Maximum output tokens returned in this call.",
          },
        },
        required: ["cmd"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const command = String(args.cmd ?? "");
        if (isRestrictRepoKnowledgeReadEnabled(ctx.meta)) {
          return {
            toolCallId: toolCallId || randomUUID(),
            content:
              "Error: exec_command is disabled under repo knowledge read restrictions. Use read_file/read_file_range on allowed roots only: assets, docs, ai-metadata, skills.",
          };
        }
        if (isDangerousShellCommand(command)) {
          return { toolCallId: toolCallId || randomUUID(), content: "Error: Dangerous command" };
        }
        const scopedSearchPolicyError = enforceScopedSearchPolicy(command, ctx.meta);
        if (scopedSearchPolicyError) {
          return { toolCallId: toolCallId || randomUUID(), content: scopedSearchPolicyError };
        }
        const cwd = parseCwd(args, ctx.cwd);
        const projectDataPolicyError = enforceProjectDataCommandPolicy(command, ctx.meta, cwd);
        if (projectDataPolicyError) {
          return { toolCallId: toolCallId || randomUUID(), content: projectDataPolicyError };
        }
        const capabilityPolicyError = enforceCapabilityShellPolicy(command, ctx.meta, cwd);
        if (capabilityPolicyError) {
          return { toolCallId: toolCallId || randomUUID(), content: capabilityPolicyError };
        }

        const manager = readTerminalManager(ctx.meta);
        const response = await manager.execCommand({
          command,
          cwd,
          tty: args.tty === true,
          yieldTimeMs: Number(args.yield_time_ms ?? 10000),
          ...(Number.isFinite(Number(args.max_output_tokens))
            ? { maxOutputTokens: Number(args.max_output_tokens) }
            : {}),
          env: buildAgentShellEnv(ctx.meta),
        });
        return {
          toolCallId: toolCallId || randomUUID(),
          content: JSON.stringify(response, null, 2),
        };
      } catch (error) {
        return { toolCallId: toolCallId || randomUUID(), content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createWriteStdinTool(): ToolHandler {
  return {
    definition: {
      name: "write_stdin",
      description: "Write to an existing terminal session or poll output when chars is empty.",
      parameters: {
        type: "object",
        properties: {
          session_id: { type: "number", description: "Session id from exec_command response." },
          chars: { type: "string", description: "Bytes to write to stdin. Empty means polling output." },
          yield_time_ms: {
            type: "number",
            description: "How long to wait before returning output for this poll.",
          },
          max_output_tokens: {
            type: "number",
            description: "Maximum output tokens returned in this call.",
          },
        },
        required: ["session_id"],
      },
    },
    async execute(args, ctx, toolCallId) {
      try {
        const manager = readTerminalManager(ctx.meta);
        const sessionId = Number(args.session_id);
        if (!Number.isFinite(sessionId)) {
          throw new Error("write_stdin session_id must be a number");
        }
        const response = await manager.writeStdin({
          sessionId: Math.trunc(sessionId),
          chars: String(args.chars ?? ""),
          yieldTimeMs: Number(args.yield_time_ms ?? 250),
          ...(Number.isFinite(Number(args.max_output_tokens))
            ? { maxOutputTokens: Number(args.max_output_tokens) }
            : {}),
        });
        return {
          toolCallId: toolCallId || randomUUID(),
          content: JSON.stringify(response, null, 2),
        };
      } catch (error) {
        return { toolCallId: toolCallId || randomUUID(), content: `Error: ${(error as Error).message}` };
      }
    },
  };
}

export function createExecSessionListTool(): ToolHandler {
  return {
    definition: {
      name: "exec_list",
      description: "List current terminal sessions and statuses.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    async execute(_args, ctx, toolCallId) {
      try {
        const manager = readTerminalManager(ctx.meta);
        return {
          toolCallId: toolCallId || randomUUID(),
          content: JSON.stringify({ sessions: manager.list() }, null, 2),
        };
      } catch (error) {
        return { toolCallId: toolCallId || randomUUID(), content: `Error: ${(error as Error).message}` };
      }
    },
  };
}
