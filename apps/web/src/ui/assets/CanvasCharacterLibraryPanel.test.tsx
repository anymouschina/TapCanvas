// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiCharacterLibraryCharacterDto } from '@tapcanvas/character-bible-protocol'
import { listAiCharacterLibraryCharacters } from '../../api/server'
import { useRFStore } from '../../canvas/store'
import { useUIStore } from '../uiStore'
import CanvasCharacterLibraryPanel from './CanvasCharacterLibraryPanel'

vi.mock('../../api/server', () => ({
  listAiCharacterLibraryCharacters: vi.fn(),
}))

vi.mock('../../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ alt }: { alt: string }) => <div className="managed-image-test-double">{alt}</div>,
}))

const TEST_CHARACTER: AiCharacterLibraryCharacterDto = {
  id: 'character-1',
  name: '沈青',
  projectId: null,
  character_id: 'shen-qing',
  group_number: '1',
  era: '古代',
  cultural_region: '中原',
  genre: '武侠',
  time_period: '架空朝代',
  appearance_background: '',
  scene: '江湖',
  gender: '女',
  age_group: '青年',
  species: '人类',
  physique: '修长',
  height_level: '高挑',
  skin_color: '自然',
  hair_length: '长发',
  hair_color: '黑色',
  temperament: '清冷',
  outfit: '青色劲装',
  distinctive_features: '银色发簪',
  identity_hint: '青衣剑客',
  full_body_image_url: 'https://assets.example/full-body.png',
  three_view_image_url: 'https://assets.example/three-view.png',
  expression_image_url: '',
  closeup_image_url: '',
  filter_worldview: '古代历史',
  filter_theme: '江湖武侠',
  filter_scene: '山门',
  imported_at: '2026-08-13T00:00:00.000Z',
  updated_at: '2026-08-13T00:00:00.000Z',
}

describe('CanvasCharacterLibraryPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useRFStore.getState().reset()
    useUIStore.setState({
      activePanel: 'character-library',
      panelAnchorX: 700,
      currentProject: { id: 'project-1', name: '角色库测试项目' },
    })
    vi.mocked(listAiCharacterLibraryCharacters).mockResolvedValue({
      characters: [TEST_CHARACTER],
      total: 1,
      syncState: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    useRFStore.getState().reset()
    useUIStore.setState({ activePanel: null, currentProject: null })
  })

  it('loads reusable characters and applies one semantic character node to the canvas', async () => {
    render(
      <MantineProvider>
        <CanvasCharacterLibraryPanel />
      </MantineProvider>,
    )

    expect(await screen.findByText('可复用角色素材 · 1 个角色')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /青衣剑客/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用至画布' }))

    await waitFor(() => {
      expect(useRFStore.getState().nodes).toHaveLength(1)
    })
    const createdNode = useRFStore.getState().nodes[0]
    expect(createdNode?.data.characterLibraryCharacterId).toBe('character-1')
    expect(createdNode?.data.roleCardReferenceImages).toEqual([
      'https://assets.example/full-body.png',
      'https://assets.example/three-view.png',
    ])
    expect(useUIStore.getState().activePanel).toBeNull()
  })
})
