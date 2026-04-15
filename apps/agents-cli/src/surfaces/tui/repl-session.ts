import path from "node:path";

import type { Message } from "../../types/index.js";
import type { LlmTurnTrace, ToolCallTrace } from "../../core/hooks/types.js";
import type { AssistantRuntime } from "../../runtime/runtime.js";
import { appendReplPromptHistory, loadReplPromptHistory } from "../../cli/repl-history.js";
import { copyTextToClipboard } from "../../cli/repl-clipboard.js";
import { ReplTui, renderReplHelp } from "../../cli/repl-input.js";
import { SkillLoader } from "../../core/skills/loader.js";
import { resolveRuntimeSessionKey } from "../../runtime/session.js";
import type { RuntimeRunEvent } from "../../runtime/events.js";

type ReplRunRenderer = {
  onTextDelta: (delta: string) => void;
  onToolCall: (toolCall: ToolCallTrace) => void;
  onTurn: (turn: LlmTurnTrace) => void;
  finalize: (result: string) => void;
};

function createReplRunRenderer(): ReplRunRenderer {
  return {
    onTextDelta(_delta: string) {},
    onToolCall(_toolCall: ToolCallTrace) {},
    onTurn(_turn: LlmTurnTrace) {},
    finalize(_result: string) {},
  };
}

type ReplSessionState = {
  sessionKey: string | null;
  history: Message[];
};

export function resolveResumeSessionKey(
  requestedKey: string,
  recentSessions: Array<{ key: string }>,
): string {
  const trimmed = requestedKey.trim();
  if (!trimmed) return "";
  if (!/^\d+$/u.test(trimmed)) return trimmed;
  return recentSessions[Number(trimmed) - 1]?.key ?? "";
}

export async function startReplSession(
  runtime: AssistantRuntime,
  options?: { sessionKey?: string | null },
): Promise<void> {
  const promptHistoryPath = path.join(runtime.config.workspaceRoot, ".agents", "repl-history.jsonl");
  const promptHistory = loadReplPromptHistory(promptHistoryPath);
  const state: ReplSessionState = {
    sessionKey: options?.sessionKey ?? resolveRuntimeSessionKey(undefined),
    history: [],
  };
  if (state.sessionKey) {
    state.history = runtime.loadSessionHistory(state.sessionKey);
  }
  let lastAssistantReply = "";
  const repl = new ReplTui({
    skills: runtime.skills,
    historyEntries: promptHistory,
    onCopyLastAssistant: async () => copyTextToClipboard(lastAssistantReply).message,
    contextLabel: buildContextLabel(runtime, state.sessionKey),
  });

  console.log(`Mini Claude Code v4 (with Skills) - ${runtime.cwd}`);
  console.log(`Skills: ${runtime.skills.listSkills().join(", ") || "none"}`);
  console.log("Agent types: explore, plan, code");
  console.log("输入 '/' 可查看本地命令与技能候选。");
  console.log(renderReplHelp());
  console.log(`Session: ${state.sessionKey ?? "ephemeral"}`);
  console.log("Type 'exit' to quit.\n");
  if (state.sessionKey && state.history.length > 0) {
    repl.hydrateTranscript(state.history);
    repl.addSystemNote(`已恢复会话 ${state.sessionKey}，载入 ${state.history.length} 条消息。`);
  }

  try {
    while (true) {
      const answer = repl.takeQueuedPrompt() ?? await repl.promptForInput({ prompt: "You: " });
      if (answer === null) {
        await runtime.shutdown("stopped");
        process.stdout.write("\n");
        break;
      }
      const rawInput = answer.trim();
      if (!rawInput || ["exit", "quit", "q"].includes(rawInput.toLowerCase())) {
        await runtime.shutdown("stopped");
        break;
      }
      if (await handleLocalReplCommand(rawInput, lastAssistantReply, repl, runtime, state)) {
        continue;
      }
      const input = resolveSlashInput(rawInput, runtime.skills);
      if (!input) continue;
      appendReplPromptHistory(promptHistoryPath, rawInput);
      if (promptHistory[promptHistory.length - 1] !== rawInput) {
        promptHistory.push(rawInput);
      }
      repl.addHistoryEntry(rawInput);
      repl.addUserMessage(rawInput);
      repl.startRun();
      try {
        const replRenderer = createReplRunRenderer();
        await runtime.logger?.log("event", `user: ${input}`);
        const result = await runtime.run(input, {
          history: state.history,
          ...(state.sessionKey ? { sessionId: state.sessionKey } : {}),
          channel: {
            kind: "tui",
            transport: "interactive",
            surface: "repl",
            ...(state.sessionKey ? { sessionId: state.sessionKey } : {}),
          },
          eventSink: (event: RuntimeRunEvent) => {
            repl.applyRuntimeEvent(event);
            if (event.type === "run.failed") {
              repl.addSystemNote(`运行失败：${event.message}`);
            }
          },
          onTextDelta: (delta) => {
            replRenderer.onTextDelta(delta);
            repl.appendAssistantDelta(delta);
          },
          onTurn: (turn) => {
            replRenderer.onTurn(turn);
            repl.addTurnSummary(turn);
          },
          onToolCall: (toolCall) => {
            runtime.logger?.log(
              "event",
              `tool:${toolCall.name} status=${toolCall.status} args=${JSON.stringify(toolCall.args)}\n${toolCall.output}`,
            );
            replRenderer.onToolCall(toolCall);
            repl.addToolCall(toolCall);
          },
        });
        await runtime.logger?.log("stdout", result);
        lastAssistantReply = result;
        if (state.sessionKey) {
          runtime.saveSessionHistory(state.sessionKey, state.history);
        }
        replRenderer.finalize(result);
        repl.finalizeAssistant(result);
      } catch (error) {
        await runtime.logger?.log("stderr", (error as Error).message);
        await runtime.shutdown("error");
        repl.addSystemNote(`Error: ${(error as Error).message}`);
        repl.finishRun();
      }
    }
  } finally {
    repl.shutdown();
    if (process.stdin.isTTY) {
      process.stdin.pause();
    }
  }
}

