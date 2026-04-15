import { AgentType } from "../subagent/types.js";
import {
  AgentExecutionMode,
  AgentIsolationMode,
  CapabilityProviderKind,
  CapabilityGrant,
  Message,
} from "../../types/index.js";
import { PersistedMailboxMessage } from "./mailbox-store.js";
import {
  PersistedProtocolRequest,
  PersistedProtocolResponseStatus,
} from "./protocol-store.js";

export type AgentRuntimeStatus = "queued" | "running" | "idle" | "completed" | "failed" | "closed";

export type AgentArtifactSummary = {
  path: string;
  bytes: number;
};

export type AgentWorkspaceHandoffFile = {
  relative_path: string;
  source_path: string;
  target_path: string;
  bytes: number;
  source_sha256: string;
  target_exists: boolean;
  target_bytes?: number;
  target_sha256?: string;
  import_decision: "create" | "unchanged" | "conflict";
};

export type AgentWorkspaceImportConflictPolicy = "fail" | "overwrite";

export type AgentWorkspaceImportSummary = {
  file_count: number;
  create_count: number;
  unchanged_count: number;
  conflict_count: number;
  copied_count: number;
  skipped_count: number;
};

export type AgentRuntimeRecord = {
  id: string;
  description: string;
  agentType: AgentType;
  executionMode?: AgentExecutionMode;
  isolationMode?: AgentIsolationMode;
  skillBundle?: string[];
  capabilityProviderBundle?: CapabilityProviderKind[];
  capabilityGrant: CapabilityGrant;
  modelOverride?: string;
  agentWorkRoot: string;
  autonomous: boolean;
  claimedTaskId?: string;
  idleSince?: string;
  depth: number;
  parentAgentId?: string;
  history: Message[];
  status: AgentRuntimeStatus;
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

export type AgentStatusSummary = {
  id: string;
  description: string;
  agent_type: string;
  execution_mode?: AgentExecutionMode;
  isolation_mode?: AgentIsolationMode;
  skill_bundle?: string[];
  capability_provider_bundle?: CapabilityProviderKind[];
  model?: string;
  status: AgentRuntimeStatus;
  status_source?: "live" | "persisted";
  agent_work_root: string;
  autonomous: boolean;
  claimed_task_id?: string;
  claimed_task_subject?: string;
  claimed_task_lane?: string;
  idle_since?: string;
  artifact_count: number;
  recent_artifacts: AgentArtifactSummary[];
  handoff_file_count: number;
  depth: number;
  parent_agent_id?: string;
  pending_tasks: number;
  completed_tasks: number;
  active_submission_id?: string;
  last_submission_id?: string;
  updated_at: string;
  unread_mailbox_count: number;
  pending_protocol_count: number;
  recent_submissions: SubmissionStatusSummary[];
  result_preview: string;
  error?: string;
};

export type SubmissionStatusSummary = {
  id: string;
  agent_id: string;
  status: string;
  status_source?: "live" | "persisted";
  created_at: string;
  updated_at: string;
  finished_at?: string;
  prompt_preview: string;
  result_preview: string;
  error?: string;
  run_started_at?: string;
  run_elapsed_ms?: number;
  budget_ms?: number;
  budget_exceeded_at?: string;
  over_budget_ms?: number;
  last_progress_at?: string;
  last_progress_age_ms?: number;
  last_progress_summary?: string;
};

export interface CollabAgentManagerLike {
  spawn(options: {
    description: string;
    prompt: string;
    agentType: AgentType;
    capabilityGrant?: CapabilityGrant;
    requiredSkills?: string[];
    modelOverride?: string;
    systemOverride?: string;
    autonomous?: boolean;
    taskId?: string;
    depth: number;
    parentAgentId?: string;
    initialHistory?: Message[];
  }): { agentId: string; submissionId: string };
  enqueue(id: string, prompt: string): { submissionId: string };
  close(id: string): string;
  markIdle(id: string): AgentStatusSummary;
  resume(id: string): AgentStatusSummary;
  status(id: string): AgentStatusSummary;
  subscribeStatus?(id: string, listener: () => void): () => void;
  list(): AgentStatusSummary[];
  get(id: string): AgentRuntimeRecord;
  getTask?(taskId: string): {
    id: string;
    subject: string;
    status: string;
    owner: string;
    workspaceLane: string;
  } | null;
  listSubmissionsForAgents(ids: string[]): SubmissionStatusSummary[];
  sendMailboxMessage(input: {
    toAgentId: string;
    body: string;
    fromAgentId?: string;
    subject?: string;
  }): PersistedMailboxMessage;
  readMailbox(
    agentId: string,
    options?: {
      includeRead?: boolean;
      limit?: number;
      markAsRead?: boolean;
    }
  ): PersistedMailboxMessage[];
  unreadMailboxCount(agentId: string): number;
  requestProtocol(input: {
    toAgentId: string;
    action: string;
    input: string;
    fromAgentId?: string;
  }): PersistedProtocolRequest;
  readProtocolInbox(
    agentId: string,
    options?: {
      includeResponded?: boolean;
      limit?: number;
    }
  ): PersistedProtocolRequest[];
  protocolPendingCount(agentId: string): number;
  getProtocolRequest(id: string): PersistedProtocolRequest;
  respondProtocol(input: {
    requestId: string;
    output: string;
    status: PersistedProtocolResponseStatus;
    responderAgentId?: string;
  }): PersistedProtocolRequest;
  listWorkspaceHandoff(agentId: string): AgentWorkspaceHandoffFile[];
  importAgentWorkspace(input: {
    agentId: string;
    mode: "dry_run" | "apply";
    conflictPolicy?: AgentWorkspaceImportConflictPolicy;
  }): {
    agent_id: string;
    mode: "dry_run" | "apply";
    conflict_policy: AgentWorkspaceImportConflictPolicy;
    source_root: string;
    target_root: string;
    audit: {
      agent_id: string;
      agent_type: string;
      agent_work_root: string;
      workspace_lane: string;
      claimed_task_id?: string;
      claimed_task_subject?: string;
      claimed_task_owner?: string;
      claimed_task_lane?: string;
    };
    summary: AgentWorkspaceImportSummary;
    files: AgentWorkspaceHandoffFile[];
  };
}
