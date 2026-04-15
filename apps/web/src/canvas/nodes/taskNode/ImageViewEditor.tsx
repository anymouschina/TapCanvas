import React from 'react'
import {
  Button,
  Group,
  Modal,
  Paper,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core'
import { IconBulb, IconCamera } from '@tabler/icons-react'
import imageViewControlsModule, {
  type ImageCameraControlConfig,
  type ImageLightingRigConfig,
} from '@tapcanvas/image-view-controls'

import { toast } from '../../../ui/toast'
import { isRemoteUrl } from './utils'

const {
  IMAGE_CAMERA_PRESETS,
  IMAGE_LIGHT_PRESETS,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} = imageViewControlsModule

type ViewEditorMode = 'camera' | 'lighting'
type ActiveLightSlot = 'main' | 'fill'

export type ImageViewEditorApplyPayload = {
  mode: ViewEditorMode
  cameraControl: ImageCameraControlConfig
  lightingRig: ImageLightingRigConfig
}

type UseImageViewEditorOptions = {
  baseImageUrl: string
  cameraControl?: unknown
  lightingRig?: unknown
  hasImages: boolean
  isDarkUi: boolean
  inlineDividerColor: string
  onApply: (payload: ImageViewEditorApplyPayload) => void
}

function updateLightSlot(
  rig: ImageLightingRigConfig,
  slot: ActiveLightSlot,
  patch: Partial<ImageLightingRigConfig[ActiveLightSlot]>,
): ImageLightingRigConfig {
  return {
    ...rig,
    [slot]: {
      ...rig[slot],
      ...patch,
    },
  }
}

function formatAngle(value: number): string {
  return `${Math.round(value)}°`
}

function formatDistance(value: number): string {
  return value.toFixed(2)
}

function normalizeSignedAngle(value: number): number {
  const normalized = ((value % 360) + 360) % 360
  return normalized > 180 ? normalized - 360 : normalized
}

function computePreviewMarker(input: { azimuthDeg: number; elevationDeg: number }): { left: string; top: string } {
  const orbit = normalizeSignedAngle(input.azimuthDeg)
  const x = Math.sin((orbit * Math.PI) / 180) * 26
  const y = (-input.elevationDeg * 0.45) - Math.cos((orbit * Math.PI) / 180) * 6
  return {
    left: `${50 + x}%`,
    top: `${50 + y}%`,
  }
}

function buildCameraPreviewStyle(control: ImageCameraControlConfig): React.CSSProperties {
  const orbit = normalizeSignedAngle(control.azimuthDeg)
  const rotateY = orbit * 0.42
  const rotateX = -control.elevationDeg * 0.55
  const zoom = 1.08 - ((control.distance - 0.7) / (3.8 - 0.7)) * 0.42
  const offsetX = Math.sin((orbit * Math.PI) / 180) * 10
  const offsetY = (-control.elevationDeg * 0.24) - Math.cos((orbit * Math.PI) / 180) * 3
  return {
    transformStyle: 'preserve-3d',
    transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(${zoom})`,
    transition: 'transform 140ms ease-out',
  }
}

function buildLightOverlayStyle(
  light: ImageLightingRigConfig[ActiveLightSlot],
  isDarkUi: boolean,
): React.CSSProperties {
  const marker = computePreviewMarker({
    azimuthDeg: light.azimuthDeg,
    elevationDeg: light.elevationDeg,
  })
  const intensity = Math.max(0.12, Math.min(0.72, light.intensity / 100))
  return {
    position: 'absolute',
    inset: 0,
    background: `radial-gradient(circle at ${marker.left} ${marker.top}, ${light.colorHex}${Math.round(intensity * 255).toString(16).padStart(2, '0')} 0%, transparent 42%)`,
    mixBlendMode: isDarkUi ? 'screen' : 'multiply',
    pointerEvents: 'none',
  }
}

function ImageViewPreviewLite(input: {
  mode: ViewEditorMode
  baseImageUrl: string
  cameraControl: ImageCameraControlConfig
  lightingRig: ImageLightingRigConfig
  activeLightSlot: ActiveLightSlot
  isDarkUi: boolean
  inlineDividerColor: string
  onCameraControlChange: React.Dispatch<React.SetStateAction<ImageCameraControlConfig>>
  onLightingRigChange: React.Dispatch<React.SetStateAction<ImageLightingRigConfig>>
}): JSX.Element {
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    startAzimuthDeg: number
    startElevationDeg: number
  } | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const activeLight = input.activeLightSlot === 'fill' ? input.lightingRig.fill : input.lightingRig.main
  const cameraMarker = computePreviewMarker({
    azimuthDeg: input.cameraControl.azimuthDeg,
    elevationDeg: input.cameraControl.elevationDeg,
  })
  const lightMarker = computePreviewMarker({
    azimuthDeg: activeLight.azimuthDeg,
    elevationDeg: activeLight.elevationDeg,
  })

  const updatePreviewDrag = React.useCallback((deltaX: number, deltaY: number) => {
    if (input.mode === 'camera') {
      input.onCameraControlChange((current) => ({
        ...current,
        enabled: true,
        azimuthDeg: ((dragRef.current?.startAzimuthDeg ?? current.azimuthDeg) + deltaX * 0.45 + 360) % 360,
        elevationDeg: Math.max(-45, Math.min(45, (dragRef.current?.startElevationDeg ?? current.elevationDeg) - deltaY * 0.24)),
      }))
      return
    }
    input.onLightingRigChange((current) =>
      updateLightSlot(current, input.activeLightSlot, {
        enabled: true,
        azimuthDeg: ((dragRef.current?.startAzimuthDeg ?? current[input.activeLightSlot].azimuthDeg) + deltaX * 0.45 + 360) % 360,
        elevationDeg: Math.max(-45, Math.min(60, (dragRef.current?.startElevationDeg ?? current[input.activeLightSlot].elevationDeg) - deltaY * 0.24)),
      }),
    )
  }, [input])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    const startControl = input.mode === 'camera' ? input.cameraControl : activeLight
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startAzimuthDeg: startControl.azimuthDeg,
      startElevationDeg: startControl.elevationDeg,
    }
    setIsDragging(true)
  }, [activeLight, input.cameraControl, input.mode])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    updatePreviewDrag(event.clientX - drag.startX, event.clientY - drag.startY)
  }, [updatePreviewDrag])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setIsDragging(false)
  }, [])

  const handleWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (input.mode === 'camera') {
      input.onCameraControlChange((current) => ({
        ...current,
        enabled: true,
        distance: Math.max(0.7, Math.min(3.8, current.distance + (event.deltaY > 0 ? 0.14 : -0.14))),
      }))
      return
    }
    input.onLightingRigChange((current) =>
      updateLightSlot(current, input.activeLightSlot, {
        enabled: true,
        intensity: Math.max(0, Math.min(100, current[input.activeLightSlot].intensity + (event.deltaY > 0 ? -4 : 4))),
      }),
    )
  }, [input])

  return (
    <div
      className="tc-image-view-editor__lite-stage"
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        overflow: 'hidden',
        background: input.isDarkUi
          ? 'radial-gradient(circle at 50% 18%, rgba(167,139,250,0.22), rgba(15,23,42,0.92) 58%, rgba(2,6,23,0.98) 100%)'
          : 'radial-gradient(circle at 50% 18%, rgba(226,232,240,0.96), rgba(244,247,251,0.94) 58%, rgba(226,232,240,0.88) 100%)',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      <div
        className="tc-image-view-editor__lite-grid"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            'repeating-linear-gradient(0deg, transparent 0, transparent 23px, rgba(255,255,255,0.08) 23px, rgba(255,255,255,0.08) 24px)',
            'repeating-linear-gradient(90deg, transparent 0, transparent 23px, rgba(255,255,255,0.08) 23px, rgba(255,255,255,0.08) 24px)',
          ].join(', '),
          backgroundPosition: '0.5px 0.5px, 0.5px 0.5px',
          opacity: input.isDarkUi ? 0.5 : 0.28,
          pointerEvents: 'none',
        }}
      />
      <div
        className="tc-image-view-editor__lite-crosshair"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, transparent calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% + 0.5px), transparent calc(50% + 0.5px)), linear-gradient(0deg, transparent calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% - 0.5px), rgba(255,255,255,0.18) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
          pointerEvents: 'none',
        }}
      />
      <div className="tc-image-view-editor__lite-orbit-guides" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div
          className="tc-image-view-editor__lite-orbit-guide tc-image-view-editor__lite-orbit-guide--outer"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '62%',
            aspectRatio: '1 / 1',
            transform: 'translate(-50%, -50%)',
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)'}`,
            borderRadius: '50%',
            boxShadow: input.isDarkUi ? 'inset 0 0 0 1px rgba(255,255,255,0.03)' : 'inset 0 0 0 1px rgba(255,255,255,0.45)',
          }}
        />
        <div
          className="tc-image-view-editor__lite-orbit-guide tc-image-view-editor__lite-orbit-guide--vertical"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '31%',
            height: '62%',
            transform: 'translate(-50%, -50%)',
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
            borderRadius: '50%',
          }}
        />
        <div
          className="tc-image-view-editor__lite-orbit-guide tc-image-view-editor__lite-orbit-guide--horizontal"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '62%',
            height: '31%',
            transform: 'translate(-50%, -50%)',
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)'}`,
            borderRadius: '50%',
          }}
        />
        <div
          className="tc-image-view-editor__lite-orbit-guide tc-image-view-editor__lite-orbit-guide--inner"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '22%',
            aspectRatio: '1 / 1',
            transform: 'translate(-50%, -50%)',
            border: `1px dashed ${input.isDarkUi ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)'}`,
            borderRadius: '50%',
          }}
        />
      </div>
      <div
        className="tc-image-view-editor__lite-card-shell"
        style={{ position: 'absolute', inset: 0, padding: 28 }}
      >
        <div
          className="tc-image-view-editor__lite-card"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '62%',
            aspectRatio: '4 / 5',
            overflow: 'hidden',
            border: `1px solid ${input.inlineDividerColor}`,
            background: input.isDarkUi ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.94)',
            boxShadow: input.isDarkUi
              ? '0 28px 72px rgba(0,0,0,0.38)'
              : '0 24px 60px rgba(15,23,42,0.18)',
            ...buildCameraPreviewStyle(input.cameraControl),
          }}
        >
          <img
            className="tc-image-view-editor__lite-image"
            src={input.baseImageUrl}
            alt="当前图片"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          <div
            className="tc-image-view-editor__lite-shade"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 35%, rgba(0,0,0,0.18) 100%)',
            }}
          />
          {input.lightingRig.main.enabled ? (
            <div
              className="tc-image-view-editor__lite-light-overlay tc-image-view-editor__lite-light-overlay--main"
              style={buildLightOverlayStyle(input.lightingRig.main, input.isDarkUi)}
            />
          ) : null}
          {input.lightingRig.fill.enabled ? (
            <div
              className="tc-image-view-editor__lite-light-overlay tc-image-view-editor__lite-light-overlay--fill"
              style={buildLightOverlayStyle(input.lightingRig.fill, input.isDarkUi)}
            />
          ) : null}
        </div>
      </div>
      <div
        className="tc-image-view-editor__lite-badge"
        style={{
          position: 'absolute',
          left: 12,
          top: 12,
          padding: '5px 8px',
          border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)'}`,
          background: input.isDarkUi ? 'rgba(15,23,42,0.66)' : 'rgba(255,255,255,0.82)',
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {input.mode === 'camera' ? '机位预览' : `${input.activeLightSlot === 'main' ? '主光' : '辅光'}预览`}
      </div>
      <div
        className="tc-image-view-editor__lite-hint"
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          padding: '5px 8px',
          border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)'}`,
          background: input.isDarkUi ? 'rgba(15,23,42,0.66)' : 'rgba(255,255,255,0.82)',
          fontSize: 11,
          opacity: 0.76,
        }}
      >
        拖动{input.mode === 'camera' ? '旋转机位' : '调整灯位'} / 滚轮{input.mode === 'camera' ? '推拉远近' : '改强度'}
      </div>
      <div
        className="tc-image-view-editor__lite-chip-row"
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 12,
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <LiteChip label="环绕" value={formatAngle(input.cameraControl.azimuthDeg)} isDarkUi={input.isDarkUi} />
        <LiteChip label="垂直" value={formatAngle(input.cameraControl.elevationDeg)} isDarkUi={input.isDarkUi} />
        <LiteChip label="远近" value={formatDistance(input.cameraControl.distance)} isDarkUi={input.isDarkUi} />
      </div>
      {input.mode === 'camera' ? (
        <div
          className="tc-image-view-editor__lite-marker tc-image-view-editor__lite-marker--camera"
          style={{
            position: 'absolute',
            left: cameraMarker.left,
            top: cameraMarker.top,
            width: 18,
            height: 18,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#8B5CF6',
            boxShadow: '0 0 0 6px rgba(139,92,246,0.18)',
          }}
        />
      ) : (
        <div
          className="tc-image-view-editor__lite-marker tc-image-view-editor__lite-marker--light"
          style={{
            position: 'absolute',
            left: lightMarker.left,
            top: lightMarker.top,
            width: 18,
            height: 18,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background: activeLight.colorHex,
            boxShadow: `0 0 0 6px ${activeLight.colorHex}22`,
          }}
        />
      )}
    </div>
  )
}

