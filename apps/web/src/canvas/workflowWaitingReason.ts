export type WorkflowWaitingReason = Readonly<{
  code: 'provider_balance_required'
  label: '等待余额恢复'
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Projects only versioned runtime facts already present in the workflow
 * receipt. Conflicting or unknown reason codes stay generic instead of being
 * guessed from error prose, node labels, prompts or task content.
 */
export function resolveWorkflowWaitingReason(outputRefs: unknown): WorkflowWaitingReason | null {
  if (!isRecord(outputRefs) || !isRecord(outputRefs.evidence)) return null
  const evidence = outputRefs.evidence
  const requestTerminal = isRecord(evidence.requestTerminal) ? evidence.requestTerminal : null
  const deliveryEvidence = isRecord(evidence.deliveryEvidence) ? evidence.deliveryEvidence : null
  const recoveryCheckpoint = isRecord(deliveryEvidence?.recoveryCheckpoint)
    ? deliveryEvidence.recoveryCheckpoint
    : null
  const declaredCodes = [
    readString(evidence.continuationReason),
    readString(requestTerminal?.reason),
    readString(recoveryCheckpoint?.reasonCode),
  ].filter(Boolean)
  const uniqueCodes = [...new Set(declaredCodes)]
  if (uniqueCodes.length !== 1 || uniqueCodes[0] !== 'provider_balance_required') return null
  return { code: 'provider_balance_required', label: '等待余额恢复' }
}
