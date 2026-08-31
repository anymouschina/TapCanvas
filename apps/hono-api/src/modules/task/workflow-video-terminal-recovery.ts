import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { parseWorkflowNodeOutputV1, type WorkflowNodeItemRunV1 } from "../execution/execution.node-runtime";
import type { FlowRow } from "../flow/flow.repo";
import {
  persistVideoNodePatch,
  reconcileVideoNodesForFlow,
} from "./agents-tool-bridge.generate-video-to-canvas";
import { workflowVideoSubmissionFailureData } from "./workflow-video-effect-claim";

type FlowNodeLike = Readonly<{ id?: unknown; data?: unknown }>;

export type WorkflowVideoRecoveryCandidate = Readonly<{
  nodeId: string;
  executionId: string;
  aggregateNodeId: string;
  runtimeNodeId: string;
  effectId: string;
}>;

export type WorkflowVideoTerminalRecoveryResult = Readonly<{
  reconciled: number;
  failed: number;
  stillRunning: number;
  details: readonly Readonly<{
    nodeId: string;
    taskId: string;
    status: string;
  }>[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(readTrimmed).filter(Boolean))];
}

function isNonTerminalVideoStatus(value: unknown): boolean {
  const status = readTrimmed(value).toLowerCase();
  return status === "submitting"
    || status === "running"
    || status === "queued"
    || status === "submitted";
}

function aggregateNodeIdFromRuntimeNodeId(runtimeNodeId: string): string | null {
  const itemBoundary = runtimeNodeId.lastIndexOf("::item::");
  if (itemBoundary <= 0) return null;
  const aggregateNodeId = runtimeNodeId.slice(0, itemBoundary).trim();
  return aggregateNodeId || null;
}

/**
 * Resolve the immutable paid-effect identity carried by a workflow-generated
 * video node. Every field is protocol identity, never prompt semantics.
 */
export function workflowVideoRecoveryCandidateFromNode(
  raw: unknown,
): WorkflowVideoRecoveryCandidate | null {
  if (!isRecord(raw)) return null;
  const node = raw as FlowNodeLike;
  const data = isRecord(node.data) ? node.data : {};
  const kind = readTrimmed(data.kind).toLowerCase();
  if (kind !== "video" && kind !== "composevideo") return null;
  if (!isNonTerminalVideoStatus(data.status)) return null;

  const nodeId = readTrimmed(node.id);
  const executionId = readTrimmed(data.workflowExecutionId);
  const runtimeNodeId = readTrimmed(data.workflowRuntimeNodeId);
  const effectId = readTrimmed(data.workflowEffectId);
  const aggregateNodeId = aggregateNodeIdFromRuntimeNodeId(runtimeNodeId);
  if (!nodeId || !executionId || !runtimeNodeId || !effectId || !aggregateNodeId) return null;

  const effectSuffix = `:${runtimeNodeId}:video-submit`;
  if (!effectId.endsWith(effectSuffix)) return null;
  const executionFamilyId = effectId.slice(0, -effectSuffix.length).trim();
  if (!executionFamilyId) return null;
  const expectedCanvasNodeId = `${runtimeNodeId}::family::${executionFamilyId}::output::video`;
  if (nodeId !== expectedCanvasNodeId) return null;

  return {
    nodeId,
    executionId,
    aggregateNodeId,
    runtimeNodeId,
    effectId,
  };
}

export function selectWorkflowVideoRecoveryCandidates(
  nodes: unknown,
): WorkflowVideoRecoveryCandidate[] {
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map(workflowVideoRecoveryCandidateFromNode)
    .filter((candidate): candidate is WorkflowVideoRecoveryCandidate => candidate !== null);
}

function exactItemRun(
  candidate: WorkflowVideoRecoveryCandidate,
  outputRefs: unknown,
): WorkflowNodeItemRunV1 | null {
  const output = parseWorkflowNodeOutputV1(outputRefs);
  if (!output || output.nodeId !== candidate.aggregateNodeId) return null;
  const itemRun = output.itemRuns.find((item) => item.runtimeNodeId === candidate.runtimeNodeId);
  if (!itemRun) return null;
  if (readTrimmed(itemRun.evidence.canvasNodeId) !== candidate.nodeId) return null;
  return itemRun;
}

