import { API_BASE } from '../api/server'
import type { CanvasFlow } from './chapterCanvasFlow.types'

export type ChapterCanvasFlowGetResponse = {
  chapterId: string
  revision: number
  flow: CanvasFlow | null
}

export type ChapterCanvasFlowPutRequest = {
  expectedRevision: number
  flow: CanvasFlow
  // 本地显式删除墓碑：让服务端写保护区分「用户真删」与「stale autosave 漏带」，
  // 否则母板/分镜板等生成态资产会被服务端护栏复活、永远删不掉。
  deletedNodeIds?: string[]
}

export type ChapterCanvasFlowPutResponse = {
  chapterId: string
  revision: number
  authoritativeFlow?: CanvasFlow
}

export class ChapterCanvasFlowConflictError extends Error {
  constructor(
    public readonly chapterId: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(
      `Canvas flow revision conflict on ${chapterId}: expected ${expected}, actual ${actual}`,
    )
    this.name = 'ChapterCanvasFlowConflictError'
  }
}

function authed(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) || {}),
  }
  return fetch(`${API_BASE}${path}`, {
    credentials: init?.credentials ?? 'include',
    ...(init || {}),
    headers,
  })
}

export async function getChapterCanvasFlow(
  chapterId: string,
): Promise<ChapterCanvasFlowGetResponse> {
  const resp = await authed(
    `/chapters/${encodeURIComponent(chapterId)}/canvas-flow`,
    { method: 'GET' },
  )
  if (resp.status === 404) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }
  if (!resp.ok) {
    throw new Error(
      `Failed to load canvas flow for ${chapterId}: ${resp.status} ${resp.statusText}`,
    )
  }
  return (await resp.json()) as ChapterCanvasFlowGetResponse
}

export async function putChapterCanvasFlow(
  chapterId: string,
  req: ChapterCanvasFlowPutRequest,
): Promise<ChapterCanvasFlowPutResponse> {
  const resp = await authed(
    `/chapters/${encodeURIComponent(chapterId)}/canvas-flow`,
    {
      method: 'PUT',
      // This module is the browser/user write path. Mark it explicitly so a
      // stale full snapshot is rejected instead of being retried with the
      // server's newer revision and overwriting agent changes.
      body: JSON.stringify({ ...req, source: 'user' }),
    },
  )
  if (resp.status === 404) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }
  if (resp.status === 409) {
    let actual = Number.NaN
    try {
      const body = (await resp.json()) as { expected?: number; actual?: number; error?: string }
      if (typeof body.actual === 'number') actual = body.actual
    } catch {
      // ignore body parse errors; fall through with NaN
    }
    throw new ChapterCanvasFlowConflictError(chapterId, req.expectedRevision, actual)
  }
  if (!resp.ok) {
    throw new Error(
      `Failed to save canvas flow for ${chapterId}: ${resp.status} ${resp.statusText}`,
    )
  }
  return (await resp.json()) as ChapterCanvasFlowPutResponse
}
