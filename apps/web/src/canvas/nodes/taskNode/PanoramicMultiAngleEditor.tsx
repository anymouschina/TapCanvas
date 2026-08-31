import React from 'react'
import * as THREE from 'three'
import { Slider } from '@mantine/core'
import { IconArrowUp, IconLoader2, IconRefresh, IconX } from '@tabler/icons-react'
import { NodeToolbar, Position, useViewport } from '@xyflow/react'
import { ManagedImage } from '../../../domain/resource-runtime'
import type { PanoramicCameraState, PanoramicViewerHandle } from './PanoramicViewer'
import { resolveMultiAnglePresetPrompt } from './imageViewEditorContract'
import { resolveLibTvEditorScale } from './libTvEditorDisplay'
import './LibTvImageEditorSurface.css'

// ─── Preset definitions ────────────────────────────────────────────────────

type AnglePreset = {
  key: string
  label: string
  azimuthDeg: number
  elevationDeg: number
  fovDeg: number
}

const ANGLE_PRESETS: AnglePreset[] = [
  { key: 'custom',    label: '自定义',   azimuthDeg: 0,   elevationDeg: 0,   fovDeg: 75 },
  { key: 'fisheye',   label: '鱼眼视角', azimuthDeg: 0,   elevationDeg: 0,   fovDeg: 110 },
  { key: 'tilt',      label: '倾斜视角', azimuthDeg: 30,  elevationDeg: 25,  fovDeg: 75 },
  { key: 'topdown',   label: '正面俯拍', azimuthDeg: 0,   elevationDeg: 45,  fovDeg: 75 },
  { key: 'lookup',    label: '正面仰拍', azimuthDeg: 0,   elevationDeg: -35, fovDeg: 75 },
  { key: 'pandown',   label: '全景俯拍', azimuthDeg: 0,   elevationDeg: 75,  fovDeg: 90 },
  { key: 'back',      label: '背面视角', azimuthDeg: 180, elevationDeg: 0,   fovDeg: 75 },
]

export const FOUR_VIEW_ANGLES: Array<{ label: string } & PanoramicCameraState> = [
  { label: '前方',  azimuthDeg: 0,   elevationDeg: 0, fovDeg: 75 },
  { label: '后方',  azimuthDeg: 180, elevationDeg: 0, fovDeg: 75 },
  { label: '左侧',  azimuthDeg: 270, elevationDeg: 0, fovDeg: 75 },
  { label: '右侧',  azimuthDeg: 90,  elevationDeg: 0, fovDeg: 75 },
]

export const TWELVE_VIEW_ANGLES: Array<{ label: string } & PanoramicCameraState> = [
  { label: '正前方',   azimuthDeg: 0,   elevationDeg: 0,   fovDeg: 75 },
  { label: '右前方',   azimuthDeg: 60,  elevationDeg: 0,   fovDeg: 75 },
  { label: '右后方',   azimuthDeg: 120, elevationDeg: 0,   fovDeg: 75 },
  { label: '正后方',   azimuthDeg: 180, elevationDeg: 0,   fovDeg: 75 },
  { label: '左后方',   azimuthDeg: 240, elevationDeg: 0,   fovDeg: 75 },
  { label: '左前方',   azimuthDeg: 300, elevationDeg: 0,   fovDeg: 75 },
  { label: '仰视前',   azimuthDeg: 0,   elevationDeg: 40,  fovDeg: 75 },
  { label: '仰视右',   azimuthDeg: 90,  elevationDeg: 40,  fovDeg: 75 },
  { label: '仰视后',   azimuthDeg: 180, elevationDeg: 40,  fovDeg: 75 },
  { label: '仰视左',   azimuthDeg: 270, elevationDeg: 40,  fovDeg: 75 },
  { label: '正上方',   azimuthDeg: 0,   elevationDeg: 82,  fovDeg: 90 },
  { label: '正下方',   azimuthDeg: 0,   elevationDeg: -82, fovDeg: 90 },
]