export function resolveWorkflowVideoRecoveryItemRun(
  candidate: WorkflowVideoRecoveryCandidate,
  attempts: readonly Readonly<{ outputRefs: unknown }>[],
): WorkflowNodeItemRunV1 | null {
  for (const attempt of attempts) {
    const itemRun = exactItemRun(candidate, attempt.outputRefs);
    if (itemRun) return itemRun;
  }
  return null;
}

function currentNodeData(current: unknown, candidate: WorkflowVideoRecoveryCandidate): Record<string, unknown> | null {
  if (!isRecord(current) || !Array.isArray(current.nodes)) return null;
  const node = current.nodes.find((item) => isRecord(item) && readTrimmed(item.id) === candidate.nodeId);
  if (!isRecord(node) || !isRecord(node.data)) return null;
  const freshCandidate = workflowVideoRecoveryCandidateFromNode(node);
  if (!freshCandidate || freshCandidate.effectId !== candidate.effectId) return null;
  return node.data;
}

function persistentHttpUrl(value: unknown): string {
  const raw = readTrimmed(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function loadCandidateAttempts(
  candidate: WorkflowVideoRecoveryCandidate,
  ownerId: string,
): Promise<readonly Readonly<{ outputRefs: unknown }>[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.workflow_node_attempts.findMany({
    where: {
      execution_id: candidate.executionId,
      node_id: candidate.aggregateNodeId,
      workflow_executions: { owner_id: ownerId },
    },
    select: { output_refs: true },
    orderBy: [{ attempt: "desc" }, { created_at: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => ({ outputRefs: row.output_refs }));
}

async function persistExactFailure(input: Readonly<{
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  chapterId?: string;
  candidate: WorkflowVideoRecoveryCandidate;
  itemRun: WorkflowNodeItemRunV1;
}>): Promise<void> {
  const taskId = readTrimmed(input.itemRun.evidence.taskId);
  const providerRejected = readTrimmed(input.itemRun.evidence.providerStatus).toLowerCase() === "failed";
  const providerRejectedReferenceIds = readStringArray(input.itemRun.evidence.providerRejectedReferenceIds);
  const errorCode = readTrimmed(input.itemRun.evidence.providerErrorCode)
    || readTrimmed(input.itemRun.errorCode)
    || null;
  const errorMessage = readTrimmed(input.itemRun.errorMessage)
    || "Workflow video item reached a persisted terminal failure";
  const failedAt = new Date().toISOString();

  await persistVideoNodePatch({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
    fallbackRow: input.row,
    broadcastNodeId: input.candidate.nodeId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    buildPatch: (current) => {
      const data = currentNodeData(current, input.candidate);
      if (!data) return null;
      return {
        allowOverwrite: true,
        patchNodeData: [{
          id: input.candidate.nodeId,
          data: {
            ...workflowVideoSubmissionFailureData({
              base: data,
              knownPreUpstream: false,
              providerRejected,
              errorCode,
              errorMessage,
              failedAt,
              providerRejectedReferenceIds,
            }),
            ...(taskId ? { taskId } : {}),
            clipSubmitError: errorMessage,
          },
        }],
      };
    },
  });
}

async function persistExactSuccess(input: Readonly<{
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  chapterId?: string;
  candidate: WorkflowVideoRecoveryCandidate;
  itemRun: WorkflowNodeItemRunV1;
  videoUrl: string;
}>): Promise<void> {
  const taskId = readTrimmed(input.itemRun.evidence.taskId);
  const thumbnailUrl = persistentHttpUrl(input.itemRun.evidence.thumbnailUrl);
  await persistVideoNodePatch({
    c: input.c,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    flowId: input.flowId,
    fallbackRow: input.row,
    broadcastNodeId: input.candidate.nodeId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    buildPatch: (current) => {
      const data = currentNodeData(current, input.candidate);
      if (!data) return null;
      const existingResults = Array.isArray(data.videoResults) ? data.videoResults : [];
      const videoResults = existingResults.length > 0
        ? existingResults
        : [{ url: input.videoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}) }];
      return {
        allowOverwrite: true,
        patchNodeData: [{
          id: input.candidate.nodeId,
          data: {
            ...data,
            status: "success",
            workflowSubmissionState: "materialized",
            ...(taskId ? { taskId } : {}),
            videoUrl: input.videoUrl,
            ...(thumbnailUrl ? { videoThumbnailUrl: thumbnailUrl } : {}),
            videoResults,
            errorCode: null,
            errorMessage: null,
            clipSubmitError: null,
          },
        }],
      };
    },
  });
}

/**
 * Project durable collection-item receipts back into their exact canvas video
 * nodes. It never submits provider work; it only materializes persisted
 * success/failure facts or reconciles an already accepted task identity.
 */
export async function recoverWorkflowVideoTerminalNodes(input: Readonly<{
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow;
  chapterId?: string;
}>): Promise<WorkflowVideoTerminalRecoveryResult> {
  const graph = typeof input.row.data === "string"
    ? JSON.parse(input.row.data) as unknown
    : input.row.data;
  const nodes = isRecord(graph) ? graph.nodes : null;
  const candidates = selectWorkflowVideoRecoveryCandidates(nodes).slice(0, 24);
  let reconciled = 0;
  let failed = 0;
  let stillRunning = 0;
  const details: Array<{ nodeId: string; taskId: string; status: string }> = [];

  for (const candidate of candidates) {
    const attempts = await loadCandidateAttempts(candidate, input.requestUserId);
    const itemRun = resolveWorkflowVideoRecoveryItemRun(candidate, attempts);
    if (!itemRun) {
      stillRunning += 1;
      details.push({ nodeId: candidate.nodeId, taskId: "", status: "workflow_receipt_missing" });
      continue;
    }
    const taskId = readTrimmed(itemRun.evidence.taskId);
    if (itemRun.status === "failed") {
      if (taskId) {
        try {
          const provider = await reconcileVideoNodesForFlow({
            c: input.c,
            requestUserId: input.requestUserId,
            devBypass: input.devBypass,
            flowId: input.flowId,
            row: input.row,
            ...(input.chapterId ? { chapterId: input.chapterId } : {}),
            target: { nodeId: candidate.nodeId, taskId },
          });
          if (provider.reconciled > 0 || provider.failed > 0) {
            reconciled += provider.reconciled;
            failed += provider.failed;
            stillRunning += provider.stillRunning;
            details.push(...provider.details);
            continue;
          }
        } catch (error: unknown) {
          console.warn("[workflow-video-terminal-recovery] exact provider reconciliation failed; projecting immutable item failure", {
            executionId: candidate.executionId,
            runtimeNodeId: candidate.runtimeNodeId,
            canvasNodeId: candidate.nodeId,
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await persistExactFailure({ ...input, candidate, itemRun });
      reconciled += 1;
      failed += 1;
      details.push({ nodeId: candidate.nodeId, taskId, status: "failed" });
      continue;
    }
    if (itemRun.status === "success") {
      const videoUrl = persistentHttpUrl(itemRun.evidence.videoUrl)
        || persistentHttpUrl(itemRun.artifacts.find((artifact) => artifact.type === "tapcanvas.video/v1")?.value);
      if (videoUrl) {
        await persistExactSuccess({ ...input, candidate, itemRun, videoUrl });
        reconciled += 1;
        details.push({ nodeId: candidate.nodeId, taskId, status: "success" });
        continue;
      }
    }
    if (!taskId) {
      stillRunning += 1;
      details.push({ nodeId: candidate.nodeId, taskId: "", status: "provider_task_identity_missing" });
      continue;
    }
    const provider = await reconcileVideoNodesForFlow({
      c: input.c,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      flowId: input.flowId,
      row: input.row,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      target: { nodeId: candidate.nodeId, taskId },
    });
    reconciled += provider.reconciled;
    failed += provider.failed;
    stillRunning += provider.stillRunning;
    details.push(...provider.details);
  }

  return { reconciled, failed, stillRunning, details };
}
