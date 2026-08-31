import { describe, it, expect } from 'vitest'
import { extractChoicesCardBlocks, supersedeStaleChoices, trimDanglingChoices } from './choicesCard'
import { serializeSbaChoiceSelection } from '@tapcanvas/storyboard-adventure-protocol'
import type { ChoicesCardPayload } from './types'

const FENCE_JSON = '{"question":"接下来要我做哪一步？","options":[{"label":"生成分镜脚本","description":"拆镜头"},{"label":"生成角色参考图"}]}'

describe('extractChoicesCardBlocks', () => {
  it('围栏 → data 块并从正文剥离，id 稳定可去重', () => {
    const text = `分析完成。\n\n\`\`\`choices\n${FENCE_JSON}\n\`\`\`\n\n补充说明`
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(1)
    const block = dataBlocks[0]!
    expect(block.name).toBe('choices')
    expect(block.id).toMatch(/^choices-/)
    const payload = block.payload as ChoicesCardPayload
    expect(payload.question).toBe('接下来要我做哪一步？')
    expect(payload.options).toEqual([
      { label: '生成分镜脚本', description: '拆镜头' },
      { label: '生成角色参考图' },
    ])
    expect(cleanedText).not.toContain('{"question"')
    expect(cleanedText).toContain('分析完成。')
    expect(cleanedText).toContain('补充说明')
    // 同一围栏在「流式累积全文」里再次解析（前面多了别的内容），id 不变 → 可按 id 去重
    const again = extractChoicesCardBlocks(`前面多了一轮回复\n\n${text}`)
    expect(again.dataBlocks[0]!.id).toBe(block.id)
  })

  it('裸 JSON（行首 {"question"，无围栏）同样解析，[SBA] 前缀只清理显示', () => {
    const text = '先说结论。\n{"question":"[SBA]你的选择？","options":[{"label":"进山洞"},{"label":"绕路走"}]}\n收尾'
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(1)
    const payload = dataBlocks[0]!.payload as ChoicesCardPayload
    expect(payload.sba).toBeUndefined()
    expect(payload.question).toBe('你的选择？')
    expect(cleanedText).not.toContain('{"question"')
  })

  it('保留 SBA 分支身份，并序列化为单一结构化选择动作', () => {
    const text = '```choices\n{"question":"[SBA]接下来——","options":[{"label":"进山洞","metadata":{"kind":"sba_branch","version":1,"selectionEventId":"selection-1","branchNodeId":"node-1","sbaPath":"1A","basisFingerprint":"abc123"}}]}\n```'
    const { dataBlocks } = extractChoicesCardBlocks(text)
    const option = (dataBlocks[0]!.payload as ChoicesCardPayload).options[0]!
    expect(option.metadata).toEqual({
      kind: 'sba_branch',
      version: 1,
      selectionEventId: 'selection-1',
      branchNodeId: 'node-1',
      sbaPath: '1A',
      basisFingerprint: 'abc123',
    })
    expect(serializeSbaChoiceSelection(option.metadata!, option.label)).toBe(
      '[SBA_SELECTION] {"kind":"sba_branch","version":1,"selectionEventId":"selection-1","branchNodeId":"node-1","sbaPath":"1A","basisFingerprint":"abc123","label":"进山洞"}',
    )
    expect((dataBlocks[0]!.payload as ChoicesCardPayload).sba).toBe(true)
  })

  it('只按结构化 metadata 识别 SBA 卡片，不依赖问题标题前缀', () => {
    const text = '```choices\n{"question":"接下来——","options":[{"label":"进山洞","metadata":{"kind":"sba_branch","version":1,"selectionEventId":"selection-1","branchNodeId":"node-1","sbaPath":"1A","basisFingerprint":"abc123"}}]}\n```'
    const { dataBlocks } = extractChoicesCardBlocks(text)
    const payload = dataBlocks[0]!.payload as ChoicesCardPayload

    expect(payload.question).toBe('接下来——')
    expect(payload.sba).toBe(true)
  })

  it('围栏内 JSON 前有杂词行（2026-07-17 实测 ```choices 里多打一行 choices）→ 容错解析成卡', () => {
    const text = `方向你定：\n\n\`\`\`choices\nchoices\n${FENCE_JSON}\n\`\`\``
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(1)
    const payload = dataBlocks[0]!.payload as ChoicesCardPayload
    expect(payload.question).toBe('接下来要我做哪一步？')
    expect(payload.options).toHaveLength(2)
    expect(cleanedText).not.toContain('{"question"')
  })

  it('JSON 残缺/无 options 时原样保留，不产 data 块', () => {
    const text = '前文\n```choices\n{"question":"残缺\n```\n后文'
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(0)
    expect(cleanedText).toContain('{"question":"残缺')
  })

  it('多个围栏各自成块，普通正文不受影响', () => {
    const a = '{"question":"A？","options":[{"label":"a1"}]}'
    const b = '{"question":"B？","options":[{"label":"b1"}]}'
    const text = `\`\`\`choices\n${a}\n\`\`\`\n中间\n\`\`\`choices\n${b}\n\`\`\``
    const { dataBlocks, cleanedText } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(2)
    expect(dataBlocks[0]!.id).not.toBe(dataBlocks[1]!.id)
    expect(cleanedText).toContain('中间')
  })
})

