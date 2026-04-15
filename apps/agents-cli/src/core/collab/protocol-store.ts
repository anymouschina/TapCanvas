import fs from "node:fs";
import path from "node:path";

export type PersistedProtocolRequestStatus = "pending" | "responded";
export type PersistedProtocolResponseStatus = "completed" | "failed";

export type PersistedProtocolRequest = {
  id: string;
  fromAgentId?: string;
  toAgentId: string;
  action: string;
  input: string;
  createdAt: string;
  updatedAt: string;
  status: PersistedProtocolRequestStatus;
  response?: {
    responderAgentId?: string;
    status: PersistedProtocolResponseStatus;
    output: string;
    respondedAt: string;
  };
};

export type ProtocolListOptions = {
  includeResponded?: boolean;
  limit?: number;
};

export class CollabProtocolStore {
  private readonly requestsDir: string;

  constructor(private readonly rootDir: string) {
    this.requestsDir = path.join(this.rootDir, "requests");
    fs.mkdirSync(this.requestsDir, { recursive: true });
  }

  saveRequest(record: PersistedProtocolRequest): void {
    this.writeJson(this.requestPath(record.id), record);
  }

  loadRequest(id: string): PersistedProtocolRequest | null {
    return this.readJson<PersistedProtocolRequest>(this.requestPath(id));
  }

  listRequestsForAgent(agentId: string, options?: ProtocolListOptions): PersistedProtocolRequest[] {
    const includeResponded = options?.includeResponded === true;
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.trunc(options?.limit ?? 0)) : null;
    const filtered = this.listJson<PersistedProtocolRequest>(this.requestsDir)
      .filter((request) => request.toAgentId === agentId)
      .filter((request) => includeResponded || request.status === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return limit === null ? filtered : filtered.slice(0, limit);
  }

  pendingCount(agentId: string): number {
    return this.listRequestsForAgent(agentId).length;
  }

  private requestPath(id: string): string {
    return path.join(this.requestsDir, `${id}.json`);
  }

  private writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  }

  private readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      return null;
    }
  }

  private listJson<T>(dir: string): T[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => this.readJson<T>(path.join(dir, name)))
      .filter((value): value is T => value !== null);
  }
}
