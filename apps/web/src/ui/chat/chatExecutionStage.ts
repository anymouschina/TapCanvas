export type ChatExecutionStage = {
  label: string
  elapsedMs: number | null
}

type StageTodo = {
  status: 'pending' | 'in_progress' | 'completed'
  content: string
  startedAt?: number
}

type StageTool = {
  startedAt?: number
}

export function resolveChatExecutionStage(input: {
  todoItems: readonly StageTodo[]
  toolSteps: readonly StageTool[]
  active: boolean
  observedAtMs: number
}): ChatExecutionStage | null {
  if (!input.active) return null
  const activeTodo = input.todoItems.find((item) => item.status === 'in_progress')
  if (activeTodo) {
    return {
      label: activeTodo.content,
      elapsedMs: typeof activeTodo.startedAt === 'number'
        ? Math.max(0, input.observedAtMs - activeTodo.startedAt)
        : null,
    }
  }
  if (input.toolSteps.length === 0) return null
  const toolStarts = input.toolSteps
    .map((step) => step.startedAt)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return {
    label: '动作执行',
    elapsedMs: toolStarts.length > 0
      ? Math.max(0, input.observedAtMs - Math.min(...toolStarts))
      : null,
  }
}
