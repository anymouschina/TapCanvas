/**
 * 视频合成结果写回画布的纯逻辑。
 *
 * 背景:合成节点点「合成视频」后,旧实现是先 `await` 把成片上传 TOS、再 updateNodeData,
 * 导致写回被一次几秒~几十秒的上传阻塞,用户看着「合成后加不到画布」(commit bfeb2ada8 回归)。
 * 正解:先用 blob: URL 立即写回(合成即可见),后台转存 TOS,成功后把临时 URL 换成持久 URL。
 */

export type ComposeVideoResult = { url?: string; title?: string; uploadToken?: string }

/** 立即写回用的节点 patch:把刚合成的 blob: URL 追加为新主视频。 */
export function buildComposeInitialPatch(
  existingResults: unknown,
  blobUrl: string,
  uploadToken: string,
): {
  videoUrl: string
  status: 'success'
  videoResults: ComposeVideoResult[]
  videoPrimaryIndex: number
} {
  const existing: ComposeVideoResult[] = Array.isArray(existingResults)
    ? (existingResults as ComposeVideoResult[])
    : []
  return {
    videoUrl: blobUrl,
    status: 'success',
    videoResults: [...existing, { url: blobUrl, title: '合成视频', uploadToken }],
    videoPrimaryIndex: existing.length,
  }
}

/**
 * 后台转存成功后,把节点里临时 blob: URL 换成持久 TOS URL。
 * 重新基于「最新」节点数据计算,只替换 url 恰好等于该 blob: 的位置,避免覆盖期间发生的其它改动。
 * 没有需要替换的内容时返回 null(不触发多余的 updateNodeData)。
 */
export function buildComposeUrlSwapPatch(
  freshData: unknown,
  blobUrl: string,
  durableUrl: string,
  uploadToken: string,
): { videoUrl?: string; videoResults?: ComposeVideoResult[] } | null {
  if (!freshData || typeof freshData !== 'object') return null
  const d = freshData as { videoUrl?: unknown; videoResults?: unknown; videoPrimaryIndex?: unknown }
  const results: ComposeVideoResult[] = Array.isArray(d.videoResults)
    ? (d.videoResults as ComposeVideoResult[])
    : []

  let changed = false
  let matchedIndex = -1
  const swapped = results.map((r, index) => {
    if (r && (r.url === blobUrl || r.uploadToken === uploadToken)) {
      changed = true
      matchedIndex = index
      const { uploadToken: _completedUploadToken, ...rest } = r
      return { ...rest, url: durableUrl }
    }
    return r
  })

  const patch: { videoUrl?: string; videoResults?: ComposeVideoResult[] } = {}
  if (changed) patch.videoResults = swapped
  const primaryIndex = typeof d.videoPrimaryIndex === 'number' ? d.videoPrimaryIndex : -1
  if (d.videoUrl === blobUrl || (matchedIndex >= 0 && matchedIndex === primaryIndex && !d.videoUrl)) {
    patch.videoUrl = durableUrl
  }
  return Object.keys(patch).length > 0 ? patch : null
}
