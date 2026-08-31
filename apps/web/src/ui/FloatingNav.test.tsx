// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingNav from './FloatingNav'
import { useUIStore } from './uiStore'

vi.mock('./capabilities/CapabilityBayDialog', () => ({
  CapabilityBayDialog: ({ opened, focusRequest, onClose }: {
    opened: boolean
    focusRequest?: { requestKey: string; flowId: string } | null
    onClose: () => void
  }) => opened ? (
    <section className="capability-bay-test-double" role="dialog" aria-label="Agent 配置" data-flow-id={focusRequest?.flowId ?? ''}>
      <button className="capability-bay-close-test-double" type="button" onClick={onClose}>关闭</button>
    </section>
  ) : null,
}))

describe('FloatingNav character library entry', () => {
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
    useUIStore.setState({
      activePanel: null,
      panelAnchorX: null,
      assetPanelMaterialCategory: 'docs',
      capabilityBayOpenRequest: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useUIStore.setState({
      activePanel: null,
      panelAnchorX: null,
      assetPanelMaterialCategory: 'docs',
      capabilityBayOpenRequest: null,
    })
  })

  it('opens the independent character library instead of project assets', () => {
    render(
      <MantineProvider>
        <FloatingNav />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '角色库' }))

    expect(useUIStore.getState().activePanel).toBe('character-library')
    expect(useUIStore.getState().assetPanelMaterialCategory).toBe('docs')

    fireEvent.click(screen.getByRole('button', { name: '角色库' }))
    expect(useUIStore.getState().activePanel).toBeNull()
  })

  it('opens and closes the capability bay without changing the active canvas panel', async () => {
    render(
      <MantineProvider>
        <FloatingNav />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Agent 配置' }))
    expect(await screen.findByRole('dialog', { name: 'Agent 配置' })).toBeInTheDocument()
    expect(useUIStore.getState().activePanel).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('dialog', { name: 'Agent 配置' })).not.toBeInTheDocument()
  })

  it('opens the capability bay at the exact saved Flow requested by the canvas', async () => {
    render(
      <MantineProvider>
        <FloatingNav />
      </MantineProvider>,
    )

    act(() => {
      useUIStore.getState().requestCapabilityBayForFlow('flow-one-click')
    })

    const dialog = await screen.findByRole('dialog', { name: 'Agent 配置' })
    expect(dialog).toHaveAttribute('data-flow-id', 'flow-one-click')
  })
})
