import { parseMsDoc } from '@file-viewer/doc'

/** Extract document text without rendering HTML or opening embedded resources. */
export function extractLegacyWordText(buffer: ArrayBuffer): string {
  const document = parseMsDoc(buffer)
  if (document.warnings.length) {
    console.warn('legacy_word_parse_warnings', document.warnings)
  }
  return document.blocks.map((block) => {
    if (block.type === 'paragraph') return block.text
    if (block.type === 'table') {
      return block.rows.map((row) => row.cells.map((cell) =>
        cell.paragraphs.map((paragraph) => paragraph.text).join('\n'),
      ).join('\t')).join('\n')
    }
    return ''
  }).join('\n').trim()
}
