import { createHash } from "node:crypto";
import {
  projectBeatExecutionSelectors,
  validateBeatSheetDraftNode,
} from "./video-orchestrator.beat-sheet-draft-node";
import { validateBeatSheetDraftHeader } from "./video-orchestrator.beat-sheet-draft-header";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";
import type { ParentAgentExecution } from "./agent-execution-provenance";
import {
  resilientDraftBatch,
  resilientDraftCompareAndSetBeat,
  resilientDraftExpire,
  resilientDraftGet,
  resilientDraftMget,
  resilientDraftSet,
  resilientDraftSetRepair,
} from "./video-orchestrator.resilient-draft-store";

const PREFLIGHT_TTL_SECONDS = 24 * 60 * 60;
const PREFLIGHT_KEY_PREFIX = "video:beat-sheet-preflight:v1:";
const DRAFT_KEY_PREFIX = "video:beat-sheet-draft:v1:";
const REPAIR_CONTRACT_VERSION = 4;

/**
 * BeatSheet preflight 记录的是通过结构合同的创作计划，不是可编辑草稿。
 * 资产生成阶段只消费 revision/fingerprint；最终 loop 必须证明仍在执行同一份计划。
 */
export type BeatSheetPreflight = {
  ownerId: string;
  runId: string;
  revision: string;
  fingerprint: string;
  sourceFingerprint: string;
  beatSheet: Record<string, unknown>;
  updatedAt: string;
};

export class BeatSheetPreflightError extends Error {
  constructor(
    public readonly code:
      | "beat_sheet_preflight_store_unavailable"
      | "beat_sheet_draft_not_found"
      | "beat_sheet_preflight_not_found"
      | "beat_sheet_preflight_invalid",
    message: string,
  ) {
    super(message);
  }
}

const preflightKey = (ownerId: string, runId: string): string =>
  `${PREFLIGHT_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(runId)}`;

const draftKey = (ownerId: string, runId: string): string =>
  `${DRAFT_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(runId)}`;

const draftRepairKey = (ownerId: string, runId: string): string =>
  `${draftKey(ownerId, runId)}:repair`;

const draftBeatKey = (ownerId: string, runId: string, revision: string, clipIndex: number): string =>
  `${draftKey(ownerId, runId)}:${revision}:beat:${clipIndex}`;

const draftBeatRevisionKey = (
  ownerId: string,
  runId: string,
  revision: string,
  clipIndex: number,
): string => `${draftBeatKey(ownerId, runId, revision, clipIndex)}:revision`;

const draftBeatHistoryKey = (
  ownerId: string,
  runId: string,
  revision: string,
  clipIndex: number,
  beatRevision: string,
): string => `${draftBeatKey(ownerId, runId, revision, clipIndex)}:history:${beatRevision}`;

export type BeatSheetDraft = {
  ownerId: string;
  runId: string;
  revision: string;
  expectedBeatCount: number;
  header: Record<string, unknown>;
	executionBinding: BeatSheetDraftExecutionBinding;
	repairContractVersion: number;
	repairActions: string[];
  repairIssues: string[];
  repairClipIndexes: number[];
  repairContinuityClipIndexes: number[];
  repairHeader: boolean;
  updatedAt: string;
};

/**
 * Stable logical-root ownership for a durable authoring draft.
 *
 * executionId changes whenever the same logical task crosses a physical window,
 * so equality is intentionally fenced by sessionId + model + apiStyle. The first
 * physical executionId remains audit evidence only.
 */
export type BeatSheetDraftExecutionBinding = {
	version: 1;
	sessionId: string;
	model: string;
	apiStyle: "chat" | "responses";
	initialExecutionId: string;
};

function readNonEmptyString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function createBeatSheetDraftExecutionBinding(
	parent: ParentAgentExecution,
): BeatSheetDraftExecutionBinding {
	const model = readNonEmptyString(parent.model);
	const provenance = parent.provenance;
	const sessionId = readNonEmptyString(provenance?.sessionId);
	const executionId = readNonEmptyString(provenance?.executionId);
	if (!model || !provenance || !sessionId || !executionId) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet durable draft 需要父代理真实 provenance.sessionId/executionId；禁止用无根物理调用创建或修改草稿。",
		);
	}
	if (provenance.model !== model || provenance.apiStyle !== parent.apiStyle) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"parentAgentExecution 与 provenance 的 model/apiStyle 不一致，拒绝绑定 BeatSheet durable draft。",
		);
	}
	return {
		version: 1,
		sessionId,
		model,
		apiStyle: parent.apiStyle,
		initialExecutionId: executionId,
	};
}

