// @vitest-environment jsdom
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRFStore } from '../store'
import { WorkflowAgentDefinitionSelect } from './WorkflowAgentDefinitionSelect'

describe('WorkflowAgentDefinitionSelect', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    useRFStore.getState().reset()
    useRFStore.setState({
      nodes: [{
        id: 'workflow:agent',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: { label: 'Agent' },
      }],
      edges: [],
    })
  })

  it('persists the explicit runtime agent role without an external catalog', () => {
    render(
      <MantineProvider>
        <WorkflowAgentDefinitionSelect nodeId="workflow:agent" value="" readOnly={false} />
      </MantineProvider>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Agent 角色标识' }), {
      target: { value: 'video-prompt-writer' },
    })

    expect(useRFStore.getState().nodes[0]?.data.workflowAgentDefinitionId).toBe('video-prompt-writer')
  })

  it('keeps an existing role visible in read-only mode', () => {
    render(
      <MantineProvider>
        <WorkflowAgentDefinitionSelect
          nodeId="workflow:agent"
          value="video-prompt-writer"
          readOnly
        />
      </MantineProvider>,
    )

    const input = screen.getByRole('textbox', { name: 'Agent 角色标识' }) as HTMLInputElement
    expect(input.readOnly).toBe(true)
    expect(input.value).toBe('video-prompt-writer')
  })
})
