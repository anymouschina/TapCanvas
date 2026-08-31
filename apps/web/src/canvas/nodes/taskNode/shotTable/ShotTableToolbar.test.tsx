import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ShotTableToolbar, type ShotTableToolbarProps } from './ShotTableToolbar'

const createProps = (overrides: Partial<ShotTableToolbarProps> = {}): ShotTableToolbarProps => ({
  className: 'test-toolbar',
  readOnly: false,
  hasSelectedRow: true,
  hasSelectedColumn: true,
  hasActiveCell: true,
  canDeleteRow: true,
  assetBindingsValid: true,
  columnsOpen: false,
  scriptOpen: false,
  assetPickerOpen: false,
  splitDisabled: false,
  splitTooltip: '均匀拆为 3 个独立分镜表',
  onAddTimeline: vi.fn(),
  onAddShot: vi.fn(),
  onDuplicateRow: vi.fn(),
  onDeleteRow: vi.fn(),
  onToggleColumns: vi.fn(),
  onToggleAssets: vi.fn(),
  onSplit: vi.fn(),
  onToggleScript: vi.fn(),
  onExport: vi.fn(),
  onImport: vi.fn(),
  ...overrides,
})

const renderToolbar = (props: ShotTableToolbarProps) => render(
  <MantineProvider>
    <ShotTableToolbar {...props} />
  </MantineProvider>,
)

describe('ShotTableToolbar', () => {
  it('通过可访问的内联图标按钮触发一键拆分', () => {
    const onSplit = vi.fn()
    renderToolbar(createProps({ onSplit }))

    fireEvent.click(screen.getByRole('button', { name: '均匀拆分为不超过 15 秒的独立分镜表' }))

    expect(onSplit).toHaveBeenCalledTimes(1)
  })

  it('不满足拆分条件时禁用按钮', () => {
    renderToolbar(createProps({ splitDisabled: true }))

    const button = screen.getByRole('button', { name: '均匀拆分为不超过 15 秒的独立分镜表' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
