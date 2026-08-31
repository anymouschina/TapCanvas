// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingUserInputChoices } from './PendingUserInputChoices'

const request = {
  requestId: 'request-1',
  questions: [
    {
      id: 'world',
      header: '题材',
      question: '选择世界观',
      options: [
        { label: '冷兵器', description: '近身打斗' },
        { label: '现代都市', description: '追逐械斗' },
      ],
    },
    {
      id: 'ending',
      header: '结尾',
      question: '选择收尾',
      options: [
        { label: '明确制服', description: '一方落败' },
        { label: '留待下段', description: '保留悬念' },
      ],
    },
  ],
}

afterEach(cleanup)

describe('PendingUserInputChoices', () => {
  it('waits for every question and submits the whole stage once', () => {
    const onSubmit = vi.fn()
    render(<PendingUserInputChoices request={request} onSubmit={onSubmit} />)

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: '确认并继续' })
    expect(submit.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /冷兵器/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('已选择 1/2')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /明确制服/ }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      requestId: 'request-1',
      answers: [
        { id: 'world', value: '冷兵器', optionLabel: '冷兵器', optionIndex: 0 },
        { id: 'ending', value: '明确制服', optionLabel: '明确制服', optionIndex: 0 },
      ],
    })
  })

  it('lets the user revise one group before the aggregate submit', () => {
    const onSubmit = vi.fn()
    render(<PendingUserInputChoices request={request} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /冷兵器/ }))
    fireEvent.click(screen.getByRole('button', { name: /现代都市/ }))
    fireEvent.click(screen.getByRole('button', { name: /留待下段/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))

    expect(onSubmit).toHaveBeenCalledWith({
      requestId: 'request-1',
      answers: [
        { id: 'world', value: '现代都市', optionLabel: '现代都市', optionIndex: 1 },
        { id: 'ending', value: '留待下段', optionLabel: '留待下段', optionIndex: 1 },
      ],
    })
  })
})
