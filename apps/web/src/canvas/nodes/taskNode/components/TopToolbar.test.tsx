// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resolveToolbarViewportShiftX, resolveToolbarViewportShiftY, TopToolbar, type ToolbarMenuItem } from './TopToolbar'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top' },
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  })
  if (typeof globalThis.ResizeObserver !== 'function') {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    })
  }
})

afterEach(cleanup)

const menuItem = (key: string, label: string, onClick: () => void): ToolbarMenuItem => ({ key, label, onClick })

describe('TopToolbar LibTV menu interaction', () => {
  it('keeps the wide image toolbar inside the viewport without moving an already visible toolbar', () => {
    expect(resolveToolbarViewportShiftX({ left: -111, width: 1148, viewportWidth: 1470 })).toBe(123)
    expect(resolveToolbarViewportShiftX({ left: 400, width: 1148, viewportWidth: 1470 })).toBe(-90)
    expect(resolveToolbarViewportShiftX({ left: 76, width: 1100, viewportWidth: 1470 })).toBe(0)
  })

  it('keeps the image toolbar below the workspace header and inside the viewport', () => {
    expect(resolveToolbarViewportShiftY({ top: 5, height: 49, viewportHeight: 664, minimumTop: 62 })).toBe(57)
    expect(resolveToolbarViewportShiftY({ top: 80, height: 49, viewportHeight: 664, minimumTop: 62 })).toBe(0)
    expect(resolveToolbarViewportShiftY({ top: 630, height: 49, viewportHeight: 664, minimumTop: 62 })).toBe(-27)
  })

  it('opens a labelled dropdown and dispatches the selected action', async () => {
    const onContinue = vi.fn()
    render(
      <MantineProvider>
        <TopToolbar
          isVisible
          hasContent
          toolbarBackground="#222"
          toolbarShadow="none"
          toolbarActionIconStyles={{ root: {}, icon: {} }}
          inlineDividerColor="#555"
          libtvVideoMode
          visibleDefs={[
            {
              key: 'retake',
              label: '片段重拍',
              icon: <span aria-hidden="true">↻</span>,
              onClick: vi.fn(),
              showLabel: true,
              menuItems: [
                menuItem('continue', '智能续写', onContinue),
              ],
            },
          ]}
          onPreview={vi.fn()}
          onDownload={vi.fn()}
        />
      </MantineProvider>,
    )

    expect(screen.queryByRole('menuitem', { name: '智能续写' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '片段重拍' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '智能续写' })).toBeVisible())
    fireEvent.click(screen.getByRole('menuitem', { name: '智能续写' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('opens image capability menus on hover and dispatches the primary action on click', async () => {
    const onPrimaryAction = vi.fn()
    render(
      <MantineProvider>
        <TopToolbar
          isVisible
          hasContent
          toolbarBackground="#222"
          toolbarShadow="none"
          toolbarActionIconStyles={{ root: {}, icon: {} }}
          inlineDividerColor="#555"
          libtvImageMode
          utilitiesAtEnd
          visibleDefs={[
            {
              key: 'quality',
              label: '高清',
              icon: <span aria-hidden="true">HD</span>,
              onClick: onPrimaryAction,
              showLabel: true,
              menuItems: [menuItem('crop', '裁剪', vi.fn())],
            },
          ]}
          onPreview={vi.fn()}
          onDownload={vi.fn()}
        />
      </MantineProvider>,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: '高清' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '裁剪' })).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: '高清' }))
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
  })

  it('keeps non-reference overflow actions out of the Liblib image toolbar', () => {
    render(
      <MantineProvider>
        <TopToolbar
          isVisible
          hasContent
          toolbarBackground="#222"
          toolbarShadow="none"
          toolbarActionIconStyles={{ root: {}, icon: {} }}
          inlineDividerColor="#555"
          libtvImageMode
          utilitiesAtEnd
          visibleDefs={[
            { key: 'element-edit', label: '元素编辑', icon: <span aria-hidden="true">E</span>, onClick: vi.fn(), showLabel: true },
            { key: 'more', label: '更多', icon: <span aria-hidden="true">…</span>, onClick: vi.fn() },
          ]}
          onPreview={vi.fn()}
          onDownload={vi.fn()}
        />
      </MantineProvider>,
    )

    expect(screen.getByRole('button', { name: '元素编辑' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载' })).toBeVisible()
    expect(screen.getByRole('button', { name: '全屏' })).toBeVisible()
  })

  it('keeps the LibTV image toolbar separators in the reference order', () => {
    const { container } = render(
      <MantineProvider>
        <TopToolbar
          isVisible
          hasContent
          toolbarBackground="#222"
          toolbarShadow="none"
          toolbarActionIconStyles={{ root: {}, icon: {} }}
          inlineDividerColor="#555"
          libtvImageMode
          utilitiesAtEnd
          visibleDefs={[
            { key: 'lighting-edit', label: '打光', icon: <span aria-hidden="true">L</span>, onClick: vi.fn(), showLabel: true },
            { key: 'nine-grid', label: '九宫格', icon: <span aria-hidden="true">9</span>, onClick: vi.fn(), showLabel: true },
            { key: 'grid-split', label: '宫格切分', icon: <span aria-hidden="true">G</span>, onClick: vi.fn(), showLabel: true },
            { key: 'annotate', label: '标注', icon: <span aria-hidden="true">A</span>, onClick: vi.fn() },
            { key: 'rotate', label: '旋转', icon: <span aria-hidden="true">R</span>, onClick: vi.fn() },
          ]}
          onPreview={vi.fn()}
          onDownload={vi.fn()}
        />
      </MantineProvider>,
    )

    const inlineDivider = container.querySelector('.top-toolbar-divider--inline')
    expect(inlineDivider?.nextElementSibling).toHaveAttribute('aria-label', '九宫格')
    const utilityDivider = [...container.querySelectorAll('.top-toolbar-divider')]
      .find((element) => !element.classList.contains('top-toolbar-divider--inline'))
    expect(utilityDivider?.nextElementSibling).toHaveAttribute('aria-label', '标注')
  })
})
