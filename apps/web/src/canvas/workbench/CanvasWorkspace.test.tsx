import React, { useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkspace } from './CanvasWorkspace'
import { CanvasViewSwitcher } from './CanvasViewSwitcher'
import { useWorkbenchViewStore } from './workbenchViewStore'

const lifecycle = vi.hoisted(() => ({ mounted: 0, unmounted: 0 }))

vi.mock('../store', () => ({
  useRFStore: (selector: (state: { graphProvenanceKey: string }) => unknown) => selector({ graphProvenanceKey: 'flow:local-test' }),
}))

vi.mock('./CanvasWorkbench', () => ({
  default: ({ active }: { active: boolean }) => <section className="test-pipeline" hidden={!active}>流水线内容</section>,
}))

function CanvasStateProbe(): JSX.Element {
  const [position, setPosition] = useState('120,240')
  useEffect(() => {
    lifecycle.mounted += 1
    return () => { lifecycle.unmounted += 1 }
  }, [])
  return <input className="test-canvas-position" aria-label="节点位置" value={position} onChange={(event) => setPosition(event.currentTarget.value)} />
}

function renderWorkspace() {
  return render(<MantineProvider><CanvasViewSwitcher /><CanvasWorkspace><CanvasStateProbe /></CanvasWorkspace></MantineProvider>)
}

beforeEach(() => {
  useWorkbenchViewStore.setState({ view: 'canvas' })
  lifecycle.mounted = 0
  lifecycle.unmounted = 0
})

describe('canvas and pipeline views', () => {
  it('keeps the canvas mounted and preserves its state across a round trip', async () => {
    const { container } = renderWorkspace()
    fireEvent.change(screen.getByLabelText('节点位置'), { target: { value: '360,480' } })
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    expect(await screen.findByText('流水线内容')).toBeVisible()
    const canvas = container.querySelector('.tc-workspace-face--canvas')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    expect(canvas).toHaveAttribute('inert')
    expect(lifecycle.mounted).toBe(1)
    expect(lifecycle.unmounted).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '切换到画布' }))
    expect(screen.getByLabelText('节点位置')).toHaveValue('360,480')
    expect(canvas).toHaveAttribute('aria-hidden', 'false')
    expect(canvas).not.toHaveAttribute('inert')
    expect(container.querySelector('.tc-workspace-face--pipeline')).toHaveAttribute('inert')
    expect(lifecycle.mounted).toBe(1)
    expect(lifecycle.unmounted).toBe(0)
  })

  it('settles the view when the cube finishes, and keeps stage animations independent', async () => {
    const { container } = renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: '切换到流水线' }))
    await screen.findByText('流水线内容')
    const workspace = container.querySelector('.tc-canvas-workspace')
    expect(workspace).toHaveAttribute('data-turning', 'true')
    fireEvent.animationEnd(screen.getByText('流水线内容'))
    expect(workspace).toHaveAttribute('data-turning', 'true')
    fireEvent.animationEnd(container.querySelector('.tc-workspace-cube') as HTMLElement)
    expect(workspace).toHaveAttribute('data-turning', 'false')

    act(() => useWorkbenchViewStore.getState().setView('canvas'))
    expect(screen.getByRole('button', { name: '切换到流水线' })).toHaveAttribute('aria-pressed', 'false')
  })
})
