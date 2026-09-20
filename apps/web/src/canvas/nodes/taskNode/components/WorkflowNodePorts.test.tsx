import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowNodePorts } from './WorkflowNodePorts'

describe('WorkflowNodePorts', () => {
  it('labels both sides and preserves full values in titles', () => {
    render(<WorkflowNodePorts inputPorts={['章节文本', '风格锚点']} outputPorts={['BeatSheet', 'Clip Prompt']} />)
    expect(screen.getByText('输入')).toBeInTheDocument()
    expect(screen.getByText('输出')).toBeInTheDocument()
    expect(screen.getByTitle('章节文本, 风格锚点')).toBeInTheDocument()
    expect(screen.getByTitle('BeatSheet, Clip Prompt')).toBeInTheDocument()
  })
})
