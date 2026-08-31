import React from 'react'
import { Text, useComputedColorScheme } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import {
  CAMERA_APERTURES,
  CAMERA_BODIES,
  CAMERA_FOCALS,
  CAMERA_LENSES,
  type CinematicCameraValue,
} from '../cameraControlContract'

type DrumItem = { key: string; label: string; iconUrl?: string }

const ITEM_H = 76

interface ThemeTokens {
  panelBg: string
  text: string
  subText: string
  divider: string
  fadeRgba: string
  highlightRow: string
  arrow: string
  arrowDisabled: string
  saveBtn: string
}

function buildThemeTokens(scheme: 'light' | 'dark'): ThemeTokens {
  if (scheme === 'dark') {
    return {
      panelBg: 'rgba(18,23,33,0.98)',
      text: '#fff',
      subText: 'rgba(255,255,255,0.45)',
      divider: 'rgba(255,255,255,0.07)',
      fadeRgba: '18,23,33',
      highlightRow: 'rgba(255,255,255,0.025)',
      arrow: 'rgba(255,255,255,0.45)',
      arrowDisabled: 'rgba(255,255,255,0.12)',
      saveBtn: 'rgba(255,255,255,0.6)',
    }
  }
  return {
    panelBg: 'rgba(248,249,251,0.98)',
    text: '#1a1f2c',
    subText: 'rgba(0,0,0,0.5)',
    divider: 'rgba(0,0,0,0.08)',
    fadeRgba: '248,249,251',
    highlightRow: 'rgba(0,0,0,0.04)',
    arrow: 'rgba(0,0,0,0.45)',
    arrowDisabled: 'rgba(0,0,0,0.15)',
    saveBtn: 'rgba(0,0,0,0.6)',
  }
}

function DrumIcon({ url, size, opacity, ownerKey }: { url: string; size: number; opacity: number; ownerKey: string }) {
  return (
    <ManagedImage
      className="cam-ctrl-icon"
      src={url}
      alt=""
      ownerRequestKey={ownerKey}
      priority="visible"
      loading="eager"
      decoding="async"
      draggable={false}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        opacity,
        transition: 'all 0.12s',
        pointerEvents: 'none',
      }}
    />
  )
}

function DrumColumn({
  items,
  value,
  onChange,
  tokens,
  columnKey,
}: {
  items: readonly DrumItem[]
  value: string
  onChange: (key: string) => void
  tokens: ThemeTokens
  columnKey: string
}) {
  const idx = Math.max(0, items.findIndex((i) => i.key === value))

  const goTo = (newIdx: number) => {
    const clamped = Math.max(0, Math.min(items.length - 1, newIdx))
    onChange(items[clamped].key)
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    e.stopPropagation()
    goTo(idx + (e.deltaY > 0 ? 1 : -1))
  }

  const selected = items[idx]

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0 }}
      onWheel={handleWheel}
    >
      <div style={{ height: ITEM_H * 3, overflow: 'hidden', position: 'relative' }}>
        {/* fade top */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: ITEM_H * 1.15,
          background: `linear-gradient(to bottom, rgba(${tokens.fadeRgba},1) 0%, rgba(${tokens.fadeRgba},0) 100%)`,
          zIndex: 2, pointerEvents: 'none',
        }} />
        {/* selection highlight row */}
        <div style={{
          position: 'absolute', top: ITEM_H, left: 0, right: 0, height: ITEM_H,
          borderTop: `1px solid ${tokens.divider}`,
          borderBottom: `1px solid ${tokens.divider}`,
          background: tokens.highlightRow,
          zIndex: 0,
        }} />
        {/* fade bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: ITEM_H * 1.15,
          background: `linear-gradient(to top, rgba(${tokens.fadeRgba},1) 0%, rgba(${tokens.fadeRgba},0) 100%)`,
          zIndex: 2, pointerEvents: 'none',
        }} />

        {([-1, 0, 1] as const).map((offset) => {
          const i = idx + offset
          const item = i >= 0 && i < items.length ? items[i] : null
          const isCenter = offset === 0
          return (
            <div
              key={offset}
              onClick={() => item && onChange(item.key)}
              style={{
                height: ITEM_H,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: item ? 'pointer' : 'default',
                position: 'relative', zIndex: 1,
              }}
            >
              {item?.iconUrl ? (
                <DrumIcon
                  url={item.iconUrl}
                  size={isCenter ? 56 : 32}
                  opacity={isCenter ? 1 : 0.28}
                  ownerKey={`${columnKey}:${item.key}`}
                />
              ) : (
                <Text style={{
                  fontSize: isCenter ? 22 : 13,
                  fontWeight: isCenter ? 700 : 400,
                  color: tokens.text,
                  textAlign: 'center',
                  lineHeight: 1.2,
                  padding: '0 24px',
                  opacity: isCenter ? 1 : 0.28,
                  transition: 'all 0.12s',
                  userSelect: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}>
                  {item?.label ?? ''}
                </Text>
              )}
            </div>
          )
        })}

        {/* prev arrow */}
        <button
          onClick={() => goTo(idx - 1)}
          disabled={idx === 0}
          style={{
            position: 'absolute', left: 4,
            top: ITEM_H + ITEM_H / 2, transform: 'translateY(-50%)',
            zIndex: 3, background: 'none', border: 'none',
            cursor: idx === 0 ? 'default' : 'pointer',
            padding: 4,
            color: idx === 0 ? tokens.arrowDisabled : tokens.arrow,
            display: 'flex', alignItems: 'center',
          }}
        >
          <IconChevronLeft size={14} />
        </button>

        {/* next arrow */}
        <button
          onClick={() => goTo(idx + 1)}
          disabled={idx === items.length - 1}
          style={{
            position: 'absolute', right: 4,
            top: ITEM_H + ITEM_H / 2, transform: 'translateY(-50%)',
            zIndex: 3, background: 'none', border: 'none',
            cursor: idx === items.length - 1 ? 'default' : 'pointer',
            padding: 4,
            color: idx === items.length - 1 ? tokens.arrowDisabled : tokens.arrow,
            display: 'flex', alignItems: 'center',
          }}
        >
          <IconChevronRight size={14} />
        </button>
      </div>

      {/* selected label (昵称) */}
      <Text size="xs" style={{
        color: tokens.subText,
        textAlign: 'center',
        marginTop: 8,
        userSelect: 'none',
        padding: '0 4px',
        fontWeight: 500,
        letterSpacing: 0.2,
      }}>
        {selected?.label ?? ''}
      </Text>
    </div>
  )
}

