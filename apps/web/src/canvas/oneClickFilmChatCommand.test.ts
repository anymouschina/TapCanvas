import { describe, expect, it } from 'vitest'
import {
  buildGroupFilmChatText,
  buildOneClickFilmChatText,
  GROUP_FILM_CHAT_DISPLAY_TEXT,
  ONE_CLICK_FILM_CHAT_DISPLAY_TEXT,
} from './oneClickFilmChatCommand'

describe('buildOneClickFilmChatText', () => {
  it('只向用户展示简短动作摘要', () => {
    expect(ONE_CLICK_FILM_CHAT_DISPLAY_TEXT).toBe('生成当前画布整片')
    expect(GROUP_FILM_CHAT_DISPLAY_TEXT).toBe('生成当前组整片')
  })

  it('只发送真实入口事实，不在前端规定创作流程', () => {
    const text = buildOneClickFilmChatText({
      groupId: 'group-1',
      projectId: 'project-1',
      flowId: null,
      chapterId: 'chapter-1',
      recipeId: 'cinematic-narrative',
      targetDurationSeconds: 90,
      videoAspect: '9:16',
      requestedVideoModel: null,
      videoProfileId: null,
      userBrief: '一段平淡的重逢，需要改编成完整成片。',
      referenceImageNodeIds: ['image-1'],
    })

    expect(text).toContain('"groupId":"group-1"')
    expect(text).toContain('"chapterId":"chapter-1"')
    expect(text).toContain('"targetDurationSeconds":90')
    expect(text).toContain('"referenceImageNodeIds":["image-1"]')
    expect(text).not.toContain('https://example.com/reference.png')
    expect(text).toContain('自主判断内容领域、证据计划和执行步骤')
    expect(text).toContain('若本轮入口已携带 adaptationMode，则以它为唯一改编合同')
    expect(text).toContain('faithful 只镜头化来源')
    expect(text).toContain('creative 在核心人物关系、世界规则、主线因果与关键结果不偏离的前提下允许扩写')
    expect(text).toContain('复盘只能追加证据')
    expect(text).not.toContain('S1')
    expect(text).not.toContain('S8')
    expect(text).not.toContain('逐镜单独调用')
    expect(text).not.toContain('先只做开头')
    expect(text).not.toContain('doubao-seedance')
    expect(text).not.toContain('pixverse')
  })
})

describe('buildGroupFilmChatText', () => {
  it('组节点只提交作用域事实，生产决策留给 agents', () => {
    const text = buildGroupFilmChatText({
      groupId: 'group-9',
      sourceRecipeId: 'cinematic-narrative',
      targetDurationSeconds: 60,
      videoAspect: '16:9',
      videoModel: null,
      videoProfileId: null,
    })

    expect(text).toContain('"groupId":"group-9"')
    expect(text).toContain('"targetDurationSeconds":60')
    expect(text).toContain('自主决定完整 BeatSheet、连续性、资产职责和执行动作')
    expect(text).not.toContain('runNodeDagToTarget')
    expect(text).not.toContain('videoCompose')
    expect(text).not.toContain('积分')
  })
})
