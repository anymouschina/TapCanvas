#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, ensureConfig, getAgentsHomeDir, writeGlobalConfig, resolveWorkspaceRoot } from "../core/config.js";
import { Message } from "../types/index.js";
import { listSessionSummaries } from "../core/memory/session.js";
import { startAgentsHttpServer } from "../server/http-server.js";
import { ensureDefaultBootstrapFiles } from "../core/workspace-context/bootstrap.js";
import { SkillLoader } from "../core/skills/loader.js";
import type { LlmTurnTrace, ToolCallTrace } from "../core/hooks/types.js";
import { resolveAgentRuntimeProfile } from "../runtime/profile.js";
import { createAssistantRuntime, type AssistantRuntime } from "../runtime/runtime.js";
import { resolveRuntimeSessionKey } from "../runtime/session.js";
import { readPromptFromStdin, previewToolCallOutput } from "../surfaces/cli/io.js";
import { startReplSession } from "../surfaces/tui/repl-session.js";

type Runtime = AssistantRuntime;

const program = new Command();

program
  .name("agents")
  .description("TypeScript 智能体种子")
  .version("0.1.0");

function scaffoldSkill(cwd: string, name: string) {
  const skillDir = path.join(cwd, "skills", name);
  if (fs.existsSync(skillDir)) {
    console.error("技能已存在。");
    process.exit(1);
  }
  fs.mkdirSync(skillDir, { recursive: true });
  for (const folder of ["assets", "references", "scripts"]) {
    fs.mkdirSync(path.join(skillDir, folder), { recursive: true });
  }
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(
    skillPath,
    [
      "---",
      `name: ${name}`,
      "description: 简要描述技能用途",
      "---",
      "",
      `# ${name}`,
      "- 目标: ",
      "- 输入: ",
      "- 输出: ",
      "- 示例: ",
    ].join("\n"),
    "utf-8"
  );
  console.log(`已创建技能: ${skillPath}`);
}

program
  .command("init")
  .description("初始化 agents 项目")
  .action(() => {
    const cwd = process.cwd();
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const configPath = path.join(cwd, "agents.config.json");
    if (!fs.existsSync(configPath)) {
      const config = loadConfig(cwd);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    }

    const skillsDir = path.join(cwd, "skills");
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const memoryDir = path.join(workspaceRoot, ".agents", "memory");
    fs.mkdirSync(memoryDir, { recursive: true });

    ensureDefaultBootstrapFiles(workspaceRoot);

    console.log("初始化完成。");
  });

program
  .command("run")
  .description("运行智能体")
  .argument("[prompt...]", "任务描述")
  .option("--no-stream", "关闭流式输出")
  .option("--session <id>", "使用指定会话 ID（用于跨多次运行续写）")
  .action(async (promptParts: string[], options) => {
    const prompt = promptParts.join(" ") || (await readPromptFromStdin());
    const runtime = createRuntime(options);

    if (!prompt) {
      if (process.stdin.isTTY) {
        await startReplSession(runtime);
        return;
      }
      console.error("缺少 prompt，请传入参数或通过 stdin 输入。");
      process.exit(1);
    }

    const sessionKey = resolveRuntimeSessionKey(options.session);
    const history = sessionKey ? runtime.loadSessionHistory(sessionKey) : null;

    await runtime.logger?.log("event", `user: ${prompt}`);
    const result = await runtime.run(prompt, {
      ...(sessionKey ? { sessionId: sessionKey } : {}),
      ...(history !== null ? { history } : {}),
      onToolCall: (toolCall) => {
        runtime.logger?.log(
          "event",
          `tool:${toolCall.name} status=${toolCall.status} args=${JSON.stringify(toolCall.args)}\n${toolCall.output}`
        );
        previewToolCallOutput(toolCall.name, toolCall.output);
      },
    });
    await runtime.logger?.log("stdout", result);
    if (sessionKey && history !== null) {
      try {
        runtime.saveSessionHistory(sessionKey, history);
      } catch {
        // ignore session persistence failures
      }
    }
    process.stdout.write(`${result}\n`);
  });

program
  .command("repl")
  .description("交互式会话")
  .option("--no-stream", "关闭流式输出")
  .option("--session <id>", "恢复或绑定到指定会话 ID")
  .action(async (options) => {
    const runtime = createRuntime(options);
    await startReplSession(runtime, {
      sessionKey: resolveRuntimeSessionKey(options.session),
    });
  });

