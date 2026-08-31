import { createHash } from "node:crypto";
import {
  resilientDraftGet,
  resilientDraftSet,
} from "./video-orchestrator.resilient-draft-store";

const DRAFT_TTL_SECONDS = 24 * 60 * 60;
const DRAFT_KEY_PREFIX = "video:beat-sheet-draft:v1:";

export type BeatSheetDraft = {
  ownerId: string;
  runId: string;
  revision: string;
  beatSheet: Record<string, unknown>;
  updatedAt: string;
};

export type BeatSheetPatchOperation =
  | { op: "set"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "removeValue"; path: string; value: unknown };

export class BeatSheetDraftError extends Error {
  constructor(
    public readonly code:
      | "beat_sheet_draft_store_unavailable"
      | "beat_sheet_draft_not_found"
      | "beat_sheet_draft_revision_conflict"
      | "beat_sheet_patch_invalid",
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const draftKey = (ownerId: string, runId: string): string =>
  `${DRAFT_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(runId)}`;

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function revisionOf(beatSheet: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(beatSheet)).digest("hex").slice(0, 16);
}

function decodePointer(path: string): string[] {
  if (!path.startsWith("/") || path === "/") {
    throw new BeatSheetDraftError(
      "beat_sheet_patch_invalid",
      `patch path 必须是非根 JSON Pointer，实收 ${JSON.stringify(path)}`,
    );
  }
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function readContainer(root: Record<string, unknown>, path: string): {
  container: Record<string, unknown> | unknown[];
  key: string;
} {
  const segments = decodePointer(path);
  let current: unknown = root;
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new BeatSheetDraftError("beat_sheet_patch_invalid", `patch path 数组下标不存在：${path}`);
      }
      current = current[index];
      continue;
    }
    if (!current || typeof current !== "object") {
      throw new BeatSheetDraftError("beat_sheet_patch_invalid", `patch path 中间节点不是容器：${path}`);
    }
    const record = current as Record<string, unknown>;
    if (!(segment in record)) {
      throw new BeatSheetDraftError("beat_sheet_patch_invalid", `patch path 中间字段不存在：${path}`);
    }
    current = record[segment];
  }
  if (!Array.isArray(current) && (!current || typeof current !== "object")) {
    throw new BeatSheetDraftError("beat_sheet_patch_invalid", `patch path 父节点不是容器：${path}`);
  }
  return { container: current as Record<string, unknown> | unknown[], key: segments.at(-1) ?? "" };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * A repair operation targets one JSON Pointer, but model repairs frequently only
 * know the invalid fields reported by the validator. Merging plain objects keeps
 * the untouched structural fields in the persisted draft; arrays and scalars are
 * still replaced atomically. This remains deterministic and does not invent any
 * creative value or bypass validation.
 */
function mergePatchRecord(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = structuredClone(existing);
  for (const [key, value] of Object.entries(incoming)) {
    const previous = merged[key];
    merged[key] = isRecord(previous) && isRecord(value)
      ? mergePatchRecord(previous, value)
      : structuredClone(value);
  }
  return merged;
}

