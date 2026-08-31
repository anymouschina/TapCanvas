import type { ExecutionGraphDetail } from './executionGraph.types'

export type KnowledgeTraceEvidence = {
  primaryItems: string[]
  details: ExecutionGraphDetail[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readRecords(record: Record<string, unknown> | null, key: string): Record<string, unknown>[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value
    .map(readRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function readStringChars(value: unknown): number | null {
  if (typeof value === 'string') return value.length
  const record = readRecord(value)
  const chars = record?.chars
  return typeof chars === 'number' && Number.isFinite(chars) && chars >= 0
    ? Math.trunc(chars)
    : null
}

function formatMetric(value: number | null): string {
  if (value === null) return '未记录'
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '')
}

function readSourceReferences(record: Record<string, unknown> | null): string[] {
  const value = record?.sourceUrls
  if (!Array.isArray(value)) return []
  return value
    .map((item): string => {
      if (typeof item === 'string') return item.trim()
      const source = readRecord(item)
      if (!source) return ''
      const origin = readString(source, 'origin')
      const pathnameHash = readString(source, 'pathnameHash')
      const valueHash = readString(source, 'valueHash')
      const sha256 = readString(source, 'sha256')
      const queryPresent = source.queryPresent === true ? ' · query' : ''
      return [
        origin,
        pathnameHash ? `pathHash=${pathnameHash}` : '',
        valueHash ? `valueHash=${valueHash}` : '',
        sha256 ? `sha256=${sha256}` : '',
        queryPresent,
      ].filter(Boolean).join(' · ')
    })
    .filter(Boolean)
}

function candidateRankSummary(candidate: Record<string, unknown>): string {
  const vectorRank = readNumber(candidate, 'vectorRank')
  return vectorRank !== null ? `vector#${vectorRank}` : 'rank 未记录'
}

function candidatePrimaryItem(candidate: Record<string, unknown>, index: number): string {
  const title = readString(candidate, 'title')
  const id = readString(candidate, 'id') || 'cardId 未记录'
  const score = formatMetric(readNumber(candidate, 'score'))
  return `#${index + 1} ${title || id} · score=${score} · ${candidateRankSummary(candidate)}`
}

function candidateDetail(candidate: Record<string, unknown>, index: number): ExecutionGraphDetail {
  const sourceRefs = readStringArray(candidate, 'sources')
  const matchedQueryIds = readStringArray(candidate, 'matchedQueryIds')
  const sourceUrls = readSourceReferences(candidate)
  const title = readString(candidate, 'title')
  return {
    label: `召回候选 #${index + 1}`,
    value: [
      `finalRank=${index + 1}`,
      `title=${title || '未记录'}`,
      `id=${readString(candidate, 'id') || '未记录'}`,
      `score=${formatMetric(readNumber(candidate, 'score'))}`,
      `vectorScore=${formatMetric(readNumber(candidate, 'vectorScore'))}`,
      `vectorRank=${formatMetric(readNumber(candidate, 'vectorRank'))}`,
      sourceRefs.length > 0 ? `sources=${sourceRefs.join(', ')}` : '',
      matchedQueryIds.length > 0 ? `matchedQueryIds=${matchedQueryIds.join(', ')}` : '',
      sourceUrls.length > 0 ? `sourceUrls=${sourceUrls.join(', ')}` : '',
    ].filter(Boolean).join('\n'),
  }
}

function buildKnowledgeSearchEvidence(
  input: Record<string, unknown> | null,
  output: Record<string, unknown>,
): KnowledgeTraceEvidence {
  const results = readRecords(output, 'results')
  const diagnostics = readRecord(output.diagnostics)
  const retrievalSandbox = readRecord(output.retrievalSandbox)
  const retrievalMode = readString(output, 'retrievalMode')
  const candidateSetId = readString(output, 'candidateSetId')
  const count = readNumber(output, 'count') ?? results.length
  const primaryItems = [
    candidateSetId ? `候选集 · ${candidateSetId}` : '候选集 · 未记录',
    `检索模式 · ${retrievalMode || '未记录'}`,
    `召回候选 · ${count}`,
    readString(retrievalSandbox, 'protocolVersion') === 'retrieval-sandbox-receipt/v1'
      ? `检索沙盒 · 返回 ${formatMetric(readNumber(retrievalSandbox, 'returnedCandidateCount'))} / 初排 ${formatMetric(readNumber(retrievalSandbox, 'availableCandidateCount'))}`
      : '',
    readString(retrievalSandbox, 'bodyAccess') === 'candidate_set_required'
      ? '正文边界 · 选中后精确读取'
      : '',
    `向量排序 · ${results.length} 张（返回顺序）`,
    readBoolean(output, 'rawUserRequestIncluded') === true ? '原始请求视图 · 已纳入' : '',
    readNumber(diagnostics, 'vectorCandidates') !== null
      ? `向量候选 · ${readNumber(diagnostics, 'vectorCandidates')}`
      : '',
    readNumber(diagnostics, 'queryViews') !== null
      ? `检索视角 · ${readNumber(diagnostics, 'queryViews')}`
      : '',
    (readNumber(diagnostics, 'omittedQueryViews') ?? 0) > 0
      ? `视角预算省略 · ${readNumber(diagnostics, 'omittedQueryViews')}`
      : '',
    readNumber(diagnostics, 'vectorHits') !== null
      ? `视角命中 · ${readNumber(diagnostics, 'vectorHits')}`
      : '',
    readNumber(diagnostics, 'indexedCards') !== null
      ? `已索引卡片 · ${readNumber(diagnostics, 'indexedCards')}`
      : '',
    readString(diagnostics, 'embeddingModel') ? `嵌入模型 · ${readString(diagnostics, 'embeddingModel')}` : '',
    ...results.slice(0, 3).map(candidatePrimaryItem),
  ].filter(Boolean)

  return {
    primaryItems,
    details: [
      { label: 'evidence', value: 'knowledge_search · candidate_recall' },
      { label: 'query', value: readString(input, 'query') || '原始请求由运行时注入；未在诊断中展开' },
      { label: 'candidateSetId', value: candidateSetId || '未记录' },
      { label: 'retrievalMode', value: retrievalMode || '未记录' },
      { label: 'count', value: String(count) },
      { label: 'abstained', value: String(output.abstained === true) },
      { label: 'reason', value: readString(output, 'reason') || '未记录' },
      { label: 'retrievalSandbox', value: retrievalSandbox ? JSON.stringify(retrievalSandbox, null, 2) : '未记录' },
      { label: 'diagnostics', value: diagnostics ? JSON.stringify(diagnostics, null, 2) : '未记录' },
      ...results.map(candidateDetail),
    ],
  }
}

function buildKnowledgeReadEvidence(
  input: Record<string, unknown> | null,
  output: Record<string, unknown>,
): KnowledgeTraceEvidence {
  const cardId = readString(output, 'id') || readString(input, 'cardId')
  const title = readString(output, 'title') || cardId
  const sourceUrls = readSourceReferences(output)
  const bodyChars = readStringChars(output.body) ?? readNumber(output, 'bodyChars')
  return {
    primaryItems: [
      `已读取知识卡 · ${title || '未记录'}`,
      cardId ? `cardId · ${cardId}` : 'cardId · 未记录',
      readString(input, 'candidateSetId') ? `候选集 · ${readString(input, 'candidateSetId')}` : '',
      readString(output, 'domain') ? `领域 · ${readString(output, 'domain')}` : '',
      bodyChars !== null ? `正文长度 · ${bodyChars} 字` : '',
      sourceUrls.length > 0 ? `文档来源 · ${sourceUrls[0]}` : '',
    ].filter(Boolean),
    details: [
      { label: 'evidence', value: 'knowledge_read · selected_card_context' },
      { label: 'candidateSetId', value: readString(input, 'candidateSetId') || '未记录' },
      { label: 'cardId', value: cardId || '未记录' },
      { label: 'title', value: title || '未记录' },
      { label: 'domain', value: readString(output, 'domain') || '未记录' },
      { label: 'facet', value: readString(output, 'facet') || '未记录' },
      { label: 'sourceUrls', value: sourceUrls.join('\n') || '未记录' },
      { label: 'bodyChars', value: bodyChars === null ? '未记录' : String(bodyChars) },
    ],
  }
}

export function buildKnowledgeTraceEvidence(
  name: string,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  status = 'succeeded',
): KnowledgeTraceEvidence {
  if (!output) return { primaryItems: [], details: [] }
  if (name === 'knowledge_search') return buildKnowledgeSearchEvidence(input, output)
  if (name === 'knowledge_read' && status !== 'succeeded') return { primaryItems: [], details: [] }
  if (name === 'knowledge_read') return buildKnowledgeReadEvidence(input, output)
  return { primaryItems: [], details: [] }
}
