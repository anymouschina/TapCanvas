import React from 'react'
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core'
import { IconCamera } from '@tabler/icons-react'
import { NodeToolbar, Position } from '@xyflow/react'
import imageViewControlsModule, {
  type ImageCameraControlConfig,
  type ImageLightingRigConfig,
} from '@tapcanvas/image-view-controls'

import * as THREE from 'three'
import {
  arcPointToAzimuth,
  arcPointToElevation,
  azimuthToArcPoint,
  elevationToArcPoint,
} from './imageView3dMath'
import { ManagedImage } from '../../../domain/resource-runtime'
import { toast } from '../../../ui/toast'
import { isRemoteUrl } from './utils'
import {
  DEFAULT_LIBTV_LIGHTING_CONTROL_STATE,
  LibTvLightingEditorToolbar,
  type LibTvLightingControlState,
} from './LibTvLightingEditorToolbar'

const {
  IMAGE_CAMERA_PRESETS,
  normalizeImageCameraControl,
  normalizeImageLightingRig,
} = imageViewControlsModule

type ViewEditorMode = 'camera' | 'lighting'
type ActiveLightSlot = 'main' | 'fill'

export type ImageViewEditorApplyPayload = {
  mode: ViewEditorMode
  cameraControl: ImageCameraControlConfig
  lightingRig: ImageLightingRigConfig
  smartPrompt: string
  lightingReferenceImageUrl: string | null
  lightingControlState: LibTvLightingControlState
}