describe('顶层裸数组容错（2026-07-29 实测：无围栏无 question 的 [{"label":…}] 整坨裸显）', () => {
  const BARE = '[\n  {"label":"就按这个设计继续跑全章","description":"补齐资产后提交 BeatSheet"},\n  {"label":"先只做这两段看效果","description":"只生产 clip0+clip1"}\n]'

  it('行首裸数组解析成无标题选项卡并从正文剥离', () => {
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(`设计如上。\n${BARE}\n`)
    expect(dataBlocks).toHaveLength(1)
    const payload = dataBlocks[0]!.payload as ChoicesCardPayload
    expect(payload.question).toBeUndefined()
    expect(payload.options).toEqual([
      { label: '就按这个设计继续跑全章', description: '补齐资产后提交 BeatSheet' },
      { label: '先只做这两段看效果', description: '只生产 clip0+clip1' },
    ])
    expect(cleanedText).not.toContain('"label"')
    expect(cleanedText).toContain('设计如上。')
  })

  it('带围栏的裸数组同样成卡', () => {
    const { dataBlocks, cleanedText } = extractChoicesCardBlocks(`\`\`\`choices\n${BARE}\n\`\`\``)
    expect(dataBlocks).toHaveLength(1)
    expect((dataBlocks[0]!.payload as ChoicesCardPayload).options).toHaveLength(2)
    expect(cleanedText).not.toContain('"label"')
  })

  it('正文里的普通 JSON 数组不被误吃（键集合超出 label/description）', () => {
    const text = '返回结构：\n[{"id":1,"name":"x"}]\n以上'
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(text)
    expect(dataBlocks).toHaveLength(0)
    expect(cleanedText).toContain('{"id":1,"name":"x"}')
  })

  it('数组项缺 label 或为标量时不成卡', () => {
    expect(extractChoicesCardBlocks('\n[{"description":"只有说明"}]\n').dataBlocks).toHaveLength(0)
    expect(extractChoicesCardBlocks('\n["a","b"]\n').dataBlocks).toHaveLength(0)
  })

  it('流式未闭合的裸数组被裁掉，不闪 JSON', () => {
    const streaming = '设计如上。\n[{"label":"就按这个设计'
    expect(trimDanglingChoices(streaming)).toBe('设计如上。\n')
  })
})

