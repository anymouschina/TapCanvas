export type ChatSubmissionOrigin = 'composer' | 'programmatic'

export type ChatSubmissionAdmission = {
  hasMessage: boolean
  turnReady: boolean
  modelLoading: boolean
  modelError: Error | null
  hasSelectedModel: boolean
  preparing: boolean
}

/**
 * The composer must only accept a click when every deterministic prerequisite
 * already visible to the user is ready. Programmatic submissions keep their
 * bounded wait path because they may be dispatched before the panel finishes
 * resolving its session and model catalog.
 */
export function canSubmitChatComposer(input: ChatSubmissionAdmission): boolean {
  return input.hasMessage
    && input.turnReady
    && !input.modelLoading
    && input.modelError === null
    && input.hasSelectedModel
    && !input.preparing
}

export function shouldAwaitChatSubmissionReadiness(origin: ChatSubmissionOrigin): boolean {
  return origin === 'programmatic'
}