type UseImageViewEditorOptions = {
  baseImageUrl: string
  cameraControl?: unknown
  lightingRig?: unknown
  hasImages: boolean
  isDarkUi: boolean
  inlineDividerColor: string
  lightingCreditCost?: number
  onUploadLightingReferenceImage: (file: File) => Promise<string>
  onApply: (payload: ImageViewEditorApplyPayload) => Promise<void>
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
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const ballDragRef = React.useRef<{ axis: 'azimuth' | 'elevation'; pointerId: number } | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)

  // Single-axis drag handles on the orbit guide ellipses (camera mode).
  const handleBallPointerDown = React.useCallback(
    (axis: 'azimuth' | 'elevation') => (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      ballDragRef.current = { axis, pointerId: event.pointerId }
      setIsDragging(true)
    },
    [],
  )

  const handleBallPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const ball = ballDragRef.current
      const stage = stageRef.current
      if (!ball || !stage || ball.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      const rect = stage.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const dxPct = ((event.clientX - rect.left) / rect.width) * 100 - 50
      const dyPct = ((event.clientY - rect.top) / rect.height) * 100 - 50
      if (ball.axis === 'azimuth') {
        const azimuthDeg = arcPointToAzimuth(dxPct, dyPct)
        input.onCameraControlChange((current) => ({ ...current, enabled: true, azimuthDeg }))
      } else {
        const elevationDeg = arcPointToElevation(dyPct)
        input.onCameraControlChange((current) => ({ ...current, enabled: true, elevationDeg }))
      }
    },
    [input],
  )

  const handleBallPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const ball = ballDragRef.current
    if (!ball || ball.pointerId !== event.pointerId) return
    ballDragRef.current = null
    setIsDragging(false)
  }, [])
  const activeLight = input.activeLightSlot === 'fill' ? input.lightingRig.fill : input.lightingRig.main
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
      ref={stageRef}
      className="tc-image-view-editor__lite-stage"
      style={{
        position: 'relative',
        aspectRatio: '1 / 1',
        overflow: 'hidden',
        background: input.isDarkUi
          ? 'radial-gradient(circle at 50% 18%, rgba(162,168,178,0.22), rgba(17,18,21,0.92) 58%, rgba(2,6,23,0.98) 100%)'
          : 'radial-gradient(circle at 50% 18%, rgba(212,215,220,0.96), rgba(244,247,251,0.94) 58%, rgba(212,215,220,0.88) 100%)',
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
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(17,18,21,0.12)'}`,
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
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(17,18,21,0.1)'}`,
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
            border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(17,18,21,0.1)'}`,
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
            border: `1px dashed ${input.isDarkUi ? 'rgba(255,255,255,0.14)' : 'rgba(17,18,21,0.14)'}`,
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
              : '0 24px 60px rgba(17,18,21,0.18)',
            ...buildCameraPreviewStyle(input.cameraControl),
          }}
        >
          <ManagedImage
            className="tc-image-view-editor__lite-image"
            crossOrigin="anonymous"
            src={input.baseImageUrl}
            alt="当前图片"
            priority="critical"
            ownerSurface="task-node-main-image"
            ownerRequestKey={`image-view-editor:${input.baseImageUrl}`}
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
          border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(17,18,21,0.08)'}`,
          background: input.isDarkUi ? 'rgba(17,18,21,0.66)' : 'rgba(255,255,255,0.82)',
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
          border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(17,18,21,0.08)'}`,
          background: input.isDarkUi ? 'rgba(17,18,21,0.66)' : 'rgba(255,255,255,0.82)',
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
        <>
          {(() => {
            const azPoint = azimuthToArcPoint(input.cameraControl.azimuthDeg)
            const elPoint = elevationToArcPoint(input.cameraControl.elevationDeg)
            const ballBase: React.CSSProperties = {
              position: 'absolute',
              width: 18,
              height: 18,
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              cursor: 'grab',
              touchAction: 'none',
            }
            return (
              <>
                <div
                  className="tc-image-view-editor__lite-handle tc-image-view-editor__lite-handle--azimuth"
                  title="拖动调整环绕角度"
                  style={{
                    ...ballBase,
                    left: `${azPoint.leftPct}%`,
                    top: `${azPoint.topPct}%`,
                    background: '#4dabf7',
                    boxShadow: '0 0 0 6px rgba(77,171,247,0.22)',
                  }}
                  onPointerDown={handleBallPointerDown('azimuth')}
                  onPointerMove={handleBallPointerMove}
                  onPointerUp={handleBallPointerUp}
                  onPointerCancel={handleBallPointerUp}
                />
                <div
                  className="tc-image-view-editor__lite-handle tc-image-view-editor__lite-handle--elevation"
                  title="拖动调整垂直角度"
                  style={{
                    ...ballBase,
                    left: `${elPoint.leftPct}%`,
                    top: `${elPoint.topPct}%`,
                    background: '#ffd43b',
                    boxShadow: '0 0 0 6px rgba(255,212,59,0.22)',
                  }}
                  onPointerDown={handleBallPointerDown('elevation')}
                  onPointerMove={handleBallPointerMove}
                  onPointerUp={handleBallPointerUp}
                  onPointerCancel={handleBallPointerUp}
                />
              </>
            )
          })()}
        </>
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
        border: `1px solid ${input.isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(17,18,21,0.08)'}`,
        background: input.isDarkUi ? 'rgba(17,18,21,0.72)' : 'rgba(255,255,255,0.82)',
        fontSize: 11,
      }}
    >
      <span style={{ fontWeight: 700 }}>{input.label}</span>
      <span style={{ opacity: 0.72 }}>{input.value}</span>
    </div>
  )
}