// LibTV 的第三个参数不是镜头 FOV 枚举，而是 0 / 5 / 10 三档 zoom。
// TapCanvas 的 3D 预览仍使用 FOV，因而只在显示层做无损映射；提交层使用 zoom。
export function multiAngleFovToZoom(fovDeg: number): 0 | 5 | 10 {
  if (fovDeg >= 92) return 0
  if (fovDeg <= 52) return 10
  return 5
}

export function multiAngleZoomToFov(zoom: number): number {
  if (zoom <= 0) return 110
  if (zoom >= 10) return 35
  return 75
}

export function multiAngleZoomLabel(zoom: number): string {
  if (zoom <= 3) return '全景'
  if (zoom <= 6) return '中景'
  return '特写'
}

// ─── Sphere line geometry (clean meridians + parallels, no triangle fills) ──

function createSphereLines(radius: number, numMeridians: number, numParallels: number): THREE.BufferGeometry {
  const N = 64
  const points: THREE.Vector3[] = []

  for (let p = 1; p < numParallels; p++) {
    const phi = (Math.PI * p) / numParallels
    const y = radius * Math.cos(phi)
    const r = radius * Math.sin(phi)
    for (let i = 0; i < N; i++) {
      const t1 = (2 * Math.PI * i) / N
      const t2 = (2 * Math.PI * (i + 1)) / N
      points.push(
        new THREE.Vector3(r * Math.sin(t1), y, r * Math.cos(t1)),
        new THREE.Vector3(r * Math.sin(t2), y, r * Math.cos(t2)),
      )
    }
  }

  for (let m = 0; m < numMeridians; m++) {
    const theta = (2 * Math.PI * m) / numMeridians
    for (let i = 0; i < N; i++) {
      const phi1 = (Math.PI * i) / N
      const phi2 = (Math.PI * (i + 1)) / N
      points.push(
        new THREE.Vector3(
          radius * Math.sin(phi1) * Math.sin(theta),
          radius * Math.cos(phi1),
          radius * Math.sin(phi1) * Math.cos(theta),
        ),
        new THREE.Vector3(
          radius * Math.sin(phi2) * Math.sin(theta),
          radius * Math.cos(phi2),
          radius * Math.sin(phi2) * Math.cos(theta),
        ),
      )
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setFromPoints(points)
  return geo
}

// ─── 3D Sphere Control ────────────────────────────────────────────────────────

type SphereControlProps = {
  azimuthDeg: number
  elevationDeg: number
  imageUrl: string | null
  onCameraChange: (az: number, el: number) => void
}

function SphereControl({ azimuthDeg, elevationDeg, imageUrl, onCameraChange }: SphereControlProps) {
  const rendererHostRef = React.useRef<HTMLDivElement | null>(null)
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = React.useRef<THREE.Scene | null>(null)
  const mainCamRef = React.useRef<THREE.PerspectiveCamera | null>(null)
  const markerRef = React.useRef<THREE.Group | null>(null)
  const onChangeRef = React.useRef(onCameraChange)
  onChangeRef.current = onCameraChange
  // Track current angle in a ref so pointer-drag handler always has latest value
  const currentAngleRef = React.useRef({ azimuthDeg, elevationDeg })
  currentAngleRef.current = { azimuthDeg, elevationDeg }
  const dragRef = React.useRef<{ x: number; y: number } | null>(null)

  React.useEffect(() => {
    const host = rendererHostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'
    host.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Clean sphere wireframe — only meridians and parallels
    const R = 2.2
    const sphereLineGeo = createSphereLines(R, 10, 9)
    const sphereLineMat = new THREE.LineBasicMaterial({ color: 0xb0b0b0, transparent: true, opacity: 0.46 })
    const sphereLines = new THREE.LineSegments(sphereLineGeo, sphereLineMat)
    scene.add(sphereLines)

    // Camera marker on sphere surface
    const markerGroup = new THREE.Group()
    const bodyGeo = new THREE.BoxGeometry(0.30, 0.20, 0.14)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd7d7d7, roughness: 0.55, metalness: 0.2 })
    markerGroup.add(new THREE.Mesh(bodyGeo, bodyMat))
    const lensGeo = new THREE.CylinderGeometry(0.065, 0.085, 0.09, 16)
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x1a202c, roughness: 0.2, metalness: 0.8 })
    const lens = new THREE.Mesh(lensGeo, lensMat)
    lens.rotation.x = Math.PI / 2
    lens.position.z = -0.11
    markerGroup.add(lens)
    const ringGeo = new THREE.TorusGeometry(0.07, 0.011, 8, 24)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x727272, metalness: 0.72, roughness: 0.22 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.z = -0.148
    markerGroup.add(ring)
    scene.add(markerGroup)
    markerRef.current = markerGroup

    scene.add(new THREE.AmbientLight(0xffffff, 1.2))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1)
    dirLight.position.set(3, 5, 4)
    scene.add(dirLight)

    // Fixed observation camera — never orbits, drag moves the marker instead
    const cam = new THREE.PerspectiveCamera(46, 1, 0.1, 20)
    cam.position.set(0, 0.6, 5.5)
    cam.lookAt(0, 0, 0)
    mainCamRef.current = cam

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
    })
    ro.observe(host)

    let rafId = 0
    let disposed = false
    const loop = () => {
      if (disposed) return
      rafId = requestAnimationFrame(loop)
      renderer.render(scene, cam)
    }
    loop()

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      ro.disconnect()
      renderer.dispose()
      sphereLineGeo.dispose()
      sphereLineMat.dispose()
      bodyGeo.dispose()
      bodyMat.dispose()
      lensGeo.dispose()
      lensMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      host.replaceChildren()
      rendererRef.current = null
      sceneRef.current = null
      mainCamRef.current = null
      markerRef.current = null
    }
  }, [])

  // Update camera marker position
  React.useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    const az = THREE.MathUtils.degToRad(azimuthDeg)
    const el = THREE.MathUtils.degToRad(elevationDeg)
    const R = 2.2
    const x = R * Math.cos(el) * Math.sin(az)
    const y = R * Math.sin(el)
    const z = R * Math.cos(el) * Math.cos(az)
    marker.position.set(x, y, z)
    marker.lookAt(0, 0, 0)
    marker.rotateY(Math.PI)
  }, [azimuthDeg, elevationDeg])

  return (
    <div
      className="tc-panoramic-editor__sphere nodrag nopan"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        const dx = e.clientX - dragRef.current.x
        const dy = e.clientY - dragRef.current.y
        dragRef.current = { x: e.clientX, y: e.clientY }
        const { azimuthDeg: az, elevationDeg: el } = currentAngleRef.current
        const newAz = ((az + dx * 0.6) + 360) % 360
        const newEl = Math.max(-85, Math.min(85, el - dy * 0.5))
        onChangeRef.current(newAz, newEl)
      }}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
    >
      <div ref={rendererHostRef} className="tc-panoramic-editor__sphere-canvas" />
      {imageUrl ? (
        <div
          className="tc-panoramic-editor__source-plane"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <ManagedImage
            className="tc-panoramic-editor__source-plane-image"
            src={imageUrl}
            alt="多角度原图预览"
            priority="critical"
            ownerSurface="task-node-upstream-reference"
          />
        </div>
      ) : null}
    </div>
  )
}