function parseExecutionBinding(value: unknown): BeatSheetDraftExecutionBinding | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const sessionId = readNonEmptyString(record.sessionId);
	const model = readNonEmptyString(record.model);
	const initialExecutionId = readNonEmptyString(record.initialExecutionId);
	const apiStyle = record.apiStyle === "chat" || record.apiStyle === "responses"
		? record.apiStyle
		: null;
	return record.version === 1 && sessionId && model && initialExecutionId && apiStyle
		? { version: 1, sessionId, model, apiStyle, initialExecutionId }
		: null;
}

export function assertBeatSheetDraftExecutionBinding(
	draft: Pick<BeatSheetDraft, "runId" | "executionBinding">,
	parent: ParentAgentExecution,
): void {
	const observed = createBeatSheetDraftExecutionBinding(parent);
	const expected = draft.executionBinding;
	if (
		expected.sessionId !== observed.sessionId ||
		expected.model !== observed.model ||
		expected.apiStyle !== observed.apiStyle
	) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			`BeatSheet draft runId=${draft.runId} 已绑定 session/model/apiStyle，当前父代理执行身份不匹配。`,
		);
	}
}

function readUniqueStrings(value: unknown): string[] {
	return Array.isArray(value)
		? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
		: [];
}

type BeatSheetDraftRepair = Pick<
  BeatSheetDraft,
  "repairContractVersion" | "repairActions" | "repairIssues" | "repairClipIndexes" | "repairContinuityClipIndexes" | "repairHeader"
> & {
  revision: string;
};

const emptyRepair = (): BeatSheetDraftRepair => ({
  revision: "",
  repairContractVersion: REPAIR_CONTRACT_VERSION,
  repairActions: [],
  repairIssues: [],
  repairClipIndexes: [],
  repairContinuityClipIndexes: [],
  repairHeader: false,
});

function parseRepair(raw: string | null, revision: string): BeatSheetDraftRepair {
  if (!raw) return emptyRepair();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRepair();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyRepair();
  const record = parsed as Record<string, unknown>;
  if (
    record.revision !== revision ||
    Number(record.repairContractVersion) !== REPAIR_CONTRACT_VERSION
  ) {
    return emptyRepair();
  }
  return {
    revision,
    repairContractVersion: REPAIR_CONTRACT_VERSION,
    repairActions: readUniqueStrings(record.repairActions),
    repairIssues: readUniqueStrings(record.repairIssues),
    repairClipIndexes: Array.isArray(record.repairClipIndexes)
      ? Array.from(new Set(
          record.repairClipIndexes
            .map(Number)
            .filter((index) => Number.isInteger(index) && index >= 0),
        )).sort((left, right) => left - right)
      : [],
    repairContinuityClipIndexes: Array.isArray(record.repairContinuityClipIndexes)
      ? Array.from(new Set(
          record.repairContinuityClipIndexes
            .map(Number)
            .filter((index) => Number.isInteger(index) && index > 0),
        )).sort((left, right) => left - right)
      : [],
    repairHeader: record.repairHeader === true,
  };
}

function parseDraft(raw: string): BeatSheetDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      "BeatSheet draft 记录不是合法 JSON。",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet draft 记录不是对象。");
  }
  const record = parsed as Record<string, unknown>;
  const ownerId = typeof record.ownerId === "string" ? record.ownerId.trim() : "";
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const revision = typeof record.revision === "string" ? record.revision.trim() : "";
  const expectedBeatCount = Number(record.expectedBeatCount);
  const header = record.header;
  const executionBinding = parseExecutionBinding(record.executionBinding);
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt.trim() : "";
  if (
    !ownerId || !runId || !revision || !Number.isInteger(expectedBeatCount) || expectedBeatCount < 1 ||
    !header || typeof header !== "object" || Array.isArray(header) || !executionBinding || !updatedAt
  ) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet draft 记录字段不完整。");
  }
  return {
    ownerId,
    runId,
    revision,
    expectedBeatCount,
    header: cloneRecord(header as Record<string, unknown>),
		executionBinding,
		repairContractVersion: REPAIR_CONTRACT_VERSION,
		repairActions: [],
    repairIssues: [],
    repairClipIndexes: [],
    repairContinuityClipIndexes: [],
    repairHeader: false,
    updatedAt,
  };
}