// ─── Lighting sphere preview (Three.js — glass bubble + real PointLight) ────
function LightingSpherePreview({ lightingRig, baseImageUrl, perspectiveMode, onLightingRigChange }: {
  lightingRig: ImageLightingRigConfig
  baseImageUrl: string
  perspectiveMode: 'perspective' | 'front'
  onLightingRigChange: React.Dispatch<React.SetStateAction<ImageLightingRigConfig>>
}): JSX.Element {
  const rendererHostRef = React.useRef<HTMLDivElement | null>(null)
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null)
  const camRef = React.useRef<THREE.PerspectiveCamera | null>(null)

  const rigRef = React.useRef(lightingRig)
  rigRef.current = lightingRig
  const onChangeRef = React.useRef(onLightingRigChange)
  onChangeRef.current = onLightingRigChange
  const perspModeRef = React.useRef(perspectiveMode)
  perspModeRef.current = perspectiveMode

  React.useEffect(() => {
    const host = rendererHostRef.current
    if (!host) return

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = false
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab'
    host.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(44, 1, 0.1, 10)
    cam.position.set(0, 0.28, 2.6)
    cam.lookAt(0, 0, 0)
    camRef.current = cam

    // Very low ambient + hemisphere — shadow side must stay dark
    scene.add(new THREE.AmbientLight(0xffffff, 0.06))
    scene.add(new THREE.HemisphereLight(0x777777, 0x191919, 0.10))

    // ── Glass bubble sphere: Fresnel rim + directional lit/shadow ─────────
    // keyLightDir = world-space unit vector FROM sphere center TO key light
    const fresnelMat = new THREE.ShaderMaterial({
      uniforms: {
        rimColor:        { value: new THREE.Color(0xd0d0d0) },
        rimPow:          { value: 2.2 },
        rimStr:          { value: 0.80 },
        keyLightDir:     { value: new THREE.Vector3(0, 0, 1) },
        keyLightColor:   { value: new THREE.Color(0xffffff) },
        keyLightBright:  { value: 0.5 },
        fillLightDir:    { value: new THREE.Vector3(0, 0, 1) },
        fillLightColor:  { value: new THREE.Color(0x7eb8f7) },
        fillLightBright: { value: 0.0 },
        fillEnabled:     { value: 0.0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vNormal      = normalize(normalMatrix * normal);
          vec4 mvp     = modelViewMatrix * vec4(position, 1.0);
          vViewDir     = normalize(-mvp.xyz);
          gl_Position  = projectionMatrix * mvp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3  rimColor;
        uniform float rimPow;
        uniform float rimStr;
        uniform vec3  keyLightDir;
        uniform vec3  keyLightColor;
        uniform float keyLightBright;
        uniform vec3  fillLightDir;
        uniform vec3  fillLightColor;
        uniform float fillLightBright;
        uniform float fillEnabled;

        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;

        void main() {
          vec3 N  = normalize(vNormal);
          vec3 Nw = normalize(vWorldNormal);
          vec3 V  = normalize(vViewDir);

          // Fresnel rim (glass bubble edge)
          float ndotv = abs(dot(N, V));
          float rim   = pow(1.0 - ndotv, rimPow) * rimStr;

          // Lambert diffuse from key light (world-space terminator)
          float kNdotL = max(0.0, dot(Nw, keyLightDir));
          // Shadow side: gentle falloff into dark
          float kDark   = max(0.0, -dot(Nw, keyLightDir));
          float ambient = 0.04;
          float keyContrib = kNdotL * keyLightBright;

          // Fill light contribution
          float fillContrib = max(0.0, dot(Nw, fillLightDir)) * fillLightBright * fillEnabled;

          // Total brightness on this fragment
          float brightness = ambient + keyContrib + fillContrib * 0.5;

          // Neutral charcoal body keeps the preview consistent with LibTV's material.
          vec3 shadowColor = vec3(0.055, 0.055, 0.055);
          vec3 keyTinted   = mix(rimColor, keyLightColor * 0.65, kNdotL * keyLightBright * 0.6);
          vec3 bodyColor   = mix(shadowColor, keyTinted, brightness);

          // Alpha: rim gives glass edge; body has base + lit side boost
          float bodyAlpha  = 0.05 + brightness * 0.09;
          float totalAlpha = clamp(rim + bodyAlpha, 0.0, 0.90);

          gl_FragColor = vec4(bodyColor, totalAlpha);
        }
      `,
      transparent: true,
      depthWrite:  false,
      side: THREE.FrontSide,
    })
    const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), fresnelMat)
    sphereMesh.renderOrder = -1
    scene.add(sphereMesh)

    // Inner BackSide shell — gives the frosted glass interior glow
    const innerSphereMat = new THREE.MeshBasicMaterial({
      color: 0xa0a0a0, transparent: true, opacity: 0.08,
      side: THREE.BackSide, depthWrite: false,
    })
    const innerSphere = new THREE.Mesh(new THREE.SphereGeometry(1.002, 32, 24), innerSphereMat)
    innerSphere.renderOrder = -2
    scene.add(innerSphere)

    // ── Full latitude/longitude grid ───────────────────────────────────────
    const lineCol = 0x858585
    const dotCol  = 0xaaaaaa
    const mkPts = (fn: (t: number) => THREE.Vector3, n = 80) => {
      const arr: THREE.Vector3[] = []
      for (let i = 0; i <= n; i++) arr.push(fn((i / n) * Math.PI * 2))
      return arr
    }
    const addOrbit = (pts: THREE.Vector3[], lineOpa: number, dotStep: number) => {
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: lineCol, transparent: true, opacity: lineOpa }),
      ))
      const dg = new THREE.SphereGeometry(0.012, 6, 4)
      const dm = new THREE.MeshBasicMaterial({ color: dotCol, transparent: true, opacity: lineOpa * 0.75 })
      for (let i = 0; i < pts.length - 1; i += dotStep) {
        const d = new THREE.Mesh(dg, dm); d.position.copy(pts[i]!); scene.add(d)
      }
    }
    // Equatorial circle (brighter)
    addOrbit(mkPts(t => new THREE.Vector3(Math.cos(t), 0, Math.sin(t))), 0.45, 7)
    // Latitude circles at ±30° and ±60°
    for (const elDeg of [-60, -30, 30, 60]) {
      const el = elDeg * Math.PI / 180
      const r = Math.cos(el), y = Math.sin(el)
      addOrbit(mkPts(t => new THREE.Vector3(r * Math.cos(t), y, r * Math.sin(t))), 0.26, 9)
    }
    // Three meridian circles
    addOrbit(mkPts(t => new THREE.Vector3(0, Math.sin(t), Math.cos(t))), 0.34, 7)       // yz
    addOrbit(mkPts(t => new THREE.Vector3(Math.cos(t), Math.sin(t), 0)), 0.28, 8)        // xz tilted
    addOrbit(mkPts(t => new THREE.Vector3(Math.sin(t) * 0.866, Math.cos(t), Math.sin(t) * 0.5)), 0.22, 9) // diagonal

    // ── Image card: thin box so edges catch directional light/shadow ─────
    const PLANE_W = 0.50, PLANE_H = 0.62, PLANE_D = 0.022
    const cardFrontMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.82, metalness: 0.0 })
    const cardEdgeMat  = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.92, metalness: 0.0 })
    // BoxGeometry face order: +x, -x, +y, -y, +z(front→camera), -z
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(PLANE_W, PLANE_H, PLANE_D),
      [cardEdgeMat, cardEdgeMat, cardEdgeMat, cardEdgeMat, cardFrontMat, cardEdgeMat],
    )
    scene.add(card)

    // ── Glow sprite texture (shared between main & fill) ──────────────────
    const gc = document.createElement('canvas'); gc.width = gc.height = 128
    const gx = gc.getContext('2d')!
    const gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gg.addColorStop(0,    'rgba(255,255,255,1)')
    gg.addColorStop(0.30, 'rgba(255,255,255,0.55)')
    gg.addColorStop(0.65, 'rgba(255,255,255,0.12)')
    gg.addColorStop(1,    'rgba(255,255,255,0)')
    gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128)
    const glowTex = new THREE.CanvasTexture(gc)

    const mkGlow = (col: number, sz: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: col, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      s.scale.setScalar(sz)
      return s
    }

    // SpotLight params — narrow cone → visible pool, directional shadow
    const SPOT_ANGLE    = Math.PI / 6   // 30° half-angle
    const SPOT_PENUMBRA = 0.55
    const SPOT_DECAY    = 1.8
    const SPOT_DIST     = 6

    // ── Main light dot + glow + SpotLight (aimed at card center) ──────────
    const mainDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x111111 }),
    )
    const mainGlow = mkGlow(0xffffff, 0.40)
    mainDot.add(mainGlow)
    scene.add(mainDot)

    const mainSpot = new THREE.SpotLight(0xffffff, 3.5, SPOT_DIST, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY)
    scene.add(mainSpot)
    scene.add(mainSpot.target) // target stays at (0,0,0) — card center

    // ── Fill light dot + glow + SpotLight ─────────────────────────────────
    const fillDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0x7eb8f7 }),
    )
    const fillGlow = mkGlow(0x7eb8f7, 0.30)
    fillDot.add(fillGlow)
    fillDot.visible = false
    scene.add(fillDot)

    const fillSpot = new THREE.SpotLight(0x7eb8f7, 1.5, SPOT_DIST, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY)
    fillSpot.visible = false
    scene.add(fillSpot)
    scene.add(fillSpot.target)

    // ── Cone factory: solid pyramid + edge lines ──────────────────────────
    // 4 triangular faces × 3 verts × 3 coords = 36 floats (no base, double-sided)
    const mkConeMesh = (col: number) => new THREE.Mesh(
      (() => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36), 3))
        return g
      })(),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    )
    // 4 edge lines × 2 pts × 3 coords = 24 floats
    const mkConeEdges = (col: number) => new THREE.LineSegments(
      (() => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3))
        return g
      })(),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 }),
    )

    const mainConeMesh  = mkConeMesh(0xffffff);  scene.add(mainConeMesh)
    const mainConeEdges = mkConeEdges(0xffffff); scene.add(mainConeEdges)
    const fillConeMesh  = mkConeMesh(0x7eb8f7);  fillConeMesh.visible = false;  scene.add(fillConeMesh)
    const fillConeEdges = mkConeEdges(0x7eb8f7); fillConeEdges.visible = false; scene.add(fillConeEdges)

    // ── Helpers ───────────────────────────────────────────────────────────
    const lPos = (az: number, el: number) => {
      const a = az * Math.PI / 180, e = el * Math.PI / 180
      return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
    }
    const hw = PLANE_W / 2, hh = PLANE_H / 2, hz = PLANE_D / 2
    const localCorners = [
      new THREE.Vector3(-hw, hh, hz), new THREE.Vector3(hw, hh, hz),
      new THREE.Vector3(hw, -hh, hz), new THREE.Vector3(-hw, -hh, hz),
    ]

    const applyCone = (
      cm: THREE.Mesh, ce: THREE.LineSegments,
      from: THREE.Vector3, wc: THREE.Vector3[], colorHex: string, intensity: number,
    ) => {
      // Pyramid faces: apex → two adjacent corners
      const mAttr = cm.geometry.getAttribute('position') as THREE.BufferAttribute
      const mArr  = mAttr.array as Float32Array
      for (let i = 0; i < 4; i++) {
        const c0 = wc[i]!, c1 = wc[(i + 1) % 4]!, b = i * 9
        mArr[b]=from.x; mArr[b+1]=from.y; mArr[b+2]=from.z
        mArr[b+3]=c0.x; mArr[b+4]=c0.y; mArr[b+5]=c0.z
        mArr[b+6]=c1.x; mArr[b+7]=c1.y; mArr[b+8]=c1.z
      }
      mAttr.needsUpdate = true
      const mm = cm.material as THREE.MeshBasicMaterial
      mm.color.set(colorHex)
      mm.opacity = 0.07 + (intensity / 100) * 0.22

      // Edge lines: apex → each corner
      const eAttr = ce.geometry.getAttribute('position') as THREE.BufferAttribute
      const eArr  = eAttr.array as Float32Array
      wc.forEach((c, i) => {
        eArr[i*6]=from.x; eArr[i*6+1]=from.y; eArr[i*6+2]=from.z
        eArr[i*6+3]=c.x;  eArr[i*6+4]=c.y;    eArr[i*6+5]=c.z
      })
      eAttr.needsUpdate = true
      ;(ce.material as THREE.LineBasicMaterial).color.set(colorHex)
    }

    // ── Render loop ───────────────────────────────────────────────────────
    let rafId = 0, disposed = false
    const loop = () => {
      if (disposed) return
      rafId = requestAnimationFrame(loop)
      const rig = rigRef.current
      const isPersp = perspModeRef.current === 'perspective'

      card.rotation.y = isPersp ? -0.26 : 0
      card.rotation.x = isPersp ? 0.08 : 0
      card.updateMatrixWorld()
      const wc = localCorners.map(v => card.localToWorld(v.clone()))

      // Main light (SpotLight aimed at card center)
      const mainPos = lPos(rig.main.azimuthDeg, rig.main.elevationDeg)
      mainDot.position.copy(mainPos)
      ;(mainDot.material as THREE.MeshBasicMaterial).color.set(rig.main.colorHex || '#ffffff')
      ;(mainGlow.material as THREE.SpriteMaterial).color.set(rig.main.colorHex || '#ffffff')
      mainSpot.position.copy(mainPos)
      mainSpot.color.set(rig.main.colorHex || '#ffffff')
      mainSpot.intensity = 0.5 + (rig.main.intensity / 100) * 4.5
      applyCone(mainConeMesh, mainConeEdges, mainPos, wc, rig.main.colorHex || '#ffffff', rig.main.intensity)

      // Fill light
      const hasFill = rig.fill.enabled
      fillDot.visible = hasFill; fillSpot.visible = hasFill
      fillConeMesh.visible = hasFill; fillConeEdges.visible = hasFill
      if (hasFill) {
        const fillPos = lPos(rig.fill.azimuthDeg, rig.fill.elevationDeg)
        fillDot.position.copy(fillPos)
        ;(fillDot.material as THREE.MeshBasicMaterial).color.set(rig.fill.colorHex || '#a8aeb8')
        ;(fillGlow.material as THREE.SpriteMaterial).color.set(rig.fill.colorHex || '#a8aeb8')
        fillSpot.position.copy(fillPos)
        fillSpot.color.set(rig.fill.colorHex || '#a8aeb8')
        fillSpot.intensity = 0.2 + (rig.fill.intensity / 100) * 2.2
        applyCone(fillConeMesh, fillConeEdges, fillPos, wc, rig.fill.colorHex || '#a8aeb8', rig.fill.intensity)
      }

      // Sync Fresnel sphere uniforms so lit/shadow sides follow light positions
      const mainDir = lPos(rig.main.azimuthDeg, rig.main.elevationDeg).normalize()
      fresnelMat.uniforms.keyLightDir.value.copy(mainDir)
      fresnelMat.uniforms.keyLightColor.value.set(rig.main.colorHex || '#ffffff')
      fresnelMat.uniforms.keyLightBright.value = 0.15 + (rig.main.intensity / 100) * 0.85
      fresnelMat.uniforms.fillEnabled.value = hasFill ? 1.0 : 0.0
      if (hasFill) {
        const fillDir = lPos(rig.fill.azimuthDeg, rig.fill.elevationDeg).normalize()
        fresnelMat.uniforms.fillLightDir.value.copy(fillDir)
        fresnelMat.uniforms.fillLightColor.value.set(rig.fill.colorHex || '#a8aeb8')
        fresnelMat.uniforms.fillLightBright.value = (rig.fill.intensity / 100) * 0.5
      }

      renderer.render(scene, cam)
    }
    loop()

    // ── Drag ──────────────────────────────────────────────────────────────
    let dragging = false, dragSlot: ActiveLightSlot = 'main', lastX = 0, lastY = 0
    const toScreen = (pos: THREE.Vector3) => {
      const ndc = pos.clone().project(cam)
      return { x: (ndc.x + 1) / 2 * host.clientWidth, y: (1 - ndc.y) / 2 * host.clientHeight }
    }
    const onPointerDown = (e: PointerEvent) => {
      e.stopPropagation()
      host.setPointerCapture(e.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
      dragging = true; lastX = e.clientX; lastY = e.clientY
      const rig = rigRef.current; dragSlot = 'main'
      if (rig.fill.enabled) {
        const rect = host.getBoundingClientRect()
        const px = e.clientX - rect.left, py = e.clientY - rect.top
        const ms = toScreen(lPos(rig.main.azimuthDeg, rig.main.elevationDeg))
        const fs = toScreen(lPos(rig.fill.azimuthDeg, rig.fill.elevationDeg))
        if (Math.hypot(px - fs.x, py - fs.y) < Math.hypot(px - ms.x, py - ms.y)) dragSlot = 'fill'
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      e.stopPropagation()
      const dx = e.clientX - lastX, dy = e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      onChangeRef.current(cur => updateLightSlot(cur, dragSlot, {
        enabled: true,
        azimuthDeg: ((cur[dragSlot].azimuthDeg + dx * 0.55) + 360) % 360,
        elevationDeg: Math.max(-80, Math.min(80, cur[dragSlot].elevationDeg - dy * 0.28)),
      }))
    }
    const onPointerUp = (e: PointerEvent) => {
      e.stopPropagation(); dragging = false
      renderer.domElement.style.cursor = 'grab'
    }
    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', onPointerUp)
    host.addEventListener('pointercancel', onPointerUp)

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix()
    })
    ro.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId); ro.disconnect()
      host.removeEventListener('pointerdown', onPointerDown)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', onPointerUp)
      host.removeEventListener('pointercancel', onPointerUp)
      glowTex.dispose(); renderer.dispose()
      host.replaceChildren()
      rendererRef.current = null; camRef.current = null
    }
  }, [])

  return (
    <div className="tc-lighting-toolbar__sphere nodrag nopan">
      <div ref={rendererHostRef} className="tc-lighting-toolbar__sphere-canvas" />
      <div
        className="tc-lighting-toolbar__source-plane"
        style={{
          transform: perspectiveMode === 'perspective'
            ? 'translate(-50%, -50%) perspective(260px) rotateX(5deg) rotateY(-15deg)'
            : 'translate(-50%, -50%)',
        }}
      >
        <ManagedImage
          className="tc-lighting-toolbar__source-image"
          src={baseImageUrl}
          alt="打光原图预览"
          priority="critical"
          ownerSurface="task-node-upstream-reference"
        />
      </div>
    </div>
  )
}

export function useImageViewEditor(options: UseImageViewEditorOptions & { nodeId?: string }) {
  const [mode, setMode] = React.useState<ViewEditorMode | null>(null)
  const [activeLightSlot, setActiveLightSlot] = React.useState<ActiveLightSlot>('main')
  const [cameraControl, setCameraControl] = React.useState<ImageCameraControlConfig>(() =>
    normalizeImageCameraControl(options.cameraControl),
  )
  const [lightingRig, setLightingRig] = React.useState<ImageLightingRigConfig>(() =>
    normalizeImageLightingRig(options.lightingRig),
  )
  const [smartPrompt, setSmartPrompt] = React.useState<string>('')
  const [lightingReferenceImageUrl, setLightingReferenceImageUrl] = React.useState<string | null>(null)
  const [lightingControlState, setLightingControlState] = React.useState<LibTvLightingControlState>(() => ({
    ...DEFAULT_LIBTV_LIGHTING_CONTROL_STATE,
    smartMode: typeof window !== 'undefined' && window.localStorage.getItem('light-editor-smart-mode') === '1',
  }))
  const [lightingReferenceUploading, setLightingReferenceUploading] = React.useState(false)
  const [applyLoading, setApplyLoading] = React.useState(false)

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
    if (nextMode === 'lighting') {
      setSmartPrompt('')
      setLightingReferenceImageUrl(null)
      setLightingReferenceUploading(false)
      setLightingControlState((current) => ({
        ...DEFAULT_LIBTV_LIGHTING_CONTROL_STATE,
        smartMode: current.smartMode,
      }))
    }
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

  const handleSelectLightingReferenceImage = React.useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast('打光参考图必须是图片文件', 'error')
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      toast('打光参考图不能超过 30MB', 'error')
      return
    }
    setLightingReferenceUploading(true)
    void options.onUploadLightingReferenceImage(file)
      .then((url) => {
        const normalizedUrl = url.trim()
        if (!isRemoteUrl(normalizedUrl)) {
          throw new Error('打光参考图上传结果缺少可用 URL')
        }
        setLightingReferenceImageUrl(normalizedUrl)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '打光参考图上传失败'
        toast(message, 'error')
      })
      .finally(() => setLightingReferenceUploading(false))
  }, [options.onUploadLightingReferenceImage])

  const handleRemoveLightingReferenceImage = React.useCallback(() => {
    setLightingReferenceImageUrl(null)
  }, [])

  const handleApply = React.useCallback(async () => {
    if (!mode || applyLoading) return
    setApplyLoading(true)
    try {
      await options.onApply({
        mode,
        cameraControl,
        lightingRig,
        smartPrompt: smartPrompt.trim(),
        lightingReferenceImageUrl,
        lightingControlState,
      })
      setMode(null)
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '图片编辑生成失败', 'error')
    } finally {
      setApplyLoading(false)
    }
  }, [applyLoading, cameraControl, lightingControlState, lightingReferenceImageUrl, lightingRig, mode, options, smartPrompt])

  const modal = mode === 'camera' ? (
    <Modal
      className="tc-image-view-editor"
      opened
      onClose={closeEditor}
      centered
      size="xl"
      title="调整角度"
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
            background: options.isDarkUi ? 'rgba(255,255,255,0.02)' : 'rgba(17,18,21,0.02)',
            borderColor: options.inlineDividerColor,
            overflow: 'hidden',
          }}
        >
          <ImageViewPreviewLite
            mode="camera"
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
                <NumberInput
                  className="tc-image-view-editor__slider-input"
                  size="xs"
                  w={92}
                  hideControls={false}
                  min={0}
                  max={360}
                  step={5}
                  suffix="°"
                  clampBehavior="strict"
                  value={Math.round(cameraControl.azimuthDeg)}
                  onChange={(value) => {
                    if (typeof value !== 'number' || !Number.isFinite(value)) return
                    setCameraControl((current) => ({
                      ...current,
                      enabled: true,
                      azimuthDeg: ((value % 360) + 360) % 360,
                    }))
                  }}
                />
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
                <NumberInput
                  className="tc-image-view-editor__slider-input"
                  size="xs"
                  w={92}
                  hideControls={false}
                  min={-45}
                  max={45}
                  step={1}
                  suffix="°"
                  clampBehavior="strict"
                  value={Math.round(cameraControl.elevationDeg)}
                  onChange={(value) => {
                    if (typeof value !== 'number' || !Number.isFinite(value)) return
                    setCameraControl((current) => ({
                      ...current,
                      enabled: true,
                      elevationDeg: Math.max(-45, Math.min(45, value)),
                    }))
                  }}
                />
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
                <NumberInput
                  className="tc-image-view-editor__slider-input"
                  size="xs"
                  w={92}
                  hideControls={false}
                  min={0.7}
                  max={3.8}
                  step={0.05}
                  decimalScale={2}
                  clampBehavior="strict"
                  value={Number(cameraControl.distance.toFixed(2))}
                  onChange={(value) => {
                    if (typeof value !== 'number' || !Number.isFinite(value)) return
                    setCameraControl((current) => ({
                      ...current,
                      enabled: true,
                      distance: Math.max(0.7, Math.min(3.8, value)),
                    }))
                  }}
                />
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

            <Group className="tc-image-view-editor__actions" justify="flex-end" gap="xs">
              <Button
                className="tc-image-view-editor__cancel"
                variant="subtle"
                disabled={applyLoading}
                onClick={closeEditor}
              >
                取消
              </Button>
              <Button
                className="tc-image-view-editor__apply"
                loading={applyLoading}
                onClick={() => { void handleApply() }}
              >
                应用
              </Button>
            </Group>
          </Stack>
        </Paper>
      </div>
    </Modal>
  ) : null

  const lightingToolbar = (
    <LibTvLightingEditorToolbar
      isOpen={mode === 'lighting'}
      lightingRig={lightingRig}
      controlState={lightingControlState}
      smartPrompt={smartPrompt}
      lightingReferenceImageUrl={lightingReferenceImageUrl}
      lightingReferenceUploading={lightingReferenceUploading}
      applying={applyLoading}
      creditCost={options.lightingCreditCost}
      preview={(previewMode) => (
        <LightingSpherePreview
          lightingRig={lightingRig}
          baseImageUrl={options.baseImageUrl}
          perspectiveMode={previewMode}
          onLightingRigChange={setLightingRig}
        />
      )}
      onLightingRigChange={setLightingRig}
      onControlStateChange={setLightingControlState}
      onSmartPromptChange={setSmartPrompt}
      onSelectLightingReferenceImage={handleSelectLightingReferenceImage}
      onRemoveLightingReferenceImage={handleRemoveLightingReferenceImage}
      onLightingReferenceImageUrlChange={setLightingReferenceImageUrl}
      onReset={() => {
        setLightingRig(normalizeImageLightingRig(options.lightingRig))
        setSmartPrompt('')
        setLightingReferenceImageUrl(null)
        setLightingControlState((current) => ({ ...DEFAULT_LIBTV_LIGHTING_CONTROL_STATE, smartMode: current.smartMode }))
      }}
      onClose={closeEditor}
      onApply={handleApply}
    />
  )

  return {
    openCameraEditor,
    openLightingEditor,
    closeEditor,
    modal,
    lightingToolbar,
    isEditorOpen: mode !== null,
  }
}
