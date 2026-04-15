import { randomUUID } from "node:crypto";

export type WorldLoggerOptions = {
  apiUrl: string;
  processName: string;
  parentId?: string;
};

export class WorldLogger {
  private processId = randomUUID();
  private apiUrl: string;
  private rpcId = 1;

  constructor(private options: WorldLoggerOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
  }

  get id() {
    return this.processId;
  }

  async start() {
    await this.rpc("process.upsert", {
      id: this.processId,
      name: this.options.processName,
      status: "running",
      parentId: this.options.parentId,
    });
  }

  async updateStatus(status: "ok" | "error" | "stopped" | "running") {
    await this.rpc("process.status", { id: this.processId, status });
  }

  async log(
    type:
      | "stdout"
      | "stderr"
      | "event"
      | "json_patch"
      | "session_id"
      | "ready"
      | "finished",
    content: string
  ) {
    const payload = {
      type,
      content: clamp(content, 10000),
      processId: this.processId,
    };
    await this.rpc("log.push", payload);
  }

  private async post(path: string, body: Record<string, unknown>) {
    try {
      await fetch(`${this.apiUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Ignore logging failures to avoid breaking agent flow.
    }
  }

  private async rpc(method: string, params: Record<string, unknown>) {
    const payload = {
      jsonrpc: "2.0",
      id: this.rpcId++,
      method,
      params,
    };
    await this.post("/api/rpc", payload);
  }
}

function clamp(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
}