function LiteChip(input: { label: string; value: string; isDarkUi: boolean }): JSX.Element {
  return (
    <div
      className="tc-image-view-editor__lite-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.08)'}`,
        background: input.isDarkUi ? 'rgba(15,23,42,0.72)' : 'rgba(255,255,255,0.82)',
        fontSize: 11,
      }}
    >
      <span style={{ fontWeight: 700 }}>{input.label}</span>
      <span style={{ opacity: 0.72 }}>{input.value}</span>
    </div>
  )
}

export function useImageViewEditor(options: UseImageViewEditorOptions) {
  const [mode, setMode] = React.useState<ViewEditorMode | null>(null)
  const [activeLightSlot, setActiveLightSlot] = React.useState<ActiveLightSlot>('main')
  const [cameraControl, setCameraControl] = React.useState<ImageCameraControlConfig>(() =>
    normalizeImageCameraControl(options.cameraControl),
  )
  const [lightingRig, setLightingRig] = React.useState<ImageLightingRigConfig>(() =>
    normalizeImageLightingRig(options.lightingRig),
  )

  const openEditor = React.useCallback((nextMode: ViewEditorMode) => {
    if (!options.hasImages || !isRemoteUrl(options.baseImageUrl)) {
      toast('请先上传或生成图片', 'warning')
      return
    }
    const normalizedCamera = normalizeImageCameraControl(options.cameraControl)
    const normalizedLighting = normalizeImageLightingRig(options.lightingRig)
    setCameraControl(
      nextMode === 'camera'
        ? { ...normalizedCamera, enabled: true }
        : normalizedCamera,
    )
    setLightingRig(
      nextMode === 'lighting' && !normalizedLighting.main.enabled && !normalizedLighting.fill.enabled
        ? {
            ...normalizedLighting,
            main: {
              ...normalizedLighting.main,
              enabled: true,
            },
          }
        : normalizedLighting,
    )
    setActiveLightSlot('main')
    setMode(nextMode)
  }, [options.baseImageUrl, options.cameraControl, options.hasImages, options.lightingRig])

  const openCameraEditor = React.useCallback(() => {
    openEditor('camera')
  }, [openEditor])

  const openLightingEditor = React.useCallback(() => {
    openEditor('lighting')
  }, [openEditor])

  const closeEditor = React.useCallback(() => {
    setMode(null)
  }, [])

  const activeLight = activeLightSlot === 'fill' ? lightingRig.fill : lightingRig.main

  const handleApply = React.useCallback(() => {
    if (!mode) return
    options.onApply({
      mode,
      cameraControl,
      lightingRig,
    })
    setMode(null)
  }, [cameraControl, lightingRig, mode, options])

  const modal = mode ? (
    <Modal
      className="tc-image-view-editor"
      opened
      onClose={closeEditor}
      centered
      size="xl"
      title={mode === 'camera' ? '调整角度' : '调整灯光'}
      styles={{
        content: {
          background: options.isDarkUi ? 'rgba(10,12,18,0.96)' : 'rgba(245,247,252,0.98)',
        },
        body: {
          paddingTop: 8,
        },
        header: {
          background: 'transparent',
        },
      }}
    >
      <div className="tc-image-view-editor__shell" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1fr) minmax(320px, 0.9fr)', gap: 16 }}>
        <Paper
          className="tc-image-view-editor__preview-panel"
          radius={10}
          p={0}
          withBorder
          style={{
            background: options.isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)',
            borderColor: options.inlineDividerColor,
            overflow: 'hidden',
          }}
        >
          <ImageViewPreviewLite
            mode={mode}
            baseImageUrl={options.baseImageUrl}
            cameraControl={cameraControl}
            lightingRig={lightingRig}
            activeLightSlot={activeLightSlot}
            isDarkUi={options.isDarkUi}
            inlineDividerColor={options.inlineDividerColor}
            onCameraControlChange={setCameraControl}
            onLightingRigChange={setLightingRig}
          />
        </Paper>

        <Paper
          className="tc-image-view-editor__controls-panel"
          radius={10}
          p="md"
          withBorder
          style={{
            background: options.isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.94)',
            borderColor: options.inlineDividerColor,
          }}
        >
          <Stack className="tc-image-view-editor__controls-stack" gap="md">
            {mode === 'camera' ? (
              <>
                <Group className="tc-image-view-editor__section-header" justify="space-between" gap="xs">
                  <Group className="tc-image-view-editor__section-title" gap={8}>
                    <IconCamera size={16} />
                    <Text className="tc-image-view-editor__section-title-text" size="sm" fw={700}>
                      摄像机
                    </Text>
                  </Group>
                  <Switch
                    className="tc-image-view-editor__camera-switch"
                    size="sm"
                    checked={cameraControl.enabled}
                    onChange={(event) => {
                      setCameraControl((current) => ({
                        ...current,
                        enabled: event.currentTarget.checked,
                      }))
                    }}
                    label="启用角度控制"
                  />
                </Group>
                <Group className="tc-image-view-editor__preset-grid" gap={8} wrap="wrap">
                  {IMAGE_CAMERA_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      className="tc-image-view-editor__preset-button"
                      size="compact-sm"
                      variant={cameraControl.presetId === preset.id ? 'light' : 'default'}
                      onClick={() => {
                        setCameraControl((current) => ({
                          ...current,
                          enabled: true,
                          presetId: preset.id,
                          azimuthDeg: preset.azimuthDeg,
                          elevationDeg: preset.elevationDeg,
                        }))
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </Group>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>环绕</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {Math.round(cameraControl.azimuthDeg)}°
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={cameraControl.azimuthDeg}
                    min={0}
                    max={360}
                    step={1}
                    onChange={(value) => {
                      setCameraControl((current) => ({
                        ...current,
                        enabled: true,
                        azimuthDeg: value,
                      }))
                    }}
                  />
                </div>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>垂直</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {Math.round(cameraControl.elevationDeg)}°
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={cameraControl.elevationDeg}
                    min={-45}
                    max={45}
                    step={1}
                    onChange={(value) => {
                      setCameraControl((current) => ({
                        ...current,
                        enabled: true,
                        elevationDeg: value,
                      }))
                    }}
                  />
                </div>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>远近</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {cameraControl.distance.toFixed(2)}
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={cameraControl.distance}
                    min={0.7}
                    max={3.8}
                    step={0.05}
                    onChange={(value) => {
                      setCameraControl((current) => ({
                        ...current,
                        enabled: true,
                        distance: value,
                      }))
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <Group className="tc-image-view-editor__section-header" justify="space-between" gap="xs">
                  <Group className="tc-image-view-editor__section-title" gap={8}>
                    <IconBulb size={16} />
                    <Text className="tc-image-view-editor__section-title-text" size="sm" fw={700}>
                      灯光
                    </Text>
                  </Group>
                  <SegmentedControl
                    className="tc-image-view-editor__light-slot"
                    size="xs"
                    value={activeLightSlot}
                    onChange={(value) => setActiveLightSlot(value as ActiveLightSlot)}
                    data={[
                      { value: 'main', label: '主光' },
                      { value: 'fill', label: '辅光' },
                    ]}
                  />
                </Group>
                <Switch
                  className="tc-image-view-editor__light-switch"
                  size="sm"
                  checked={activeLight.enabled}
                  onChange={(event) => {
                    setLightingRig((current) =>
                      updateLightSlot(current, activeLightSlot, { enabled: event.currentTarget.checked }),
                    )
                  }}
                  label={`启用${activeLightSlot === 'main' ? '主光' : '辅光'}`}
                />
                <Group className="tc-image-view-editor__preset-grid" gap={8} wrap="wrap">
                  {IMAGE_LIGHT_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      className="tc-image-view-editor__preset-button"
                      size="compact-sm"
                      variant={activeLight.presetId === preset.id ? 'light' : 'default'}
                      onClick={() => {
                        setLightingRig((current) =>
                          updateLightSlot(current, activeLightSlot, {
                            enabled: true,
                            presetId: preset.id,
                            azimuthDeg: preset.azimuthDeg,
                            elevationDeg: preset.elevationDeg,
                          }),
                        )
                      }}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </Group>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>水平环绕</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {Math.round(activeLight.azimuthDeg)}°
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={activeLight.azimuthDeg}
                    min={0}
                    max={360}
                    step={1}
                    onChange={(value) => {
                      setLightingRig((current) =>
                        updateLightSlot(current, activeLightSlot, {
                          enabled: true,
                          azimuthDeg: value,
                        }),
                      )
                    }}
                  />
                </div>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>高度</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {Math.round(activeLight.elevationDeg)}°
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={activeLight.elevationDeg}
                    min={-45}
                    max={60}
                    step={1}
                    onChange={(value) => {
                      setLightingRig((current) =>
                        updateLightSlot(current, activeLightSlot, {
                          enabled: true,
                          elevationDeg: value,
                        }),
                      )
                    }}
                  />
                </div>
                <div className="tc-image-view-editor__slider-block">
                  <Group className="tc-image-view-editor__slider-header" justify="space-between" gap="xs">
                    <Text className="tc-image-view-editor__slider-label" size="xs" fw={700}>强度</Text>
                    <Text className="tc-image-view-editor__slider-value" size="xs" c="dimmed">
                      {Math.round(activeLight.intensity)}%
                    </Text>
                  </Group>
                  <Slider
                    className="tc-image-view-editor__slider"
                    value={activeLight.intensity}
                    min={0}
                    max={100}
                    step={1}
                    onChange={(value) => {
                      setLightingRig((current) =>
                        updateLightSlot(current, activeLightSlot, {
                          enabled: true,
                          intensity: value,
                        }),
                      )
                    }}
                  />
                </div>
                <TextInput
                  className="tc-image-view-editor__color-input"
                  label="灯光颜色"
                  value={activeLight.colorHex}
                  onChange={(event) => {
                    setLightingRig((current) =>
                      updateLightSlot(current, activeLightSlot, {
                        enabled: true,
                        colorHex: event.currentTarget.value.toUpperCase(),
                      }),
                    )
                  }}
                  rightSection={
                    <span
                      className="tc-image-view-editor__color-swatch"
                      style={{
                        display: 'inline-block',
                        width: 16,
                        height: 16,
                        background: activeLight.colorHex,
                        border: `1px solid ${options.inlineDividerColor}`,
                      }}
                    />
                  }
                />
              </>
            )}

            <Group className="tc-image-view-editor__actions" justify="flex-end" gap="xs">
              <Button
                className="tc-image-view-editor__cancel"
                variant="subtle"
                onClick={closeEditor}
              >
                取消
              </Button>
              <Button
                className="tc-image-view-editor__apply"
                onClick={handleApply}
              >
                应用
              </Button>
            </Group>
          </Stack>
        </Paper>
      </div>
    </Modal>
  ) : null

  return {
    openCameraEditor,
    openLightingEditor,
    modal,
  }
}