program
  .command("sessions")
  .description("列出最近会话")
  .option("--limit <n>", "返回数量", "12")
  .action((options) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const limit = Number(options.limit);
    const sessions = listSessionSummaries(
      path.join(config.workspaceRoot, config.memoryDir, "sessions"),
      Number.isFinite(limit) ? limit : 12,
    );
    if (sessions.length === 0) {
      console.log("当前没有可恢复的会话。");
      return;
    }
    for (const session of sessions) {
      console.log(`${session.key}\t${session.messageCount} msgs\t${session.updatedAt}\t${session.preview}`);
    }
  });

program
  .command("resume")
  .description("恢复一个现有会话并进入 TUI")
  .argument("[sessionId]", "会话 ID；留空时自动选择最近会话")
  .option("--no-stream", "关闭流式输出")
  .action(async (sessionId: string | undefined, options) => {
    const cwd = process.cwd();
    const config = loadConfig(cwd);
    const pickedSessionId = resolveResumeSessionId({
      cwd,
      workspaceRoot: config.workspaceRoot,
      memoryDir: config.memoryDir,
      requestedSessionId: sessionId,
    });
    if (!pickedSessionId) {
      console.error("当前没有可恢复的会话。");
      process.exit(1);
    }
    const runtime = createRuntime(options);
    await startReplSession(runtime, {
      sessionKey: pickedSessionId,
    });
  });

program
  .command("serve")
  .description("启动 HTTP 服务（用于与外部进程通信）")
  .option("--host <host>", "监听地址", "127.0.0.1")
  .option("--port <port>", "监听端口", "8799")
  .option("--token <token>", "可选：鉴权 Token（Authorization: Bearer 或 X-Agents-Token）")
  .option("--body-limit <bytes>", "请求体大小限制（字节）", "8000000")
  .option("--no-stream", "关闭流式输出")
  .action(async (options) => {
    const runtime = createRuntime(options);
    const port = Number(options.port);
    const bodyLimitBytes = Number(options.bodyLimit);

    const server = await startAgentsHttpServer(
      {
        runner: runtime.runner,
        cwd: runtime.cwd,
        systemOverride: runtime.systemOverride,
        memoryDir: runtime.config.memoryDir,
        toolContextMeta: runtime.createToolContextMeta(),
      },
      {
        host: String(options.host || "127.0.0.1"),
        port: Number.isFinite(port) ? port : 8799,
        token: typeof options.token === "string" ? options.token : undefined,
        bodyLimitBytes: Number.isFinite(bodyLimitBytes) ? bodyLimitBytes : undefined,
      }
    );

    console.log(`[agents] HTTP server listening: ${server.url}`);
    console.log(`[agents] POST ${server.url}/chat`);
    console.log(`[agents] GET  ${server.url}/collab/status`);

    const stop = async (signal: string) => {
      try {
        console.log(`\n[agents] received ${signal}, shutting down...`);
        await server.close();
        await runtime.logger?.updateStatus("stopped");
      } finally {
        process.exit(0);
      }
    };

    process.on("SIGINT", () => void stop("SIGINT"));
    process.on("SIGTERM", () => void stop("SIGTERM"));
  });

const skill = program.command("skill").description("技能管理");

skill
  .command("new")
  .description("创建新技能")
  .argument("<name>", "技能名称")
  .action((name: string) => {
    scaffoldSkill(process.cwd(), name);
  });

program
  .command("create-skill")
  .description("创建新技能（skill new 的别名）")
  .argument("<name>", "技能名称")
  .action((name: string) => {
    scaffoldSkill(process.cwd(), name);
  });

program
  .command("global-init")
  .description("将当前配置写入全局 agents 根目录")
  .action(() => {
    const cwd = process.cwd();
    const config = ensureConfig(cwd);
    writeGlobalConfig(config);
    console.log(`已写入全局配置 ${path.join(getAgentsHomeDir(), "agents.config.json")}`);
  });

if (process.argv.length <= 2) {
  process.argv.push("repl");
}

function createRuntime(options: { stream?: boolean }): Runtime {
  const cwd = process.cwd();
  const config = ensureConfig(cwd);
  if (options.stream === false) {
    config.stream = false;
  }
  const runtime = createAssistantRuntime({
    cwd,
    config,
    profile: resolveAgentRuntimeProfile(),
  });

  process.on("exit", () => {
    void runtime.shutdown("ok");
  });
  process.on("SIGINT", () => {
    void runtime.shutdown("stopped");
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    void runtime.shutdown("stopped");
    process.exit(143);
  });

  return runtime;
}

function resolveResumeSessionId(input: {
  cwd: string;
  workspaceRoot: string;
  memoryDir: string;
  requestedSessionId?: string;
}): string | null {
  const explicit = String(input.requestedSessionId || "").trim();
  if (explicit) return explicit;
  const summaries = listSessionSummaries(
    path.join(input.workspaceRoot, input.memoryDir, "sessions"),
    1,
  );
  return summaries[0]?.key ?? null;
}

program.parse();