export function applyBeatSheetPatch(
  beatSheet: Record<string, unknown>,
  operations: BeatSheetPatchOperation[],
): Record<string, unknown> {
  if (operations.length < 1 || operations.length > 64) {
    throw new BeatSheetDraftError("beat_sheet_patch_invalid", "patch operations 数量必须为 1～64");
  }
  const next = cloneRecord(beatSheet);
  for (const [operationIndex, operation] of operations.entries()) {
    if (
      !operation ||
      typeof operation !== "object" ||
      Array.isArray(operation) ||
      !["set", "remove", "removeValue"].includes(operation.op) ||
      typeof operation.path !== "string" ||
      !operation.path.trim() ||
      ((operation.op === "set" || operation.op === "removeValue") &&
        !Object.prototype.hasOwnProperty.call(operation, "value"))
    ) {
      throw new BeatSheetDraftError(
        "beat_sheet_patch_invalid",
        `patch operations[${operationIndex}] 缺少合法 op/path/value。`,
      );
    }
    const { container, key } = readContainer(next, operation.path);
    if (Array.isArray(container)) {
      const index = Number(key);
      const appendsAtTail =
        operation.op === "set" && (key === "-" || index === container.length);
      const indexExists = Number.isInteger(index) && index >= 0 && index < container.length;
      if (!indexExists && !appendsAtTail) {
        throw new BeatSheetDraftError("beat_sheet_patch_invalid", `patch path 数组下标不存在：${operation.path}`);
      }
      if (appendsAtTail) container.push(structuredClone(operation.value));
      else if (operation.op === "set") container[index] = structuredClone(operation.value);
      else if (operation.op === "remove") container.splice(index, 1);
      else {
        const value = container[index];
        if (!Array.isArray(value)) {
          throw new BeatSheetDraftError("beat_sheet_patch_invalid", `removeValue 目标不是数组：${operation.path}`);
        }
        const filtered = value.filter((item) => !valuesEqual(item, operation.value));
        if (filtered.length === value.length) {
          throw new BeatSheetDraftError("beat_sheet_patch_invalid", `removeValue 未命中目标值：${operation.path}`);
        }
        container[index] = filtered;
      }
      continue;
    }
    if (operation.op === "set") {
      const previous = container[key];
      container[key] = isRecord(previous) && isRecord(operation.value)
        ? mergePatchRecord(previous, operation.value)
        : structuredClone(operation.value);
    } else if (operation.op === "remove") {
      if (!(key in container)) {
        throw new BeatSheetDraftError("beat_sheet_patch_invalid", `remove 字段不存在：${operation.path}`);
      }
      delete container[key];
    } else {
      const value = container[key];
      if (!Array.isArray(value)) {
        throw new BeatSheetDraftError("beat_sheet_patch_invalid", `removeValue 目标不是数组：${operation.path}`);
      }
      const filtered = value.filter((item) => !valuesEqual(item, operation.value));
      if (filtered.length === value.length) {
        throw new BeatSheetDraftError("beat_sheet_patch_invalid", `removeValue 未命中目标值：${operation.path}`);
      }
      container[key] = filtered;
    }
  }
  return next;
}

export async function saveBeatSheetDraft(input: {
  ownerId: string;
  runId: string;
  beatSheet: Record<string, unknown>;
}): Promise<BeatSheetDraft> {
  const beatSheet = cloneRecord(input.beatSheet);
  const draft: BeatSheetDraft = {
    ownerId: input.ownerId,
    runId: input.runId,
    revision: revisionOf(beatSheet),
    beatSheet,
    updatedAt: new Date().toISOString(),
  };
  await resilientDraftSet(
    draftKey(input.ownerId, input.runId),
    JSON.stringify(draft),
    DRAFT_TTL_SECONDS,
  );
  return draft;
}

export async function readBeatSheetDraft(ownerId: string, runId: string): Promise<BeatSheetDraft> {
  const raw = await resilientDraftGet(draftKey(ownerId, runId), DRAFT_TTL_SECONDS);
  if (!raw) {
    throw new BeatSheetDraftError("beat_sheet_draft_not_found", `runId「${runId}」没有可修订的 BeatSheet 草稿`);
  }
  const parsed = JSON.parse(raw) as BeatSheetDraft;
  return { ...parsed, beatSheet: cloneRecord(parsed.beatSheet) };
}

export async function patchBeatSheetDraft(input: {
  ownerId: string;
  runId: string;
  revision: string;
  operations: BeatSheetPatchOperation[];
}): Promise<BeatSheetDraft> {
  const current = await readBeatSheetDraft(input.ownerId, input.runId);
  if (current.revision !== input.revision) {
    throw new BeatSheetDraftError(
      "beat_sheet_draft_revision_conflict",
      `BeatSheet 草稿版本冲突：期望 ${input.revision}，当前 ${current.revision}；请按当前 revision 重试。`,
      {
        expectedRevision: input.revision,
        currentRevision: current.revision,
      },
    );
  }
  return saveBeatSheetDraft({
    ownerId: input.ownerId,
    runId: input.runId,
    beatSheet: applyBeatSheetPatch(current.beatSheet, input.operations),
  });
}
