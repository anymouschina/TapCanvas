/**
 * 错误信息格式化
 * 参考雅虎军规：错误兜底要稳健，避免 UI 因对象渲染而崩溃
 */

type ErrorLike = {
  code?: unknown
  message?: unknown
  error?: unknown
}

export function formatErrorMessage(error: unknown): string {
  if (error == null) return ''
  if (typeof error === 'string') return error
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') return String(error)
  if (error instanceof Error) return error.message || String(error)

  if (typeof error === 'object') {
    const errorLike = error as ErrorLike

    const directMessage = extractMessageWithCode(errorLike)
    if (directMessage) return directMessage

    if (errorLike.error instanceof Error) {
      return errorLike.error.message || String(errorLike.error)
    }
    if (typeof errorLike.error === 'string' && errorLike.error.trim()) {
      return errorLike.error.trim()
    }
    if (typeof errorLike.error === 'object' && errorLike.error) {
      const nestedMessage = extractMessageWithCode(errorLike.error as ErrorLike)
      if (nestedMessage) return nestedMessage
    }

    try {
      return JSON.stringify(error)
    } catch {
      // ignore
    }
  }

  try {
    return String(error)
  } catch {
    return ''
  }
}

function extractMessageWithCode(errorLike: ErrorLike): string {
  const rawMessage = typeof errorLike.message === 'string' ? errorLike.message.trim() : ''
  if (!rawMessage) return ''

  const rawCode = typeof errorLike.code === 'string' || typeof errorLike.code === 'number'
    ? String(errorLike.code).trim()
    : ''
  return rawCode ? `${rawCode}: ${rawMessage}` : rawMessage
}

