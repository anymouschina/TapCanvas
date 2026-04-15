import fs from "node:fs";
import path from "node:path";

export type PersistedMailboxMessage = {
  id: string;
  toAgentId: string;
  fromAgentId?: string;
  subject?: string;
  body: string;
  createdAt: string;
  readAt?: string;
};

export type MailboxReadOptions = {
  includeRead?: boolean;
  limit?: number;
};

export class CollabMailboxStore {
  private readonly messagesDir: string;

  constructor(private readonly rootDir: string) {
    this.messagesDir = path.join(this.rootDir, "messages");
    fs.mkdirSync(this.messagesDir, { recursive: true });
  }

  saveMessage(record: PersistedMailboxMessage): void {
    this.writeJson(this.messagePath(record.id), record);
  }

  loadMessage(id: string): PersistedMailboxMessage | null {
    return this.readJson<PersistedMailboxMessage>(this.messagePath(id));
  }

  listMessagesForAgent(agentId: string, options?: MailboxReadOptions): PersistedMailboxMessage[] {
    const includeRead = options?.includeRead === true;
    const limit = Number.isFinite(options?.limit) ? Math.max(1, Math.trunc(options?.limit ?? 0)) : null;
    const filtered = this.listJson<PersistedMailboxMessage>(this.messagesDir)
      .filter((message) => message.toAgentId === agentId)
      .filter((message) => includeRead || !message.readAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return limit === null ? filtered : filtered.slice(0, limit);
  }

  markRead(ids: string[], readAt: string): PersistedMailboxMessage[] {
    const updated: PersistedMailboxMessage[] = [];
    for (const id of ids) {
      const current = this.loadMessage(id);
      if (!current || current.readAt) continue;
      const next: PersistedMailboxMessage = {
        ...current,
        readAt,
      };
      this.saveMessage(next);
      updated.push(next);
    }
    return updated;
  }

  unreadCount(agentId: string): number {
    return this.listMessagesForAgent(agentId).length;
  }

  private messagePath(id: string): string {
    return path.join(this.messagesDir, `${id}.json`);
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
