import { describe, expect, it } from 'vitest'
import {
  buildCharacterFissionNodeDraft,
  buildCharacterFissionPrompt,
  CHARACTER_FISSION_VARIANT_COUNT,
} from './characterFissionContract'

describe('character fission contract', () => {
  it('compiles the selected direction and user hint without turning the output into a grid', () => {
    const prompt = buildCharacterFissionPrompt({
      direction: 'body_proportion',
      additionalPrompt: '从三头身到八头身，保持橙色外套',
    })

    expect(prompt).toContain('本轮裂变方向为「头身比例」')
    expect(prompt).toContain('附加要求：从三头身到八头身，保持橙色外套')
    expect(prompt).toContain('每次生成只输出一个候选角色')
    expect(prompt).toContain('不做拼图')
  })

  it('creates four non-canonical candidates bound to the exact source character node', () => {
    const result = buildCharacterFissionNodeDraft({
      sourceNodeId: 'character-node-1',
      sourceData: {
        referenceType: 'character',
        roleName: '阿乔',
        characterName: '阿乔',
        roleId: 'role-ajiao',
        cardId: 'card-ajiao',
        characterProfileVersion: 'character-card/v3',
        identityAnchors: ['橙色短发', '琥珀色眼睛'],
        prohibitedDrift: ['不得改变橙色短发轮廓'],
        imageSize: '2K',
      },
      referenceImageUrl: 'https://assets.example.com/ajiao.png',
      imageModel: 'gpt-image-2',
      draft: {
        direction: 'body_silhouette',
        additionalPrompt: '肩线更宽，但不要增加盔甲',
      },
    })

    expect(result.label).toBe('阿乔·角色裂变·体型轮廓')
    expect(result.data).toMatchObject({
      kind: 'imageEdit',
      sampleCount: CHARACTER_FISSION_VARIANT_COUNT,
      referenceType: 'character',
      roleName: '阿乔',
      characterAssetRole: 'design_candidate',
      parentCharacterNodeId: 'character-node-1',
      referenceImageNodeIds: ['character-node-1'],
      approvalStatus: 'needs_confirmation',
      productionEligible: false,
      skipCanvasIndexSync: true,
      imageModel: 'gpt-image-2',
      imageSize: '2K',
    })
    expect(result.data.referenceImages).toEqual(['https://assets.example.com/ajiao.png'])
  })

  it('fails explicitly when the source has no structured character identity', () => {
    expect(() => buildCharacterFissionNodeDraft({
      sourceNodeId: 'legacy-node',
      sourceData: { label: '看起来像角色，但没有 roleName' },
      referenceImageUrl: 'https://assets.example.com/legacy.png',
      imageModel: 'gpt-image-2',
      draft: { direction: 'custom', additionalPrompt: '改变体态' },
    })).toThrow('缺少结构化 roleName')
  })
})
