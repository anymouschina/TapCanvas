import { describe, expect, it } from 'vitest'
import { buildChatInspirationQuickActions } from '../../src/ui/chat/quickActions'

const identity = (input: string): string => input

describe('buildChatInspirationQuickActions', () => {
  it('exposes single video quick action with single_video creation mode', () => {
    const actions = buildChatInspirationQuickActions({
      currentProjectId: 'project-1',
      currentProjectName: '项目A',
      hasFocusedReference: true,
    }, identity)

    const singleVideo = actions.find((item) => item.key === 'single-video-sop')
    expect(singleVideo).toBeDefined()
    expect(singleVideo?.label).toBe('根据上传文本快捷创作单个视频')
    expect(singleVideo?.creationMode).toBe('single_video')
    expect(singleVideo?.requireProjectTextEvidence).toBe(true)
    expect(singleVideo?.description).toContain('当前选中节点和参考图')
    expect(singleVideo?.prompt).toContain('根据上传文本快捷创作单个视频')
    expect(singleVideo?.prompt).toContain('已上传小说文本')
    expect(singleVideo?.prompt).toContain('自主判断应该承接已有关键帧')
    expect(singleVideo?.prompt).toContain('优先继续补证')
    expect(singleVideo?.prompt).toContain('缺少显式 checkpoint')
  })

  it('disables project text scene action when no project is selected', () => {
    const actions = buildChatInspirationQuickActions({
      currentProjectId: null,
      currentProjectName: null,
      hasFocusedReference: false,
    }, identity)

    const projectScene = actions.find((item) => item.key === 'project-text-scene-pipeline')
    expect(projectScene).toBeDefined()
    expect(projectScene?.creationMode).toBe('scene')
    expect(projectScene?.disabled).toBe(true)
  })
})
