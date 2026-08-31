import React from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Line, Grid, GizmoHelper, GizmoViewport, PerspectiveCamera, TransformControls, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import type { DirectorScene, CharacterObj, CameraObj, Vec3 } from '../types'
import { CharacterObject, resolveCharacterPose, type CharacterMixerEntry } from './CharacterObject'
import { CameraRig } from './CameraRig'
import { poseEulerFromRig, type JointRole, type RigState } from '../state/pose'
import { aspectRatio, captureSize } from '../state/aspect'
import { isPanoramaRatio, panoramaCanvasSize, adaptPanoramaPixels } from './panoramaAdapt'
import { sampleAnimationAt, type ClipAnimation } from './clipAnimation'
import { fetchProxiedImageBlob } from '../../../../api/server'
import { samplePathAt } from '../state/groundPath'

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export type ClipFrame = { position: Vec3; lookAt: Vec3; fovDeg: number; characters?: Record<string, { position?: Vec3; rotation?: Vec3; motionClip?: string; motionTimeSec?: number; motion?: import('../state/characterMotion').CharacterMotion; motionAbsTime?: number }> }
export type ClipFrameRequest = {
  frames: ClipFrame[]
  clay?: boolean
  /** 流式消费每帧（避免囤积全分辨率位图爆内存）；onFrame 返回后 Viewport 会 close 该 bitmap */
  onFrame: (bitmap: ImageBitmap, index: number) => Promise<void> | void
}
export type ViewportHandle = {
  /** fovScale：画幅取景框可见时传 框高/视口高，垂直 FOV 收窄到框内 → 截图=框中所见（缺省 1 保持原行为） */
  captureView: (opts?: { fovScale?: number }) => string | null
  captureClipFrames: (req: ClipFrameRequest) => Promise<{ width: number; height: number }>
  /** 离屏渲染单帧（给定相机机位 + 角色帧）→ 小尺寸 JPEG dataURL，用于时间轴片段缩略图。 */
  captureFrameAt: (frame: ClipFrame, w: number, h: number) => string | null
  getCurrentCamera: () => { position: Vec3; lookAt: Vec3; fovDeg: number } | null
  resetView: () => void
}

const DIRECTOR_CAM_POS: Vec3 = [6, 4.5, 13]
const DIRECTOR_TARGET: Vec3 = [0, 1, 0]

type Props = {
  scene: DirectorScene
  viewpoint: 'director' | 'camera'
  selectedId?: string
  gizmoMode?: GizmoMode
  /** 全景背景图 URL（来自连入导演台左侧输入口的图片节点；优先于 scene.skybox 上传兜底） */
  skyboxUrl?: string
  onSelect: (id?: string) => void
  onPatchCharacter: (id: string, patch: Partial<CharacterObj>) => void
  onPatchCamera: (id: string, patch: Partial<CameraObj>) => void
  /** 离屏截图用：所有 useGLTF 模型加载完成（Suspense resolve）后触发一次 */
  onSceneReady?: () => void
  /** 机位视角下：给定时让当前机位按该动画 capture-cam 轨道实时循环预览运镜（orbit/录制路径），null/缺省=静态机位 */
  previewAnim?: ClipAnimation | null
  /** 给定（≥0）时，previewAnim 按此【绝对时间】采样（与全局播放头同步），而非内部自循环时钟。 */
  previewTime?: number | null
  /** 导演视角里画出的相机运动路径折线（对齐参考视频的相机 spline 可视化）；截图时随 helper 隐藏。 */
  cameraPath?: Vec3[]
  /** 播放时给定的实时采样机位 → 让对应 CameraRig 图标/视锥沿路径滑行。 */
  liveCamera?: { id: string; position: Vec3; lookAt: Vec3; fovDeg: number } | null
  /** 自由飞行录制模式：换 FlyControls（WASD/方向键移动+拖拽转视角+可调速），用于录制自定义运镜 */
  flyMode?: boolean
  flySpeed?: number
  flyRecording?: boolean
  /** 飞行录制中每帧上报当前相机（position/lookAt/fovDeg），供模态采样成运镜轨道 */
  onFlyFrame?: (s: { position: Vec3; lookAt: Vec3; fovDeg: number }) => void
  /** 已录制的相机轨迹点，在 3D 场景画出蓝色轨迹线（截图时随 helper 隐藏） */
  trajectory?: Vec3[]
  /** 路径绘制：active 时视口出现地面落点平面 + 路点把手 + 路径线（仅 director 视角） */
  pathDraw?: {
    active: boolean
    waypoints: [number, number][]   // XZ
    mode: 'linear' | 'curve'
    onAddWaypoint: (xz: [number, number]) => void
    onMoveWaypoint: (i: number, xz: [number, number]) => void
    selectedIndex?: number
    onSelectWaypoint?: (i: number) => void
  }
  /** 动画预览：playing 时对应角色展示腿/上半身动画 + 路径行进（仅编辑器预览；不影响离屏渲染） */
  motionPreview?: { playing: boolean; characterId?: string }
  /** 给定(≥0)时角色动画按此绝对时间采样（与全局时间线播放头同步）；否则自循环。 */
  motionDriveTime?: number | null
}

/**
 * 穿梭机控制器：**拖拽** delta 转视角(yaw/pitch，跟 OrbitControls 手感一致，松手即停)+ WASD/方向键平移
 * + R/F 升降，speed 可调。录制时每帧上报相机。不用 three FlyControls(其转视角是光标位置驱动、持续乱转)。
 */
