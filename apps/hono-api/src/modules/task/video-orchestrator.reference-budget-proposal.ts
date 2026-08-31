import type { BeatSheetPatchOperation } from "./video-orchestrator.beat-sheet-draft";
import {
  resilientDraftGet,
  resilientDraftSet,
} from "./video-orchestrator.resilient-draft-store";

const PROPOSAL_TTL_SECONDS = 24 * 60 * 60;
const PROPOSAL_KEY_PREFIX = "video:reference-budget-proposal:v1:";

export type ReferenceBudgetProposal = {
  ownerId: string;
  projectId: string | null;
  scopeId: string;
  sourceRunId: string;
  budgetRevision: string;
  operations: BeatSheetPatchOperation[];
  createdAt: string;
};

export class ReferenceBudgetProposalError extends Error {
  constructor(
    public readonly code:
      | "reference_budget_proposal_store_unavailable"
      | "reference_budget_proposal_not_found"
      | "reference_budget_proposal_invalid"
      | "reference_budget_proposal_scope_mismatch",
    message: string,
  ) {
    super(message);
  }
}

const proposalKey = (ownerId: string, sourceRunId: string, budgetRevision: string): string =>
  `${PROPOSAL_KEY_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(sourceRunId)}:${encodeURIComponent(budgetRevision)}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPatchOperation(value: unknown): value is BeatSheetPatchOperation {
  if (!isRecord(value) || typeof value.path !== "string" || !value.path.trim()) return false;
  if (value.op === "remove") return true;
  if (value.op !== "set" && value.op !== "removeValue") return false;
  return Object.prototype.hasOwnProperty.call(value, "value");
}

function cloneOperations(operations: BeatSheetPatchOperation[]): BeatSheetPatchOperation[] {
  return structuredClone(operations);
}

function parseStoredProposal(raw: string): ReferenceBudgetProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ReferenceBudgetProposalError(
      "reference_budget_proposal_invalid",
      `reference_budget proposal JSON 无法解析：${String((error as Error).message || error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ReferenceBudgetProposalError(
      "reference_budget_proposal_invalid",
      "reference_budget proposal 根对象无效。",
    );
  }
  const operations = Array.isArray(parsed.operations) && parsed.operations.every(isPatchOperation)
    ? parsed.operations
    : null;
  if (
    typeof parsed.ownerId !== "string" ||
    typeof parsed.scopeId !== "string" ||
    typeof parsed.sourceRunId !== "string" ||
    typeof parsed.budgetRevision !== "string" ||
    typeof parsed.createdAt !== "string" ||
    !(typeof parsed.projectId === "string" || parsed.projectId === null) ||
    !operations
  ) {
    throw new ReferenceBudgetProposalError(
      "reference_budget_proposal_invalid",
      "reference_budget proposal 字段不完整或 operations 无效。",
    );
  }
  return {
    ownerId: parsed.ownerId,
    projectId: parsed.projectId,
    scopeId: parsed.scopeId,
    sourceRunId: parsed.sourceRunId,
    budgetRevision: parsed.budgetRevision,
    operations: cloneOperations(operations),
    createdAt: parsed.createdAt,
  };
}

export async function saveReferenceBudgetProposal(input: {
  ownerId: string;
  projectId: string | null;
  scopeId: string;
  sourceRunId: string;
  budgetRevision: string;
  operations: BeatSheetPatchOperation[];
}): Promise<ReferenceBudgetProposal> {
  const proposal: ReferenceBudgetProposal = {
    ownerId: input.ownerId,
    projectId: input.projectId,
    scopeId: input.scopeId,
    sourceRunId: input.sourceRunId,
    budgetRevision: input.budgetRevision,
    operations: cloneOperations(input.operations),
    createdAt: new Date().toISOString(),
  };
  await resilientDraftSet(
    proposalKey(input.ownerId, input.sourceRunId, input.budgetRevision),
    JSON.stringify(proposal),
    PROPOSAL_TTL_SECONDS,
  );
  return { ...proposal, operations: cloneOperations(proposal.operations) };
}

export async function readReferenceBudgetProposal(input: {
  ownerId: string;
  projectId: string | null;
  scopeId: string;
  sourceRunId: string;
  budgetRevision: string;
}): Promise<ReferenceBudgetProposal> {
  const raw = await resilientDraftGet(
    proposalKey(input.ownerId, input.sourceRunId, input.budgetRevision),
    PROPOSAL_TTL_SECONDS,
  );
  if (!raw) {
    throw new ReferenceBudgetProposalError(
      "reference_budget_proposal_not_found",
      "reference_budget 权威提案不存在或已过期；请重新提交一次 reference_budget operations。",
    );
  }
  const proposal = parseStoredProposal(raw);
  if (
    proposal.ownerId !== input.ownerId ||
    proposal.projectId !== input.projectId ||
    proposal.scopeId !== input.scopeId ||
    proposal.sourceRunId !== input.sourceRunId ||
    proposal.budgetRevision !== input.budgetRevision
  ) {
    throw new ReferenceBudgetProposalError(
      "reference_budget_proposal_scope_mismatch",
      "reference_budget 权威提案与当前用户、项目、画布作用域或源 run 不一致。",
    );
  }
  return { ...proposal, operations: cloneOperations(proposal.operations) };
}
