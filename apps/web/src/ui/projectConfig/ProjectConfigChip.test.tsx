// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../uiStore'
import { ProjectConfigChip } from './ProjectConfigChip'
import CanvasStyleLibraryPanel from '../styleLibrary/CanvasStyleLibraryPanel'

vi.mock('../styleLibrary/GlobalStyleChip', () => ({
  GlobalStyleChip: () => <div className="global-style-chip-test-panel">视觉风格设置面板</div>,
}))

vi.mock('../projectLookBible/ProjectLookBibleChip', () => ({
  ProjectLookBibleChip: () => <div className="project-look-bible-test-panel">项目视觉设置面板</div>,
}))

vi.mock('../DirectorPersonaChip', () => ({
  DirectorPersonaChip: () => <div className="director-persona-test-panel">导演设置面板</div>,
}))

vi.mock('../chat/RoleSkillConfigModal', () => ({
  RoleSkillConfigModal: ({ opened }: { opened: boolean }) => opened
    ? <div className="role-skill-config-test-modal">角色技能配置编辑器</div>
    : null,
}))

describe('ProjectConfigChip', () => {
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
      currentProject: { id: 'project-1', name: '测试项目' },
      styleReferenceRequest: null,
      activePanel: null,
    })
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ currentProject: null, styleReferenceRequest: null, activePanel: null })
  })

  it('replaces the three toolbar chips with one project configuration entry', async () => {
    render(<MantineProvider><ProjectConfigChip /></MantineProvider>)

    const trigger = await screen.findByRole('button', { name: '打开项目配置' })
    expect(trigger.textContent).toBe('')
    expect(screen.queryByText('视觉风格设置面板')).toBeNull()
    expect(screen.queryByText('项目视觉设置面板')).toBeNull()
    expect(screen.queryByText('导演设置面板')).toBeNull()

    fireEvent.click(trigger)

    expect(await screen.findByRole('button', { name: /视觉风格/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /项目视觉/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /导演设置/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /角色技能/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /视觉风格/ }))
    expect(await screen.findByText('视觉风格设置面板')).toBeTruthy()
    expect(screen.getByRole('button', { name: '返回项目配置' })).toBeTruthy()
  })

  it('opens the role skill editor from the unified project configuration menu', async () => {
    render(<MantineProvider><ProjectConfigChip /></MantineProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '打开项目配置' }))
    fireEvent.click(await screen.findByRole('button', { name: /角色技能/ }))

    expect(await screen.findByText('角色技能配置编辑器')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开项目配置' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('routes a pending style reference request to the first-class canvas style panel', async () => {
    render(<MantineProvider><CanvasStyleLibraryPanel /></MantineProvider>)

    act(() => {
      useUIStore.getState().requestStyleReference({ reason: '角色卡缺少风格参考图' })
    })

    await waitFor(() => {
      expect(screen.getByText('视觉风格设置面板')).toBeTruthy()
      expect(useUIStore.getState().activePanel).toBe('style-library')
    })
  })
})
