export type FinalVideoDeliveryEvidence = {
  runId: string;
  nodeId: string;
  videoUrl: string;
};

export type FinalVideoRunProjection = {
  runId: string;
  runCreatedAt: string;
  videoUrl: string;
  totalClips: number;
  clipsDone: number;
  completedAt: string;
  stateChanged: boolean;
};

type ProjectionRunSnapshot = {
  id: string;
  owner_id: string;
  chapter_id: string | null;
  state: string;
  total_clips: number;
  clips_done: number;
  created_at: string;
  completed_at: string | null;
};

type VideoRunProjectionDb = {
  video_runs: {
    findFirst(input: {
      where: { id: string; owner_id: string; chapter_id: string };
      select: {
        id: true;
        owner_id: true;
        chapter_id: true;
        state: true;
        total_clips: true;
        clips_done: true;
        created_at: true;
        completed_at: true;
      };
    }): Promise<ProjectionRunSnapshot | null>;
    updateMany(input: {
      where: {
        id: string;
        owner_id: string;
        chapter_id: string | null;
        state: string;
        total_clips: number;
        clips_done: number;
      };
      data: {
        state: "concatenated";
        error_message: null;
        completed_at: string;
        updated_at: string;
        last_drive_at: string;
      };
    }): Promise<{ count: number }>;
  };
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readDurableVideoUrl(value: unknown): string | null {
  const candidate = readString(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname
      ? candidate
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the durable result carried by a persisted video node. Canvas video
 * nodes may store the same final asset directly on `videoUrl` or in the
 * canonical `videoResults[videoPrimaryIndex]` result list. Both shapes are
 * first-class persisted evidence; transient blob URLs are rejected in either
 * shape.
 */
export function readDurableVideoUrlFromNodeData(value: unknown): string | null {
  const data = readRecord(value);
  if (!data) return null;

  const directUrl = readDurableVideoUrl(data.videoUrl);
  if (directUrl) return directUrl;

  const results = Array.isArray(data.videoResults) ? data.videoResults : [];
  const primaryIndex =
    typeof data.videoPrimaryIndex === "number" &&
    Number.isInteger(data.videoPrimaryIndex) &&
    data.videoPrimaryIndex >= 0
      ? data.videoPrimaryIndex
      : null;
  if (primaryIndex !== null) {
    const primaryResult = readRecord(results[primaryIndex]);
    const primaryUrl = readDurableVideoUrl(primaryResult?.url);
    if (primaryUrl) return primaryUrl;
  }

  for (const result of results) {
    const resultUrl = readDurableVideoUrl(readRecord(result)?.url);
    if (resultUrl) return resultUrl;
  }
  return null;
}

/**
 * Read deterministic delivery evidence from persisted compose nodes. The
 * orchestrator-owned `film-${runId}` node wins when stale archived compose
 * nodes for the same run are still present. Ambiguous non-canonical results
 * are ignored instead of guessing which asset is final.
 */
export function collectFinalVideoDeliveryEvidence(flow: unknown): FinalVideoDeliveryEvidence[] {
  const flowRecord = readRecord(flow);
  const nodes = Array.isArray(flowRecord?.nodes) ? flowRecord.nodes : [];
  const candidatesByRun = new Map<string, FinalVideoDeliveryEvidence[]>();

  for (const rawNode of nodes) {
    const node = readRecord(rawNode);
    const data = readRecord(node?.data);
    if (!node || !data) continue;
    const kind = readString(data.kind).toLowerCase();
    if (kind !== "composevideo" && kind !== "videocompose") continue;
    if (readString(data.status).toLowerCase() !== "success") continue;
    const runId = readString(data.clipRunId) || readString(data.runId);
    const nodeId = readString(node.id);
    const videoUrl = readDurableVideoUrlFromNodeData(data);
    if (!runId || !nodeId || !videoUrl) continue;
    const candidate = { runId, nodeId, videoUrl };
    candidatesByRun.set(runId, [...(candidatesByRun.get(runId) ?? []), candidate]);
  }

  const evidence: FinalVideoDeliveryEvidence[] = [];
  for (const [runId, candidates] of candidatesByRun) {
    const canonical = candidates.find((candidate) => candidate.nodeId === `film-${runId}`);
    if (canonical) {
      evidence.push(canonical);
      continue;
    }
    const urls = new Set(candidates.map((candidate) => candidate.videoUrl));
    if (urls.size === 1) evidence.push(candidates[0]);
  }
  return evidence;
}

export function canProjectFinalVideoRun(input: {
  evidence: FinalVideoDeliveryEvidence;
  run: ProjectionRunSnapshot;
  ownerId: string;
  chapterId: string;
}): boolean {
  return (
    input.run.id === input.evidence.runId &&
    input.run.owner_id === input.ownerId &&
    input.run.chapter_id === input.chapterId &&
    input.run.total_clips > 0 &&
    input.run.clips_done >= input.run.total_clips
  );
}

/**
 * Project persisted final-asset evidence into video_runs. This CAS is the only
 * path that may recover a terminal run: the final HTTP(S) asset and all clip
 * completions are stronger facts than an earlier watchdog cancellation.
 */
export async function projectFinalVideoRunsFromCanvas(input: {
  db: VideoRunProjectionDb;
  flow: unknown;
  ownerId: string;
  chapterId: string;
  nowIso: string;
}): Promise<FinalVideoRunProjection[]> {
  const evidence = collectFinalVideoDeliveryEvidence(input.flow);
  const projected: FinalVideoRunProjection[] = [];

  for (const item of evidence) {
    const run = await input.db.video_runs.findFirst({
      where: {
        id: item.runId,
        owner_id: input.ownerId,
        chapter_id: input.chapterId,
      },
      select: {
        id: true,
        owner_id: true,
        chapter_id: true,
        state: true,
        total_clips: true,
        clips_done: true,
        created_at: true,
        completed_at: true,
      },
    });
    if (!run || !canProjectFinalVideoRun({ evidence: item, run, ownerId: input.ownerId, chapterId: input.chapterId })) {
      continue;
    }
    if (run.state === "concatenated") {
      projected.push({
        runId: run.id,
        runCreatedAt: run.created_at,
        videoUrl: item.videoUrl,
        totalClips: run.total_clips,
        clipsDone: run.clips_done,
        completedAt: run.completed_at ?? input.nowIso,
        stateChanged: false,
      });
      continue;
    }
    const updated = await input.db.video_runs.updateMany({
      where: {
        id: run.id,
        owner_id: run.owner_id,
        chapter_id: run.chapter_id,
        state: run.state,
        total_clips: run.total_clips,
        clips_done: run.clips_done,
      },
      data: {
        state: "concatenated",
        error_message: null,
        completed_at: input.nowIso,
        updated_at: input.nowIso,
        last_drive_at: input.nowIso,
      },
    });
    if (updated.count !== 1) continue;
    projected.push({
      runId: run.id,
      runCreatedAt: run.created_at,
      videoUrl: item.videoUrl,
      totalClips: run.total_clips,
      clipsDone: run.clips_done,
      completedAt: input.nowIso,
      stateChanged: true,
    });
  }

  return projected;
}

type FinalVideoStatusFlow = {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
};

export type FinalVideoStatusNodeSync = {
  flow: FinalVideoStatusFlow;
  upsertNodes: Array<Record<string, unknown>>;
};

/** Keep the durable canvas status card aligned with the final asset/run facts. */
export function syncFinalVideoStatusNodes(input: {
  flow: FinalVideoStatusFlow;
  runs: FinalVideoRunProjection[];
}): FinalVideoStatusNodeSync {
  const runsByCreation = [...input.runs].sort((left, right) =>
    left.runCreatedAt.localeCompare(right.runCreatedAt),
  );
  const run = runsByCreation[runsByCreation.length - 1];
  if (!run) return { flow: input.flow, upsertNodes: [] };

  const nodeId = "video-run-status";
  const label = "整片生成";
  const prompt = `整片已完成\n${run.videoUrl}`;
  const nodeIndex = input.flow.nodes.findIndex((node) => readString(node.id) === nodeId);
  const existingNode = nodeIndex >= 0 ? input.flow.nodes[nodeIndex] : null;
  const existingData = readRecord(existingNode?.data) ?? {};
  const existingRunId = readString(existingData.runId);
  const existingRunCreatedAt = readString(existingData.runCreatedAt);
  if (
    existingRunId &&
    existingRunId !== run.runId &&
    existingRunCreatedAt > run.runCreatedAt
  ) {
    return { flow: input.flow, upsertNodes: [] };
  }
  const alreadySynchronized =
    readString(existingData.kind) === "text" &&
    readString(existingData.label) === label &&
    readString(existingData.prompt) === prompt &&
    readString(existingData.managedProjection) === "video_run_status" &&
    readString(existingData.runId) === run.runId &&
    readString(existingData.runCreatedAt) === run.runCreatedAt &&
    readString(existingData.authoringState) === "authoring_done" &&
    readString(existingData.productionState) === "concatenated" &&
    readString(existingData.videoUrl) === run.videoUrl &&
    existingData.pendingUserInput === null;
  if (alreadySynchronized) return { flow: input.flow, upsertNodes: [] };

  const data = {
    ...existingData,
    kind: "text",
    label,
    prompt,
    managedProjection: "video_run_status",
    runId: run.runId,
    runCreatedAt: run.runCreatedAt,
    authoringState: "authoring_done",
    productionState: "concatenated",
    videoUrl: run.videoUrl,
    pendingUserInput: null,
  };
  const nextNode: Record<string, unknown> = existingNode
    ? { ...existingNode, data }
    : {
        id: nodeId,
        type: "taskNode",
        position: { x: -420, y: 0 },
        data,
      };
  const nodes = nodeIndex >= 0
    ? input.flow.nodes.map((node, index) => (index === nodeIndex ? nextNode : node))
    : [...input.flow.nodes, nextNode];

  return {
    flow: { ...input.flow, nodes },
    upsertNodes: [nextNode],
  };
}