export async function beginBeatSheetDraft(input: {
  ownerId: string;
  runId: string;
  expectedBeatCount: number;
  header: Record<string, unknown>;
  executionBinding: BeatSheetDraftExecutionBinding;
  replaceRevision?: string;
}): Promise<BeatSheetDraft> {
  if (!Number.isInteger(input.expectedBeatCount) || input.expectedBeatCount < 1 || input.expectedBeatCount > 64) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "expectedBeatCount 必须是 1..64 的整数。");
  }
  const header = cloneRecord(input.header);
  delete header.beats;
  header.runId = input.runId;
  const headerIssues = validateBeatSheetDraftHeader(header);
  if (headerIssues.length > 0) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `BeatSheet header 结构未完成，拒绝写入 durable draft：${headerIssues.join("；")}`,
    );
  }
  const revision = createHash("sha256")
    .update(JSON.stringify({ header, expectedBeatCount: input.expectedBeatCount }))
    .digest("hex")
    .slice(0, 16);
  const existingRaw = await resilientDraftGet(
    draftKey(input.ownerId, input.runId),
    PREFLIGHT_TTL_SECONDS,
  );
  let replacedDraft: BeatSheetDraft | null = null;
  if (existingRaw) {
    const existing = parseDraft(existingRaw);
    if (existing.ownerId !== input.ownerId || existing.runId !== input.runId) {
      throw new BeatSheetPreflightError(
        "beat_sheet_preflight_invalid",
        "BeatSheet draft 的持久作用域与请求不一致。",
      );
    }
    if (
		existing.executionBinding.sessionId !== input.executionBinding.sessionId ||
		existing.executionBinding.model !== input.executionBinding.model ||
		existing.executionBinding.apiStyle !== input.executionBinding.apiStyle
	) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			`BeatSheet draft runId=${input.runId} 的稳定执行绑定不允许跨 session/model/apiStyle 漂移。`,
		);
	}
    if (existing.revision === revision) return readBeatSheetDraft(input.ownerId, input.runId);
    if ((input.replaceRevision ?? "").trim() !== existing.revision) {
      throw new BeatSheetPreflightError(
        "beat_sheet_preflight_invalid",
        `BeatSheet draft 已初始化为 revision=${existing.revision}；继续写 beat，或携带该 revision 显式替换 header。`,
      );
    }
    replacedDraft = existing;
  }
  const draft: BeatSheetDraft = {
    ownerId: input.ownerId,
    runId: input.runId,
    revision,
    expectedBeatCount: input.expectedBeatCount,
    header,
		executionBinding: replacedDraft?.executionBinding ?? structuredClone(input.executionBinding),
		repairContractVersion: REPAIR_CONTRACT_VERSION,
		repairActions: [],
    repairIssues: [],
    repairClipIndexes: [],
    repairContinuityClipIndexes: [],
    repairHeader: false,
    updatedAt: new Date().toISOString(),
  };
  if (!replacedDraft) {
    await resilientDraftBatch([
      {
        type: "set",
        key: draftKey(input.ownerId, input.runId),
        value: JSON.stringify(draft),
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
      { type: "del", key: draftRepairKey(input.ownerId, input.runId) },
    ]);
    return draft;
  }

  const sourceBeatKeys = Array.from(
    { length: replacedDraft.expectedBeatCount },
    (_, clipIndex) => draftBeatKey(input.ownerId, input.runId, replacedDraft.revision, clipIndex),
  );
  const sourceBeats = sourceBeatKeys.length > 0
    ? await resilientDraftMget(sourceBeatKeys, PREFLIGHT_TTL_SECONDS)
    : [];
  const operations: Array<
    | { type: "set"; key: string; value: string; ttlSeconds: number }
    | { type: "del"; key: string }
  > = [
    {
      type: "set",
      key: draftKey(input.ownerId, input.runId),
      value: JSON.stringify(draft),
      ttlSeconds: PREFLIGHT_TTL_SECONDS,
    },
    { type: "del", key: draftRepairKey(input.ownerId, input.runId) },
  ];
  sourceBeats.forEach((rawBeat, clipIndex) => {
    if (!rawBeat) return;
    const beatRevision = fingerprintBeat(rawBeat);
    operations.push(
      {
        type: "set",
        key: draftBeatKey(input.ownerId, input.runId, revision, clipIndex),
        value: rawBeat,
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
      {
        type: "set",
        key: draftBeatRevisionKey(input.ownerId, input.runId, revision, clipIndex),
        value: beatRevision,
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
      {
        type: "set",
        key: draftBeatHistoryKey(input.ownerId, input.runId, revision, clipIndex, beatRevision),
        value: rawBeat,
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
    );
  });
  await resilientDraftBatch(operations);
  return draft;
}

export async function readBeatSheetDraft(ownerId: string, runId: string): Promise<BeatSheetDraft> {
  const [raw, repairRaw] = await resilientDraftMget(
    [draftKey(ownerId, runId), draftRepairKey(ownerId, runId)],
    PREFLIGHT_TTL_SECONDS,
  );
  if (!raw) {
    throw new BeatSheetPreflightError("beat_sheet_draft_not_found", `runId「${runId}」没有 BeatSheet draft。`);
  }
  const draft = parseDraft(raw);
  const repair = parseRepair(repairRaw, draft.revision);
  return {
    ...draft,
    repairContractVersion: repair.repairContractVersion,
    repairActions: repair.repairActions,
    repairIssues: repair.repairIssues,
    repairClipIndexes: repair.repairClipIndexes,
    repairContinuityClipIndexes: repair.repairContinuityClipIndexes,
    repairHeader: repair.repairHeader,
  };
}

export async function setBeatSheetDraftRepairActions(input: {
	ownerId: string;
	runId: string;
	revision: string;
	repairActions: readonly string[];
  repairIssues?: readonly string[];
  repairClipIndexes?: readonly number[];
  repairContinuityClipIndexes?: readonly number[];
  repairHeader?: boolean;
}): Promise<BeatSheetDraft> {
	const repairActions = readUniqueStrings(input.repairActions);
  const repairIssues = readUniqueStrings(input.repairIssues);
  const repairClipIndexes = Array.from(
    new Set((input.repairClipIndexes ?? []).filter((index) => Number.isInteger(index) && index >= 0)),
  ).sort((left, right) => left - right);
  const repairContinuityClipIndexes = Array.from(
    new Set((input.repairContinuityClipIndexes ?? []).filter((index) => Number.isInteger(index) && index > 0)),
  ).sort((left, right) => left - right);
	const key = draftKey(input.ownerId, input.runId);
	const repairKey = draftRepairKey(input.ownerId, input.runId);
	const repair: BeatSheetDraftRepair = {
		revision: input.revision,
		repairContractVersion: REPAIR_CONTRACT_VERSION,
		repairActions,
		repairIssues,
		repairClipIndexes,
		repairContinuityClipIndexes,
		repairHeader: input.repairHeader === true,
	};
	const changed = await resilientDraftSetRepair({
		draftKey: key,
		repairKey,
		expectedRevision: input.revision,
		repairJson: JSON.stringify(repair),
		ttlSeconds: PREFLIGHT_TTL_SECONDS,
	});
	if (!changed) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			`BeatSheet draft revision 已变化，拒绝写入旧修复游标 revision=${input.revision}。`,
		);
	}
	return readBeatSheetDraft(input.ownerId, input.runId);
}

function parseBeat(raw: string, clipIndex: number): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    return cloneRecord(parsed as Record<string, unknown>);
  } catch {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `BeatSheet draft clip ${clipIndex} 不是合法对象。`,
    );
  }
}

