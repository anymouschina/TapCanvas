import React from 'react'
import { create } from 'zustand'
import { notifications } from '@mantine/notifications'

type Toast = { id: string; message: string; type?: 'info'|'success'|'error'; ttl?: number }

type ToastState = {
  items: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2, 8)
    const item: Toast = { id, ...t }
    set((s) => ({ items: [...s.items, item] }))
    const ttl = t.ttl ?? 3000
    window.setTimeout(() => get().remove(id), ttl)
  },
  remove: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
}))

export function toast(message: string, type?: 'info'|'success'|'error') {
  const color = type === 'error' ? 'red' : type === 'success' ? 'teal' : 'gray'
  try {
    notifications.show({ message, color })
  } catch {
    // fallback to local store host
    useToastStore.getState().push({ message, type })
  }
}

export function ToastHost({ className }: { className?: string }): JSX.Element {
  const items = useToastStore((s) => s.items)
  const hostClassName = ['tc-toast-host', className].filter(Boolean).join(' ')
  return (
    <div className={hostClassName} style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 50 }}>
      {items.map(i => (
        <div className="tc-toast-host__item" key={i.id} style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid rgba(127,127,127,.25)',
          background: i.type === 'error' ? 'rgba(239,68,68,.12)' : i.type === 'success' ? 'rgba(16,185,129,.12)' : 'rgba(59,130,246,.12)',
          color: 'inherit',
          boxShadow: '0 2px 8px rgba(0,0,0,.08)'
        }}>{i.message}</div>
      ))}
    </div>
  )
}