export interface CameraControlPanelProps {
  value: CinematicCameraValue | null
  onChange: (cam: Omit<CinematicCameraValue, 'enabled'>) => void
  onClose: () => void
}

export function CameraControlPanel({ value, onChange, onClose }: CameraControlPanelProps) {
  const scheme = useComputedColorScheme('dark', { getInitialValueInEffect: false })
  const tokens = React.useMemo(() => buildThemeTokens(scheme), [scheme])

  const [cameraKey, setCameraKey] = React.useState(value?.cameraKey || CAMERA_BODIES[0].key)
  const [lensKey, setLensKey] = React.useState(value?.lensKey || CAMERA_LENSES[0].key)
  const [focalKey, setFocalKey] = React.useState(value?.focalKey || CAMERA_FOCALS[2].key)
  const [apertureKey, setApertureKey] = React.useState(value?.apertureKey || CAMERA_APERTURES[3].key)

  React.useEffect(() => {
    if (!value) return
    if (value.cameraKey) setCameraKey(value.cameraKey)
    if (value.lensKey) setLensKey(value.lensKey)
    if (value.focalKey) setFocalKey(value.focalKey)
    if (value.apertureKey) setApertureKey(value.apertureKey)
  }, [value])

  const handleSave = () => {
    onChange({ cameraKey, lensKey, focalKey, apertureKey })
    onClose()
  }

  return (
    <div style={{
      width: 600,
      background: tokens.panelBg,
      border: `1px solid ${tokens.divider}`,
      borderRadius: 16,
      boxShadow: scheme === 'dark' ? '0 24px 56px rgba(0,0,0,0.55)' : '0 24px 56px rgba(20,30,50,0.18)',
      overflow: 'hidden',
      backdropFilter: 'blur(20px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 4px' }}>
        <Text fw={600} size="sm" style={{ color: tokens.text }}>摄影机控制</Text>
        <button
          onClick={handleSave}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: tokens.saveBtn, fontSize: 13, fontWeight: 500,
            padding: '2px 4px',
          }}
        >
          保存
        </button>
      </div>

      <div style={{ display: 'flex', padding: '4px 0 14px' }}>
        <DrumColumn items={CAMERA_BODIES} value={cameraKey} onChange={setCameraKey} tokens={tokens} columnKey="camera" />
        <div style={{ width: 1, background: tokens.divider, margin: '4px 0', flexShrink: 0 }} />
        <DrumColumn items={CAMERA_LENSES} value={lensKey} onChange={setLensKey} tokens={tokens} columnKey="lens" />
        <div style={{ width: 1, background: tokens.divider, margin: '4px 0', flexShrink: 0 }} />
        <DrumColumn items={CAMERA_FOCALS} value={focalKey} onChange={setFocalKey} tokens={tokens} columnKey="focal" />
        <div style={{ width: 1, background: tokens.divider, margin: '4px 0', flexShrink: 0 }} />
        <DrumColumn items={CAMERA_APERTURES} value={apertureKey} onChange={setApertureKey} tokens={tokens} columnKey="aperture" />
      </div>
    </div>
  )
}
