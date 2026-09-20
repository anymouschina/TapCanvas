"use strict";

const DEFAULT_TARGET_DURATION_MS = 10 * 60_000;
function parseLogicalTaskBudget(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("logical_task_budget_invalid");
  const { version, logicalTaskId, acceptedAt, targetAt, targetKind } = value;
  if (version !== 2 || targetKind !== "delivery_or_provider_acceptance" || typeof logicalTaskId !== "string" || !logicalTaskId.trim()
    || typeof acceptedAt !== "string" || typeof targetAt !== "string"
    || !Number.isFinite(Date.parse(acceptedAt)) || !Number.isFinite(Date.parse(targetAt))
    || Date.parse(targetAt) <= Date.parse(acceptedAt)) throw new Error("logical_task_budget_invalid");
  return { version: 2, targetKind, logicalTaskId: logicalTaskId.trim(), acceptedAt: new Date(acceptedAt).toISOString(), targetAt: new Date(targetAt).toISOString() };
}
function createLogicalTaskBudget(logicalTaskId, acceptedAt, targetDurationMs = DEFAULT_TARGET_DURATION_MS) {
  if (!Number.isFinite(targetDurationMs) || targetDurationMs <= 0 || !Number.isFinite(Date.parse(acceptedAt))) throw new Error("logical_task_budget_invalid");
  return parseLogicalTaskBudget({ version: 2, targetKind: "delivery_or_provider_acceptance", logicalTaskId, acceptedAt, targetAt: new Date(Date.parse(acceptedAt) + targetDurationMs).toISOString() });
}
function observeLogicalTaskBudget(value, nowMs = Date.now()) {
  const budget = parseLogicalTaskBudget(value);
  if (!Number.isFinite(nowMs)) throw new Error("logical_task_budget_observation_invalid");
  return { ...budget, observedAt: new Date(nowMs).toISOString(), elapsedMs: Math.max(0, nowMs - Date.parse(budget.acceptedAt)), remainingMs: Math.max(0, Date.parse(budget.targetAt) - nowMs), overdueMs: Math.max(0, nowMs - Date.parse(budget.targetAt)), terminalAuthority: false };
}
exports.DEFAULT_TARGET_DURATION_MS = DEFAULT_TARGET_DURATION_MS;
exports.parseLogicalTaskBudget = parseLogicalTaskBudget;
exports.createLogicalTaskBudget = createLogicalTaskBudget;
exports.observeLogicalTaskBudget = observeLogicalTaskBudget;
