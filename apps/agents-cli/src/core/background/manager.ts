import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export type BackgroundTaskStatus = "running" | "completed" | "failed";

export type BackgroundTaskRecord = {
  id: string;
  command: string;
  cwd: string;
  requestedBy: string;
  status: BackgroundTaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  resultPreview: string;
  outputPath: string;
  exitCode?: number;
  error?: string;
};

export type BackgroundNotificationRecord = {
  id: string;
  taskId: string;
  audience: string;
  status: "completed" | "failed";
  summary: string;
  createdAt: string;
  readAt?: string;
};

export class BackgroundTaskManager {
  private readonly tasksDir: string;
  private readonly notificationsDir: string;
  private readonly outputDir: string;

  constructor(private readonly rootDir: string) {
    this.tasksDir = path.join(this.rootDir, "tasks");
    this.notificationsDir = path.join(this.rootDir, "notifications");
    this.outputDir = path.join(this.rootDir, "output");
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.notificationsDir, { recursive: true });
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  start(input: { command: string; cwd: string; requestedBy: string; env?: Record<string, string> }): BackgroundTaskRecord {
    const command = String(input.command || "").trim();
    const cwd = String(input.cwd || "").trim();
    const requestedBy = String(input.requestedBy || "").trim() || "root";
    if (!command) throw new Error("background_run 缺少 command。");
    if (!cwd) throw new Error("background_run 缺少 cwd。");
    const id = `bg_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const outputPath = path.join(this.outputDir, `${id}.log`);
    const record: BackgroundTaskRecord = {
      id,
      command,
      cwd,
      requestedBy,
      status: "running",
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
      resultPreview: "",
      outputPath,
    };
    this.saveTask(record);

    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
        ...(input.env ?? {}),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stream = fs.createWriteStream(outputPath, { flags: "a" });
    child.stdout.pipe(stream);
    child.stderr.pipe(stream);
    child.on("error", (error) => {
      this.finishTask(record.id, {
        status: "failed",
        error: error.message,
        exitCode: undefined,
      });
    });
    child.on("close", (code) => {
      this.finishTask(record.id, {
        status: code === 0 ? "completed" : "failed",
        ...(typeof code === "number" ? { exitCode: code } : {}),
        ...(code === 0 ? {} : { error: `Process exited with code ${String(code)}` }),
      });
    });
    child.unref();
    return record;
  }

  get(taskId: string): BackgroundTaskRecord {
    const filePath = this.taskPath(taskId);
    if (!fs.existsSync(filePath)) throw new Error(`background task not found: ${taskId}`);
    return this.readJson<BackgroundTaskRecord>(filePath);
  }

  list(): BackgroundTaskRecord[] {
    return this.listJson<BackgroundTaskRecord>(this.tasksDir);
  }

  readOutput(taskId: string, limit = 4000): string {
    const record = this.get(taskId);
    if (!fs.existsSync(record.outputPath)) return "";
    const content = fs.readFileSync(record.outputPath, "utf-8");
    if (content.length <= limit) return content;
    return content.slice(-limit);
  }

  drainNotifications(audience: string): BackgroundNotificationRecord[] {
    const unread = this.listJson<BackgroundNotificationRecord>(this.notificationsDir)
      .filter((item) => !item.readAt && (item.audience === audience || item.audience === "root"))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (unread.length === 0) return [];
    const readAt = new Date().toISOString();
    for (const item of unread) {
      this.writeJson(this.notificationPath(item.id), {
        ...item,
        readAt,
      });
    }
    return unread;
  }

  private finishTask(
    taskId: string,
    result: { status: "completed" | "failed"; error?: string; exitCode?: number }
  ): void {
    const record = this.get(taskId);
    if (record.status !== "running") return;
    const finishedAt = new Date().toISOString();
    const output = this.readOutput(taskId, 1200).trim();
    const preview = output.length > 400 ? `${output.slice(0, 400)}…` : output;
    const next: BackgroundTaskRecord = {
      ...record,
      status: result.status,
      updatedAt: finishedAt,
      finishedAt,
      resultPreview: preview,
      ...(typeof result.exitCode === "number" ? { exitCode: result.exitCode } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
    this.saveTask(next);
    const notification: BackgroundNotificationRecord = {
      id: `notif_${randomUUID()}`,
      taskId: record.id,
      audience: record.requestedBy,
      status: result.status,
      summary:
        result.status === "completed"
          ? `后台任务 ${record.id} 已完成: ${preview || record.command}`
          : `后台任务 ${record.id} 失败: ${result.error || preview || record.command}`,
      createdAt: finishedAt,
    };
    this.writeJson(this.notificationPath(notification.id), notification);
  }

  private saveTask(record: BackgroundTaskRecord): void {
    this.writeJson(this.taskPath(record.id), record);
  }

  private taskPath(id: string): string {
    return path.join(this.tasksDir, `${id}.json`);
  }

  private notificationPath(id: string): string {
    return path.join(this.notificationsDir, `${id}.json`);
  }

  private writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  }

  private readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  }

  private listJson<T>(dir: string): T[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => this.readJson<T>(path.join(dir, name)));
  }
}