function fingerprintBeat(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export async function readBeatSheetDraftBeat(input: {
  ownerId: string;
  runId: string;
  revision: string;
  clipIndex: number;
  beatRevision?: string;
  sourceRevision?: string;
}): Promise<{
  draft: BeatSheetDraft;
  beat: Record<string, unknown>;
  beatRevision: string;
  current: boolean;
}> {
  const draft = await readBeatSheetDraft(input.ownerId, input.runId);
  if (draft.revision !== input.revision) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet draft revision 已变化，禁止读取旧图。");
  }
  if (!Number.isInteger(input.clipIndex) || input.clipIndex < 0 || input.clipIndex >= draft.expectedBeatCount) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `clipIndex 必须在 0..${draft.expectedBeatCount - 1}。`,
    );
  }
  const requestedBeatRevision = (input.beatRevision ?? "").trim();
  const sourceRevision = (input.sourceRevision ?? "").trim() || input.revision;
  const currentKey = draftBeatKey(input.ownerId, input.runId, sourceRevision, input.clipIndex);
  const raw = requestedBeatRevision
    ? await resilientDraftGet(draftBeatHistoryKey(
      input.ownerId,
      input.runId,
      sourceRevision,
        input.clipIndex,
        requestedBeatRevision,
      ), PREFLIGHT_TTL_SECONDS)
    : await resilientDraftGet(currentKey, PREFLIGHT_TTL_SECONDS);
  if (!raw) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_not_found",
      requestedBeatRevision
        ? `clipIndex=${input.clipIndex} 没有 beatRevision=${requestedBeatRevision} 的历史节点。`
        : `clipIndex=${input.clipIndex} 尚未写入 BeatSheet 节点。`,
    );
  }
  const actualRevision = fingerprintBeat(raw);
  if (requestedBeatRevision && actualRevision !== requestedBeatRevision) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet 历史节点 revision 与内容不一致。");
  }
  return {
    draft,
    beat: parseBeat(raw, input.clipIndex),
    beatRevision: actualRevision,
    current: sourceRevision === input.revision &&
      (!requestedBeatRevision || (await resilientDraftGet(currentKey, PREFLIGHT_TTL_SECONDS)) === raw),
  };
}

