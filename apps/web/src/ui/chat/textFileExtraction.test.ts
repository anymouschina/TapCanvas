import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { extractTextFromFile } from './textFileImport'

// Vitest executes Mammoth's Node entry; adapt only the input transport to Buffer.
vi.mock('mammoth', async () => {
  const actual = await vi.importActual<{ extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> }>('mammoth')
  return { extractRawText: ({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) => actual.extractRawText({ buffer: Buffer.from(arrayBuffer) }) }
})

function fileWithBytes(name: string, bytes: Uint8Array): File {
  const file = new File([], name)
  Object.defineProperty(file, 'arrayBuffer', { value: async () => Uint8Array.from(bytes).buffer })
  return file
}

describe('real document extraction', () => {
  for (const extension of ['doc', 'docx']) {
    it(`extracts Chinese paragraphs from a real ${extension} document`, async () => {
      const bytes = readFileSync(`${process.cwd()}/src/ui/chat/__fixtures__/text-import.${extension}`)
      const text = await extractTextFromFile(fileWithBytes(`story.${extension}`, bytes))
      expect(text).toContain('第一章 雨夜')
      expect(text).toContain('林舟推开门，问：“你还记得那封信吗？”')
      expect(text).toContain('保留 Markdown 与中文正文。')
      expect(text).not.toContain('�')
    })
    it(`rejects corrupt ${extension} instead of importing binary noise`, async () => {
      await expect(extractTextFromFile(fileWithBytes(`broken.${extension}`, new Uint8Array([1, 2, 3])))).rejects.toThrow()
    })
  }
  it('preserves Markdown and internal paragraph breaks', async () => {
    const body = '# 标题\n\n第一段\n\n- 第二段'
    expect(await extractTextFromFile(fileWithBytes('稿件.md', new TextEncoder().encode(body)))).toBe(body)
  })
})
