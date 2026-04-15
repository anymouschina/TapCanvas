import { describe, expect, it } from 'vitest'
import {
  formatStoryBeatPlanItem,
  normalizeStoryBeatPlan,
  serializeStoryBeatPlan,
  storyBeatPlanToPromptText,
  summarizeStoryBeatPlan,
} from '../../src/canvas/storyBeatPlan'

describe('storyBeatPlan helpers', () => {
  it('parses structured beat lines from textarea text', () => {
    const beats = normalizeStoryBeatPlan(
      [
        '黄昏山巅远景，建立包围压迫感 | 节奏=建立 | 时长=3s | 运动=弱',
        '方源侧脸收紧，转看落日 | 节奏=停顿 | 时长=2s | 运镜=轻推 | 承接=保持站位',
      ].join('\n'),
    )

    expect(beats).toEqual([
      {
        summary: '黄昏山巅远景，建立包围压迫感',
        rhythm: '建立',
        durationSec: 3,
        motionIntensity: '弱',
      },
      {
        summary: '方源侧脸收紧，转看落日',
        rhythm: '停顿',
        durationSec: 2,
        cameraMotion: '轻推',
        continuity: '保持站位',
      },
    ])
  })

  it('keeps object beats and serializes them back to readable lines', () => {
    const beats = normalizeStoryBeatPlan([
      {
        summary: '仰头大笑后白闪收束',
        rhythm: '爆点',
        durationSec: 2,
        motionIntensity: '强',
        continuity: '延续上一镜头站位',
      },
    ])

    expect(formatStoryBeatPlanItem(beats[0]!)).toContain('节奏=爆点')
    expect(serializeStoryBeatPlan(beats)).toContain('时长=2s')
    expect(summarizeStoryBeatPlan(beats)).toContain('仰头大笑后白闪收束（爆点 / 2s）')
  })

  it('converts structured beats into prompt-friendly text', () => {
    const promptText = storyBeatPlanToPromptText([
      {
        summary: '黄昏山巅远景，建立群雄围杀压迫感',
        rhythm: '建立',
        durationSec: 3,
        motionIntensity: '弱',
      },
      {
        summary: '方源仰头大笑，能量聚拢到爆点',
        rhythm: '爆点',
        durationSec: 2,
        cameraMotion: '轻推',
        continuity: '保持人物身份与血迹位置',
      },
    ])

    expect(promptText).toContain('镜头1：黄昏山巅远景，建立群雄围杀压迫感')
    expect(promptText).toContain('节奏=建立')
    expect(promptText).toContain('运镜=轻推')
    expect(promptText).toContain('承接=保持人物身份与血迹位置')
  })
})