describe('supersedeStaleChoices', () => {
  it('围栏后面还有正文（小T已继续推进）→ 标过期；末尾提问保持原样', () => {
    const mid = '{"question":"怎么推进？","options":[{"label":"一条龙"}]}'
    const tail = '{"question":"最后确认？","options":[{"label":"确认"}]}'
    const streamed = `盘点完成。\n\`\`\`choices\n${mid}\n\`\`\`\n我自主推进，继续建卡。\n\`\`\`choices\n${tail}\n\`\`\``
    const { dataBlocks } = extractChoicesCardBlocks(streamed)
    expect(dataBlocks).toHaveLength(2)
    const out = supersedeStaleChoices(dataBlocks, streamed)
    const midOut = out.find((b) => b.id === dataBlocks[0]!.id)!
    const tailOut = out.find((b) => b.id === dataBlocks[1]!.id)!
    expect((midOut as { payload: ChoicesCardPayload }).payload.superseded).toBe(true)
    expect((tailOut as { payload: ChoicesCardPayload }).payload.superseded).toBeUndefined()
    // 原 blocks 不被原地修改
    expect((dataBlocks[0]!.payload as ChoicesCardPayload).superseded).toBeUndefined()
  })

  it('提问就在全文末尾（真在等回答）→ 不动；无 choices 正文直接原样返回', () => {
    const only = '{"question":"选哪个？","options":[{"label":"A"}]}'
    const streamed = `先说结论。\n\`\`\`choices\n${only}\n\`\`\`\n`
    const { dataBlocks } = extractChoicesCardBlocks(streamed)
    const out = supersedeStaleChoices(dataBlocks, streamed)
    expect(out).toBe(dataBlocks)
    expect(supersedeStaleChoices(dataBlocks, '普通正文无选项')).toBe(dataBlocks)
  })

  it('围栏后只有一句重述/交还决策的短尾巴 → 保持可点（不误灰）', () => {
    const only = '{"question":"下一步？","options":[{"label":"出分镜"},{"label":"看镜头表"}]}'
    const streamed = `分析完了。\n\`\`\`choices\n${only}\n\`\`\`\n你定？`
    const { dataBlocks } = extractChoicesCardBlocks(streamed)
    expect(dataBlocks).toHaveLength(1)
    const out = supersedeStaleChoices(dataBlocks, streamed)
    expect((out[0] as { payload: ChoicesCardPayload }).payload.superseded).toBeUndefined()
  })

  it('围栏后有大段续写（小T 真继续推进干活）→ 仍标过期', () => {
    const only = '{"question":"选哪个？","options":[{"label":"A"}]}'
    const longTail =
      '我不等了，直接开始做：先建角色卡，再建场景卡，然后逐镜出图，最后拼接成片，整个流程我自主跑完。'
    const streamed = `先说结论。\n\`\`\`choices\n${only}\n\`\`\`\n${longTail}`
    const { dataBlocks } = extractChoicesCardBlocks(streamed)
    const out = supersedeStaleChoices(dataBlocks, streamed)
    expect((out[0] as { payload: ChoicesCardPayload }).payload.superseded).toBe(true)
  })
})

describe('trimDanglingChoices', () => {
  it('裁掉尾部未闭合的 ```choices 围栏（流式中间态不闪 JSON）', () => {
    const streaming = '分析完成。\n\n```choices\n{"question":"接下来要我做哪一步？","options":[{"label":"生成分'
    expect(trimDanglingChoices(streaming)).toBe('分析完成。\n\n')
  })

  it('裁掉尾部未配平的行首 {"question": 裸 JSON', () => {
    const streaming = '先说结论。\n{"question":"选哪个？","options":[{"label":"A"'
    expect(trimDanglingChoices(streaming)).toBe('先说结论。\n')
  })

  it('闭合围栏与普通文本原样保留', () => {
    const done = `分析完成。\n\n\`\`\`choices\n${FENCE_JSON}\n\`\`\`\n收尾`
    expect(trimDanglingChoices(done)).toBe(done)
    expect(trimDanglingChoices('普通回复，无选项')).toBe('普通回复，无选项')
  })
})

describe('坏 JSON 容错（2026-07-16 实测：option 尾多一个 } 导致整卡裸显代码块）', () => {
  it('多一个大括号的 choices 围栏仍能修复渲染成卡', () => {
    const bad = '```choices\n{"question":"设计板渲染中，你想接着做什么？","options":[{"label":"等出图","description":"核验后定"},{"label":"先做第二段","description":"并行推进"},{"label":"整章一次拆完","description":"统一审"}}]}\n```'
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(`前文\n${bad}\n`)
    expect(dataBlocks).toHaveLength(1)
    const payload = dataBlocks[0]!.payload as { question?: string; options: Array<{ label: string }> }
    expect(payload.question).toContain('设计板渲染中')
    expect(payload.options.map((o) => o.label)).toEqual(['等出图', '先做第二段', '整章一次拆完'])
    expect(cleanedText).not.toContain('"question"')
  })

  it('尾逗号/缺右括号也能修复', () => {
    const bad = '```choices\n{"question":"下一步？","options":[{"label":"A",},{"label":"B"}]\n```'
    const { dataBlocks } = extractChoicesCardBlocks(bad)
    expect(dataBlocks).toHaveLength(1)
    expect((dataBlocks[0]!.payload as { options: Array<{ label: string }> }).options).toHaveLength(2)
  })

  it('修不回来的垃圾仍原样保留（暴露问题不吞掉）', () => {
    const garbage = '```choices\n{"question": 完全不是JSON也修不了 [[[\n```'
    const { cleanedText, dataBlocks } = extractChoicesCardBlocks(garbage)
    expect(dataBlocks).toHaveLength(0)
    expect(cleanedText).toContain('choices')
  })
})
