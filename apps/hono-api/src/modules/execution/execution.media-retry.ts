import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseWorkflowNodeOutputV1,
  parseWorkflowNodes,
  resolveWorkflowNodeExecutionMode,
  resolveWorkflowNodeExecutorRef,
  type WorkflowNodeOutputV1,
} from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { resolveWorkflowPipelineMediaTarget, workflowPipelineDownstreamStepIds } from "./execution.pipeline-media-target";

export const WorkflowMediaRetrySchema = z.object({
  nodeId: z.string().trim().min(1),
  itemId: z.string().trim().min(1).nullable(),
  taskId: z.string().trim().min(1).nullable(),
}).strict();
export const WorkflowMediaRetriesSchema = z.array(WorkflowMediaRetrySchema).min(1).superRefine((items, ctx) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = JSON.stringify([item.nodeId, item.itemId]);
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "Duplicate media retry target" });
    seen.add(key);
  });
});
export type WorkflowMediaRetry = z.infer<typeof WorkflowMediaRetrySchema>;
const AuthorizedRetrySchema = WorkflowMediaRetrySchema.extend({
  executorRef: z.enum(["tapcanvas.image.generate/v1", "tapcanvas.video.generate/v1"]),
  executionMode: z.enum(["once", "each"]),
  canvasNodeId: z.string().min(1),
  retryKey: z.string().min(1),
});
export type AuthorizedWorkflowMediaRetry = z.infer<typeof AuthorizedRetrySchema>;

/** Match the exact item receipt produced by a collection executor.
 * Nested pipeline steps may persist the item id literally, while the top-level
 * collection executor URI-encodes the same segment. Both forms remain bound
 * to the exact base node and exact item id.
 */
export function matchesWorkflowMediaItemRuntimeNodeId(input: Readonly<{
	nodeId: string;
	itemId: string;
	runtimeNodeId: string;
}>): boolean {
	const prefix = `${input.nodeId}::item::`;
	if (!input.runtimeNodeId.startsWith(prefix)) return false;
	const itemSegment = input.runtimeNodeId.slice(prefix.length);
	if (itemSegment === input.itemId || itemSegment === encodeURIComponent(input.itemId)) return true;
	try {
		return decodeURIComponent(itemSegment) === input.itemId;
	} catch {
		return false;
	}
}

