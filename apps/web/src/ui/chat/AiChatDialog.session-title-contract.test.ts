import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AiChatDialog session title failure presentation contract', () => {
  it('keeps title-generation failures observable without showing an error toast', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/ui/chat/AiChatDialog.tsx'), 'utf8')

    expect(source).toContain("console.error('[ai-chat] session title generation failed'")
    expect(source).toContain("titleGenRef.current = { key, state: 'failed' }")
    expect(source).toContain('llmAuxiliaryChat(buildSessionTitleLlmRequest')
    expect(source).toContain('messages.find(isSessionTitleEligibleAssistantMessage)')
    expect(source).not.toContain('toast(`会话标题生成失败')
  })
})
