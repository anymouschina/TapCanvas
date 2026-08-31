import React from 'react'
import { RealtimeAsrClient } from '../../services/realtimeAsrClient'

// 对话框语音输入 hook（回填逻辑对齐 Tanva AIChatDialog）：
// 开始录音时快照输入框现值为 base；final 分句累计、interim 整段替换，
// 合成 base + "\n" + finalText + interimText 实时回填输入框，边说边出字。
export function useVoiceInput(opts: {
  getBaseText: () => string
  onText: (text: string) => void
  onError?: (message: string) => void
  disabled?: boolean
}) {
  const { getBaseText, onText, onError, disabled } = opts
  const [isListening, setIsListening] = React.useState(false)
  const clientRef = React.useRef<RealtimeAsrClient | null>(null)
  const baseTextRef = React.useRef('')
  const finalTextRef = React.useRef('')
  // 回调经 ref 转发：避免 client 生命周期内闭包捕获过期的 onText/onError。
  const onTextRef = React.useRef(onText)
  const onErrorRef = React.useRef(onError)
  onTextRef.current = onText
  onErrorRef.current = onError

  const applyTranscript = React.useCallback((finalText: string, interimText = '') => {
    const base = baseTextRef.current.trimEnd()
    const voiceText = [finalText, interimText]
      .map((item) => item.trim())
      .filter(Boolean)
      .join('')
    const next = [base, voiceText].filter(Boolean).join(base && voiceText ? '\n' : '')
    onTextRef.current(next)
  }, [])

  const stop = React.useCallback(() => {
    clientRef.current?.stop()
    clientRef.current = null
    setIsListening(false)
  }, [])

  const start = React.useCallback(async () => {
    if (disabled || clientRef.current) return
    baseTextRef.current = getBaseText()
    finalTextRef.current = ''

    const client = new RealtimeAsrClient({
      language: 'mixed',
      onReady: () => setIsListening(true),
      onTranscript: (text, isFinal) => {
        if (!text.trim()) return
        if (isFinal) {
          finalTextRef.current = `${finalTextRef.current}${text}`
          applyTranscript(finalTextRef.current)
        } else {
          applyTranscript(finalTextRef.current, text)
        }
      },
      onError: (message) => {
        onErrorRef.current?.(message)
        stop()
      },
      onClose: () => setIsListening(false),
    })
    clientRef.current = client
    try {
      await client.start()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onErrorRef.current?.(message)
      stop()
    }
  }, [applyTranscript, disabled, getBaseText, stop])

  const toggle = React.useCallback(() => {
    if (clientRef.current) {
      stop()
      return
    }
    void start()
  }, [start, stop])

  React.useEffect(() => {
    return () => {
      clientRef.current?.stop()
      clientRef.current = null
    }
  }, [])

  return { isListening, toggle, stop }
}