/** One recovery request has one failed-node frontier, even when it targets many items. */
export function resolveWorkflowMediaRetryFrontier(retries: readonly WorkflowMediaRetry[]): string {
	if (retries.length === 0) throw new Error("workflow_media_retry_frontier_missing");
	const nodeIds = new Set(retries.map((retry) => retry.nodeId.split("::item::", 1)[0]));
	if (nodeIds.size !== 1) throw new Error("workflow_media_retry_frontier_conflict");
  const nodeId = retries[0]?.nodeId.split("::item::", 1)[0];
  if (!nodeId) throw new Error("workflow_media_retry_frontier_missing");
  return nodeId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveRetryMediaSource(input: {
  nodeId: string;
  outputs: readonly { nodeId: string; status: string; outputRefs: unknown }[];
  workflowNodes: ReturnType<typeof parseWorkflowNodes>;
}): { output: WorkflowNodeOutputV1 | null; status: string | null; executorRef: string | null; executionMode: string | null } {
  const directRun = input.outputs.find((run) => run.nodeId === input.nodeId);
  const directNode = input.workflowNodes.find((node) => node.id === input.nodeId);
  if (directRun && directNode) return {
    output: parseWorkflowNodeOutputV1(directRun.outputRefs), status: directRun.status,
    executorRef: resolveWorkflowNodeExecutorRef(directNode), executionMode: resolveWorkflowNodeExecutionMode(directNode),
  };
  const frontierNodeId = input.nodeId.split("::item::", 1)[0];
  const outerRun = input.outputs.find((run) => run.nodeId === frontierNodeId);
  const outerNode = input.workflowNodes.find((node) => node.id === frontierNodeId);
  const outerOutput = parseWorkflowNodeOutputV1(outerRun?.outputRefs);
  if (!outerRun || !outerNode || !outerOutput || outerOutput.executorRef !== "workflow.pipeline.run/v1") {
    return { output: null, status: null, executorRef: null, executionMode: null };
  }
  const nested = resolveWorkflowPipelineMediaTarget({
    nodeId: input.nodeId,
    outputs: input.outputs,
    workflowNodes: input.workflowNodes,
  });
  if (!nested || nested.ownerNodeId !== frontierNodeId) {
    return { output: null, status: null, executorRef: null, executionMode: null };
  }
  const downstream = workflowPipelineDownstreamStepIds(nested.spec, nested.stepId);
  for (const downstreamId of downstream) {
    const downstreamStep = nested.spec.steps.find((step) => step.stepId === downstreamId);
    const downstreamReceipt = nested.state.steps[downstreamId];
    if (!downstreamStep || !isRecord(downstreamReceipt) || downstreamReceipt.status === "not_selected") continue;
    const executorRef = resolveWorkflowNodeExecutorRef(downstreamStep.node);
    const semantics = executorRef ? resolveCoreWorkflowExecutorSemantics(executorRef) : null;
    if (!semantics || semantics.sideEffect === "none") continue;
    const downstreamOutput = parseWorkflowNodeOutputV1(downstreamReceipt.outputRefs);
    const preUpstreamVideoRejection = executorRef === "tapcanvas.video.generate/v1"
      && downstreamReceipt.status === "failed" && downstreamOutput !== null
      && (downstreamOutput.executionMode === "each" && downstreamOutput.itemRuns.length > 0
        ? downstreamOutput.itemRuns.every((item) => item.status === "failed" && item.evidence.taskId === null
          && item.evidence.workflowSubmissionState === "rejected_pre_upstream"
          && !hasMediaAsset(executorRef, item.ports, item.artifacts, item.evidence))
        : downstreamOutput.evidence.taskId === null
          && downstreamOutput.evidence.workflowSubmissionState === "rejected_pre_upstream"
          && !hasMediaAsset(executorRef, downstreamOutput.ports, downstreamOutput.artifacts, downstreamOutput.evidence));
    if (!preUpstreamVideoRejection) throw new Error(`media_retry_nested_downstream_effect_exists:${downstreamId}`);
  }
  return {
    output: nested.stepOutput, status: nested.stepStatus,
    executorRef: resolveWorkflowNodeExecutorRef(nested.stepNode),
    executionMode: resolveWorkflowNodeExecutionMode(nested.stepNode),
  };
}

function hasMediaAsset(
  executorRef: "tapcanvas.image.generate/v1" | "tapcanvas.video.generate/v1",
  ports: Readonly<Record<string, unknown>>,
  artifacts: readonly { type: string; value?: unknown; media?: { url: string } }[],
  evidence: Readonly<Record<string, unknown>>,
): boolean {
  const outputUrlField = executorRef === "tapcanvas.image.generate/v1" ? "imageUrl" : "videoUrl";
  const ownedAssetFields = new Set([
    outputUrlField, "imageUrl", "videoUrl", "thumbnailUrl", "posterUrl", "assetUrl", "mediaUrl",
    "assetId", "assetIds", "generatedAssetId", "generatedAssetIds", "serverAssetId", "assetRefId",
  ]);
  const hasOwnedFields = (value: unknown): boolean => isRecord(value)
    && Object.entries(value).some(([key, child]) => ownedAssetFields.has(key)
      && (typeof child === "string" ? child.trim().length > 0 : Array.isArray(child) && child.length > 0));
  const mediaArtifactType = executorRef === "tapcanvas.image.generate/v1" ? "tapcanvas.image/v1" : "tapcanvas.video/v1";

  return Object.values(ports).some(hasOwnedFields)
    || hasOwnedFields(evidence)
    || artifacts.some((artifact) => typeof artifact.media?.url === "string" && artifact.media.url.trim().length > 0
      || (artifact.type === mediaArtifactType && typeof artifact.value === "string" && artifact.value.trim().length > 0));
}

/** Explicit caller authorization is bound to the exact failed receipt, never its message. */
export function authorizeWorkflowMediaRetries(input: {
  sourceExecutionId: string;
  retries: readonly WorkflowMediaRetry[];
  outputs: readonly { nodeId: string; status: string; outputRefs: unknown }[];
  workflowDefinition: unknown;
}): AuthorizedWorkflowMediaRetry[] {
  const workflowNodes = parseWorkflowNodes(input.workflowDefinition);
  return input.retries.map((retry) => {
    const source = resolveRetryMediaSource({ nodeId: retry.nodeId, outputs: input.outputs, workflowNodes });
    const { output } = source;
    const definitionExecutorRef = source.executorRef;
    const definitionExecutionMode = source.executionMode;
    if (!output || (output.executorRef !== "tapcanvas.image.generate/v1"
      && output.executorRef !== "tapcanvas.video.generate/v1")
      || output.nodeId !== retry.nodeId || (output.executionMode !== "each" && output.executionMode !== "once")
      || definitionExecutorRef !== output.executorRef || definitionExecutionMode !== output.executionMode) {
      throw new Error(`media_retry_media_collection_required:${retry.nodeId}`);
    }
    const item = retry.itemId === null ? null : output.itemRuns.find((entry) => entry.itemId === retry.itemId) ?? null;
    const receipt = output.executionMode === "each" ? item?.evidence : output.evidence;
    const taskIdPresent = receipt ? Object.hasOwn(receipt, "taskId") : false;
    const videoPreUpstreamFailure = output.executorRef === "tapcanvas.video.generate/v1"
      && retry.taskId === null
      && receipt?.taskId === null
      && receipt.workflowSubmissionState === "rejected_pre_upstream";
    const exactTarget = output.executionMode === "each"
      ? retry.itemId !== null && item !== null
        && matchesWorkflowMediaItemRuntimeNodeId({ nodeId: retry.nodeId, itemId: retry.itemId, runtimeNodeId: item.runtimeNodeId })
        && (source.status === "failed" || source.status === "success" || source.status === "canceled")
        && item.status === "failed"
      : retry.itemId === null && source.status === "failed" && output.itemRuns.length === 0;
    const targetHasAsset = output.executionMode === "once"
      ? hasMediaAsset(output.executorRef, output.ports, output.artifacts, output.evidence)
      : item !== null && hasMediaAsset(output.executorRef, item.ports, item.artifacts, item.evidence);
    if (!exactTarget || !receipt || !taskIdPresent
      || !(videoPreUpstreamFailure || (retry.taskId !== null && receipt.taskId === retry.taskId))
      || typeof receipt.canvasNodeId !== "string" || !receipt.canvasNodeId.trim()
      || (!videoPreUpstreamFailure && receipt.providerStatus !== "failed")
      || targetHasAsset) {
      throw new Error(`media_retry_failed_receipt_required:${retry.itemId}`);
    }
    if (output.executorRef === "tapcanvas.image.generate/v1" && retry.taskId === null) {
      throw new Error(`media_retry_provider_receipt_required:${retry.itemId}`);
    }
    return { ...retry, executorRef: output.executorRef, executionMode: output.executionMode, canvasNodeId: receipt.canvasNodeId,
      retryKey: createHash("sha256").update(JSON.stringify([
        input.sourceExecutionId, retry.nodeId, retry.itemId, retry.taskId, receipt.canvasNodeId, output.executorRef,
      ])).digest("hex") };
  });
}

/**
 * Return already-started downstream external actions that a media retry would
 * invalidate. A partial media item can be retried only while the source family
 * has no active member and no descendant action has consumed the old output.
 */
export function findWorkflowMediaRetryDownstreamEffects(input: Readonly<{
  nodeId: string;
  workflowDefinition: unknown;
  outputs: readonly {
    nodeId: string;
    status: string;
    startedAt?: string | null;
    toolCalls?: string | null;
    outputRefs: unknown;
  }[];
}>): string[] {
  const nodes = parseWorkflowNodes(input.workflowDefinition);
  const root = isRecord(input.workflowDefinition) ? input.workflowDefinition : null;
  const rawEdges = root && Array.isArray(root.edges) ? root.edges : [];
  const children = new Map<string, string[]>();
  for (const rawEdge of rawEdges) {
    if (!isRecord(rawEdge) || typeof rawEdge.source !== "string" || typeof rawEdge.target !== "string") continue;
    const edgeChildren = children.get(rawEdge.source) ?? [];
    edgeChildren.push(rawEdge.target);
    children.set(rawEdge.source, edgeChildren);
  }
  const descendants = new Set<string>();
  const queue = [...(children.get(input.nodeId) ?? [])];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || descendants.has(nodeId)) continue;
    descendants.add(nodeId);
    queue.push(...(children.get(nodeId) ?? []));
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
	const effects: string[] = [];
	for (const run of input.outputs) {
    if (!descendants.has(run.nodeId)) continue;
    const physicallyStarted = run.startedAt !== null && run.startedAt !== undefined
      || ["running", "waiting_external", "success", "failed"].includes(run.status);
    if (!physicallyStarted) continue;
    const node = nodeById.get(run.nodeId);
    const output = parseWorkflowNodeOutputV1(run.outputRefs);
    const executorRef = node ? resolveWorkflowNodeExecutorRef(node) : output?.executorRef ?? null;
    const semantics = executorRef ? resolveCoreWorkflowExecutorSemantics(executorRef) : null;
    if (semantics?.sideEffect === "paid_generation" && executorRef === "tapcanvas.video.generate/v1"
      && run.status === "failed" && output) {
      const itemRuns = output.executionMode === "each" ? output.itemRuns : [];
      const exactPreUpstreamRejections = itemRuns.length > 0
        ? itemRuns.every((itemRun) => itemRun.status === "failed"
          && itemRun.evidence.taskId === null
          && itemRun.evidence.workflowSubmissionState === "rejected_pre_upstream"
          && !hasMediaAsset(executorRef, itemRun.ports, itemRun.artifacts, itemRun.evidence))
        : output.evidence.taskId === null
          && output.evidence.workflowSubmissionState === "rejected_pre_upstream"
          && !hasMediaAsset(executorRef, output.ports, output.artifacts, output.evidence);
      if (exactPreUpstreamRejections) continue;
    }
    if (!semantics || semantics.sideEffect !== "none") effects.push(run.nodeId);
  }
  return [...new Set(effects)].sort();
}

/** A stable batch identity makes duplicate clicks converge while later receipts advance attempts. */
export function workflowMediaRetryBatchIdentity(retries: readonly AuthorizedWorkflowMediaRetry[]): string {
  if (retries.length === 0) throw new Error("workflow_media_retry_frontier_missing");
  const retryKeys = retries.map((retry) => retry.retryKey).sort();
  return createHash("sha256").update(JSON.stringify(retryKeys)).digest("hex");
}

export function readWorkflowMediaRetries(root: unknown): AuthorizedWorkflowMediaRetry[] {
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const value = (root as Record<string, unknown>).workflowMediaRetries;
  return value === undefined ? [] : z.array(AuthorizedRetrySchema).parse(value);
}

export function workflowMediaRetryForItem(root: unknown, runtimeNodeId: string): AuthorizedWorkflowMediaRetry | undefined {
  return readWorkflowMediaRetries(root).find((item) => item.executionMode === "once"
    ? item.itemId === null && item.nodeId === runtimeNodeId
    : item.itemId !== null && matchesWorkflowMediaItemRuntimeNodeId({ nodeId: item.nodeId, itemId: item.itemId, runtimeNodeId }));
}
