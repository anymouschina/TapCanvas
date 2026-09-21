import { describe, expect, it } from 'vitest'
import { buildChatInspirationQuickActions } from './quickActions'

const translate = (value: string): string => value

describe('chat quick actions', () => {
  it('exposes the one-click text-to-video remake action only when a project is selected', () => {
    const actions = buildChatInspirationQuickActions({
      currentProjectId: 'project-1',
      currentProjectName: 'Demo',
      hasFocusedReference: false,
      selectedNodeLabel: null,
      selectedNodeKind: null,
      hasStoryboardContext: false,
    }, translate)

    const action = actions.find((candidate) => candidate.key === 'one-click-remake-text-to-video')
    expect(action).toMatchObject({
      label: '一键复刻（文生视频）',
      group: 'project',
      disabled: false,
    })
    expect(action?.prompt).toContain('tapcanvas_equipped_workflow_run')
    expect(action?.prompt).toContain('原视频、参考视频、视频 URL')
    expect(action?.prompt).toContain('1 条 15 秒真实视频 clip')
  })

  it('keeps the action visible but disabled until a project is selected', () => {
    const actions = buildChatInspirationQuickActions({
      currentProjectId: null,
      currentProjectName: null,
      hasFocusedReference: false,
      selectedNodeLabel: null,
      selectedNodeKind: null,
      hasStoryboardContext: false,
    }, translate)

    expect(actions.find((candidate) => candidate.key === 'one-click-remake-text-to-video')).toMatchObject({
      disabled: true,
    })
  })
})
