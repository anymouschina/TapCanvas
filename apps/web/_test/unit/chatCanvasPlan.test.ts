import { describe, expect, it } from 'vitest'
import { parseCanvasPlanFromReply } from '../../src/ui/chat/canvasPlan'

describe('chat canvas plan parser', () => {
  it('extracts tagged canvas plan and strips it from display text', () => {
    const input = [
      '已整理流程。',
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        summary: 'test',
        nodes: [
          { clientId: 'n1', kind: 'text', label: '需求节点', position: { x: 0, y: 0 }, config: { prompt: 'abc' } },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')
    const result = parseCanvasPlanFromReply(input)
    expect(result.displayText).toContain('已整理流程')
    expect(result.displayText).not.toContain('tapcanvas_canvas_plan')
    expect(result.plan?.action).toBe('create_canvas_workflow')
    expect(result.plan?.nodes[0]?.clientId).toBe('n1')
  })

  it('inherits chapter traceability metadata into downstream visual nodes', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'basis',
            kind: 'text',
            label: '第2章依据',
            config: {
              prompt: '第2章《第一节：纵身亡魔心仍不悔》正文依据',
              sourceBookId: 'book-1',
              materialChapter: 2,
            },
          },
          {
            clientId: 'frame',
            kind: 'image',
            label: '雨夜窗前初醒',
            config: {
              prompt: '春雨夜中，少年方源立于窗前，冷静确认自己重生。',
              imagePromptSpecV2: {
                version: 'v2',
                shotIntent: '雨夜窗前初醒关键帧',
                spatialLayout: ['前景是雨滴与窗框', '中景是少年站在窗前', '背景是夜雨山寨'],
                cameraPlan: ['中近景', '镜头略微低机位'],
                lightingPlan: ['冷月光与室内暖灯交错'],
                continuityConstraints: ['保持方源外观一致'],
                negativeConstraints: ['不要切到白天'],
              },
            },
          },
        ],
        edges: [{ sourceClientId: 'basis', targetClientId: 'frame' }],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const imageConfig = result.plan?.nodes[1]?.config || {}
    expect(imageConfig.sourceBookId).toBe('book-1')
    expect(imageConfig.bookId).toBe('book-1')
    expect(imageConfig.materialChapter).toBe(2)
    expect(imageConfig.chapter).toBe(2)
    expect(imageConfig.chapterId).toBe('2')
  })

  it('rejects chapter-bound visual nodes when chapter metadata is incomplete', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'frame',
            kind: 'image',
            label: '雨夜窗前初醒',
            config: {
              prompt: '春雨夜中，少年方源立于窗前，冷静确认自己重生。',
              sourceBookId: 'book-1',
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    expect(() => parseCanvasPlanFromReply(input)).toThrowError(/缺少 config\.materialChapter/)
  })

  it('rejects chapter-grounded image nodes when imagePromptSpecV2 is missing', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'frame',
            kind: 'image',
            label: '雨夜窗前初醒',
            config: {
              prompt: '春雨夜中，少年方源立于窗前，冷静确认自己重生。',
              sourceBookId: 'book-1',
              materialChapter: 2,
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    expect(() => parseCanvasPlanFromReply(input)).toThrowError(/缺少 config\.imagePromptSpecV2/)
  })

  it('accepts optional grouping fields in canvas plan nodes', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'n1',
            kind: 'text',
            label: '依据',
            groupId: 'source_basis',
            groupLabel: '素材依据',
            config: { prompt: '章节依据' },
          },
          {
            clientId: 'n2',
            kind: 'storyboardShot',
            label: '关键帧',
            groupId: 'generation',
            groupLabel: '生成输出',
            config: { prompt: '雨夜室内，中近景，少年方源站在窗前，冷色月光与室内昏黄油灯交错，东方玄幻动漫电影感。' },
          },
        ],
        edges: [{ sourceClientId: 'n1', targetClientId: 'n2' }],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    expect(result.plan?.nodes[0]?.groupId).toBe('source_basis')
    expect(result.plan?.nodes[0]?.groupLabel).toBe('素材依据')
    expect(result.plan?.nodes[1]?.groupId).toBe('generation')
  })

  it('compiles chapter-grounded imagePromptSpecV2 into prompt during canvas plan parsing', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'frame',
            kind: 'image',
            label: '雨夜窗前初醒',
            config: {
              sourceBookId: 'book-1',
              materialChapter: 2,
              imagePromptSpecV2: {
                version: 'v2',
                shotIntent: '雨夜窗前初醒关键帧',
                spatialLayout: ['前景是窗框与雨滴', '中景是少年立于窗前', '背景是雨夜山寨'],
                cameraPlan: ['中近景', '镜头略微低机位'],
                lightingPlan: ['冷月光打在侧脸', '室内暖灯勾出桌边与窗沿'],
                continuityConstraints: ['保持方源外观一致', '维持夜晚山寨空间锚点'],
                negativeConstraints: ['不要切到白天', '不要新增无关角色'],
              },
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const config = result.plan?.nodes[0]?.config || {}
    expect(config.prompt).toContain('画面目标：雨夜窗前初醒关键帧')
    expect(config.prompt).toContain('空间布局：前景是窗框与雨滴')
    expect(config.prompt).toContain('镜头与构图：中近景')
    expect(config.prompt).toContain('光线与材质：冷月光打在侧脸')
  })

  it('rejects chapter-grounded image nodes when imagePromptSpecV2 is invalid', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'frame',
            kind: 'image',
            label: '雨夜窗前初醒',
            config: {
              sourceBookId: 'book-1',
              materialChapter: 2,
              imagePromptSpecV2: {
                version: 'v1',
                shotIntent: '雨夜窗前初醒关键帧',
                spatialLayout: ['前景是窗框与雨滴'],
                cameraPlan: ['中近景'],
                lightingPlan: ['冷月光打在侧脸'],
              },
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    expect(() => parseCanvasPlanFromReply(input)).toThrowError(/imagePromptSpecV2 非法/)
  })

  it('strips queued placeholder runtime state from plan-only visual nodes', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'n1',
            kind: 'storyboardShot',
            label: '关键帧',
            config: {
              prompt: '雨夜室内，中近景，少年方源站在窗前。',
              status: 'queued',
              aiChatPlanStatus: 'queued',
              skipDagRun: true,
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const config = result.plan?.nodes[0]?.config || {}
    expect(config.status).toBeUndefined()
    expect(config.aiChatPlanStatus).toBeUndefined()
    expect(config.skipDagRun).toBeUndefined()
  })

  it('splits overloaded 5-second video plans into multiple composeVideo nodes', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'v1',
            kind: 'composeVideo',
            label: '短片',
            config: {
              prompt: '镜头1...镜头2...镜头3...镜头4...镜头5...镜头6...',
              videoDurationSeconds: 5,
              storyBeatPlan: [
                { summary: '镜头1', durationSec: 3 },
                { summary: '镜头2', durationSec: 3 },
                { summary: '镜头3', durationSec: 2 },
                { summary: '镜头4', durationSec: 1.5 },
                { summary: '镜头5', durationSec: 3 },
                { summary: '镜头6', durationSec: 4 },
              ],
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const videoNodes = (result.plan?.nodes || []).filter((node) => node.kind === 'composeVideo')
    expect(videoNodes.length).toBeGreaterThan(1)
    expect(videoNodes[0]?.label).toContain('（1/')
    expect(videoNodes[1]?.label).toContain('（2/')
    expect(videoNodes[0]?.config?.storyBeatPlan).toBeUndefined()
  })

  it('rejects video plans that drop upstream dialogue', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'shot-1',
            kind: 'storyboardShot',
            label: '镜头一',
            config: {
              prompt: '雨夜室内，中近景，少年方源站在窗前。',
              storyboardDialogue: ['古月山寨，这是五百年前？！'],
            },
          },
          {
            clientId: 'video-1',
            kind: 'composeVideo',
            label: '短片',
            config: {
              prompt: '8秒短片，表现方源确认重生。',
              videoDurationSeconds: 8,
              storyBeatPlan: [
                { summary: '镜头1：雨夜山寨远景', durationSec: 3 },
                { summary: '镜头2：窗前人物特写', durationSec: 3 },
                { summary: '镜头3：停在眼神', durationSec: 2 },
              ],
              prompt: '镜头1，3秒，雨夜山寨远景；镜头2，3秒，窗前中近景慢推；镜头3，2秒，停在人物眼神与呼吸感。',
            },
          },
        ],
        edges: [{ sourceClientId: 'shot-1', targetClientId: 'video-1' }],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    expect(() => parseCanvasPlanFromReply(input)).toThrowError(/没有在 config\.prompt 中保留上游关键台词/)
  })

  it('accepts video plans that preserve upstream dialogue in node data and prompt text', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'shot-1',
            kind: 'storyboardShot',
            label: '镜头一',
            config: {
              prompt: '雨夜室内，中近景，少年方源站在窗前。',
              storyboardDialogue: ['古月山寨，这是五百年前？！'],
            },
          },
          {
            clientId: 'video-1',
            kind: 'composeVideo',
            label: '短片',
            config: {
              prompt: '8秒短片，表现方源确认重生，并保留关键低语。',
              storyboardDialogue: ['古月山寨，这是五百年前？！'],
              videoDurationSeconds: 8,
              storyBeatPlan: [
                { summary: '镜头1：雨夜山寨远景', durationSec: 3 },
                { summary: '镜头2：窗前人物特写，低声说出“古月山寨，这是五百年前？！”', durationSec: 3 },
                { summary: '镜头3：停在眼神', durationSec: 2 },
              ],
              prompt: '镜头1，3秒，雨夜山寨远景；镜头2，3秒，窗前中近景慢推，方源低声说出“古月山寨，这是五百年前？！”；镜头3，2秒，停在人物眼神与呼吸感。',
            },
          },
        ],
        edges: [{ sourceClientId: 'shot-1', targetClientId: 'video-1' }],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    expect(result.plan?.nodes[1]?.config?.storyboardDialogue).toEqual(['古月山寨，这是五百年前？！'])
  })

  it('injects storyboard dialogue into composeVideo prompt when the raw prompt omits it', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'video-1',
            kind: 'composeVideo',
            label: '短片',
            config: {
              prompt: '镜头1，2秒，雨夜山寨远景；镜头2，2秒，窗前中近景慢推；镜头3，1秒，手掌特写。',
              storyboardDialogue: ['方源：古月山寨，这是五百年前？！'],
              videoDurationSeconds: 5,
              storyBeatPlan: [
                { summary: '镜头1：雨夜山寨远景', durationSec: 2 },
                { summary: '镜头2：窗前人物特写', durationSec: 2 },
                { summary: '镜头3：手掌缓缓握紧', durationSec: 1 },
              ],
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const prompt = result.plan?.nodes[0]?.config?.prompt
    expect(typeof prompt).toBe('string')
    expect(String(prompt)).toContain('对白要求')
    expect(String(prompt)).toContain('古月山寨，这是五百年前？！')
  })

  it('keeps dialogue inside split composeVideo prompt chunks', () => {
    const input = [
      '<tapcanvas_canvas_plan>',
      JSON.stringify({
        action: 'create_canvas_workflow',
        nodes: [
          {
            clientId: 'v1',
            kind: 'composeVideo',
            label: '短片',
            config: {
              prompt: '镜头1...镜头2...镜头3...镜头4...',
              storyboardDialogue: [
                '方源：若是刚炼成的春秋蝉有效，来生还是要做邪魔！',
                '群雄：快快交出春秋蝉！！',
              ],
              videoDurationSeconds: 5,
              storyBeatPlan: [
                { summary: '镜头1：山巅远景', durationSec: 2 },
                { summary: '镜头2：方源转身', durationSec: 2 },
                { summary: '镜头3：方源大笑自爆', durationSec: 2 },
                { summary: '镜头4：雨夜山寨远景', durationSec: 2 },
              ],
            },
          },
        ],
        edges: [],
      }),
      '</tapcanvas_canvas_plan>',
    ].join('\n')

    const result = parseCanvasPlanFromReply(input)
    const videoNodes = (result.plan?.nodes || []).filter((node) => node.kind === 'composeVideo')
    expect(videoNodes.length).toBe(2)
    expect(String(videoNodes[0]?.config?.prompt)).toContain('对白要求')
    expect(String(videoNodes[0]?.config?.prompt)).toContain('来生还是要做邪魔')
    expect(String(videoNodes[1]?.config?.prompt)).toContain('对白要求')
    expect(String(videoNodes[1]?.config?.prompt)).toContain('快快交出春秋蝉')
  })
})
