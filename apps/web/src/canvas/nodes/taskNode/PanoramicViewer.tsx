import React from 'react'
import * as THREE from 'three'
import { fetchProxiedImageBlob } from '../../../api/server'

export type PanoramicCameraState = {
  azimuthDeg: number    // 0-360, horizontal
  elevationDeg: number  // -85 to +85, vertical
  fovDeg: number        // 30-120
}

export const PANORAMIC_DEFAULT_CAMERA: PanoramicCameraState = {
  azimuthDeg: 0,
  elevationDeg: 0,
  fovDeg: 75,
}

export type PanoramicViewerHandle = {
  captureAtAngle: (
    azimuthDeg: number,
    elevationDeg: number,
    fovDeg: number,
    outputWidth: number,
    outputHeight: number,
  ) => string | null
}

type PanoramicViewerProps = {
  imageUrl: string | null
  camera: PanoramicCameraState
  showGrid: boolean
  onCameraChange: (camera: PanoramicCameraState) => void
}

function computeLookAt(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg)
  const el = THREE.MathUtils.degToRad(elevationDeg)
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az) * 500,
    Math.sin(el) * 500,
    Math.cos(el) * Math.cos(az) * 500,
  )
}

function PanoramicAxesIndicator({ azimuthDeg, elevationDeg }: { azimuthDeg: number; elevationDeg: number }) {
  const az = THREE.MathUtils.degToRad(azimuthDeg)
  const el = THREE.MathUtils.degToRad(elevationDeg)
  const sz = 22
  const cx = 32, cy = 32

  // forward = look direction
  const fx = Math.cos(el) * Math.sin(az)
  const fy = Math.sin(el)
  const fz = Math.cos(el) * Math.cos(az)

  // right = cross(forward, worldUp)
  const rx = fz, ry = 0, rz = -fx
  const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1

  // screen X axis = right projected
  const sx = (rx / rLen) * sz
  const sy = -(ry / rLen) * sz

  // screen Y axis = up projected (approximate: world Y minus forward component)
  const ux = -fx * fy
  const uy = 1 - fy * fy
  const uz = -fz * fy
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
  const ux2 = (ux / uLen) * sz
  const uy2 = -(uy / uLen) * sz

  // Z = negative forward (pointing toward viewer)
  const zsx = -fx * sz
  const zsy = fy * sz

  return (
    <svg width="64" height="64" viewBox="0 0 64 64" style={{ display: 'block' }}>
      <line x1={cx} y1={cy} x2={cx + sx} y2={cy + sy} stroke="#f55" strokeWidth="2" strokeLinecap="round" />
      <text x={cx + sx + 2} y={cy + sy + 4} fill="#f55" fontSize="8" fontFamily="monospace">X</text>
      <line x1={cx} y1={cy} x2={cx + ux2} y2={cy + uy2} stroke="#5f5" strokeWidth="2" strokeLinecap="round" />
      <text x={cx + ux2 - 2} y={cy + uy2 - 2} fill="#5f5" fontSize="8" fontFamily="monospace">Y</text>
      <line x1={cx} y1={cy} x2={cx + zsx * 0.7} y2={cy + zsy * 0.7} stroke="#55f" strokeWidth="2" strokeLinecap="round" />
      <text x={cx + zsx * 0.7 + 2} y={cy + zsy * 0.7 + 4} fill="#55f" fontSize="8" fontFamily="monospace">Z</text>
    </svg>
  )
}

