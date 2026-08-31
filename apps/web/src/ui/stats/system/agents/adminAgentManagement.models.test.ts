import { describe, expect, it } from 'vitest'
import type { AdminAgentSkillDto, AdminLlmNodePresetDto } from '../../../../api/server'
import {
  createNodePresetEditor,
  createSkillEditor,
  parseNodePresetEditor,
  parseSkillEditor,
  replaceById,
} from './adminAgentManagement.models'

const skill: AdminAgentSkillDto = {
  id: 'skill-1',
  key: 'storyboard_continuity',
  name: '分镜连续性',
  description: null,
  content: '# Instructions',
  logoUrl: null,
  category: 'storyboard',
  enabled: true,
  visible: true,
  sortOrder: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const preset: AdminLlmNodePresetDto = {
  id: 'preset-1',
  title: '电影分镜',
  type: 'image',
  prompt: '保持角色连续性',
  scope: 'base',
  enabled: true,
  sortOrder: 4,
  styleReference: { tags: ['cinematic'] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('admin Agent management editor contract', () => {
  it('does not select a semantic node type for a new preset', () => {
    expect(createNodePresetEditor().type).toBeNull()
  })

  it('rejects incomplete Skill input instead of generating defaults', () => {
    const parsed = parseSkillEditor(createSkillEditor())
    expect(parsed).toEqual({ ok: false, message: 'Skill key 不能为空' })
  })

  it('keeps an existing Skill key immutable', () => {
    const editor = createSkillEditor(skill)
    const parsed = parseSkillEditor({ ...editor, key: 'renamed' })
    expect(parsed).toEqual({ ok: false, message: '已有 Skill 的 key 不允许修改' })
  })

  it('preserves style metadata while editing a base preset', () => {
    const parsed = parseNodePresetEditor({
      ...createNodePresetEditor(preset),
      title: '电影分镜 v2',
    })
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        id: 'preset-1',
        title: '电影分镜 v2',
        styleReference: { tags: ['cinematic'] },
        sortOrder: 4,
      },
    })
  })

  it('rejects non-HTTP asset URLs and non-integer ordering', () => {
    const invalidUrl = parseSkillEditor({ ...createSkillEditor(skill), logoUrl: 'file:///tmp/logo.png' })
    expect(invalidUrl).toEqual({ ok: false, message: 'Logo URL 必须使用 HTTP(S) URL' })

    const invalidOrder = parseNodePresetEditor({ ...createNodePresetEditor(preset), sortOrder: '1.5' })
    expect(invalidOrder).toEqual({ ok: false, message: '排序值必须是安全整数' })
  })

  it('replaces saved records without requiring a second network read', () => {
    expect(replaceById([skill], { ...skill, name: '连续性指导' })).toEqual([
      { ...skill, name: '连续性指导' },
    ])
  })
})
