import { describe, expect, it } from 'vitest'
import { AdminAgentSkillDtoSchema, AdminBuiltInCapabilityDtoSchema, AdminLlmNodePresetDtoSchema } from './server'

describe('admin Agent management response contracts', () => {
  it('requires Skill content instead of accepting public metadata as an admin record', () => {
    const parsed = AdminAgentSkillDtoSchema.safeParse({
      id: 'skill-1',
      key: 'continuity',
      name: '连续性',
      description: null,
      logoUrl: null,
      category: 'storyboard',
      enabled: true,
      visible: true,
      sortOrder: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts only a fully identified base preset for the admin endpoint', () => {
    const basePreset = {
      id: 'preset-1',
      title: '电影分镜',
      type: 'image',
      prompt: '保持角色连续性',
      scope: 'base',
      enabled: true,
      sortOrder: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    expect(AdminLlmNodePresetDtoSchema.safeParse(basePreset).success).toBe(true)
    expect(AdminLlmNodePresetDtoSchema.safeParse({ ...basePreset, scope: 'user' }).success).toBe(false)

    const { enabled: _enabled, ...withoutEnabled } = basePreset
    expect(AdminLlmNodePresetDtoSchema.safeParse(withoutEnabled).success).toBe(false)
  })

  it('requires the system state and audit fields for built-in capabilities', () => {
    const capability = {
      id: 'builtin:one_click_video',
      key: 'one_click_video',
      name: '一键成片',
      description: '从创作目标规划并交付完整成片。',
      requiredTools: ['tapcanvas_video_orchestrate'],
      sideEffects: ['paid_generation'],
      replaceable: true,
      enabled: false,
      updatedAt: '2026-08-15T00:00:00.000Z',
      updatedByUserId: 'admin-1',
    }

    expect(AdminBuiltInCapabilityDtoSchema.safeParse(capability).success).toBe(true)
    const { updatedByUserId: _updatedByUserId, ...withoutAuditActor } = capability
    expect(AdminBuiltInCapabilityDtoSchema.safeParse(withoutAuditActor).success).toBe(false)
  })
})
