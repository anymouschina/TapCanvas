import {
  parseAgentExecutionProvenance,
  type AgentExecutionProvenance,
} from "./agent-execution-provenance";

export type VideoClipExecutionProvenance = {
  artifactKey: string;
  artifactStatus: string;
  artifactError: string | null;
  clipIndex: number;
  sourceHash: string | null;
  outputHash: string | null;
  agentId: string | null;
  repairable: boolean | null;
  repairAttempt: number | null;
  repairProblems: string[];
  writerExecutionProvenance: AgentExecutionProvenance | null;
  dramaticCoverage: Record<string, unknown> | null;
};

export type VideoRunExecutionProvenance = {
  version: 1;
  state: "complete" | "partial" | "legacy_unavailable" | "unavailable";
  expectedClipCount: number;
  parentExecutionProvenance: AgentExecutionProvenance | null;
  clips: VideoClipExecutionProvenance[];
  missingParent: boolean;
  missingWriterClipIndexes: number[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function buildVideoRunExecutionProvenance(input: {
  beatSheetJson: string | null | undefined;
  totalClips: number;
  artifacts: Array<{
    artifact_key: string;
    status: string;
    payload: string | null;
    error?: string | null;
  }>;
}): VideoRunExecutionProvenance {
  const beatSheet = parseJsonRecord(input.beatSheetJson);
  const meta = readRecord(beatSheet?.meta);
  const parentExecutionProvenance = parseAgentExecutionProvenance(meta?.parentExecutionProvenance);
  const beats = Array.isArray(beatSheet?.beats) ? beatSheet.beats : [];
  const expectedClipCount = Math.max(0, beats.length || Math.trunc(input.totalClips));
  const clips = input.artifacts
    .filter((artifact) => artifact.artifact_key.startsWith("clip:"))
    .map((artifact): VideoClipExecutionProvenance | null => {
      const payload = parseJsonRecord(artifact.payload);
      const clipIndex = Number(payload?.clipIndex);
      if (!Number.isInteger(clipIndex) || clipIndex < 0) return null;
      const sourceHash = typeof payload?.sourceHash === "string" && payload.sourceHash.trim()
        ? payload.sourceHash.trim()
        : null;
      const outputHash = typeof payload?.outputHash === "string" && payload.outputHash.trim()
        ? payload.outputHash.trim()
        : null;
      const agentId = typeof payload?.agentId === "string" && payload.agentId.trim()
        ? payload.agentId.trim()
        : null;
      const repairable = typeof payload?.repairable === "boolean" ? payload.repairable : null;
      const rawRepairAttempt = payload?.repairAttempt;
      const repairAttempt = typeof rawRepairAttempt === "number" && Number.isInteger(rawRepairAttempt) && rawRepairAttempt >= 0
        ? rawRepairAttempt
        : null;
      const repairProblems = Array.isArray(payload?.repairProblems)
        ? payload.repairProblems
          .filter((problem): problem is string => typeof problem === "string" && Boolean(problem.trim()))
          .map((problem) => problem.trim().slice(0, 800))
        : [];
      const clip = readRecord(payload?.clip);
      return {
        artifactKey: artifact.artifact_key,
        artifactStatus: artifact.status,
        artifactError: typeof artifact.error === "string" && artifact.error.trim()
          ? artifact.error.trim().slice(0, 800)
          : null,
        clipIndex,
        sourceHash,
        outputHash,
        agentId,
        repairable,
        repairAttempt,
        repairProblems,
        writerExecutionProvenance: parseAgentExecutionProvenance(payload?.writerExecutionProvenance),
        dramaticCoverage: readRecord(clip?.dramaticCoverage),
      };
    })
    .filter((clip): clip is VideoClipExecutionProvenance => clip !== null)
    .sort((left, right) => left.clipIndex - right.clipIndex);
  const writerByIndex = new Map(
    clips.map((clip) => [clip.clipIndex, clip.writerExecutionProvenance] as const),
  );
  const missingWriterClipIndexes = Array.from(
    { length: expectedClipCount },
    (_, clipIndex) => clipIndex,
  ).filter((clipIndex) => !writerByIndex.get(clipIndex));
  const missingParent = parentExecutionProvenance === null;
  const hasAnyProvenance = Boolean(parentExecutionProvenance) || clips.some(
    (clip) => clip.writerExecutionProvenance !== null,
  );
  const hasLegacyFacts = Boolean(beatSheet) || clips.length > 0;
  const state = !hasAnyProvenance
    ? hasLegacyFacts ? "legacy_unavailable" : "unavailable"
    : !missingParent && missingWriterClipIndexes.length === 0
      ? "complete"
      : "partial";
  return {
    version: 1,
    state,
    expectedClipCount,
    parentExecutionProvenance,
    clips,
    missingParent,
    missingWriterClipIndexes,
  };
}
