import { API_BASE, apiFetch, throwApiError, withAuth } from './server'

import { parseChapterScriptPlansResponse, parseScriptExportSelection, type ChapterScriptPlanSummary } from '../../../../packages/schemas/chapter-script-export'
export type { ChapterScriptPlanSummary } from '../../../../packages/schemas/chapter-script-export'

export async function fetchChapterScriptPlans(projectId: string): Promise<ChapterScriptPlanSummary[]> {
  const response = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/script-plans`, withAuth())
  if (!response.ok) await throwApiError(response, `读取可导出的章节失败（HTTP ${response.status}）`)
  return parseChapterScriptPlansResponse(await response.json(), projectId).items
}

function readFileName(response: Response): string {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') ?? '')
  if (!match) throw new Error('导出响应缺少文件名')
  return decodeURIComponent(match[1])
}

/** 选中章节各片段的视频提示词，按集拼成一个 TXT 文件并交给浏览器下载。 */
export async function downloadChapterScripts(projectId: string, chapterIds: readonly string[]): Promise<string> {
  parseScriptExportSelection({ chapterIds })
  const response = await apiFetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/script-export`, withAuth({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterIds }),
  }))
  if (!response.ok) await throwApiError(response, `导出剧本失败（HTTP ${response.status}）`)
  const fileName = readFileName(response)
  const url = URL.createObjectURL(await response.blob())
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return fileName
}
