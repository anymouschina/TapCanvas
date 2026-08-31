import { describe, expect, it } from 'vitest'
import { buildProjectLookBibleChatCommand } from './projectLookBibleChatCommand'

describe('buildProjectLookBibleChatCommand', () => {
  it('carries the exact user-authored document and durable delivery contract', () => {
    const text = '3200K灯笼暖光\n暗部不低于12 IRE'
    const command = buildProjectLookBibleChatCommand({
      fileName: '民国夜戏.md',
      sourceKind: 'uploaded_text_file',
      sourceNodeId: 'look-bible-source-1',
      sourceText: text,
    })
    const serializedFacts = command.split('\n').find((line) => line.startsWith('{'))
    expect(serializedFacts).toBeTruthy()
    expect(JSON.parse(serializedFacts || '{}')).toMatchObject({
      sourceNodeId: 'look-bible-source-1',
      sourceText: text,
    })
    expect(command).toContain('semanticKind=projectLookBible')
    expect(command).toContain('项目画风锚图片只供图片生成')
    expect(command).toContain('保留用户本轮未覆盖的 sections')
    expect(command).toContain('generationContract')
    expect(command).toContain('requiredSkills 已预读 tapcanvas-style-pack')
    expect(command).toContain('禁止再次调用 Skill 加载同名技能')
    expect(command).toContain('禁止再创建、改写或复制第二个来源节点')
  })
})
