export interface ToolEventMessage {
  type: 'tool-call' | 'tool-result'
  toolCallId: string
  toolName: string
  input?: Record<string, any>
  output?: any
  errorText?: string
}

interface SubscribeOptions {
  url: string
  token?: string | null
  onEvent: (event: ToolEventMessage) => void
}

/**
 * Minimal SSE client using fetch so we can attach Authorization headers.
 * Returns a function that aborts the stream.
 */
export function subscribeToolEvents({ url, token, onEvent }: SubscribeOptions) {
  if (!url || !token) {
    return () => {}
  }

  const controller = new AbortController()
  const connect = async () => {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    })

    if (!response.body) {
      throw new Error('No response body for tool-events stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let separatorIndex = buffer.indexOf('\n\n')
        while (separatorIndex !== -1) {
          const rawChunk = buffer.slice(0, separatorIndex)
          buffer = buffer.slice(separatorIndex + 2)
          const cleaned = rawChunk.replace(/\r/g, '')
          const dataLines = cleaned
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
          if (dataLines.length) {
            const payload = dataLines.join('\n')
            try {
              onEvent(JSON.parse(payload))
            } catch (err) {
              console.warn('[toolEvents] invalid payload', err)
            }
          }
          separatorIndex = buffer.indexOf('\n\n')
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  connect().catch(err => {
    if (!controller.signal.aborted) {
      console.warn('[toolEvents] stream failed', err)
    }
  })

  return () => controller.abort()
}
