import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024

export type ParsedWorksheet = { name: string; rows: string[][] }

export type WorkbookSheetDefinition = {
  name: string
  rows: string[][]
  widths: number[]
  filter: boolean
}

const escapeXml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const decodeXml = (value: string): string => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&')

const columnName = (zeroBasedIndex: number): string => {
  let current = zeroBasedIndex + 1
  let name = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

const columnIndexFromReference = (reference: string): number => {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() || 'A'
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return Math.max(0, index - 1)
}

const buildCellXml = (value: string, rowIndex: number, columnIndex: number, styleIndex: number): string => {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`
  return `<c r="${reference}" t="inlineStr" s="${styleIndex}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

const buildWorksheetXml = (sheet: WorkbookSheetDefinition): string => {
  const maxColumns = Math.max(1, ...sheet.rows.map((row) => row.length))
  const rowXml = sheet.rows.map((row, rowIndex) => {
    const cells = Array.from({ length: maxColumns }, (_, columnIndex) => buildCellXml(
      String(row[columnIndex] ?? ''),
      rowIndex,
      columnIndex,
      rowIndex === 0 ? 1 : 2,
    )).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = sheet.widths[index] ?? (index === 0 ? 18 : 30)
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  }).join('')
  const lastCell = `${columnName(maxColumns - 1)}${Math.max(1, sheet.rows.length)}`
  const filter = sheet.filter && sheet.rows.length > 0 ? `<autoFilter ref="A1:${lastCell}"/>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${rowXml}</sheetData>${filter}
</worksheet>`
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE2E8F0"/></left><right style="thin"><color rgb="FFE2E8F0"/></right><top style="thin"><color rgb="FFE2E8F0"/></top><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

export const buildXlsxWorkbook = (sheets: readonly WorkbookSheetDefinition[]): Uint8Array => {
  if (sheets.length === 0) throw new Error('Excel 至少需要一个工作表。')
  const workbookSheets = sheets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
  ).join('')
  const relationships = sheets.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('')
  const overrides = sheets.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('')
  const text = (value: string): Uint8Array => strToU8(value)
  const archive: Record<string, Uint8Array> = {
    '[Content_Types].xml': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': text('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': text(STYLES_XML),
  }
  sheets.forEach((sheet, index) => {
    archive[`xl/worksheets/sheet${index + 1}.xml`] = text(buildWorksheetXml(sheet))
  })
  return zipSync(archive, { level: 6 })
}

const extractAttribute = (attributes: string, name: string): string => decodeXml(
  new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`, 'i').exec(attributes)?.[1] || '',
)

const extractTextNodes = (xml: string): string => {
  const chunks: string[] = []
  const pattern = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml))) chunks.push(decodeXml(match[1] || ''))
  return chunks.join('')
}

const parseSharedStrings = (archive: Record<string, Uint8Array>): string[] => {
  const entry = archive['xl/sharedStrings.xml']
  if (!entry) return []
  const strings: string[] = []
  const pattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi
  let match: RegExpExecArray | null
  const xml = strFromU8(entry)
  while ((match = pattern.exec(xml))) strings.push(extractTextNodes(match[1] || ''))
  return strings
}

const parseWorksheetRows = (xml: string, sharedStrings: string[]): string[][] => {
  const rows: string[][] = []
  const rowPattern = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells: string[] = []
    const cellPattern = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi
    let cellMatch: RegExpExecArray | null
    let sequentialColumn = 0
    while ((cellMatch = cellPattern.exec(rowMatch[1] || ''))) {
      const attributes = cellMatch[1] || ''
      const body = cellMatch[2] || ''
      const reference = extractAttribute(attributes, 'r')
      const columnIndex = reference ? columnIndexFromReference(reference) : sequentialColumn
      const type = extractAttribute(attributes, 't')
      const rawValue = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1] || ''
      cells[columnIndex] = type === 'inlineStr'
        ? extractTextNodes(body)
        : type === 's'
          ? sharedStrings[Number.parseInt(rawValue, 10)] || ''
          : type === 'b'
            ? rawValue === '1' ? 'TRUE' : 'FALSE'
            : decodeXml(rawValue)
      sequentialColumn = columnIndex + 1
    }
    while (cells.length > 0 && !String(cells[cells.length - 1] ?? '').trim()) cells.pop()
    rows.push(cells)
  }
  return rows
}

const resolveWorkbookSheets = (archive: Record<string, Uint8Array>): Array<{ name: string; path: string }> => {
  const workbookEntry = archive['xl/workbook.xml']
  const relationshipsEntry = archive['xl/_rels/workbook.xml.rels']
  if (!workbookEntry || !relationshipsEntry) throw new Error('Excel 缺少 workbook 或 relationships。')
  const targetById = new Map<string, string>()
  const relationshipPattern = /<(?:\w+:)?Relationship\b([^>]*)\/?>/gi
  let relationshipMatch: RegExpExecArray | null
  const relationshipsXml = strFromU8(relationshipsEntry)
  while ((relationshipMatch = relationshipPattern.exec(relationshipsXml))) {
    const attributes = relationshipMatch[1] || ''
    const id = extractAttribute(attributes, 'Id')
    const target = extractAttribute(attributes, 'Target')
    if (!id || !target) continue
    targetById.set(id, target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/') ? target : `xl/${target.replace(/^\.\//, '')}`)
  }
  const sheets: Array<{ name: string; path: string }> = []
  const sheetPattern = /<(?:\w+:)?sheet\b([^>]*)\/?>/gi
  let sheetMatch: RegExpExecArray | null
  const workbookXml = strFromU8(workbookEntry)
  while ((sheetMatch = sheetPattern.exec(workbookXml))) {
    const attributes = sheetMatch[1] || ''
    const name = extractAttribute(attributes, 'name')
    const path = targetById.get(extractAttribute(attributes, 'r:id') || extractAttribute(attributes, 'id'))
    if (name && path && archive[path]) sheets.push({ name, path })
  }
  return sheets
}

export const parseXlsxWorkbook = (bytes: Uint8Array): ParsedWorksheet[] => {
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) throw new Error('Excel 文件不能超过 8MB。')
  let archive: Record<string, Uint8Array>
  try {
    archive = unzipSync(bytes)
  } catch {
    throw new Error('Excel 文件无法解压或不是有效的 .xlsx。')
  }
  const sharedStrings = parseSharedStrings(archive)
  return resolveWorkbookSheets(archive).map(({ name, path }) => ({
    name,
    rows: parseWorksheetRows(strFromU8(archive[path]), sharedStrings),
  }))
}