export async function putBeatSheetDraftBeat(input: {
  ownerId: string;
  runId: string;
  revision: string;
  beat: Record<string, unknown>;
  replaceBeatRevision?: string;
  generationContract?: VideoGenerationContract;
}): Promise<{ draft: BeatSheetDraft; clipIndex: number; beatRevision: string; idempotent: boolean }> {
  const draft = await readBeatSheetDraft(input.ownerId, input.runId);
  if (draft.revision !== input.revision) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet draft revision 已变化，禁止混写旧节点。");
  }
  const normalizedBeat = projectBeatExecutionSelectors(input.beat);
  const clipIndex = Number(normalizedBeat.clipIndex);
  if (!Number.isInteger(clipIndex) || clipIndex < 0 || clipIndex >= draft.expectedBeatCount) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `beat.clipIndex 必须在 0..${draft.expectedBeatCount - 1}。`,
    );
  }
  const nodeIssues = validateBeatSheetDraftNode(
    normalizedBeat,
    draft.header.storyFactsContext,
    input.generationContract ? { generationContract: input.generationContract } : {},
  );
  if (nodeIssues.length > 0) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `beat 节点结构未完成，拒绝写入 durable draft：${nodeIssues.join("；")}`,
    );
  }
  const currentKey = draftBeatKey(input.ownerId, input.runId, input.revision, clipIndex);
  const currentRaw = await resilientDraftGet(currentKey, PREFLIGHT_TTL_SECONDS);
  const nextRaw = JSON.stringify(cloneRecord(normalizedBeat));
  const nextBeatRevision = fingerprintBeat(nextRaw);
  const currentBeatRevision = currentRaw ? fingerprintBeat(currentRaw) : "";
  if (currentRaw === nextRaw) {
    await resilientDraftBatch([
      {
        type: "set",
        key: draftBeatHistoryKey(input.ownerId, input.runId, input.revision, clipIndex, nextBeatRevision),
        value: nextRaw,
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
      {
        type: "set",
        key: draftBeatRevisionKey(input.ownerId, input.runId, input.revision, clipIndex),
        value: nextBeatRevision,
        ttlSeconds: PREFLIGHT_TTL_SECONDS,
      },
    ]);
    return { draft, clipIndex, beatRevision: nextBeatRevision, idempotent: true };
  }
  const replaceBeatRevision = (input.replaceBeatRevision ?? "").trim();
  if (currentRaw && replaceBeatRevision !== currentBeatRevision) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `clipIndex=${clipIndex} 已存在 beatRevision=${currentBeatRevision}；先 preflight_get_beat 读取当前节点，再携带 replaceBeatRevision 精确替换。`,
    );
  }
  const historyKey = draftBeatHistoryKey(
    input.ownerId,
    input.runId,
    input.revision,
    clipIndex,
    nextBeatRevision,
  );
  const currentHistoryKey = currentBeatRevision
    ? draftBeatHistoryKey(
        input.ownerId,
        input.runId,
        input.revision,
        clipIndex,
        currentBeatRevision,
      )
    : historyKey;
  const casResult = await resilientDraftCompareAndSetBeat({
    currentKey,
    previousHistoryKey: currentHistoryKey,
    nextHistoryKey: historyKey,
    revisionKey: draftBeatRevisionKey(input.ownerId, input.runId, input.revision, clipIndex),
    repairKey: draftRepairKey(input.ownerId, input.runId),
    observedRaw: currentRaw ?? "",
    observedRevision: currentBeatRevision,
    nextRaw,
    nextRevision: nextBeatRevision,
    ttlSeconds: PREFLIGHT_TTL_SECONDS,
  });
  if (!casResult) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      `clipIndex=${clipIndex} 在写入期间已变化；重新 preflight_get_beat 后再修订。`,
    );
  }
  return {
    // Keep the verifier-authored repair frontier until a successful commit
    // explicitly clears it. Clearing it after the first patched beat made the
    // durable catalog advertise commit and reject every remaining repair.
    draft,
    clipIndex,
    beatRevision: nextBeatRevision,
    idempotent: false,
  };
}

