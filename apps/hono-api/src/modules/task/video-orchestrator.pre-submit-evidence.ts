import { getPrismaClient } from "../../platform/node/prisma";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import type { VideoRunRow } from "./video-run.repo";
import { vendorLogTextMatchesExactSourcePrefix } from "./vendor-call-logs.repo";

type VendorFailureLog = {
  taskId: string;
  startedAt: string | null;
  requestJson: string | null;
  responseJson: string | null;
};

export type VerifiedPreSubmitEvidence = {
  nodeId: string;
  clipIndex: number;
  vendorLogTaskId: string;
  vendorLogStartedAt: string | null;
  code: "membership_concurrency_limit_reached" | "seedance_reference_mode_conflict";
};

export type PreSubmitEvidenceMismatchReason =
  | "invalid_clip_index"
  | "planned_clip_missing"
  | "planned_prompt_missing"
  | "storyboard_node_id_missing"
  | "storyboard_url_missing"
  | "vendor_log_missing"
  | "synthetic_task_id_required"
  | "request_json_invalid"
  | "response_json_invalid"
  | "prompt_serialization_mismatch"
  | "first_frame_mismatch"
  | "response_status_mismatch"
  | "response_code_mismatch"
  | "structured_rejection_mismatch"
  | "task_result_present"
  | "vendor_ref_present"
  | "ledger_present";

type VendorLogDiagnostic = {
  taskId: string;
  startedAt: string | null;
  mismatchReasons: PreSubmitEvidenceMismatchReason[];
  code?: VerifiedPreSubmitEvidence["code"];
};

const REQUEST_IDENTITY_MISMATCH_REASONS: ReadonlySet<PreSubmitEvidenceMismatchReason> = new Set([
  "request_json_invalid",
  "prompt_serialization_mismatch",
  "first_frame_mismatch",
]);

export type PreSubmitEvidenceDiagnostic = {
  nodeId: string;
  clipIndex: number | null;
  candidateLogCount: number;
  mismatchReasons: PreSubmitEvidenceMismatchReason[];
  vendorLogs: VendorLogDiagnostic[];
};

export type PreSubmitEvidenceAssessment = {
  verified: VerifiedPreSubmitEvidence[];
  diagnostics: PreSubmitEvidenceDiagnostic[];
};

type PlannedClip = { clipPrompt: string; storyboardImageNodeId?: string };

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseUnknownObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return parseObject(value);
  return readObject(value);
}

function parsePlannedClips(storyPlanJson: string | null): PlannedClip[] {
  const plan = parseObject(storyPlanJson);
  const clips = plan?.clips;
  if (!Array.isArray(clips)) return [];
  return clips.map((clip) => {
    const record = readObject(clip);
    return {
      clipPrompt: typeof record?.clipPrompt === "string" ? record.clipPrompt : "",
      ...(typeof record?.storyboardImageNodeId === "string" && record.storyboardImageNodeId.trim()
        ? { storyboardImageNodeId: record.storyboardImageNodeId.trim() }
        : {}),
    };
  });
}

