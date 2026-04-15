import { describe, expect, it } from 'vitest'
import {
  hasPotentialImagePromptExecution,
  normalizeImagePromptExecutionConfig,
  reconcileImagePromptExecutionConfig,
  resolveCompiledImagePrompt,
} from '../../src/canvas/nodes/taskNode/imagePromptSpec'

describe('imagePromptSpec helpers', () => {
  const imagePromptSpecV2 = {
    version: 'v2',
    shotIntent: '山巅对峙关键帧',
    spatialLayout: ['前景保留碎石与灰尘', '中景是主角与围攻者', '背景是黄昏山谷'],
    cameraPlan: ['中景偏低机位', '镜头略微前压'],
    lightingPlan: ['黄昏侧逆光压出轮廓', '地面材质保持冷暖交错'],
    continuityConstraints: ['保持主角服装一致'],
    negativeConstraints: ['不要切到其他场景'],
  }

  it('treats spec-only image nodes as executable', () => {
    expect(
      hasPotentialImagePromptExecution({
        imagePromptSpecV2,
      }),
    ).toBe(true)
  })

  it('compiles imagePromptSpecV2 into prompt text', () => {
    const prompt = resolveCompiledImagePrompt({
      imagePromptSpecV2,
    })

    expect(prompt).toContain('画面目标：山巅对峙关键帧')
    expect(prompt).toContain('空间布局：前景保留碎石与灰尘')
    expect(prompt).toContain('镜头与构图：中景偏低机位')
    expect(prompt).toContain('光线与材质：黄昏侧逆光压出轮廓')
  })

  it('normalizes execution config and throws on invalid spec', () => {
    expect(
      normalizeImagePromptExecutionConfig({
        imagePromptSpecV2,
      }),
    ).toMatchObject({
      imagePromptSpecV2,
      prompt: expect.stringContaining('画面目标：山巅对峙关键帧'),
    })

    expect(() =>
      normalizeImagePromptExecutionConfig({
        imagePromptSpecV2: {
          version: 'v1',
          shotIntent: 'bad spec',
          spatialLayout: ['x'],
          cameraPlan: ['x'],
          lightingPlan: ['x'],
        },
      }),
    ).toThrowError(/imagePromptSpecV2 非法/)
  })

  it('reconciles legacy object-shaped imagePromptSpecV2 for runtime execution', () => {
    const legacyConfig = {
      negativePrompt: '禁止现代元素，禁止卡通化',
      imagePromptSpecV2: {
        version: 'v2',
        spatialLayout: {
          foreground: '碎石与兵器剪影',
          midground: '成年方源居中',
          background: '半包围群雄与晚霞群山',
          subjectRelation: '群雄围而不攻',
        },
        cameraPlan: {
          aspect: '16:9',
          framing: '大全景偏中景',
          angle: '平视略低机位',
          focus: '方源为画面中心主体',
        },
        lightingPlan: {
          time: '夕阳西下',
          key: '落日逆光与侧光混合',
          fill: '环境反光补细节',
          consistency: '光向稳定，风向与衣袍发丝一致',
        },
        continuityConstraints: {
          character: '成年方源，黑发披散，残破碧绿长袍',
          scene: '不得切换夜景或雨景',
          blocking: '人物站位符合山巅地形与物理重心',
          logic: '围杀对峙关系保持不变',
        },
      },
    }

    expect(() => normalizeImagePromptExecutionConfig(legacyConfig)).toThrowError(/imagePromptSpecV2 非法/)

    const reconciled = reconcileImagePromptExecutionConfig(legacyConfig) as {
      prompt: string
      imagePromptSpecV2: {
        shotIntent: string
        spatialLayout: string[]
        cameraPlan: string[]
        lightingPlan: string[]
        continuityConstraints: string[]
        negativeConstraints: string[]
      }
    }

    expect(reconciled.imagePromptSpecV2.shotIntent).toBe('方源为画面中心主体，群雄围而不攻')
    expect(reconciled.imagePromptSpecV2.spatialLayout).toEqual([
      '前景：碎石与兵器剪影',
      '中景：成年方源居中',
      '背景：半包围群雄与晚霞群山',
    ])
    expect(reconciled.imagePromptSpecV2.cameraPlan).toContain('画幅：16:9')
    expect(reconciled.imagePromptSpecV2.lightingPlan).toContain('时间：夕阳西下')
    expect(reconciled.imagePromptSpecV2.continuityConstraints).toContain('围杀对峙关系保持不变')
    expect(reconciled.imagePromptSpecV2.negativeConstraints).toEqual(['禁止现代元素', '禁止卡通化'])
    expect(reconciled.prompt).toContain('画面目标：方源为画面中心主体，群雄围而不攻')
  })

  it('compiles legacy runtime imagePromptSpecV2 without throwing', () => {
    expect(() =>
      resolveCompiledImagePrompt({
        negativePrompt: '禁止现代元素，禁止卡通化',
        imagePromptSpecV2: {
          version: 'v2',
          spatialLayout: {
            foreground: '窗框',
            midground: '少年方源靠窗站立',
            background: '山寨灯火与夜色',
            subjectRelation: '人物视线朝向窗外山寨',
          },
          cameraPlan: {
            framing: '近中景',
            angle: '室内平视机位',
            focus: '方源眼神与面部表情',
          },
          lightingPlan: {
            time: '深夜',
            key: '窗边侧向柔光勾勒面部',
            fill: '室内微弱反光补足层次',
          },
        },
      }),
    ).not.toThrow()
  })
})
