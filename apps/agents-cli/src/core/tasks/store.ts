import fs from "node:fs";
import path from "node:path";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "blocked";

export type TaskRecord = {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  blockedBy: string[];
  blocks: string[];
  owner: string;
  workspaceLane: string;
  createdAt: string;
  updatedAt: string;
};

type ClaimTaskInput = {
  owner: string;
  workspaceLane?: string;
};

type UpdateTaskInput = {
  subject?: string;
  description?: string;
  status?: TaskStatus;
  owner?: string;
  workspaceLane?: string;
  addBlockedBy?: string[];
  addBlocks?: string[];
};

export class TaskStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  create(input: {
    subject: string;
    description?: string;
    blockedBy?: string[];
    blocks?: string[];
    owner?: string;
    workspaceLane?: string;
  }): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: this.nextTaskId(),
      subject: requireNonEmpty(input.subject, "subject"),
      description: String(input.description ?? "").trim(),
      status: normalizeStatus(input.blockedBy?.length ? "blocked" : "pending"),
      blockedBy: normalizeIds(input.blockedBy),
      blocks: normalizeIds(input.blocks),
      owner: String(input.owner ?? "").trim(),
      workspaceLane: String(input.workspaceLane ?? "").trim(),
      createdAt: now,
      updatedAt: now,
    };
    this.save(task);
    this.syncReverseEdges(task.id, task.blocks, []);
    return task;
  }

  get(taskId: string): TaskRecord {
    const id = normalizeTaskId(taskId);
    const filePath = this.taskFilePath(id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`task not found: ${id}`);
    }
    return parseTask(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>);
  }

  list(): TaskRecord[] {
    const entries = fs.readdirSync(this.dir)
      .filter((name) => name.startsWith("task_") && name.endsWith(".json"))
      .sort();
    return entries.map((entry) => this.get(entry.replace(/\.json$/, "")));
  }

  update(taskId: string, input: UpdateTaskInput): TaskRecord {
    const current = this.get(taskId);
    const nextBlocks = mergeIds(current.blocks, input.addBlocks);
    const nextBlockedBy = mergeIds(current.blockedBy, input.addBlockedBy);
    const status = input.status
      ? normalizeStatus(input.status)
      : nextBlockedBy.length > 0 && current.status !== "completed" && current.status !== "failed"
        ? "blocked"
        : current.status === "blocked" && nextBlockedBy.length === 0
          ? "pending"
          : current.status;
    const updated: TaskRecord = {
      ...current,
      ...(typeof input.subject === "string" ? { subject: requireNonEmpty(input.subject, "subject") } : {}),
      ...(typeof input.description === "string" ? { description: input.description.trim() } : {}),
      ...(typeof input.owner === "string" ? { owner: input.owner.trim() } : {}),
      ...(typeof input.workspaceLane === "string"
        ? { workspaceLane: input.workspaceLane.trim() }
        : {}),
      status,
      blockedBy: nextBlockedBy,
      blocks: nextBlocks,
      updatedAt: new Date().toISOString(),
    };
    this.save(updated);
    this.syncReverseEdges(updated.id, updated.blocks, current.blocks);
    if (updated.status === "completed") {
      this.clearDependency(updated.id);
    }
    return this.get(updated.id);
  }

  renderBoard(): string {
    const tasks = this.list();
    if (tasks.length === 0) return "No tasks.";
    return tasks
      .map((task) => {
        const blocked = task.blockedBy.length ? ` blockedBy=${task.blockedBy.join(",")}` : "";
        const blocks = task.blocks.length ? ` blocks=${task.blocks.join(",")}` : "";
        const owner = task.owner ? ` owner=${task.owner}` : "";
        const lane = task.workspaceLane ? ` lane=${task.workspaceLane}` : "";
        return `- ${task.id} [${task.status}] ${task.subject}${owner}${lane}${blocked}${blocks}`;
      })
      .join("\n");
  }

  listClaimable(input?: { workspaceLane?: string }): TaskRecord[] {
    const requestedLane = normalizeLane(input?.workspaceLane);
    return this.list().filter((task) => {
      if (task.status !== "pending" || task.blockedBy.length > 0 || task.owner) return false;
      return matchesLane(task.workspaceLane, requestedLane);
    });
  }

  claim(taskId: string, input: ClaimTaskInput): TaskRecord {
    const current = this.get(taskId);
    const owner = requireNonEmpty(input.owner, "owner");
    const requestedLane = normalizeLane(input.workspaceLane);
    if (current.owner && current.owner !== owner) {
      throw new Error(`task already owned by ${current.owner}: ${current.id}`);
    }
    if (current.status === "completed" || current.status === "failed") {
      throw new Error(`task is not claimable in status ${current.status}: ${current.id}`);
    }
    if (current.blockedBy.length > 0) {
      throw new Error(`task is blocked and cannot be claimed: ${current.id}`);
    }
    if (!matchesLane(current.workspaceLane, requestedLane)) {
      const taskLane = current.workspaceLane || "<unassigned>";
      const agentLane = requestedLane || "<unassigned>";
      throw new Error(
        `task lane mismatch: task=${current.id} taskLane=${taskLane} agentLane=${agentLane}`
      );
    }
    return this.update(current.id, {
      owner,
      ...(requestedLane ? { workspaceLane: requestedLane } : {}),
      status: "in_progress",
    });
  }

  claimNextAvailable(input: ClaimTaskInput): TaskRecord | null {
    const next = this.listClaimable({ workspaceLane: input.workspaceLane })[0];
    if (!next) return null;
    return this.claim(next.id, input);
  }

  private nextTaskId(): string {
    const tasks = this.list();
    const max = tasks.reduce((acc, task) => {
      const match = task.id.match(/^task_(\d+)$/);
      if (!match) return acc;
      return Math.max(acc, Number(match[1]));
    }, 0);
    return `task_${String(max + 1).padStart(4, "0")}`;
  }

  private taskFilePath(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`);
  }

  private save(task: TaskRecord): void {
    fs.writeFileSync(this.taskFilePath(task.id), `${JSON.stringify(task, null, 2)}\n`, "utf-8");
  }

  private clearDependency(completedId: string): void {
    const tasks = this.list();
    for (const task of tasks) {
      if (!task.blockedBy.includes(completedId)) continue;
      const nextBlockedBy = task.blockedBy.filter((item) => item !== completedId);
      this.save({
        ...task,
        blockedBy: nextBlockedBy,
        status: nextBlockedBy.length === 0 && task.status === "blocked" ? "pending" : task.status,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private syncReverseEdges(taskId: string, nextBlocks: string[], previousBlocks: string[]): void {
    const removed = previousBlocks.filter((item) => !nextBlocks.includes(item));
    const added = nextBlocks.filter((item) => !previousBlocks.includes(item));
    for (const blockedTaskId of removed) {
      const task = this.get(blockedTaskId);
      this.save({
        ...task,
        blockedBy: task.blockedBy.filter((item) => item !== taskId),
        status: task.blockedBy.length <= 1 && task.status === "blocked" ? "pending" : task.status,
        updatedAt: new Date().toISOString(),
      });
    }
    for (const blockedTaskId of added) {
      const task = this.get(blockedTaskId);
      const blockedBy = mergeIds(task.blockedBy, [taskId]);
      this.save({
        ...task,
        blockedBy,
        status: task.status === "completed" || task.status === "failed" ? task.status : "blocked",
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

function normalizeTaskId(taskId: string): string {
  const normalized = String(taskId || "").trim();
  if (!normalized) throw new Error("taskId is required");
  return normalized;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function mergeIds(base: string[], extras?: string[]): string[] {
  return normalizeIds([...base, ...(extras ?? [])]);
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function normalizeLane(value: string | undefined): string {
  return String(value ?? "").trim();
}

function matchesLane(taskLane: string, requestedLane: string): boolean {
  const normalizedTaskLane = normalizeLane(taskLane);
  const normalizedRequestedLane = normalizeLane(requestedLane);
  if (!normalizedTaskLane) return true;
  return normalizedTaskLane === normalizedRequestedLane;
}

function normalizeStatus(status: string): TaskStatus {
  const normalized = String(status || "").trim().toLowerCase();
  if (
    normalized !== "pending" &&
    normalized !== "in_progress" &&
    normalized !== "completed" &&
    normalized !== "failed" &&
    normalized !== "blocked"
  ) {
    throw new Error(`invalid status: ${status}`);
  }
  return normalized;
}

function parseTask(raw: Record<string, unknown>): TaskRecord {
  return {
    id: requireNonEmpty(String(raw.id ?? ""), "id"),
    subject: requireNonEmpty(String(raw.subject ?? ""), "subject"),
    description: String(raw.description ?? "").trim(),
    status: normalizeStatus(String(raw.status ?? "pending")),
    blockedBy: normalizeIds(raw.blockedBy),
    blocks: normalizeIds(raw.blocks),
    owner: String(raw.owner ?? "").trim(),
    workspaceLane: String(raw.workspaceLane ?? "").trim(),
    createdAt: requireNonEmpty(String(raw.createdAt ?? ""), "createdAt"),
    updatedAt: requireNonEmpty(String(raw.updatedAt ?? ""), "updatedAt"),
  };
}
