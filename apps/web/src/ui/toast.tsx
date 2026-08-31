import React from 'react'
import { create } from 'zustand'
import { notifications } from '@mantine/notifications'

type ToastType = 'info' | 'success' | 'error' | 'warning'
type ToastAction = { label: string; onClick: () => void }
type Toast = { id: string; message: string; type?: ToastType; ttl?: number }

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

export function toast(message: string, type?: ToastType, action?: ToastAction) {
  const color = type === 'error' ? 'red' : type === 'success' ? 'teal' : type === 'warning' ? 'yellow' : 'gray'
  try {
    if (action) {
      const notificationId = `toast-${Math.random().toString(36).slice(2, 8)}`
      notifications.show({
        id: notificationId,
        message: React.createElement(
          'span',
          { className: 'tc-toast-with-action' },
          message,
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'tc-toast-action',
              onClick: () => {
                try {
                  notifications.hide(notificationId)
                } catch {
                  /* mantine not mounted */
                }
                action.onClick()
              },
              style: {
                marginLeft: 8,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid currentColor',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 12,
              },
            },
            action.label,
          ),
        ),
        color,
        autoClose: 8000,
      })
      return
    }
    notifications.show({ message, color })
  } catch {
    // fallback to local store host (no action support — drop button)
    useToastStore.getState().push({ message: action ? `${message} (${action.label})` : message, type })
  }
}

export function ToastHost({ className }: { className?: string }): JSX.Element {
  const items = useToastStore((s) => s.items)
  const hostClassName = ['tc-toast-host', className].filter(Boolean).join(' ')
  return (
    <div className={hostClassName} style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 12_000 }}>
      {items.map(i => (
        <div className="tc-toast-host__item" key={i.id} style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid rgba(127,127,127,.25)',
          background: i.type === 'error' ? 'rgba(239,68,68,.12)' : i.type === 'success' ? 'rgba(16,185,129,.12)' : 'rgba(122,129,140,.12)',
          color: 'inherit',
          boxShadow: '0 2px 8px rgba(0,0,0,.08)'
        }}>{i.message}</div>
      ))}
    </div>
  )
}