function FlyDragControls({ speed, recording, onFlyFrame }: { speed: number; recording?: boolean; onFlyFrame?: (s: { position: Vec3; lookAt: Vec3; fovDeg: number }) => void }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const keys = React.useRef<Set<string>>(new Set())
  const drag = React.useRef<{ x: number; y: number } | null>(null)
  const euler = React.useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const fwd = React.useMemo(() => new THREE.Vector3(), [])
  const move = React.useMemo(() => new THREE.Vector3(), [])

  React.useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion)
    const el = gl.domElement
    const onDown = (e: PointerEvent) => { drag.current = { x: e.clientX, y: e.clientY } }
    const onUp = () => { drag.current = null }
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return
      const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
      drag.current = { x: e.clientX, y: e.clientY }
      const sens = 0.0028
      euler.current.y -= dx * sens
      euler.current.x -= dy * sens
      const lim = Math.PI / 2 - 0.02
      euler.current.x = Math.max(-lim, Math.min(lim, euler.current.x))
      camera.quaternion.setFromEuler(euler.current)
    }
    const norm = (k: string) => k.length === 1 ? k.toLowerCase() : k.toLowerCase()
    const onKeyDown = (e: KeyboardEvent) => {
      const k = norm(e.key)
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault()
      keys.current.add(k)
    }
    const onKeyUp = (e: KeyboardEvent) => { keys.current.delete(norm(e.key)) }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    el.style.cursor = 'grab'
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      el.style.cursor = ''
      keys.current.clear()
    }
  }, [camera, gl])

  useFrame((_, delta) => {
    const k = keys.current
    move.set(0, 0, 0)
    if (k.has('w') || k.has('arrowup')) move.z -= 1
    if (k.has('s') || k.has('arrowdown')) move.z += 1
    if (k.has('a') || k.has('arrowleft')) move.x -= 1
    if (k.has('d') || k.has('arrowright')) move.x += 1
    let dy = 0
    if (k.has('r')) dy += 1
    if (k.has('f')) dy -= 1
    if (move.lengthSq() > 0 || dy !== 0) {
      const d = speed * delta
      if (move.lengthSq() > 0) { move.normalize().multiplyScalar(d).applyQuaternion(camera.quaternion); camera.position.add(move) }
      camera.position.y += dy * d
    }
    if (recording && onFlyFrame) {
      camera.getWorldDirection(fwd)
      const p = camera.position
      onFlyFrame({ position: [p.x, p.y, p.z], lookAt: [p.x + fwd.x * 5, p.y + fwd.y * 5, p.z + fwd.z * 5], fovDeg: (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 45 })
    }
  })
  return null
}
function PathDrawLayer({ pd, onDragStart, onDragEnd }: {
  pd: NonNullable<Props['pathDraw']>
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const camera = useThree((s) => s.camera)
  const raycaster = useThree((s) => s.raycaster)
  const pointer = useThree((s) => s.pointer)
  const draggingRef = React.useRef<number | null>(null)
  const plane = React.useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hitGround = React.useCallback((): [number, number] | null => {
    raycaster.setFromCamera(pointer, camera)
    const p = new THREE.Vector3()
    return raycaster.ray.intersectPlane(plane, p) ? [p.x, p.z] : null
  }, [raycaster, pointer, camera, plane])

  const linePts = React.useMemo<[number, number, number][]>(() => {
    if (pd.waypoints.length < 2 || pd.mode === 'linear') return pd.waypoints.map((w) => [w[0], 0.02, w[1]])
    const path = { waypoints: pd.waypoints, mode: 'curve' as const }
    const N = 64
    const out: [number, number, number][] = []
    for (let i = 0; i <= N; i++) { const s = samplePathAt(path, i / N); out.push([s.pos[0], 0.02, s.pos[1]]) }
    return out
  }, [pd.waypoints, pd.mode])

  return (
    <group userData={{ directorHelper: true }}>
      {pd.active ? (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
          onPointerDown={(e) => { e.stopPropagation(); if (draggingRef.current != null) return; const xz = hitGround(); if (xz) pd.onAddWaypoint(xz) }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
      {linePts.length >= 2 ? <Line points={linePts} color="#22d3ee" lineWidth={2} /> : null}
      {pd.waypoints.map((w, i) => (
        <mesh
          key={i}
          position={[w[0], 0.12, w[1]]}
          onPointerDown={(e) => { e.stopPropagation(); draggingRef.current = i; onDragStart(); pd.onSelectWaypoint?.(i); const t = e.target as { setPointerCapture?: (id: number) => void }; t.setPointerCapture?.(e.pointerId) }}
          onPointerMove={(e) => { if (draggingRef.current !== i) return; e.stopPropagation(); const xz = hitGround(); if (xz) pd.onMoveWaypoint(i, xz) }}
          onPointerUp={(e) => { if (draggingRef.current === i) { draggingRef.current = null; onDragEnd(); const t = e.target as { releasePointerCapture?: (id: number) => void }; t.releasePointerCapture?.(e.pointerId) } }}
        >
          <sphereGeometry args={[0.13, 16, 16]} />
          <meshBasicMaterial color={pd.selectedIndex === i ? '#fbbf24' : '#22d3ee'} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}

type SceneContentsProps = Props & {
  groupsRef: React.MutableRefObject<Map<string, THREE.Group>>
  mixersRef: React.MutableRefObject<Map<string, CharacterMixerEntry>>
}

/** 求机位注视点：手动坐标或锁定的角色位置（抬到胸高） */
function resolveLookAt(cam: CameraObj, scene: DirectorScene): Vec3 {
  if (cam.lookAtMode !== 'manual') {
    const target = scene.characters.find((c) => c.id === cam.lookAtMode)
    if (target) return [target.position[0], target.position[1] + 1.2, target.position[2]]
  }
  return cam.lookAt
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('全景图加载失败'))
    img.src = url
  })
}

/** 非 2:1 图 → cover 铺满 2:1 画布 + seam/极点优化 → 穹顶纹理（吸收 storyai-3d-director-desk 全景管线） */
function buildBackdropTexture(img: HTMLImageElement): THREE.Texture | null {
  const { width, height } = panoramaCanvasSize(img.naturalWidth, img.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#06080D'
  ctx.fillRect(0, 0, width, height)
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
  try {
    const frame = ctx.getImageData(0, 0, width, height)
    frame.data.set(adaptPanoramaPixels(frame.data, width, height))
    ctx.putImageData(frame, 0, 0)
  } catch {
    // getImageData 失败（极端环境/跨域污染）：退回未优化的 cover 结果，仍可用
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.repeat.set(-1, 1) // 从穹顶内侧看不镜像
  tex.offset.set(1, 0)
  return tex
}

type SkyboxState = { texture: THREE.Texture } | null

/**
 * 无视差环境穹顶：2:1 等距图与普通背景图统一使用相机跟随的 BackSide 球体。
 * 球心逐帧跟随当前相机，避免导演视角/机位移动时背景产生错误视差；yaw/pitch 分别校准取景方向与地平线。
 */
function Skybox({ url, yawDeg, pitchDeg }: { url?: string; yawDeg?: number; pitchDeg?: number }) {
  const { scene, invalidate } = useThree()
  const [state, setState] = React.useState<SkyboxState>(null)
  const domeRef = React.useRef<THREE.Mesh>(null)

  React.useEffect(() => {
    if (!url) { setState(null); return }
    let disposed = false
    let objUrl: string | null = null
    let created: THREE.Texture | null = null
    void (async () => {
      try {
        let loadUrl = url
        if (/^https?:\/\//i.test(url)) {
          const blob = await fetchProxiedImageBlob(url)
          if (disposed) return
          objUrl = URL.createObjectURL(blob)
          loadUrl = objUrl
        }
        const img = await loadImageElement(loadUrl)
        if (disposed) return
        if (isPanoramaRatio(img.naturalWidth, img.naturalHeight)) {
          const tex = new THREE.Texture(img)
          tex.colorSpace = THREE.SRGBColorSpace
          tex.wrapS = THREE.RepeatWrapping
          tex.repeat.set(-1, 1)
          tex.offset.set(1, 0)
          tex.needsUpdate = true
          created = tex
          setState({ texture: tex })
        } else {
          const tex = buildBackdropTexture(img)
          created = tex
          setState(tex ? { texture: tex } : null)
        }
        invalidate?.()
      } catch {
        if (!disposed) setState(null) // 拉取失败：保持纯色背景，不留半成品
      }
    })()
    return () => {
      disposed = true
      if (objUrl) URL.revokeObjectURL(objUrl)
      created?.dispose()
      setState(null)
    }
  }, [url, invalidate])

  const yawRad = (((yawDeg ?? 0) % 360) * Math.PI) / 180
  const pitchRad = (Math.max(-45, Math.min(45, pitchDeg ?? 0)) * Math.PI) / 180
  React.useEffect(() => {
    scene.background = new THREE.Color('#0a0b0d')
    invalidate?.()
    return () => { scene.background = new THREE.Color('#0a0b0d') }
  }, [state, scene, invalidate])

  // 穹顶不参与拾取（raycast 置空），否则点空处永远命中背景球
  return state ? (
    <mesh
      ref={domeRef}
      name="director-console-environment-dome"
      frustumCulled={false}
      renderOrder={-1000}
      rotation={[pitchRad, yawRad, 0]}
      raycast={() => null}
      onBeforeRender={(_renderer, _scene, renderCamera) => domeRef.current?.position.copy(renderCamera.position)}
    >
      <sphereGeometry args={[200, 96, 64]} />
      <meshBasicMaterial map={state.texture} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  ) : null
}

/** 机位视角下设为默认相机并持续注视目标；荷兰角 roll 在 lookAt 后绕视轴施加。
 * previewAnim 给定时改为实时按该动画的 capture-cam 轨道循环预览运镜（orbit 或录制的关键帧路径统一走 sampleAnimationAt）。 */
function ActiveCameraView({ cam, lookAt, previewAnim, previewTime }: { cam: CameraObj; lookAt: Vec3; previewAnim?: ClipAnimation | null; previewTime?: number | null }) {
  const ref = React.useRef<THREE.PerspectiveCamera>(null)
  const elapsedRef = React.useRef(0)
  useFrame((_, delta) => {
    const c = ref.current
    if (!c) return
    if (previewAnim) {
      const period = Math.max(0.5, previewAnim.durationSeconds)
      // previewTime 给定 → 与全局播放头同步采样；否则内部自循环（保持旧行为）
      let t: number
      if (previewTime != null && previewTime >= 0) {
        t = Math.min(period, previewTime)
      } else {
        elapsedRef.current = (elapsedRef.current + delta) % period
        t = elapsedRef.current
      }
      const s = sampleAnimationAt(previewAnim, t)
      const sc = s.cameras['capture-cam'] ?? Object.values(s.cameras)[0]
      if (sc) {
        c.position.set(sc.position[0], sc.position[1], sc.position[2])
        c.fov = sc.fovDeg
        c.lookAt(sc.lookAt[0], sc.lookAt[1], sc.lookAt[2])
        c.updateProjectionMatrix()
      }
      return
    }
    c.lookAt(lookAt[0], lookAt[1], lookAt[2])
    if (cam.roll) c.rotateZ(cam.roll * (Math.PI / 180))
  })
  return <PerspectiveCamera ref={ref} makeDefault position={cam.position} fov={cam.fovDeg} near={0.1} far={1000} />
}

/** Suspense 边界内的就绪探针：模型已 resolve 才会挂载，挂载后下一帧回调一次。
 * 后台标签页会冻结 rAF（离屏截图的 onReady 永不触发、busyRef 卡死），
 * 故与 setTimeout 兜底竞速：前台 rAF 先到行为不变，后台靠定时器兜底（截图走手动 gl.render，不依赖绘制帧）。 */
function ReadySignal({ onReady }: { onReady?: () => void }) {
  const { invalidate } = useThree()
  // 关键：角色 GLB 在 CharacterObject 的【内层】Suspense 里加载（fallback=占位素体），
  // 外层 Suspense 立刻 resolve——本组件若只等固定 500ms 就宣布就绪，离屏截图会在
  // GLB 仍在加载时按快门，拍到一画面的胶囊占位人（实测踩过）。改用 drei useProgress
  // 跟踪全局 LoadingManager：必须「无在途加载」才算就绪；纯占位场景（无任何 GLB）
  // active 恒为 false，走 600ms 兜底计时器，行为不退化。
  const { active } = useProgress()
  const [settled, setSettled] = React.useState(false)
  React.useEffect(() => {
    if (active) { setSettled(false); return }
    // 加载清零后再等一拍，让 resolve 的 GLB 完成 commit/首帧
    const timer = window.setTimeout(() => setSettled(true), 600)
    return () => window.clearTimeout(timer)
  }, [active])
  React.useEffect(() => {
    if (!onReady || !settled) return
    let fired = false
    const fire = () => {
      if (fired) return
      fired = true
      onReady()
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      invalidate()
      raf2 = requestAnimationFrame(fire)
    })
    // 后台标签页 rAF 被冻结时的兜底：定时器仍会触发，避免看门狗误报"场景未就绪"。
    const timer = window.setTimeout(() => {
      invalidate()
      fire()
    }, 800)
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(timer) }
  }, [onReady, settled, invalidate])
  return null
}

function SceneContents({ scene, viewpoint, selectedId, gizmoMode = 'translate', skyboxUrl, previewAnim, previewTime, cameraPath, liveCamera, flyMode, flySpeed, flyRecording, onFlyFrame, trajectory, pathDraw, motionPreview, motionDriveTime, onSelect, onPatchCharacter, onPatchCamera, groupsRef, mixersRef }: SceneContentsProps) {
  const activeCam = scene.cameras.find((c) => c.id === scene.activeCameraId)
  const selectedChar = scene.characters.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const selectedCam = scene.cameras.find((c) => c.id === selectedId && !c.locked && !c.hidden)
  const anchorRef = React.useRef<THREE.Object3D>(null)
  const [orbitOn, setOrbitOn] = React.useState(true)

  // 骨骼直掰：选中角色后场景里出现可点选关节球，点选 → rotate gizmo 挂到该骨骼
  const rigsRef = React.useRef(new Map<string, RigState>())
  const [jointRole, setJointRole] = React.useState<JointRole | null>(null)
  React.useEffect(() => { setJointRole(null) }, [selectedId, viewpoint])

  // 角色根 group 注册表：gizmo 直接挂实体 → 拖拽实时所见即所得（不再经隐形锚点+松手跳变）
  // groupsRef 已上提到 Viewport，由外层透传
  const [, bumpRefs] = React.useReducer((x: number) => x + 1, 0)

  // 机位只支持移动；角色支持移动/旋转/缩放
  const mode: GizmoMode = selectedCam ? 'translate' : gizmoMode
  const charGroup = selectedChar ? groupsRef.current.get(selectedChar.id) : undefined

  // 角色 gizmo 松手：从实体 group 读回整套变换（group.scale 含 uniformScale，需除回）
  const commitChar = () => {
    if (!selectedChar) return
    const g = groupsRef.current.get(selectedChar.id)
    if (!g) return
    const s = selectedChar.uniformScale || 1
    onPatchCharacter(selectedChar.id, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [g.rotation.x, g.rotation.y, g.rotation.z],
      scale: [g.scale.x / s, g.scale.y / s, g.scale.z / s],
    })
  }

  const commitCam = () => {
    const m = anchorRef.current
    if (!m || !selectedCam) return
    onPatchCamera(selectedCam.id, { position: [m.position.x, m.position.y, m.position.z] })
  }

  // 骨骼 gizmo 松手：从骨骼当前局部四元数反解规范系欧拉角，合并回写 pose（所见即所得）
  const commitJoint = () => {
    if (!selectedChar || !jointRole) return
    const rig = rigsRef.current.get(selectedChar.id)
    if (!rig) return
    const eul = poseEulerFromRig(rig, jointRole)
    if (!eul) return
    const base = resolveCharacterPose(selectedChar) ?? {}
    onPatchCharacter(selectedChar.id, { pose: { ...base, [jointRole]: eul } as CharacterObj['pose'] })
  }

  const jointBone = selectedChar && jointRole ? rigsRef.current.get(selectedChar.id)?.joints[jointRole]?.bone : undefined

  return (
    <>
      {flyMode ? (
        <FlyDragControls speed={flySpeed ?? 8} recording={flyRecording} onFlyFrame={onFlyFrame} />
      ) : viewpoint === 'director' ? (
        <OrbitControls makeDefault enableDamping enabled={orbitOn} target={DIRECTOR_TARGET} />
      ) : activeCam ? (
        <ActiveCameraView cam={activeCam} lookAt={resolveLookAt(activeCam, scene)} previewAnim={previewAnim} previewTime={previewTime} />
      ) : null}
      {trajectory && trajectory.length >= 2 ? (
        <Line points={trajectory} color="#3b82f6" lineWidth={2} onUpdate={(self) => { self.userData.directorHelper = true }} />
      ) : null}
      {/* 相机运动路径（导演视角下的 spline 可视化，对齐参考视频） */}
      {viewpoint === 'director' && cameraPath && cameraPath.length >= 2 ? (
        <Line points={cameraPath} color="#f59e0b" lineWidth={2} dashed dashSize={0.25} gapSize={0.12} onUpdate={(self) => { self.userData.directorHelper = true }} />
      ) : null}

      <Skybox url={skyboxUrl ?? scene.skybox} yawDeg={scene.skyboxYaw} pitchDeg={scene.skyboxPitch} />
      <ambientLight intensity={1.1} />
      <hemisphereLight args={['#ffffff', '#444a55', 0.8]} />
      <directionalLight position={[5, 10, 7]} intensity={1.4} />
      <directionalLight position={[-6, 4, -4]} intensity={0.5} />
      <Grid args={[40, 40]} cellColor="#1d3a5f" sectionColor="#626872" infiniteGrid fadeDistance={60} position={[0, 0, 0]} onUpdate={(self) => { self.userData.directorHelper = true }} />

      {viewpoint === 'director' && pathDraw ? (
        <PathDrawLayer pd={pathDraw} onDragStart={() => setOrbitOn(false)} onDragEnd={() => setOrbitOn(true)} />
      ) : null}

      {scene.characters.filter((c) => !c.hidden).map((c) => (
        <CharacterObject
          key={c.id}
          character={c}
          customMotions={scene.customMotions}
          selected={c.id === selectedId}
          onSelect={() => { setJointRole(null); onSelect(c.id) }}
          jointEditing={viewpoint === 'director' && c.id === selectedChar?.id}
          selectedJointRole={c.id === selectedChar?.id ? jointRole : null}
          onPickJoint={(role) => setJointRole((r) => (r === role ? null : role))}
          onRigChange={(rig) => { if (rig) rigsRef.current.set(c.id, rig); else rigsRef.current.delete(c.id) }}
          onGroupChange={(g) => {
            if (g === groupsRef.current.get(c.id)) return
            if (g) groupsRef.current.set(c.id, g); else groupsRef.current.delete(c.id)
            bumpRefs() // 注册表变化驱动重渲染，确保选中时 gizmo 能拿到 group
          }}
          onMixerChange={(entry) => { if (entry) mixersRef.current.set(c.id, entry); else mixersRef.current.delete(c.id) }}
          motionPreviewPlaying={!!motionPreview?.playing && (motionPreview.characterId === undefined || motionPreview.characterId === c.id)}
          motionDriveTime={motionDriveTime}
        />
      ))}
      {scene.cameras.filter((c) => !c.hidden).map((c) => (
        <CameraRig key={c.id} camera={c} scene={scene} active={viewpoint === 'director'} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} override={liveCamera && liveCamera.id === c.id ? liveCamera : undefined} />
      ))}

      {viewpoint === 'director' && selectedChar && jointRole && jointBone ? (
        // 骨骼直掰：rotate gizmo 直接挂在被点选的骨骼上，拖拽实时驱动蒙皮，松手反解回写 pose
        <TransformControls
          key={`${selectedChar.id}-${jointRole}`}
          object={jointBone}
          mode="rotate"
          size={0.6}
          onMouseUp={commitJoint}
        />
      ) : viewpoint === 'director' && selectedChar && charGroup ? (
        // gizmo 直接挂角色实体：移动/转向/缩放拖拽全程实时
        <React.Fragment key={`${selectedChar.id}-${mode}`}>
          <TransformControls object={charGroup} mode={mode} onMouseUp={commitChar} />
          {mode === 'translate' ? (
            // 移动模式下常驻 Y 轴转向环：拖环直接转身，无需切到旋转模式
            <TransformControls object={charGroup} mode="rotate" showX={false} showZ={false} onMouseUp={commitChar} />
          ) : null}
        </React.Fragment>
      ) : viewpoint === 'director' && selectedCam ? (
        <React.Fragment key={selectedCam.id}>
          <object3D ref={anchorRef} position={selectedCam.position} />
          <TransformControls
            object={anchorRef as React.MutableRefObject<THREE.Object3D>}
            mode="translate"
            onMouseUp={commitCam}
          />
        </React.Fragment>
      ) : null}

      {viewpoint === 'director' ? (
        <GizmoHelper alignment="top-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff4d4f', '#52c41a', '#1890ff']} labelColor="#fff" />
        </GizmoHelper>
      ) : null}
    </>
  )
}

export const Viewport = React.forwardRef<ViewportHandle, Props>(function Viewport(props, ref) {
  const glRef = React.useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = React.useRef<THREE.Scene | null>(null)
  const controlsRef = React.useRef<any>(null)
  const cameraRef = React.useRef<THREE.Camera | null>(null)
  const groupsRef = React.useRef(new Map<string, THREE.Group>())
  const mixersRef = React.useRef(new Map<string, CharacterMixerEntry>())
  const propsRef = React.useRef(props)
  propsRef.current = props

  React.useImperativeHandle(ref, () => ({
    // 纯客户端截图：截「当前所见」——导演视角=环绕相机视角，机位视角=机位 POV；离屏按画幅渲染 → dataURL
    captureView: (opts) => {
      const gl = glRef.current, scene = sceneRef.current
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      const p = propsRef.current
      if (!gl || !scene || !live) return null
      const vw = gl.domElement.width || 1280
      const { width, height } = captureSize(p.scene.aspect, vw / (gl.domElement.height || 720))
      const baseFov = live.isPerspectiveCamera ? live.fov : 50
      const fovScale = opts?.fovScale
      const fov = fovScale && fovScale > 0 && fovScale !== 1
        ? (Math.atan(Math.tan((baseFov * Math.PI) / 360) * fovScale) * 360) / Math.PI
        : baseFov
      const tmp = new THREE.PerspectiveCamera(fov, width / height, 0.1, 2000)
      tmp.position.copy(live.position)
      tmp.quaternion.copy(live.quaternion)
      tmp.updateMatrixWorld(true)
      // 截图前隐藏辅助物体（机位视锥/变换 gizmo/关节球），出图只含角色+网格
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        const any = o as any
        if (o.visible && (o.type === 'CameraHelper' || any.isTransformControls || any.isTransformControlsRoot || any.isTransformControlsGizmo || o.userData?.directorHelper)) {
          o.visible = false; hidden.push(o)
        }
      })
      const rt = new THREE.WebGLRenderTarget(width, height)
      // 关键：离屏 RT 默认线性、读回会偏暗 → 设 sRGB，使渲染器写出与屏幕一致的亮度
      rt.texture.colorSpace = THREE.SRGBColorSpace
      const prevClear = gl.getClearColor(new THREE.Color()).clone()
      gl.setRenderTarget(rt)
      gl.setClearColor('#0a0b0d', 1)
      gl.clear()
      gl.render(scene, tmp)
      gl.setRenderTarget(null)
      gl.setClearColor(prevClear, 1)
      hidden.forEach((o) => { o.visible = true })
      const buf = new Uint8Array(width * height * 4)
      gl.readRenderTargetPixels(rt, 0, 0, width, height, buf)
      rt.dispose()
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d'); if (!ctx) return null
      const img = ctx.createImageData(width, height)
      for (let y = 0; y < height; y++) {
        const sy = height - 1 - y // WebGL 像素是上下翻转的
        for (let x = 0; x < width; x++) {
          const si = (sy * width + x) * 4, di = (y * width + x) * 4
          img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3]
        }
      }
      ctx.putImageData(img, 0, 0)

      // 角色标注：drei <Html> 是 DOM 覆盖层，不在 WebGL 帧缓冲里，readPixels 截不到。
      // 用截图相机把每个角色的标注锚点（角色组本地 [0,2.05,0]，与 Label 一致）投影到
      // 画布坐标后手绘，使发送到画布的截图保留「角色X」标注（对齐导演台所见）。
      tmp.updateMatrixWorld(true)
      const labelFont = Math.max(13, Math.round(height / 42))
      ctx.font = `600 ${labelFont}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(2, labelFont / 5)
      const lp = new THREE.Vector3()
      const lm = new THREE.Matrix4()
      const lq = new THREE.Quaternion()
      for (const ch of p.scene.characters) {
        if (ch.hidden) continue
        const us = ch.uniformScale
        lq.setFromEuler(new THREE.Euler(ch.rotation[0], ch.rotation[1], ch.rotation[2]))
        lm.compose(
          new THREE.Vector3(ch.position[0], ch.position[1], ch.position[2]),
          lq,
          new THREE.Vector3(ch.scale[0] * us, ch.scale[1] * us, ch.scale[2] * us),
        )
        lp.set(0, 2.05, 0).applyMatrix4(lm).project(tmp)
        if (lp.z < -1 || lp.z > 1) continue // 相机背后或视锥外
        if (lp.x < -1.05 || lp.x > 1.05 || lp.y < -1.05 || lp.y > 1.05) continue
        const sx = (lp.x * 0.5 + 0.5) * width
        const sy = (1 - (lp.y * 0.5 + 0.5)) * height
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.strokeText(ch.name, sx, sy)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(ch.name, sx, sy)
      }

      return canvas.toDataURL('image/jpeg', 0.92)
    },
    captureClipFrames: async (req) => {
      const gl = glRef.current, scene = sceneRef.current
      const p = propsRef.current
      const groups = groupsRef.current // Map<string, THREE.Group>
      const mixers = mixersRef.current
      if (!gl || !scene) return { width: 0, height: 0 }
      const baseW = gl.domElement.width || 1280
      const raw = captureSize(p.scene.aspect, baseW / (gl.domElement.height || 720))
      const width = raw.width - (raw.width % 2)   // H.264 要求偶数宽高
      const height = raw.height - (raw.height % 2)
      const clayMat = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.85, metalness: 0 })
      const tmp = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000)
      // 隐藏 helper（含已打标的 Grid）
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        const any = o as any
        if (o.visible && (o.type === 'CameraHelper' || any.isTransformControls || any.isTransformControlsRoot || any.isTransformControlsGizmo || o.userData?.directorHelper)) {
          o.visible = false; hidden.push(o)
        }
      })
      const savedTransforms: Array<{ g: THREE.Group; pos: THREE.Vector3; rot: THREE.Euler }> = []
      groups.forEach((g) => savedTransforms.push({ g, pos: g.position.clone(), rot: g.rotation.clone() }))
      const prevOverride = scene.overrideMaterial
      const prevClear = gl.getClearColor(new THREE.Color()).clone()
      try {
        for (let fi = 0; fi < req.frames.length; fi++) {
          const fr = req.frames[fi]
          // 应用每帧角色 transform
          if (fr.characters) {
            for (const [cid, t] of Object.entries(fr.characters)) {
              const g = groups.get(cid)
              if (!g) continue
              if (t.position) g.position.set(t.position[0], t.position[1], t.position[2])
              if (t.rotation) g.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2])
            }
          }
          // 骨骼动画驱动：优先合成分层动作(motion)，否则走内置/自定义 clip(motionClip)
          if (fr.characters) {
            for (const [cid, t] of Object.entries(fr.characters)) {
              if (t.motion) { mixers.get(cid)?.applyComposedMotion(t.motion, t.motionAbsTime ?? 0); continue }
              if (!t.motionClip) continue
              mixers.get(cid)?.applyMotion(t.motionClip, t.motionTimeSec ?? 0)
            }
          }
          // 应用相机
          tmp.position.set(fr.position[0], fr.position[1], fr.position[2])
          tmp.fov = fr.fovDeg
          tmp.lookAt(new THREE.Vector3(fr.lookAt[0], fr.lookAt[1], fr.lookAt[2]))
          tmp.updateProjectionMatrix(); tmp.updateMatrixWorld(true)
          if (req.clay) scene.overrideMaterial = clayMat
          const rt = new THREE.WebGLRenderTarget(width, height)
          rt.texture.colorSpace = THREE.SRGBColorSpace
          gl.setRenderTarget(rt)
          gl.setClearColor('#0a0b0d', 1); gl.clear()
          gl.render(scene, tmp)
          gl.setRenderTarget(null)
          const buf = new Uint8Array(width * height * 4)
          gl.readRenderTargetPixels(rt, 0, 0, width, height, buf)
          rt.dispose()
          // 翻转 + 转 ImageBitmap（无角色标注：v2v 灰模不写字）
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const ctx = canvas.getContext('2d'); if (!ctx) continue
          const img = ctx.createImageData(width, height)
          for (let y = 0; y < height; y++) {
            const sy = height - 1 - y
            for (let x = 0; x < width; x++) {
              const si = (sy * width + x) * 4, di = (y * width + x) * 4
              img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3]
            }
          }
          ctx.putImageData(img, 0, 0)
          const bitmap = await createImageBitmap(canvas)
          await req.onFrame(bitmap, fi)
          bitmap.close()
        }
      } finally {
        scene.overrideMaterial = prevOverride
        gl.setClearColor(prevClear, 1)
        savedTransforms.forEach(({ g, pos, rot }) => { g.position.copy(pos); g.rotation.copy(rot) })
        hidden.forEach((o) => { o.visible = true })
        mixers.forEach((entry) => entry.applyMotion(undefined, 0))
        clayMat.dispose()
      }
      return { width, height }
    },
    // 时间轴片段缩略图：给定相机机位 + 角色帧，离屏渲染一张小图 → JPEG dataURL（隐藏 helper，含真材质）
    captureFrameAt: (frame, w, h) => {
      const gl = glRef.current, scene = sceneRef.current
      if (!gl || !scene) return null
      const groups = groupsRef.current, mixers = mixersRef.current
      const width = Math.max(2, w - (w % 2)), height = Math.max(2, h - (h % 2))
      const tmp = new THREE.PerspectiveCamera(frame.fovDeg || 40, width / height, 0.1, 2000)
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        const any = o as any
        if (o.visible && (o.type === 'CameraHelper' || any.isTransformControls || any.isTransformControlsRoot || any.isTransformControlsGizmo || o.userData?.directorHelper)) { o.visible = false; hidden.push(o) }
      })
      const saved: Array<{ g: THREE.Group; pos: THREE.Vector3; rot: THREE.Euler }> = []
      groups.forEach((g) => saved.push({ g, pos: g.position.clone(), rot: g.rotation.clone() }))
      const prevClear = gl.getClearColor(new THREE.Color()).clone()
      try {
        if (frame.characters) {
          for (const [cid, t] of Object.entries(frame.characters)) {
            const g = groups.get(cid)
            if (g) { if (t.position) g.position.set(t.position[0], t.position[1], t.position[2]); if (t.rotation) g.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]) }
            if (t.motion) mixers.get(cid)?.applyComposedMotion(t.motion, t.motionAbsTime ?? 0)
            else if (t.motionClip) mixers.get(cid)?.applyMotion(t.motionClip, t.motionTimeSec ?? 0)
          }
        }
        tmp.position.set(frame.position[0], frame.position[1], frame.position[2])
        tmp.lookAt(new THREE.Vector3(frame.lookAt[0], frame.lookAt[1], frame.lookAt[2]))
        tmp.updateProjectionMatrix(); tmp.updateMatrixWorld(true)
        const rt = new THREE.WebGLRenderTarget(width, height)
        rt.texture.colorSpace = THREE.SRGBColorSpace
        gl.setRenderTarget(rt); gl.setClearColor('#0a0b0d', 1); gl.clear(); gl.render(scene, tmp); gl.setRenderTarget(null); gl.setClearColor(prevClear, 1)
        const buf = new Uint8Array(width * height * 4)
        gl.readRenderTargetPixels(rt, 0, 0, width, height, buf); rt.dispose()
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const ctx = canvas.getContext('2d'); if (!ctx) return null
        const img = ctx.createImageData(width, height)
        for (let y = 0; y < height; y++) { const sy = height - 1 - y; for (let x = 0; x < width; x++) { const si = (sy * width + x) * 4, di = (y * width + x) * 4; img.data[di] = buf[si]; img.data[di + 1] = buf[si + 1]; img.data[di + 2] = buf[si + 2]; img.data[di + 3] = buf[si + 3] } }
        ctx.putImageData(img, 0, 0)
        return canvas.toDataURL('image/jpeg', 0.55)
      } finally {
        saved.forEach(({ g, pos, rot }) => { g.position.copy(pos); g.rotation.copy(rot) })
        hidden.forEach((o) => { o.visible = true })
        mixers.forEach((e) => e.applyMotion(undefined, 0))
      }
    },
    // 当前视角相机参数：位置 + 注视点(优先 OrbitControls target，否则相机前方) + FOV
    getCurrentCamera: () => {
      const live = cameraRef.current as THREE.PerspectiveCamera | null
      if (!live) return null
      const pos: Vec3 = [live.position.x, live.position.y, live.position.z]
      const c = controlsRef.current
      let lookAt: Vec3
      if (c?.target) {
        lookAt = [c.target.x, c.target.y, c.target.z]
      } else {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(live.quaternion).multiplyScalar(10).add(live.position)
        lookAt = [fwd.x, fwd.y, fwd.z]
      }
      return { position: pos, lookAt, fovDeg: live.isPerspectiveCamera ? live.fov : 50 }
    },
    resetView: () => {
      const cam = cameraRef.current as THREE.PerspectiveCamera | null
      if (cam) { cam.position.set(DIRECTOR_CAM_POS[0], DIRECTOR_CAM_POS[1], DIRECTOR_CAM_POS[2]); cam.updateProjectionMatrix() }
      const c = controlsRef.current
      if (c) { if (c.target?.set) c.target.set(DIRECTOR_TARGET[0], DIRECTOR_TARGET[1], DIRECTOR_TARGET[2]); c.update?.() }
    },
  }), [])

  // 机位视角按画幅比例做 letterbox
  const ratio = props.viewpoint === 'camera' ? aspectRatio(props.scene.aspect, 16 / 9) : null
  // isolation:isolate → 每个视口自成层叠上下文，把 drei <Html> 角色/机位标注(z-index≈16M)关在视口内，
  // 不再穿透盖在聊天面板/工具条等同级 UI 之上。
  const wrapStyle: React.CSSProperties = ratio
    ? { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', isolation: 'isolate' }
    : { position: 'absolute', inset: 0, isolation: 'isolate' }
  const canvasStyle: React.CSSProperties = ratio
    ? { aspectRatio: String(ratio), maxWidth: '100%', maxHeight: '100%', width: ratio >= 1 ? '100%' : 'auto', height: ratio >= 1 ? 'auto' : '100%' }
    : { width: '100%', height: '100%' }

  return (
    <div style={wrapStyle}>
      <div style={canvasStyle}>
        <Canvas
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          camera={{ position: [6, 4.5, 13], fov: 45 }}
          onCreated={({ gl, scene }) => { glRef.current = gl; sceneRef.current = scene; gl.setClearColor('#0a0b0d') }}
          style={{ width: '100%', height: '100%' }}
        >
          <RefSync glRef={glRef} sceneRef={sceneRef} controlsRef={controlsRef} cameraRef={cameraRef} />
          <React.Suspense fallback={null}>
            <SceneContents {...props} groupsRef={groupsRef} mixersRef={mixersRef} />
            <ReadySignal onReady={props.onSceneReady} />
          </React.Suspense>
        </Canvas>
      </div>
    </div>
  )
})

/** 同步 gl/scene/controls/camera 给截图与重置视角用 */
function RefSync({ glRef, sceneRef, controlsRef, cameraRef }: {
  glRef: React.MutableRefObject<THREE.WebGLRenderer | null>
  sceneRef: React.MutableRefObject<THREE.Scene | null>
  controlsRef: React.MutableRefObject<any>
  cameraRef: React.MutableRefObject<THREE.Camera | null>
}) {
  const { gl, scene, controls, camera } = useThree()
  React.useEffect(() => { glRef.current = gl; sceneRef.current = scene }, [gl, scene, glRef, sceneRef])
  React.useEffect(() => { controlsRef.current = controls; cameraRef.current = camera }, [controls, camera, controlsRef, cameraRef])
  return null
}
