import { useState, useEffect, useRef, useCallback } from 'react'
import type { CanvasWebSocketEvent } from '../types/canvas-intelligence'

export interface UseWebSocketOptions {
  userId: string
  onMessage?: (event: CanvasWebSocketEvent) => void
  onError?: (error: Event) => void
  onOpen?: () => void
  onClose?: () => void
}

export function useWebSocket(url: string, options: UseWebSocketOptions) {
  const { userId, onMessage, onError, onOpen, onClose } = options
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null)
  const [error, setError] = useState<Event | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const maxReconnectAttempts = 5
  const reconnectAttempts = useRef(0)

  const connect = useCallback(() => {
    try {
      // 构建WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.host
      const wsUrl = `${protocol}//${host}${url}?userId=${userId}`

      console.log('Connecting to WebSocket:', wsUrl)

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = (event) => {
        console.log('WebSocket connected')
        setIsConnected(true)
        setError(null)
        reconnectAttempts.current = 0
        onOpen?.()
      }

      ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data)
        setLastMessage(event)

        try {
          const data: CanvasWebSocketEvent = JSON.parse(event.data)
          onMessage?.(data)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.onerror = (event) => {
        console.error('WebSocket error:', event)
        setError(event)
        onError?.(event)
      }

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason)
        setIsConnected(false)
        wsRef.current = null
        onClose?.()

        // 尝试重连
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++
          const delay = Math.pow(2, reconnectAttempts.current) * 1000 // 指数退避

          console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`)

          reconnectTimerRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error)
      setError(error as Event)
    }
  }, [url, userId, onMessage, onError, onOpen, onClose])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnected(false)
  }, [])

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
      return true
    } else {
      console.warn('WebSocket is not connected')
      return false
    }
  }, [])

  // 自动连接
  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    lastMessage,
    error,
    sendMessage,
    disconnect,
    reconnect: connect
  }
}