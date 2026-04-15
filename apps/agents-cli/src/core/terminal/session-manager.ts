import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

type TerminalSessionStatus = "running" | "completed" | "failed";

export type TerminalSessionRecord = {
  id: number;
  command: string;
  cwd: string;
  tty: boolean;
  status: TerminalSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  outputChars: number;
};

type TerminalSessionState = {
  id: number;
  command: string;
  cwd: string;
  tty: boolean;
  status: TerminalSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  error?: string;
  child?: ChildProcessWithoutNullStreams;
  outputBuffer: string;
  outputBaseOffset: number;
  deliveredOffset: number;
  totalOutputChars: number;
  version: number;
  waiters: Set<() => void>;
};

export type ExecCommandRequest = {
  command: string;
  cwd: string;
  tty?: boolean;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
  env?: NodeJS.ProcessEnv;
};

export type WriteStdinRequest = {
  sessionId: number;
  chars?: string;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
};

export type ExecResponse = {
  chunk_id: string;
  wall_time_seconds: number;
  output: string;
  original_token_count: number;
  exit_code?: number;
  session_id?: number;
};

const DEFAULT_EXEC_YIELD_MS = 10_000;
const DEFAULT_WRITE_YIELD_MS = 250;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const MIN_YIELD_MS = 50;
const MAX_YIELD_MS = 30_000;
const MAX_BUFFER_CHARS = 1_000_000;

function nowIso(): string {
  return new Date().toISOString();
}

function clampYield(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WRITE_YIELD_MS;
  return Math.max(MIN_YIELD_MS, Math.min(MAX_YIELD_MS, Math.trunc(value)));
}

function resolveMaxOutputChars(maxOutputTokens: number | undefined): number {
  const normalizedTokens = Number.isFinite(maxOutputTokens)
    ? Math.max(1, Math.trunc(maxOutputTokens as number))
    : DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(512, normalizedTokens * 4);
}

function approxTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function makeChunkId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function truncateForOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function normalizeExitStatus(
  exitCode: number | null
): { status: "completed" | "failed"; exitCode?: number; error?: string } {
  if (exitCode === null) {
    return {
      status: "failed",
      error: "Process exited without a numeric code",
    };
  }
  if (exitCode === 0) {
    return {
      status: "completed",
      exitCode,
    };
  }
  return {
    status: "failed",
    exitCode,
    error: `Process exited with code ${String(exitCode)}`,
  };
}

export class TerminalSessionManager {
  private readonly sessions = new Map<number, TerminalSessionState>();
  private nextId = 1000;

  list(): TerminalSessionRecord[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((session) => this.toRecord(session));
  }

  async execCommand(request: ExecCommandRequest): Promise<ExecResponse> {
    const command = String(request.command || "").trim();
    const cwd = String(request.cwd || "").trim();
    const tty = request.tty === true;
    if (!command) throw new Error("exec_command 缺少 cmd。");
    if (!cwd) throw new Error("exec_command 缺少 cwd。");
    const session = this.startSession({
      command,
      cwd,
      tty,
      env: request.env,
    });
    const startedAtMs = Date.now();
    const delta = await this.waitForDelta(session, clampYield(request.yieldTimeMs ?? DEFAULT_EXEC_YIELD_MS));
    const consumedText = truncateForOutput(delta.text, resolveMaxOutputChars(request.maxOutputTokens));
    const response: ExecResponse = {
      chunk_id: makeChunkId(),
      wall_time_seconds: Math.max(0, (Date.now() - startedAtMs) / 1000),
      output: consumedText,
      original_token_count: approxTokenCount(delta.text),
      ...(typeof delta.exitCode === "number" ? { exit_code: delta.exitCode } : {}),
      ...(delta.status === "running" ? { session_id: session.id } : {}),
    };
    this.cleanupIfDoneAndDrained(session.id);
    return response;
  }

  async writeStdin(request: WriteStdinRequest): Promise<ExecResponse> {
    const session = this.sessions.get(request.sessionId);
    if (!session) {
      throw new Error(`write_stdin session not found: ${String(request.sessionId)}`);
    }
    if (session.status !== "running" && session.deliveredOffset >= session.outputBaseOffset + session.outputBuffer.length) {
      this.sessions.delete(session.id);
      throw new Error(`write_stdin session not running: ${String(request.sessionId)}`);
    }

    const input = String(request.chars ?? "");
    if (input.length > 0) {
      if (!session.tty) {
        throw new Error("write_stdin rejected: stdin is closed for non-tty session");
      }
      const child = session.child;
      if (!child || !child.stdin.writable) {
        throw new Error("write_stdin rejected: stdin is not writable");
      }
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(input, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }

    const startedAtMs = Date.now();
    const delta = await this.waitForDelta(session, clampYield(request.yieldTimeMs ?? DEFAULT_WRITE_YIELD_MS));
    const consumedText = truncateForOutput(delta.text, resolveMaxOutputChars(request.maxOutputTokens));
    const response: ExecResponse = {
      chunk_id: makeChunkId(),
      wall_time_seconds: Math.max(0, (Date.now() - startedAtMs) / 1000),
      output: consumedText,
      original_token_count: approxTokenCount(delta.text),
      ...(typeof delta.exitCode === "number" ? { exit_code: delta.exitCode } : {}),
      ...(delta.status === "running" ? { session_id: session.id } : {}),
    };
    this.cleanupIfDoneAndDrained(session.id);
    return response;
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.child?.kill();
    }
    this.sessions.clear();
  }