export async function assembleBeatSheetDraft(input: {
  ownerId: string;
  runId: string;
  revision: string;
}): Promise<{
  draft: BeatSheetDraft;
  beatSheet: Record<string, unknown> | null;
  missingClipIndexes: number[];
  beatRevisions: Array<string | null>;
}> {
  const draft = await readBeatSheetDraft(input.ownerId, input.runId);
  if (draft.revision !== input.revision) {
    throw new BeatSheetPreflightError("beat_sheet_preflight_invalid", "BeatSheet draft revision 已变化，禁止提交旧图。");
  }
  const indexes = Array.from({ length: draft.expectedBeatCount }, (_, index) => index);
  const raws = await resilientDraftMget(
    indexes.map((clipIndex) => draftBeatKey(input.ownerId, input.runId, input.revision, clipIndex)),
    PREFLIGHT_TTL_SECONDS,
  );
  const beatRevisions = raws.map((raw) => raw ? fingerprintBeat(raw) : null);
  const missingClipIndexes = indexes.filter((_, index) => !raws[index]);
  if (missingClipIndexes.length > 0) {
    return { draft, beatSheet: null, missingClipIndexes, beatRevisions };
  }
  const beats = raws.map((raw, index) => parseBeat(String(raw), index));
  return {
    draft,
    beatSheet: { ...cloneRecord(draft.header), runId: draft.runId, beats },
    missingClipIndexes: [],
    beatRevisions,
  };
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

/**
 * 这些字段是执行期资产身份或服务端注入事实，不改变 BeatSheet 的创作计划。
 * 资产回填可以改变它们，但不能借此改变已通过 preflight 的叙事/镜头合同。
 */
const PREFLIGHT_RUNTIME_FIELDS = new Set([
  "runId",
  "chapterId",
  "referenceImageNodeIds",
  "videoReferenceNodeIds",
  "assetNodeIds",
  "storyboardImageNodeId",
  "lastFrameImageNodeId",
  "blockingFrameNodeId",
  "generationContract",
  "finishingContract",
  "agentModel",
  "agentApiStyle",
  "parentExecutionProvenance",
  "styleReferenceImageUrl",
  "preflightRevision",
  "preflightFingerprint",
]);

function canonicalizeForPreflight(value: unknown, key?: string): unknown {
  if (key && PREFLIGHT_RUNTIME_FIELDS.has(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => canonicalizeForPreflight(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, field) => {
        const normalized = canonicalizeForPreflight(record[field], field);
        if (normalized !== undefined) result[field] = normalized;
        return result;
      }, {});
  }
  return value;
}

/**
 * 只比较创作合同。资产节点 ID、父代理物理执行身份与服务端运行时注入字段
 * 由最终 commit 重新验真；它们不能让同一逻辑任务跨物理窗口后误报计划漂移。
 */
export function buildBeatSheetPreflightFingerprint(value: unknown): string {
  const canonical = canonicalizeForPreflight(value);
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 32);
}

