import { describe, expect, it } from 'vitest'
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  summarizeStoryboardStructuredData,
} from '../../src/storyboard/storyboardStructure'

describe('storyboardStructure helpers', () => {
  it('normalizes storyboard-director v1.1 payloads into executable prompts', () => {
    const structured = normalizeStoryboardStructuredData({
      schemaVersion: 'storyboard-director/v1.1',
      globalStyle: {
        genre: '东方奇幻定格动画',
        visualTone: '冷灰压迫感',
        palette: '冷蓝灰与烛火暖橙',
      },
      shots: [
        {
          shotId: 'SHOT_01',
          durationSec: 3,
          narrativeGoal: '建立角色被雨夜压迫的处境',
          subjectAnchors: ['李长安湿透黑发', '旧式粗布外套'],
          scene: {
            location: '老屋门前',
            timeOfDay: '深夜',
            weather: '暴雨',
            environmentDetails: ['泥地积水反光', '门框剥落木刺'],
          },
          camera: {
            shotSize: '中景',
            angle: '轻低机位',
            height: '胸口高度',
            lensMm: 35,
            shutterAngleDeg: 180,
            movement: '缓慢前推',
            focusTarget: '李长安面部',
          },
          lighting: {
            keyDirection: '左后方祠堂冷光',
            keyAngleDeg: 35,
            colorTempK: 4800,
            contrastRatio: '4:1',
            fillStyle: '雨夜环境漫反射',
            rimLight: '湿发边缘弱轮廓',
          },
          actionChain: ['李长安停步', '抬眼盯住房门'],
          composition: {
            foreground: '雨线和门槛积水',
            midground: '李长安侧身站定',
            background: '老屋门板与晃动白幡',
            spatialRule: '人物偏左，房门占右侧压迫视野',
          },
          dramaticBeat: {
            before: '刚穿过村口',
            during: '在老屋前察觉异样',
            after: '决定逼近房门',
          },
          performance: {
            emotion: '警惕压抑',
            microExpression: '眼角紧绷',
            bodyLanguage: '肩膀前探但脚下迟疑',
          },
          continuity: {
            fromPrev: '首镜建立，无需承接上一镜',
            persistentAnchors: ['人物湿透外套不变', '房门始终位于画面右侧'],
            forbiddenDrifts: ['不要把老屋改成现代楼房'],
          },
          continuityLocks: {
            identityLock: ['李长安脸型与黑发保持一致'],
            propLock: ['木门破损纹理保持一致'],
            spaceLock: ['门在右、人物在左的轴线不变'],
            lightLock: ['冷雨夜与门内暖光对比保持稳定'],
          },
          failureRisks: ['人物站位漂移'],
          negativeConstraints: ['禁止现代元素', '禁止卡通表情'],
          prompt: {
            cn: '中景，李长安站在暴雨中的老屋门前。',
          },
        },
      ],
    })

    expect(structured?.shots).toHaveLength(1)
    expect(deriveShotPromptsFromStructuredData(structured)).toHaveLength(1)
    expect(structured?.shots[0]?.render?.promptText).toContain('空间锁')
    expect(structured?.shots[0]?.render?.promptText).toContain('老屋门前')
    expect(structured?.shots[0]?.render?.shotType).toBe('中景')
  })

  it('normalizes structured storyboard payloads and preserves dramatic layers', () => {
    const structured = normalizeStoryboardStructuredData({
      pacingGoal: '7-15秒总时长',
      continuityPlan: '首镜承接上一组尾帧',
      shots: [
        {
          shot_number: '分镜 1',
          dramatic_beat: '人物察觉危险',
          story_purpose: '建立威胁',
          continuity: '沿用上一组站位',
          durationSec: 3,
          render_prompt: '中景，角色A停步侧身，雨夜走廊冷光闪动',
        },
        {
          shot_number: '分镜 2',
          dramatic_beat: '冲突升级',
          story_purpose: '把威胁推到正面',
          continuity: '镜头方向继续向前',
          durationSec: 4,
          render_prompt: '近景，角色B压近逼问，镜头快速推近到眼神对撞',
        },
      ],
    })

    expect(structured?.shots).toHaveLength(2)
    expect(deriveShotPromptsFromStructuredData(structured)).toEqual([
      '中景，角色A停步侧身，雨夜走廊冷光闪动',
      '近景，角色B压近逼问，镜头快速推近到眼神对撞',
    ])
    expect(summarizeStoryboardStructuredData(structured)).toContain('起点：人物察觉危险')
    expect(summarizeStoryboardStructuredData(structured)).toContain('落点：冲突升级')
  })

  it('ignores invalid structured storyboard payloads', () => {
    expect(deriveShotPromptsFromStructuredData({ shots: [{ story_purpose: '无 render prompt' }] })).toEqual([])
    expect(summarizeStoryboardStructuredData(null)).toBe('')
  })
})
