export type TaskErrorDisplay = {
  enhancedMsg: string
}

export function isSafetyBlockedError(err: any): boolean {
  const message = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '').toLowerCase()
  const upstreamCode = String(err?.details?.upstreamData?.error?.code || '').toLowerCase()
  const upstreamType = String(err?.details?.upstreamData?.error?.type || '').toLowerCase()
  const upstreamMessage = String(err?.details?.upstreamData?.error?.message || '').toLowerCase()
  const upstreamText = String(err?.details?.upstreamText || '').toLowerCase()
  const joined = [message, code, upstreamCode, upstreamType, upstreamMessage, upstreamText].join(' ')
  return (
    joined.includes('image_safety') ||
    joined.includes('safety') ||
    joined.includes('policy') ||
    joined.includes('content_filter') ||
    joined.includes('moderation') ||
    joined.includes('unsafe')
  )
}

export function resolveTaskErrorDisplay(err: any, fallbackMsg: string): TaskErrorDisplay {
  const msg = String(err?.message || fallbackMsg || '图像模型调用失败')
  return {
    enhancedMsg: msg,
  }
}