async function handleLocalReplCommand(
  input: string,
  lastAssistantReply: string,
  repl: ReplTui,
  runtime: AssistantRuntime,
  state: ReplSessionState,
): Promise<boolean> {
  const normalized = input.trim().toLowerCase();
  if (normalized === "/help") {
    repl.addSystemNote(renderReplHelp());
    return true;
  }
  if (normalized === "/clear") {
    repl.clearTranscript();
    return true;
  }
  if (normalized === "/copy") {
    const result = copyTextToClipboard(lastAssistantReply);
    repl.addSystemNote(result.message);
    return true;
  }
  if (normalized === "/status") {
    repl.addSystemNote(
      [
        `Profile: ${runtime.profile}`,
        `Session: ${state.sessionKey ?? "ephemeral"}`,
        `Tools: ${runtime.registeredToolNames.length}`,
        `Team Tools: ${runtime.registeredTeamToolNames.length}`,
        `Skills: ${runtime.skills.listSkills().length}`,
      ].join("\n"),
    );
    return true;
  }
  if (normalized === "/sessions") {
    const summaries = runtime.listSessions(8);
    if (summaries.length === 0) {
      repl.addSystemNote("当前没有可恢复的会话。");
      return true;
    }
    repl.openSessionPicker(summaries, state.sessionKey);
    return true;
  }
  if (normalized === "/resume") {
    const summaries = runtime.listSessions(8);
    if (summaries.length === 0) {
      repl.addSystemNote("当前没有可恢复的会话。");
      return true;
    }
    repl.openSessionPicker(summaries, state.sessionKey);
    return true;
  }
  if (normalized.startsWith("/resume ")) {
    const requestedKey = input.trim().slice("/resume ".length).trim();
    const recentSessions = runtime.listSessions(8);
    const sessionKey = resolveResumeSessionKey(requestedKey, recentSessions);
    if (!sessionKey) {
      repl.addSystemNote("用法: /resume <id>");
      return true;
    }
    const restoredHistory = runtime.loadSessionHistory(sessionKey);
    const knownRecentSession = recentSessions.some((item) => item.key === sessionKey);
    if (restoredHistory.length === 0 && !knownRecentSession) {
      repl.addSystemNote(`未找到会话 ${sessionKey}。可先用 /sessions 查看最近会话。`);
      return true;
    }
    state.sessionKey = sessionKey;
    state.history.splice(0, state.history.length, ...restoredHistory);
    repl.setContextLabel(buildContextLabel(runtime, state.sessionKey));
    repl.hydrateTranscript(state.history);
    repl.addSystemNote(`已恢复会话 ${sessionKey}，载入 ${state.history.length} 条消息。`);
    return true;
  }
  if (normalized === "/new" || normalized.startsWith("/new ")) {
    const requested = input.trim().slice("/new".length).trim();
    state.sessionKey = requested || buildReplSessionKey();
    state.history.splice(0, state.history.length);
    repl.setContextLabel(buildContextLabel(runtime, state.sessionKey));
    repl.clearTranscript();
    repl.addSystemNote(`已切换到新会话 ${state.sessionKey}。`);
    return true;
  }
  return false;
}

function resolveSlashInput(input: string, skills: SkillLoader): string | null {
  const normalized = input.trim();
  if (!normalized.startsWith("/")) return input;

  const [command, ...restParts] = normalized.split(/\s+/);
  const slashCommand = command.toLowerCase();
  if (!["/", "/skills", "/skill"].includes(slashCommand)) {
    console.log("仅支持 agent 斜杠命令: /, /skills, /skill <name> [task]。本地命令见 /help。\n");
    return null;
  }

  if (slashCommand === "/" || slashCommand === "/skills") {
    console.log("请先输入 '/' 并通过上下键选择技能，按 Tab 自动补全。\n");
    return null;
  }

  const [picked, ...taskParts] = restParts;
  const skillName = String(picked || "").trim();
  if (!skillName) {
    console.log("用法: /skill <name> [task]\n");
    return null;
  }

  skills.reloadSkills();
  const summaries = skills.listSkillSummaries();
  const resolved = resolveSelectedSkillName(skillName, summaries);
  if (!resolved) {
    const names = summaries.map((item) => item.name).join(", ") || "无";
    console.log(`未知技能: ${skillName}。可用: ${names}\n`);
    return null;
  }

  const task = taskParts.join(" ").trim();
  if (!task) {
    return `请先调用 Skill 工具加载技能 "${resolved}"，并回复“技能已加载，等待任务”。`;
  }

  return `请先调用 Skill 工具加载技能 "${resolved}"，然后完成以下任务：${task}`;
}

function resolveSelectedSkillName(
  picked: string,
  summaries: Array<{ name: string; description: string }>,
): string | null {
  if (/^\d+$/.test(picked)) {
    const index = Number(picked) - 1;
    if (index >= 0 && index < summaries.length) {
      return summaries[index].name;
    }
    return null;
  }

  const exact = summaries.find((item: { name: string }) => item.name === picked);
  if (exact) return exact.name;

  const ci = summaries.find((item: { name: string }) => item.name.toLowerCase() === picked.toLowerCase());
  return ci?.name ?? null;
}

function buildReplSessionKey(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    "repl",
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join("-");
}

function buildContextLabel(runtime: AssistantRuntime, sessionKey: string | null): string {
  return `profile=${runtime.profile} · session=${sessionKey ?? "ephemeral"}`;
}