function revisionOf(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function parsePreflight(raw: string): BeatSheetPreflight {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      "BeatSheet preflight 记录不是合法 JSON，禁止猜测或回退到其他记录。",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      "BeatSheet preflight 记录不是对象，禁止继续执行。",
    );
  }
  const record = parsed as Record<string, unknown>;
  const ownerId = typeof record.ownerId === "string" ? record.ownerId.trim() : "";
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const revision = typeof record.revision === "string" ? record.revision.trim() : "";
  const fingerprint = typeof record.fingerprint === "string" ? record.fingerprint.trim() : "";
  const sourceFingerprint = typeof record.sourceFingerprint === "string"
    ? record.sourceFingerprint.trim()
    : "";
  const beatSheet = record.beatSheet;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt.trim() : "";
  if (
    !ownerId ||
    !runId ||
    !revision ||
    !fingerprint ||
    !sourceFingerprint ||
    !updatedAt ||
    !beatSheet ||
    typeof beatSheet !== "object" ||
    Array.isArray(beatSheet)
  ) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_invalid",
      "BeatSheet preflight 记录缺少 owner/run/revision/fingerprint/sourceFingerprint 或完整 BeatSheet。",
    );
  }
  return {
    ownerId,
    runId,
    revision,
    fingerprint,
    sourceFingerprint,
    beatSheet: cloneRecord(beatSheet as Record<string, unknown>),
    updatedAt,
  };
}

export async function saveBeatSheetPreflight(input: {
  ownerId: string;
  runId: string;
  beatSheet: Record<string, unknown>;
  sourceFingerprint: string;
}): Promise<BeatSheetPreflight> {
  const beatSheet = cloneRecord(input.beatSheet);
	const sourceFingerprint = input.sourceFingerprint.trim();
	if (!sourceFingerprint) {
		throw new BeatSheetPreflightError(
			"beat_sheet_preflight_invalid",
			"BeatSheet preflight 缺少冻结 source authority 的 fingerprint。",
		);
	}
	const fingerprint = buildBeatSheetPreflightFingerprint(beatSheet);
	const key = preflightKey(input.ownerId, input.runId);
	const existingRaw = await resilientDraftGet(key, PREFLIGHT_TTL_SECONDS);
	if (existingRaw) {
		const existing = parsePreflight(existingRaw);
		if (existing.ownerId !== input.ownerId || existing.runId !== input.runId) {
			throw new BeatSheetPreflightError(
				"beat_sheet_preflight_invalid",
				"BeatSheet preflight 的 owner/run 身份与存储键不一致，禁止覆盖。",
			);
		}
		if (
			existing.fingerprint === fingerprint &&
			existing.sourceFingerprint === sourceFingerprint
		) {
			await resilientDraftExpire(key, PREFLIGHT_TTL_SECONDS);
			return existing;
		}
	}
  const record: BeatSheetPreflight = {
    ownerId: input.ownerId,
    runId: input.runId,
    revision: revisionOf({ beatSheet, sourceFingerprint }),
    fingerprint,
    sourceFingerprint,
    beatSheet,
    updatedAt: new Date().toISOString(),
  };
  await resilientDraftSet(key, JSON.stringify(record), PREFLIGHT_TTL_SECONDS);
  return record;
}

export async function readBeatSheetPreflight(
  ownerId: string,
  runId: string,
): Promise<BeatSheetPreflight> {
  const raw = await resilientDraftGet(
    preflightKey(ownerId, runId),
    PREFLIGHT_TTL_SECONDS,
  );
  if (!raw) {
    throw new BeatSheetPreflightError(
      "beat_sheet_preflight_not_found",
      `runId「${runId}」没有已通过的 BeatSheet preflight。`,
    );
  }
  return parsePreflight(raw);
}