export const PanoramicViewer = React.forwardRef<PanoramicViewerHandle, PanoramicViewerProps>(
  ({ imageUrl, camera, showGrid, onCameraChange }, ref) => {
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null)
    const sceneRef = React.useRef<THREE.Scene | null>(null)
    const camRef = React.useRef<THREE.PerspectiveCamera | null>(null)
    const sphereRef = React.useRef<THREE.Mesh | null>(null)
    const textureRef = React.useRef<THREE.Texture | null>(null)
    const objUrlRef = React.useRef<string | null>(null)
    const stateRef = React.useRef<PanoramicCameraState>(camera)
    const onChangeRef = React.useRef(onCameraChange)
    stateRef.current = camera
    onChangeRef.current = onCameraChange

    const [textureReady, setTextureReady] = React.useState(false)

    // Inject spin keyframe once
    React.useEffect(() => {
      if (document.getElementById('pv-keyframes')) return
      const style = document.createElement('style')
      style.id = 'pv-keyframes'
      style.textContent = '@keyframes pv-spin { to { transform: rotate(360deg) } }'
      document.head.appendChild(style)
    }, [])

    // Initialize Three.js once
    React.useEffect(() => {
      const host = hostRef.current
      if (!host) return

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab'
      host.appendChild(renderer.domElement)
      rendererRef.current = renderer

      const scene = new THREE.Scene()
      sceneRef.current = scene

      const geometry = new THREE.SphereGeometry(500, 60, 40)
      geometry.scale(-1, 1, 1)
      // Dark initial color — avoids white flash before texture loads
      const material = new THREE.MeshBasicMaterial({ color: 0x0a0d15 })
      const sphere = new THREE.Mesh(geometry, material)
      scene.add(sphere)
      sphereRef.current = sphere

      const cam = new THREE.PerspectiveCamera(75, 1, 1, 1100)
      camRef.current = cam

      const ro = new ResizeObserver(() => {
        if (!host.clientWidth || !host.clientHeight) return
        renderer.setSize(host.clientWidth, host.clientHeight, false)
        cam.aspect = host.clientWidth / host.clientHeight
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
        geometry.dispose()
        material.dispose()
        textureRef.current?.dispose()
        if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current)
        host.replaceChildren()
        rendererRef.current = null
        sceneRef.current = null
        camRef.current = null
        sphereRef.current = null
      }
    }, [])

    // Sync camera props → Three.js camera
    React.useEffect(() => {
      const cam = camRef.current
      if (!cam) return
      cam.fov = camera.fovDeg
      cam.updateProjectionMatrix()
      cam.lookAt(computeLookAt(camera.azimuthDeg, camera.elevationDeg))
    }, [camera.azimuthDeg, camera.elevationDeg, camera.fovDeg])

    // Load texture when imageUrl changes
    React.useEffect(() => {
      const sphere = sphereRef.current
      if (!sphere || !imageUrl) return
      let cancelled = false
      let localUrl: string | null = null

      setTextureReady(false)

      void (async () => {
        try {
          const blob = await fetchProxiedImageBlob(imageUrl)
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          localUrl = url
          if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current)
          objUrlRef.current = url

          const loader = new THREE.TextureLoader()
          loader.load(url, (texture: any) => {
            if (cancelled) { texture.dispose(); return }
            texture.colorSpace = THREE.SRGBColorSpace
            const renderer = rendererRef.current
            texture.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8
            texture.needsUpdate = true
            const mat = sphere.material as THREE.MeshBasicMaterial
            mat.color.set(0xffffff)
            mat.map = texture
            mat.needsUpdate = true
            textureRef.current?.dispose()
            textureRef.current = texture
            setTextureReady(true)
          })
        } catch {
          // show overlay indefinitely on error — user sees it's not loaded
        }
      })()

      return () => {
        cancelled = true
        if (localUrl && localUrl !== objUrlRef.current) URL.revokeObjectURL(localUrl)
      }
    }, [imageUrl])

    // Drag and scroll interaction
    React.useEffect(() => {
      const host = hostRef.current
      if (!host) return

      let dragging = false
      let lastX = 0
      let lastY = 0

      const onPointerDown = (e: PointerEvent) => {
        e.stopPropagation()
        dragging = true
        lastX = e.clientX
        lastY = e.clientY
        host.setPointerCapture(e.pointerId)
        host.style.cursor = 'grabbing'
      }
      const onPointerMove = (e: PointerEvent) => {
        e.stopPropagation()
        if (!dragging) return
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        lastX = e.clientX
        lastY = e.clientY
        const sensitivity = stateRef.current.fovDeg / 400
        const az = ((stateRef.current.azimuthDeg + dx * sensitivity) + 360) % 360
        const el = Math.max(-85, Math.min(85, stateRef.current.elevationDeg - dy * sensitivity))
        onChangeRef.current({ ...stateRef.current, azimuthDeg: az, elevationDeg: el })
      }
      const onPointerUp = (e: PointerEvent) => {
        e.stopPropagation()
        dragging = false
        host.style.cursor = 'grab'
      }
      const onWheel = (e: WheelEvent) => {
        e.stopPropagation()
        e.preventDefault()
        const delta = e.deltaY > 0 ? 4 : -4
        const fov = Math.max(30, Math.min(120, stateRef.current.fovDeg + delta))
        onChangeRef.current({ ...stateRef.current, fovDeg: fov })
      }

      host.addEventListener('pointerdown', onPointerDown)
      host.addEventListener('pointermove', onPointerMove)
      host.addEventListener('pointerup', onPointerUp)
      host.addEventListener('pointercancel', onPointerUp)
      host.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointermove', onPointerMove)
        host.removeEventListener('pointerup', onPointerUp)
        host.removeEventListener('pointercancel', onPointerUp)
        host.removeEventListener('wheel', onWheel)
      }
    }, [])

    // Imperative capture API
    React.useImperativeHandle(ref, () => ({
      captureAtAngle: (azimuthDeg, elevationDeg, fovDeg, outW, outH) => {
        const renderer = rendererRef.current
        const cam = camRef.current
        const scene = sceneRef.current
        if (!renderer || !cam || !scene) return null

        const prevSize = renderer.getSize(new THREE.Vector2())
        const prevAspect = cam.aspect
        const prevFov = cam.fov
        const prevLookAt = computeLookAt(stateRef.current.azimuthDeg, stateRef.current.elevationDeg)

        renderer.setSize(outW, outH, false)
        cam.aspect = outW / outH
        cam.fov = fovDeg
        cam.updateProjectionMatrix()
        cam.lookAt(computeLookAt(azimuthDeg, elevationDeg))
        renderer.render(scene, cam)
        const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.95)

        renderer.setSize(prevSize.x, prevSize.y, false)
        cam.aspect = prevAspect
        cam.fov = prevFov
        cam.updateProjectionMatrix()
        cam.lookAt(prevLookAt)

        return dataUrl
      },
    }))

    const zoomFactor = (60 / camera.fovDeg).toFixed(2)

    return (
      <div className="nodrag nopan" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
        <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

        {/* Frosted glass loading overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(12,18,36,0.94) 0%, rgba(20,28,52,0.92) 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            opacity: textureReady ? 0 : 1,
            transition: 'opacity 0.7s ease',
            pointerEvents: textureReady ? 'none' : 'all',
            zIndex: 2,
          }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
            <circle
              cx="20" cy="20" r="16" fill="none"
              stroke="rgba(130,170,255,0.75)" strokeWidth="3"
              strokeDasharray="34 66" strokeLinecap="round"
              style={{ transformOrigin: '20px 20px', animation: 'pv-spin 1.1s linear infinite' }}
            />
          </svg>
          <span style={{ color: 'rgba(200,210,240,0.8)', fontSize: 12, fontFamily: 'system-ui, sans-serif', letterSpacing: '0.04em' }}>
            全景加载中…
          </span>
        </div>

        {showGrid && (
          <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
            <line x1="66.66%" y1="0" x2="66.66%" y2="100%" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
            <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
            <line x1="0" y1="66.66%" x2="100%" y2="66.66%" stroke="rgba(255,255,255,0.32)" strokeWidth="1" />
          </svg>
        )}

        <div style={{
          position: 'absolute',
          right: 8,
          bottom: 36,
          width: 64,
          height: 64,
          background: 'rgba(0,0,0,0.6)',
          borderRadius: 6,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <PanoramicAxesIndicator azimuthDeg={camera.azimuthDeg} elevationDeg={camera.elevationDeg} />
        </div>

        <div style={{
          position: 'absolute',
          right: 8,
          bottom: 8,
          background: 'rgba(0,0,0,0.6)',
          borderRadius: 4,
          padding: '2px 6px',
          pointerEvents: 'none',
        }}>
          <div style={{ color: '#ccc', fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5 }}>
            横 {Math.round(camera.azimuthDeg)}° 纵 {Math.round(camera.elevationDeg)}°
          </div>
          <div style={{ color: '#ccc', fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5 }}>
            缩放 {Math.round(camera.fovDeg)}°×{zoomFactor}
          </div>
        </div>
      </div>
    )
  }
)

PanoramicViewer.displayName = 'PanoramicViewer'
