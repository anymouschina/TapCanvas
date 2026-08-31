import { describe, expect, it } from 'vitest'

import {
  isSupportedTextFile,
  decodeTextBuffer,
  buildImportedTextBlock,
  SUPPORTED_TEXT_ACCEPT,
} from './textFileImport'

const fileOf = (name: string, type = '') => new File(['x'], name, { type })

describe('isSupportedTextFile — 认哪些文件当文本输入', () => {
  it('txt / md / markdown / docx 都收', () => {
    expect(isSupportedTextFile(fileOf('章节.txt', 'text/plain'))).toBe(true)
    expect(isSupportedTextFile(fileOf('大纲.md'))).toBe(true)
    expect(isSupportedTextFile(fileOf('a.markdown'))).toBe(true)
    expect(isSupportedTextFile(
      fileOf('剧本.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    )).toBe(true)
  })

  it('大小写扩展名不敏感（macOS 常见 .TXT/.DOCX）', () => {
    expect(isSupportedTextFile(fileOf('A.TXT'))).toBe(true)
    expect(isSupportedTextFile(fileOf('B.DOCX'))).toBe(true)
  })

  it('图片/视频/pdf 不收（图片有自己的参考图管线）', () => {
    expect(isSupportedTextFile(fileOf('a.png', 'image/png'))).toBe(false)
    expect(isSupportedTextFile(fileOf('a.mp4', 'video/mp4'))).toBe(false)
    expect(isSupportedTextFile(fileOf('a.pdf', 'application/pdf'))).toBe(false)
  })

  it('老式 .doc 不收（mammoth 只吃 docx，收了必失败）', () => {
    expect(isSupportedTextFile(fileOf('旧稿.doc', 'application/msword'))).toBe(false)
  })

  it('accept 串覆盖所有受支持类型', () => {
    expect(SUPPORTED_TEXT_ACCEPT).toContain('.txt')
    expect(SUPPORTED_TEXT_ACCEPT).toContain('.docx')
    expect(SUPPORTED_TEXT_ACCEPT).toContain('.md')
  })
})

describe('decodeTextBuffer — 编码嗅探（用户实测「上传剧本乱码」根治）', () => {
  const utf8 = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

  it('UTF-8 中文正常解码', () => {
    expect(decodeTextBuffer(utf8('第一章 齐夏走进祭坛'))).toBe('第一章 齐夏走进祭坛')
  })

  it('剥掉 UTF-8 BOM（Windows 记事本另存为常带·不剥会污染首行/首个标记）', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('第一章')])
    expect(decodeTextBuffer(withBom.buffer as ArrayBuffer)).toBe('第一章')
  })

  it('GBK 中文不再乱码（国产编辑器/旧剧本常见 → 按 UTF-8 硬解出 U+FFFD）', () => {
    // 「中文」的 GBK 字节序列
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const decoded = decodeTextBuffer(gbk.buffer as ArrayBuffer)
    expect(decoded).toBe('中文')
    expect(decoded).not.toContain('�')
  })

  it('纯 ASCII 两种编码都安全', () => {
    expect(decodeTextBuffer(utf8('Chapter 1: hello'))).toBe('Chapter 1: hello')
  })

  it('空文件 → 空串', () => {
    expect(decodeTextBuffer(new ArrayBuffer(0))).toBe('')
  })
})

describe('buildImportedTextBlock — 文本落进输入框的形态', () => {
  it('空草稿 → 带文件名标题 + 正文', () => {
    const out = buildImportedTextBlock('', '第三章.txt', '正文内容')
    expect(out).toContain('第三章.txt')
    expect(out).toContain('正文内容')
  })

  it('已有草稿 → 追加而非覆盖（保住用户已写的话）', () => {
    const out = buildImportedTextBlock('帮我把这章拆镜', '第三章.txt', '正文内容')
    expect(out.startsWith('帮我把这章拆镜')).toBe(true)
    expect(out).toContain('正文内容')
  })

  it('正文首尾空白清理，但内部换行保留（剧本分段是语义）', () => {
    const out = buildImportedTextBlock('', 'a.txt', '  第一段\n\n第二段  ')
    expect(out).toContain('第一段\n\n第二段')
    expect(out).not.toContain('第二段  ')
  })
})
