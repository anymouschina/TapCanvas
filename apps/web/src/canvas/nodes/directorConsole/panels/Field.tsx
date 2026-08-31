import React from 'react'
import type { Vec3 } from '../types'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #16181d' }}>
      <div style={{ fontSize: 12, color: '#8b93a1', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 6,
  color: '#e5e7eb', padding: '6px 8px', fontSize: 13, boxSizing: 'border-box',
}

export function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
}

export function NumberField({ value, onChange, step = 0.1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      step={step}
      style={inputStyle}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => { const v = parseFloat(e.target.value); onChange(Number.isFinite(v) ? v : 0) }}
    />
  )
}

const AXIS = ['x', 'y', 'z'] as const

export function Vec3Row({ value, onChange }: { value: Vec3; onChange: (v: Vec3) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {AXIS.map((ax, i) => (
        <div key={ax} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>{ax}</span>
          <NumberField value={value[i]} onChange={(v) => { const next = [...value] as Vec3; next[i] = v; onChange(next) }} />
        </div>
      ))}
    </div>
  )
}

export function SliderField({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => { const v = parseFloat(e.target.value); onChange(Number.isFinite(v) ? v : min) }}
        style={{ ...inputStyle, width: 56, flex: 'none' }} />
    </div>
  )
}