function readRealImageUrl(node: VideoFlowNode | undefined): string {
  const direct = typeof node?.data.imageUrl === "string" ? node.data.imageUrl.trim() : "";
  if (/^https?:\/\//i.test(direct)) return direct;
  if (!Array.isArray(node?.data.imageResults)) return "";
  for (const item of node.data.imageResults) {
    const record = readObject(item);
    const url = typeof record?.url === "string" ? record.url.trim() : "";
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function isCapacityRejection(response: Record<string, unknown> | null): boolean {
  const error = readObject(response?.error);
  return response?.status === 429 && error?.code === "membership_concurrency_limit_reached";
}

function hasConflictingSeedanceReferenceRoles(
  requestBody: Record<string, unknown> | null,
): boolean {
  const extras = readObject(requestBody?.extras);
  const manifest = readObject(extras?.referenceMediaManifest);
  const images = Array.isArray(manifest?.images) ? manifest.images : [];
  const audios = Array.isArray(manifest?.audios) ? manifest.audios : [];
  const roles = images.map((image) => readObject(image)?.role);
  const hasLiteralFrame = roles.some((role) => role === "first_frame" || role === "last_frame");
  const hasReferenceVideo =
    typeof extras?.upstreamVideoUrl === "string" && /^https?:\/\//i.test(extras.upstreamVideoUrl);
  return hasLiteralFrame && (
    roles.includes("reference_image") ||
    audios.length > 0 ||
    hasReferenceVideo
  );
}

function isSeedanceReferenceModeConflict(
  requestBody: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
): boolean {
  if (!hasConflictingSeedanceReferenceRoles(requestBody)) return false;
  const outerError = readObject(response?.error);
  const details = readObject(outerError?.details);
  const upstreamData = readObject(details?.upstreamData);
  const nested = parseUnknownObject(upstreamData?.message);
  const nestedError = readObject(nested?.error);
  return (
    response?.status === 400 &&
    outerError?.code === "newapi:newapi_request_failed" &&
    details?.upstreamStatus === 400 &&
    upstreamData?.code === "fail_to_fetch_task" &&
    nestedError?.code === "InvalidParameter" &&
    nestedError?.param === "content" &&
    nestedError?.type === "BadRequest"
  );
}

function evaluateVendorLog(
  log: VendorFailureLog,
  expected: { prompt: string; firstFrameUrl: string },
  occupiedTaskIds: {
    taskResults: ReadonlySet<string>;
    vendorRefs: ReadonlySet<string>;
    ledger: ReadonlySet<string>;
  },
): {
  mismatchReasons: PreSubmitEvidenceMismatchReason[];
  code: VerifiedPreSubmitEvidence["code"] | null;
} {
  const reasons: PreSubmitEvidenceMismatchReason[] = [];
  if (!log.taskId.startsWith("failed-")) reasons.push("synthetic_task_id_required");
  const request = parseObject(log.requestJson);
  const response = parseObject(log.responseJson);
  if (!request) reasons.push("request_json_invalid");
  if (!response) reasons.push("response_json_invalid");
  const requestBody = readObject(request?.request);
  const extras = readObject(requestBody?.extras);
  if (!vendorLogTextMatchesExactSourcePrefix(requestBody?.prompt, expected.prompt)) {
    reasons.push("prompt_serialization_mismatch");
  }
  const actualFirstFrameUrl =
    typeof extras?.firstFrameUrl === "string" ? extras.firstFrameUrl.trim() : "";
  if (actualFirstFrameUrl !== expected.firstFrameUrl) reasons.push("first_frame_mismatch");
  if (occupiedTaskIds.taskResults.has(log.taskId)) reasons.push("task_result_present");
  if (occupiedTaskIds.vendorRefs.has(log.taskId)) reasons.push("vendor_ref_present");
  if (occupiedTaskIds.ledger.has(log.taskId)) reasons.push("ledger_present");
  const code = isCapacityRejection(response)
    ? "membership_concurrency_limit_reached"
    : isSeedanceReferenceModeConflict(requestBody, response)
      ? "seedance_reference_mode_conflict"
      : null;
  if (!code) reasons.push("structured_rejection_mismatch");
  return { mismatchReasons: reasons, code };
}

export function assessPreSubmitCapacityEvidence(input: {
  failedNodes: VideoFlowNode[];
  flowNodes: VideoFlowNode[];
  storyPlanJson: string | null;
  vendorLogs: VendorFailureLog[];
  taskResultTaskIds: ReadonlySet<string>;
  vendorRefTaskIds: ReadonlySet<string>;
  ledgerTaskIds: ReadonlySet<string>;
}): PreSubmitEvidenceAssessment {
  const clips = parsePlannedClips(input.storyPlanJson);
  const flowNodeById = new Map(input.flowNodes.map((node) => [node.id, node]));
  const verified: VerifiedPreSubmitEvidence[] = [];
  const diagnostics: PreSubmitEvidenceDiagnostic[] = [];

  for (const node of input.failedNodes) {
    const clipIndex = Number(node.data.clipIndex);
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      diagnostics.push({
        nodeId: node.id,
        clipIndex: null,
        candidateLogCount: input.vendorLogs.length,
        mismatchReasons: ["invalid_clip_index"],
        vendorLogs: [],
      });
      continue;
    }
    const plannedClip = clips[clipIndex];
    const expectedPrompt = plannedClip?.clipPrompt ?? "";
    const expectedFirstFrameUrl = readRealImageUrl(
      plannedClip?.storyboardImageNodeId
        ? flowNodeById.get(plannedClip.storyboardImageNodeId)
        : undefined,
    );
    const nodeReasons: PreSubmitEvidenceMismatchReason[] = [];
    if (!plannedClip) nodeReasons.push("planned_clip_missing");
    if (!expectedPrompt) nodeReasons.push("planned_prompt_missing");
    if (plannedClip?.storyboardImageNodeId && !expectedFirstFrameUrl) {
      nodeReasons.push("storyboard_url_missing");
    }
    if (input.vendorLogs.length === 0) nodeReasons.push("vendor_log_missing");
    if (nodeReasons.length > 0) {
      diagnostics.push({
        nodeId: node.id,
        clipIndex,
        candidateLogCount: input.vendorLogs.length,
        mismatchReasons: nodeReasons,
        vendorLogs: [],
      });
      continue;
    }
    const vendorLogs = input.vendorLogs
      .map((log): VendorLogDiagnostic => {
        const evaluation = evaluateVendorLog(log, {
          prompt: expectedPrompt,
          firstFrameUrl: expectedFirstFrameUrl,
        }, {
          taskResults: input.taskResultTaskIds,
          vendorRefs: input.vendorRefTaskIds,
          ledger: input.ledgerTaskIds,
        });
        return {
          taskId: log.taskId,
          startedAt: log.startedAt,
          mismatchReasons: evaluation.mismatchReasons,
          ...(evaluation.code ? { code: evaluation.code } : {}),
        };
      })
      .sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
    const latestRequestCandidate = vendorLogs.find(
      (log) => !log.mismatchReasons.some((reason) => REQUEST_IDENTITY_MISMATCH_REASONS.has(reason)),
    );
    if (
      !latestRequestCandidate?.code ||
      latestRequestCandidate.mismatchReasons.length > 0
    ) {
      diagnostics.push({
        nodeId: node.id,
        clipIndex,
        candidateLogCount: vendorLogs.length,
        mismatchReasons: Array.from(new Set(vendorLogs.flatMap((log) => log.mismatchReasons))),
        vendorLogs,
      });
      continue;
    }
    verified.push({
      nodeId: node.id,
      clipIndex,
      vendorLogTaskId: latestRequestCandidate.taskId,
      vendorLogStartedAt: latestRequestCandidate.startedAt,
      code: latestRequestCandidate.code,
    });
  }
  return { verified, diagnostics };
}

export function verifyPreSubmitCapacityEvidence(input: {
  failedNodes: VideoFlowNode[];
  flowNodes: VideoFlowNode[];
  storyPlanJson: string | null;
  vendorLogs: VendorFailureLog[];
  taskResultTaskIds: ReadonlySet<string>;
  vendorRefTaskIds: ReadonlySet<string>;
  ledgerTaskIds: ReadonlySet<string>;
}): VerifiedPreSubmitEvidence[] {
  return assessPreSubmitCapacityEvidence(input).verified;
}

export function resolvePreSubmitEvidenceStartedAfter(
  run: Pick<VideoRunRow, "created_at" | "last_drive_at" | "updated_at">,
): string | null {
  const timestamps = [run.created_at, run.last_drive_at, run.updated_at]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return timestamps[0] ?? null;
}

export async function loadVerifiedPreSubmitCapacityEvidence(input: {
  run: VideoRunRow;
  failedNodes: VideoFlowNode[];
  flowNodes: VideoFlowNode[];
}): Promise<PreSubmitEvidenceAssessment> {
  const prisma = getPrismaClient();
  const startedAfter = resolvePreSubmitEvidenceStartedAfter(input.run);
  const rows = await prisma.vendor_api_call_logs.findMany({
    where: {
      user_id: input.run.owner_id,
      status: "failed",
      task_kind: { in: ["text_to_video", "image_to_video"] },
      ...(startedAfter ? { started_at: { gte: startedAfter } } : {}),
    },
    orderBy: { started_at: "desc" },
    select: {
      task_id: true,
      started_at: true,
      request_json: true,
      response_json: true,
    },
  });
  const vendorLogs = rows.map((row) => ({
    taskId: row.task_id,
    startedAt: row.started_at,
    requestJson: row.request_json,
    responseJson: row.response_json,
  }));
  const candidateTaskIds = vendorLogs
    .filter((log) => log.taskId.startsWith("failed-"))
    .map((log) => log.taskId);
  if (candidateTaskIds.length === 0) {
    return assessPreSubmitCapacityEvidence({
      failedNodes: input.failedNodes,
      flowNodes: input.flowNodes,
      storyPlanJson: input.run.story_plan,
      vendorLogs,
      taskResultTaskIds: new Set(),
      vendorRefTaskIds: new Set(),
      ledgerTaskIds: new Set(),
    });
  }

  const [taskResults, vendorRefs, ledgerRows] = await Promise.all([
    prisma.task_results.findMany({
      where: { user_id: input.run.owner_id, task_id: { in: candidateTaskIds } },
      select: { task_id: true },
    }),
    prisma.vendor_task_refs.findMany({
      where: { user_id: input.run.owner_id, task_id: { in: candidateTaskIds } },
      select: { task_id: true },
    }),
    prisma.team_credit_ledger.findMany({
      where: { task_id: { in: candidateTaskIds } },
      select: { task_id: true },
    }),
  ]);
  return assessPreSubmitCapacityEvidence({
    failedNodes: input.failedNodes,
    flowNodes: input.flowNodes,
    storyPlanJson: input.run.story_plan,
    vendorLogs,
    taskResultTaskIds: new Set(taskResults.map((row) => row.task_id)),
    vendorRefTaskIds: new Set(vendorRefs.map((row) => row.task_id)),
    ledgerTaskIds: new Set(ledgerRows.flatMap((row) => row.task_id ? [row.task_id] : [])),
  });
}
