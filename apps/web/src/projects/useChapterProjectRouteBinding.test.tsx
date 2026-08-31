import React from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../ui/uiStore'
import {
  applyChapterProjectRouteMetadata,
  useChapterProjectRouteBinding,
} from './useChapterProjectRouteBinding'

describe('useChapterProjectRouteBinding', () => {
  afterEach(() => {
    useUIStore.getState().setCurrentProject(null)
  })

  it('keeps the route project bound after StrictMode replays its layout effect', () => {
    const wrapper = ({ children }: React.PropsWithChildren): JSX.Element => (
      <React.StrictMode>{children}</React.StrictMode>
    )
    const { unmount } = renderHook(
      () => useChapterProjectRouteBinding('project-a'),
      { wrapper },
    )

    expect(useUIStore.getState().currentProject).toEqual({
      id: 'project-a',
      name: '(未命名)',
      teamId: null,
    })

    applyChapterProjectRouteMetadata({
      projectId: 'project-a',
      projectName: '真实项目名',
      teamId: 'team-a',
    })
    expect(useUIStore.getState().currentProject).toMatchObject({
      id: 'project-a',
      name: '真实项目名',
      teamId: 'team-a',
    })

    unmount()
    expect(useUIStore.getState().currentProject).toBeNull()
  })
})
