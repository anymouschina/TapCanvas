import { describe, expect, it } from 'vitest'
import { selectAgentTodoItems } from './chatAgentTodo'

type TodoItem = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

describe('selectAgentTodoItems', () => {
  const inlineTodoItems: TodoItem[] = [
    { content: '读取用户问题', status: 'in_progress' },
  ]

  it('uses the structured todo_list emitted by agents-cli as the authoritative plan', () => {
    const structuredTodoItems: TodoItem[] = [
      { content: '说明已添加工作流的真实结构', status: 'in_progress' },
      { content: '回答用户问题', status: 'pending' },
    ]

    expect(selectAgentTodoItems({ structuredTodoItems, inlineTodoItems })).toEqual(structuredTodoItems)
  })

  it('uses the AI-authored inline Todo block when no structured event is available', () => {
    expect(selectAgentTodoItems({ structuredTodoItems: [], inlineTodoItems })).toEqual(inlineTodoItems)
    expect(selectAgentTodoItems({ structuredTodoItems: null, inlineTodoItems })).toEqual(inlineTodoItems)
  })
})
