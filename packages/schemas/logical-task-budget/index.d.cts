export type LogicalTaskBudget = Readonly<{ version: 2; targetKind: "delivery_or_provider_acceptance"; logicalTaskId: string; acceptedAt: string; targetAt: string }>;
export type LogicalTaskBudgetObservation = LogicalTaskBudget & Readonly<{ observedAt: string; elapsedMs: number; remainingMs: number; overdueMs: number; terminalAuthority: false }>;
export const DEFAULT_TARGET_DURATION_MS: number;
export function parseLogicalTaskBudget(value: unknown): LogicalTaskBudget;
export function createLogicalTaskBudget(logicalTaskId: string, acceptedAt: string, targetDurationMs?: number): LogicalTaskBudget;
export function observeLogicalTaskBudget(value: unknown, nowMs?: number): LogicalTaskBudgetObservation;
