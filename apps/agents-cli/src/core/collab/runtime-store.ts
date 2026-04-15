import fs from "node:fs";
import path from "node:path";
import {
  AgentExecutionMode,
  AgentIsolationMode,
  CapabilityGrant,
  CapabilityProviderKind,
} from "../../types/index.js";

export type PersistedAgentStatus = "queued" | "running" | "idle" | "completed" | "failed" | "closed";
export type PersistedSubmissionStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type PersistedAgentRecord = {
  id: string;
  description: string;
  agentType: string;
  executionMode?: AgentExecutionMode;
  isolationMode?: AgentIsolationMode;
  skillBundle?: string[];
  capabilityProviderBundle?: CapabilityProviderKind[];
  capabilityGrant?: CapabilityGrant;
  modelOverride?: string;
  agentWorkRoot?: string;
  autonomous?: boolean;
  claimedTaskId?: string;
  idleSince?: string;
  idleRequested?: boolean;
  depth: number;
  parentAgentId?: string;
  status: PersistedAgentStatus;
  createdAt: string;
  updatedAt: string;
  pendingTasks: number;
  completedTasks: number;
  lastSubmissionId?: string;
  activeSubmissionId?: string;
  recentSubmissionIds: string[];
  lastResult?: string;
  lastError?: string;
  closed: boolean;
};

export type PersistedSubmissionRecord = {
  id: string;
  agentId: string;
  prompt: string;
  status: PersistedSubmissionStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: string;
  error?: string;
  runStartedAt?: string;
  budgetMs?: number;
  lastProgressAt?: string;
  lastProgressSummary?: string;
};

export class CollabRuntimeStore {
  private readonly agentsDir: string;
  private readonly submissionsDir: string;

  constructor(private readonly rootDir: string) {
    this.agentsDir = path.join(this.rootDir, "agents");
    this.submissionsDir = path.join(this.rootDir, "submissions");
    fs.mkdirSync(this.agentsDir, { recursive: true });
    fs.mkdirSync(this.submissionsDir, { recursive: true });
  }

  saveAgent(record: PersistedAgentRecord): void {
    this.writeJson(this.agentPath(record.id), record);
  }

  loadAgent(id: string): PersistedAgentRecord | null {
    return this.readJson<PersistedAgentRecord>(this.agentPath(id));
  }

  listAgents(): PersistedAgentRecord[] {
    return this.listJson<PersistedAgentRecord>(this.agentsDir);
  }

  saveSubmission(record: PersistedSubmissionRecord): void {
    this.writeJson(this.submissionPath(record.id), record);
  }

  loadSubmission(id: string): PersistedSubmissionRecord | null {
    return this.readJson<PersistedSubmissionRecord>(this.submissionPath(id));
  }

  listSubmissions(): PersistedSubmissionRecord[] {
    return this.listJson<PersistedSubmissionRecord>(this.submissionsDir);
  }

  private agentPath(id: string): string {
    return path.join(this.agentsDir, `${id}.json`);
  }

  private submissionPath(id: string): string {
    return path.join(this.submissionsDir, `${id}.json`);
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