  private startSession(input: {
    command: string;
    cwd: string;
    tty: boolean;
    env?: NodeJS.ProcessEnv;
  }): TerminalSessionState {
    const id = this.nextId;
    this.nextId += 1;
    const startedAt = nowIso();
    const session: TerminalSessionState = {
      id,
      command: input.command,
      cwd: input.cwd,
      tty: input.tty,
      status: "running",
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
      outputBuffer: "",
      outputBaseOffset: 0,
      deliveredOffset: 0,
      totalOutputChars: 0,
      version: 0,
      waiters: new Set(),
    };

    const child = spawn("/bin/sh", ["-lc", input.command], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    session.child = child;
    this.sessions.set(id, session);

    child.stdout.on("data", (chunk: Buffer | string) => {
      this.appendOutput(id, chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      this.appendOutput(id, chunk.toString());
    });
    child.on("error", (error) => {
      this.finishSession(id, {
        status: "failed",
        error: error.message,
      });
    });
    child.on("close", (exitCode) => {
      this.finishSession(id, normalizeExitStatus(exitCode));
    });

    return session;
  }

  private appendOutput(sessionId: number, output: string): void {
    if (!output) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.outputBuffer += output;
    session.totalOutputChars += output.length;
    if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
      const dropped = session.outputBuffer.length - MAX_BUFFER_CHARS;
      session.outputBuffer = session.outputBuffer.slice(dropped);
      session.outputBaseOffset += dropped;
      if (session.deliveredOffset < session.outputBaseOffset) {
        session.deliveredOffset = session.outputBaseOffset;
      }
    }
    session.updatedAt = nowIso();
    session.version += 1;
    this.notifyWaiters(session);
  }

  private finishSession(
    sessionId: number,
    result: {
      status: "completed" | "failed";
      exitCode?: number;
      error?: string;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status !== "running") return;
    session.status = result.status;
    session.exitCode = result.exitCode;
    session.error = result.error;
    session.finishedAt = nowIso();
    session.updatedAt = session.finishedAt;
    session.child = undefined;
    session.version += 1;
    this.notifyWaiters(session);
  }

  private async waitForDelta(
    session: TerminalSessionState,
    timeoutMs: number
  ): Promise<{ status: TerminalSessionStatus; exitCode?: number; text: string }> {
    const deadline = Date.now() + timeoutMs;
    let version = session.version;
    while (Date.now() < deadline) {
      const delta = this.consumeDelta(session);
      if (delta.text.length > 0) return delta;
      if (delta.status !== "running") return delta;
      const remaining = Math.max(1, deadline - Date.now());
      await this.waitForChange(session, version, remaining);
      version = session.version;
    }
    return this.consumeDelta(session);
  }

  private consumeDelta(
    session: TerminalSessionState
  ): { status: TerminalSessionStatus; exitCode?: number; text: string } {
    const absoluteEnd = session.outputBaseOffset + session.outputBuffer.length;
    const startOffset = Math.max(session.deliveredOffset, session.outputBaseOffset);
    const relativeStart = Math.max(0, startOffset - session.outputBaseOffset);
    const text = session.outputBuffer.slice(relativeStart);
    session.deliveredOffset = absoluteEnd;
    return {
      status: session.status,
      ...(typeof session.exitCode === "number" ? { exitCode: session.exitCode } : {}),
      text,
    };
  }

  private waitForChange(session: TerminalSessionState, version: number, timeoutMs: number): Promise<void> {
    if (session.version !== version) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.waiters.delete(notify);
        resolve();
      };
      const notify = () => done();
      const timer = setTimeout(done, timeoutMs);
      session.waiters.add(notify);
    });
  }

  private notifyWaiters(session: TerminalSessionState): void {
    const waiters = Array.from(session.waiters);
    session.waiters.clear();
    for (const notify of waiters) notify();
  }

  private cleanupIfDoneAndDrained(sessionId: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status === "running") return;
    const absoluteEnd = session.outputBaseOffset + session.outputBuffer.length;
    if (session.deliveredOffset < absoluteEnd) return;
    this.sessions.delete(sessionId);
  }

  private toRecord(session: TerminalSessionState): TerminalSessionRecord {
    return {
      id: session.id,
      command: session.command,
      cwd: session.cwd,
      tty: session.tty,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      startedAt: session.startedAt,
      ...(session.finishedAt ? { finishedAt: session.finishedAt } : {}),
      ...(typeof session.exitCode === "number" ? { exitCode: session.exitCode } : {}),
      ...(session.error ? { error: session.error } : {}),
      outputChars: session.totalOutputChars,
    };
  }
}
