// 【对话框文本文件导入】把 txt/md/docx 拖进/粘贴进/选进 AI 对话框，解析成纯文本填进输入框。
//
// 设计要点：
// - **图片不走这里**：图片有既有的参考图上传管线（onUploadReferenceFiles），两条链按 file 类型分流。
// - **编码嗅探是刚需**：用户实测反馈过「上传剧本乱码」。国产编辑器/旧剧本大量是 GBK，
//   FileReader.readAsText / TextDecoder 默认 UTF-8 硬解 → 整篇 U+FFFD 乱码。这里按 UTF-8 试解，
//   发现替换字符再回退 GBK（浏览器 TextDecoder 原生支持 gbk）。
// - **docx 懒加载**：mammoth ~200KB，只在用户真导入 docx 时动态 import，不进首屏 bundle。
// - **不截断**：整章小说几万字也照单全收（禁丢信息点）；长度提示交 UI 层，这里只负责取全文。

/** 受支持的文本文件扩展名（与 <input accept> 同源，避免两处漂移）。 */
export const SUPPORTED_TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'] as const
export const SUPPORTED_TEXT_ACCEPT = SUPPORTED_TEXT_EXTENSIONS.join(',')

const DOCX_EXT = '.docx'

function fileExtension(name: string): string {
  const n = String(name ?? '').toLowerCase()
  const i = n.lastIndexOf('.')
  return i >= 0 ? n.slice(i) : ''
}

/**
 * 是否当作「文本输入」收下。只认扩展名白名单：
 * - 老式 .doc 明确不收——mammoth 只吃 OOXML(docx)，收了必在解析期失败，不如入口就挡住；
 * - pdf/图片/视频不收（图片走参考图管线）。
 */
export function isSupportedTextFile(file: File | null | undefined): boolean {
  if (!file) return false
  return (SUPPORTED_TEXT_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))
}

/** 从 FileList 里挑出受支持的文本文件（与 extractImageFiles 对称）。 */
export function extractTextFiles(fileList: FileList | null | undefined): File[] {
  return (fileList ? Array.from(fileList) : []).filter((f) => isSupportedTextFile(f))
}

const BOM = '﻿'
const REPLACEMENT_CHAR = '�'

/**
 * 字节 → 文本，带编码嗅探。UTF-8 优先（现代主流），解出替换字符即判定不是 UTF-8 → 回退 GBK。
 * GBK 覆盖 GB2312/GB18030 常见中文剧本；两者都失败时返回 UTF-8 结果（宁可乱码也别抛错丢文件）。
 */
export function decodeTextBuffer(buffer: ArrayBuffer): string {
  if (!buffer || buffer.byteLength === 0) return ''
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes(REPLACEMENT_CHAR)) return stripBom(utf8)
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    // GBK 解出来更干净才采纳，否则保留 UTF-8 结果（避免把真 UTF-8 的偶发坏字节整篇转成 GBK 乱码）。
    if (!gbk.includes(REPLACEMENT_CHAR)) return stripBom(gbk)
  } catch {
    // 浏览器不支持 gbk 标签（极罕见）→ 落回 UTF-8。
  }
  return stripBom(utf8)
}

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(1) : s
}

/**
 * 解析单个文本文件为纯文本。docx 走 mammoth 抽纯文本（丢样式保段落）；
 * txt/md 走编码嗅探解码。
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  if (fileExtension(file.name) === DOCX_EXT) {
    // 懒加载：只有真导入 docx 才拉 mammoth（~200KB），不拖累首屏。
    // 引主入口而非 mammoth.browser.js：package.json 的 browser 字段会把 unzip/files 换成浏览器实现。
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ arrayBuffer: buffer })
    return String(result?.value ?? '').trim()
  }
  return decodeTextBuffer(buffer).trim()
}

/**
 * 把解析出的正文拼进输入框草稿。
 * - 已有草稿则**追加**（用户常先写「帮我把这章拆镜」再拖文件，覆盖会吃掉他的话）；
 * - 带文件名小标题，让 agent 与用户都知道这段文本的出处；
 * - 正文首尾空白清理，内部换行原样保留（剧本的分段/空行是语义，压掉就毁了节拍）。
 */
export function buildImportedTextBlock(draft: string, fileName: string, text: string): string {
  const body = String(text ?? '').trim()
  const head = String(draft ?? '').trim()
  const block = `【${fileName}】\n${body}`
  return head ? `${head}\n\n${block}` : block
}