// ─── Main Editor Component ────────────────────────────────────────────────────

type PanoramicMultiAngleEditorProps = {
  isOpen: boolean
  imageUrl: string | null
  camera: PanoramicCameraState
  viewerRef?: React.RefObject<PanoramicViewerHandle> | null
  prompt: string
  onCameraChange: (camera: PanoramicCameraState) => void
  onPromptChange: (prompt: string) => void
  onCapture: (
    captures: Array<{ label: string; dataUrl: string }>,
    options: { promptEnabled: boolean },
  ) => void
  onClose: () => void
  loading?: boolean
  creditCost?: number
}

export function PanoramicMultiAngleEditor({
  isOpen,
  imageUrl,
  camera,
  viewerRef,
  prompt,
  onCameraChange,
  onPromptChange,
  onCapture,
  onClose,
  loading = false,
  creditCost,
}: PanoramicMultiAngleEditorProps) {
  const { zoom } = useViewport()
  const displayScale = resolveLibTvEditorScale(zoom)
  const [activePreset, setActivePreset] = React.useState<string>('custom')
  const [promptEnabled, setPromptEnabled] = React.useState(Boolean(prompt.trim()))
  const promptInputId = React.useId()

  const handlePreset = (preset: AnglePreset) => {
    setActivePreset(preset.key)
    onPromptChange(resolveMultiAnglePresetPrompt(preset.key, prompt))
    if (preset.key !== 'custom') {
      onCameraChange({ azimuthDeg: preset.azimuthDeg, elevationDeg: preset.elevationDeg, fovDeg: preset.fovDeg })
    }
  }

  const handleAzimuthChange = (val: number) => {
    setActivePreset('custom')
    onCameraChange({ ...camera, azimuthDeg: val })
  }
  const handleElevationChange = (val: number) => {
    setActivePreset('custom')
    onCameraChange({ ...camera, elevationDeg: val })
  }
  const handleFovSliderChange = (val: number) => {
    setActivePreset('custom')
    onCameraChange({ ...camera, fovDeg: multiAngleZoomToFov(val) })
  }

  const handleReset = () => {
    setActivePreset('custom')
    setPromptEnabled(false)
    onCameraChange({ azimuthDeg: 0, elevationDeg: 0, fovDeg: 75 })
    onPromptChange('')
  }

  const handleCapture = () => {
    const viewer = viewerRef?.current
    if (viewer) {
      const dataUrl = viewer.captureAtAngle(camera.azimuthDeg, camera.elevationDeg, camera.fovDeg, 1280, 720)
      if (dataUrl) {
        onCapture([{ label: `全景截图-${Math.round(camera.azimuthDeg)}°`, dataUrl }], { promptEnabled })
      }
    } else {
      onCapture([], { promptEnabled })
    }
  }

  const navStep = (dAz: number, dEl: number) => {
    const az = ((camera.azimuthDeg + dAz) + 360) % 360
    const el = Math.max(-90, Math.min(90, camera.elevationDeg + dEl))
    setActivePreset('custom')
    onCameraChange({ ...camera, azimuthDeg: az, elevationDeg: el })
  }

  const STEP = 15

  return (
    <NodeToolbar
      className="tc-panoramic-editor nodrag nopan"
      position={Position.Bottom}
      align="center"
      isVisible={isOpen}
      offset={8}
    >
      <section
        aria-label="多角度编辑器"
        className="tc-libtv-editor-scale tc-libtv-editor-surface tc-panoramic-editor__surface"
        style={{ transform: `scale(${displayScale})` }}
      >
        <header className="tc-libtv-editor-header">
          <h2 className="tc-libtv-editor-title">多角度编辑器</h2>
          <button type="button" className="tc-libtv-icon-button" aria-label="关闭多角度编辑器" onClick={onClose}>
            <IconX size={20} />
          </button>
        </header>

        <div className="tc-panoramic-editor__presets" role="group" aria-label="视角预设">
          {ANGLE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.key}
              className="tc-libtv-chip tc-panoramic-editor__preset"
              aria-pressed={activePreset === preset.key}
              onClick={() => handlePreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="tc-panoramic-editor__body">
          <div className="tc-panoramic-editor__sphere-wrap">
            <div className="tc-panoramic-editor__sphere-inset">
              <SphereControl
                azimuthDeg={camera.azimuthDeg}
                elevationDeg={camera.elevationDeg}
                imageUrl={imageUrl}
                onCameraChange={(az, el) => {
                  setActivePreset('custom')
                  onCameraChange({ ...camera, azimuthDeg: az, elevationDeg: el })
                }}
              />
            </div>
            <NavArrow label="向上调整视角" glyph="⌃" style={{ top: 0, left: '50%', transform: 'translateX(-50%)' }} onClick={() => navStep(0, STEP)} />
            <NavArrow label="向下调整视角" glyph="⌄" style={{ bottom: 0, left: '50%', transform: 'translateX(-50%)' }} onClick={() => navStep(0, -STEP)} />
            <NavArrow label="向左环绕视角" glyph="‹" style={{ top: '50%', left: 0, transform: 'translateY(-50%)' }} onClick={() => navStep(-STEP, 0)} />
            <NavArrow label="向右环绕视角" glyph="›" style={{ top: '50%', right: 0, transform: 'translateY(-50%)' }} onClick={() => navStep(STEP, 0)} />
          </div>

          <div className="tc-panoramic-editor__sliders">
            <SliderRow
              label="水平环绕"
              value={camera.azimuthDeg}
              min={0}
              max={345}
              step={15}
              displayValue={`${Math.round(camera.azimuthDeg)}°`}
              onChange={handleAzimuthChange}
            />
            <SliderRow
              label="垂直俯仰"
              value={camera.elevationDeg}
              min={-90}
              max={90}
              step={15}
              displayValue={`${Math.round(camera.elevationDeg)}°`}
              onChange={handleElevationChange}
            />
            <SliderRow
              label="景别缩放"
              value={multiAngleFovToZoom(camera.fovDeg)}
              min={0}
              max={10}
              step={5}
              displayValue={multiAngleZoomLabel(multiAngleFovToZoom(camera.fovDeg))}
              onChange={handleFovSliderChange}
            />
          </div>
        </div>

        <div
          className="tc-panoramic-editor__prompt"
        >
          <label
            className="tc-panoramic-editor__prompt-label"
            htmlFor={promptInputId}
          >
            提示词
          </label>
          {promptEnabled ? (
            <input
              id={promptInputId}
              className="tc-panoramic-editor__prompt-input nodrag nopan"
              value={prompt}
              placeholder="输入提示词..."
              onChange={(event) => onPromptChange(event.currentTarget.value)}
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : <span />}
          <button
            type="button"
            role="switch"
            aria-checked={promptEnabled}
            aria-label="启用提示词"
            onClick={() => setPromptEnabled((enabled) => !enabled)}
            className="tc-libtv-switch"
          />
        </div>

        <footer className="tc-libtv-editor-footer tc-panoramic-editor__footer">
          <button
            type="button"
            className="tc-libtv-reset-button"
            onClick={handleReset}
            disabled={loading}
          >
            <IconRefresh size={15} />
            重置参数
          </button>

          <span style={{ flex: 1 }} />
          {creditCost != null && creditCost > 0 ? (
            <span className="tc-libtv-credit" style={{ marginRight: 10 }}>
              <span aria-hidden="true">⚡</span>
              {creditCost}
            </span>
          ) : null}
          <button
            onClick={handleCapture}
            disabled={loading}
            aria-label={loading ? '多角度生成中' : '生成多角度图片'}
            className="tc-libtv-action-button"
          >
            {loading
              ? <IconLoader2 className="tc-portrait-select__spinner" size={16} color="var(--mantine-color-dark-9)" />
              : <IconArrowUp size={18} color="var(--mantine-color-dark-9)" />}
          </button>
        </footer>
      </section>
    </NodeToolbar>
  )
}

// ─── Helper sub-components ───────────────────────────────────────────────────

function NavArrow({ label, glyph, style, onClick }: { label: string; glyph: string; style: React.CSSProperties; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="tc-panoramic-editor__nav"
      onClick={onClick}
      style={style}
    >
      {glyph}
    </button>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (val: number) => void
}) {
  return (
    <div className="tc-panoramic-editor__slider-row">
      <span className="tc-panoramic-editor__slider-label">{label}</span>
      <div>
        <Slider
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={onChange}
          size="xs"
          color="gray"
        />
      </div>
      <span className="tc-panoramic-editor__slider-value">{displayValue}</span>
    </div>
  )
}
