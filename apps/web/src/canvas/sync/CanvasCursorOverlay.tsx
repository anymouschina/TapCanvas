import React, { useEffect, useState } from 'react'
import { usePresenceStore } from './presenceStore'
import type { CursorPresence } from './presenceStore'
import { useViewportAnchoredElement } from '../hooks/useViewportAnchoredElement'

const CURSOR_TTL_MS = 5000
const CLEANUP_INTERVAL_MS = 2000

const PALETTE = [
  '#e03131', '#2f9e44', '#1971c2', '#e67700',
  '#9c36b5', '#c2255c', '#0c8599', '#5c7cfa',
]

function hashColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) & 0xfffffff
  }
  return PALETTE[h % PALETTE.length]
}

function CursorDot({ cursor }: {
  cursor: CursorPresence
}) {
  const cursorRef = React.useRef<HTMLDivElement>(null)
  useViewportAnchoredElement(cursorRef, { kind: 'point', x: cursor.x, y: cursor.y })
  const color = hashColor(cursor.userId)
  const label = cursor.name.slice(0, 10)

  return (
    <div
      ref={cursorRef}
      className="tc-canvas-cursor"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        marginLeft: -2,
        marginTop: -2,
        transition: 'transform 50ms linear',
      }}
    >
      <svg className="tc-canvas-cursor__icon" width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ display: 'block' }}>
        <path className="tc-canvas-cursor__icon-shape" d="M2 2L15 9L9 11L6 17L2 2Z" fill={color} stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <div
        className="tc-canvas-cursor__label"
        style={{
          background: color,
          color: '#fff',
          fontSize: 10,
          fontFamily: 'sans-serif',
          lineHeight: '14px',
          padding: '0 4px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          marginLeft: 14,
          marginTop: -2,
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      >
        {label}
      </div>
    </div>
  )
}

export function CanvasCursorOverlay() {
  const cursors = usePresenceStore((s) => s.cursors)
  const [, forceUpdate] = useState(0)

  // Periodically evict stale cursors
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      const store = usePresenceStore.getState()
      for (const [userId, c] of store.cursors) {
        if (now - c.updatedAt > CURSOR_TTL_MS) {
          store._removeCursor(userId)
        }
      }
      forceUpdate((n) => n + 1)
    }, CLEANUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  if (!cursors.size) return null

  return (
    <>
      {Array.from(cursors.values()).map((cursor) => (
        <CursorDot key={cursor.userId} cursor={cursor} />
      ))}
    </>
  )
}
