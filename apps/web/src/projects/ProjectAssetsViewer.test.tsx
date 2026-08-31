// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listProjectBooks, listServerAssets } from '../api/server'
import ProjectAssetsViewer from './ProjectAssetsViewer'

vi.mock('../api/server', () => ({
  listProjectBooks: vi.fn(),
  listServerAssets: vi.fn(),
}))

describe('ProjectAssetsViewer without project character asset management', () => {
  beforeEach(() => {
    vi.mocked(listProjectBooks).mockResolvedValue([])
    vi.mocked(listServerAssets).mockResolvedValue({ items: [], cursor: null })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('only exposes project documents and directs character assets to the independent library', async () => {
    render(
      <MantineProvider>
        <ProjectAssetsViewer
          opened
          projectId="project-1"
          projectName="测试项目"
          onClose={vi.fn()}
        />
      </MantineProvider>,
    )

    expect(await screen.findByText('项目资料概览')).toBeInTheDocument()
    expect(screen.getAllByText('文档脚本').length).toBeGreaterThan(0)
    expect(screen.getByText('查看当前项目的原文与文档脚本。')).toBeInTheDocument()
    expect(screen.queryByText('角色卡')).not.toBeInTheDocument()
    expect(screen.queryByText('角色共享记忆')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(listProjectBooks).toHaveBeenCalledWith('project-1')
      expect(listServerAssets).toHaveBeenCalledTimes(4)
    })
  })
})
