import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkflowNodeStatusBar } from './WorkflowNodeStatusBar'

describe('WorkflowNodeStatusBar', () => {
  it('renders status, detail, progress and elapsed facts together', () => {
    render(<WorkflowNodeStatusBar status="partial" label="部分完成" detail="provider 等待" progress="3/8" elapsed="1m 02s" />)
    expect(screen.getByText('部分完成')).toBeInTheDocument()
    expect(screen.getByText('provider 等待')).toBeInTheDocument()
    expect(screen.getByText('3/8 · 1m 02s')).toBeInTheDocument()
  })
})
