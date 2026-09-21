import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChoicesCardView } from './DataCardViews'
import { useChatCommandStore } from '../chatCommandStore'
import { resolveChatSubmissionText } from '../chatSubmissionAdmission'
import type { DataBlock } from './types'

const block: DataBlock = {
  id: 'choice-recovery',
  type: 'data',
  name: 'choices',
  payload: {
    question: '请选择后续推进方式',
    options: [{ label: '生成角色参考图', value: '生成两张角色参考图' }],
  },
}

function resetCommands() {
  useChatCommandStore.setState({ busy: false, pending: null, pendingQueue: [] })
}

describe('choices interaction across turn recovery', () => {
  beforeEach(resetCommands)
  afterEach(resetCommands)

  it.each([true, false])('dispatches the selected card with busy=%s', (busy) => {
    useChatCommandStore.getState().setBusy(busy)
    render(<ChoicesCardView block={block} />)
    const button = screen.getByRole('button', { name: '生成角色参考图' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    const command = useChatCommandStore.getState().consume()
    expect(command?.displayText).toBe('生成角色参考图')
    expect(resolveChatSubmissionText({ text: command?.text, draft: '未发送的草稿' }))
      .toBe('生成两张角色参考图')
    act(() => { useChatCommandStore.getState().setBusy(false) })
    expect(screen.queryByText(/小T 正在工作中/)).toBeNull()
    expect(button).toBeEnabled()
  })
})
