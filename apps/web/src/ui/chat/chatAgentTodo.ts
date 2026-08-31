/**
 * Selects the Todo list authored by agents-cli for one chat message.
 *
 * Structured `todo_list` events are authoritative when present. The inline
 * Todo block is retained only as the transport-compatible representation of
 * the same AI-authored plan. Workflow definitions and production projections
 * must never synthesize or replace the agent's task list.
 */
export function selectAgentTodoItems<T>(input: {
  structuredTodoItems?: readonly T[] | null
  inlineTodoItems: readonly T[]
}): T[] {
  return input.structuredTodoItems && input.structuredTodoItems.length > 0
    ? [...input.structuredTodoItems]
    : [...input.inlineTodoItems]
}
