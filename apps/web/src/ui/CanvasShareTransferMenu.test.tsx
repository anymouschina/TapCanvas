// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasShareTransferMenu } from './CanvasShareTransferMenu'

const createCallbacks = () => ({
  onPublish: vi.fn(),
  onCopyShareLink: vi.fn(),
  onExportCanvas: vi.fn(),
  onImportCanvas: vi.fn(),
  onExportWorkflow: vi.fn(),
  onImportWorkflow: vi.fn(),
})

describe('CanvasShareTransferMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows publish, share, canvas transfer, and workflow transfer in one menu', async () => {
    const callbacks = createCallbacks()
    render(
      <MantineProvider>
        <CanvasShareTransferMenu {...callbacks} />
      </MantineProvider>,
    )

    expect(screen.getAllByRole('button', { name: '发布、分享与导入导出' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '发布、分享与导入导出' }))

    expect(await screen.findByText('发布与分享')).toBeTruthy()
    expect(screen.getByText('画布文件')).toBeTruthy()
    expect(screen.getByText('工作流')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '发布作品' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '分享链接' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '导出 JSON' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '导入 JSON' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '导出选中工作流' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '插入工作流' })).toBeTruthy()
  })

  it.each([
    ['发布作品', 'onPublish'],
    ['分享链接', 'onCopyShareLink'],
    ['导出 JSON', 'onExportCanvas'],
    ['导入 JSON', 'onImportCanvas'],
    ['导出选中工作流', 'onExportWorkflow'],
    ['插入工作流', 'onImportWorkflow'],
  ] as const)('keeps the real %s action connected', async (itemLabel, callbackName) => {
    const callbacks = createCallbacks()
    render(
      <MantineProvider>
        <CanvasShareTransferMenu {...callbacks} />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '发布、分享与导入导出' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: itemLabel }))

    expect(callbacks[callbackName]).toHaveBeenCalledOnce()
  })
})
