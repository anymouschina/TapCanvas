import React from 'react'
import { useRFStore } from '../../store'
import { Viewport, type ViewportHandle, type ClipFrame } from './scene/Viewport'
import { aspectRatio } from './state/aspect'
import type { AspectKey, CharacterObj, DirectorScene, Vec3 } from './types'
import { claimDirectorCapture, reportDirectorCapture } from '../../../api/server'
import { uploadCanvasImageBlob, dataUrlToBlob } from './uploadCanvasImageBlob'
import { uploadCanvasVideoBlob } from './uploadCanvasVideoBlob'
import { sampleAnimationAt, frameTimestamps, type ClipAnimation, type CameraOrbit } from './scene/clipAnimation'
import { buildShotClip } from './state/previewClip'
import {
  createWebCodecsEncoder,
  encodeBitmapsWithFfmpeg,
  isWebCodecsMp4Supported,
  type Mp4ClipEncoder,
} from '../../../utils/clipEncode'

type CaptureMode = 'image' | 'clip'
type PendingCapture = {
  captureId: string
  scene: unknown
  aspect?: string
  status: 'queued'
  /** 缺省 'image'（向后兼容旧调用）；'clip' 走灰模动画样片渲染。 */
  mode?: CaptureMode
  /** clip 模式的关键帧动画；image 模式忽略。 */
  animation?: ClipAnimation
}

type CaptureJob = {
  pending: PendingCapture
  nodeId: string
  leaseToken: string
  scene: Record<string, unknown>
}

function readPending(data: unknown): PendingCapture | null {
  const p = (data as { pendingCapture?: PendingCapture })?.pendingCapture
  if (p && typeof p.captureId === 'string' && p.status === 'queued' && p.scene) return p
  return null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asVec3(value: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return [value[0], value[1], value[2]] as Vec3
  }
  return fallback
}

/**
 * 当前有导演台 Modal 打开的节点集合：这些节点交给 Modal 内挂的 scoped runner 认领（它更鲜活、不会被 busyRef 卡死），
 * 全局 runner 跳过它们，避免双抢 + 避免全局 runner 偶发卡死时该节点永远没人接。
 */
export const openDirectorModalNodes = new Set<string>()

/**
 * 单例执行器：监听画布上 directorConsole 节点的 data.pendingCapture 指令，
 * 原子认领（多标签页只有一个胜出）后离屏渲染机位 POV、截图、上传并回报结果——全程不打开导演台 Modal。
 * onlyNodeId：scoped 模式，只认领该节点（导演台 Modal 内挂载，负责自己这个节点）。缺省=全局，认领所有「未被 Modal 接管」的节点。
 */
export function DirectorCaptureRunner({ onlyNodeId }: { onlyNodeId?: string } = {}) {
  const nodes = useRFStore((s) => s.nodes)
  const [job, setJob] = React.useState<CaptureJob | null>(null)
  const processedRef = React.useRef<Set<string>>(new Set())
  const busyRef = React.useRef(false)

  React.useEffect(() => {
    if (busyRef.current || job) return
    for (const n of nodes) {
      const data = (n as { data?: unknown }).data
      if ((data as { kind?: string })?.kind !== 'directorConsole') continue
      // 作用域：scoped 只认领自己那个节点；全局跳过已被 Modal 接管的节点
      if (onlyNodeId ? n.id !== onlyNodeId : openDirectorModalNodes.has(n.id)) continue
      const pending = readPending(data)
      if (!pending || processedRef.current.has(pending.captureId)) continue
      busyRef.current = true
      processedRef.current.add(pending.captureId)
      const nodeId = n.id
      void (async () => {
        try {
          const claimed = await claimDirectorCapture(pending.captureId)
          if (!claimed.ok || !claimed.leaseToken) {
            busyRef.current = false
            return
          }
          const scene = asRecord(claimed.scene ?? pending.scene)
          setJob({ pending, nodeId, leaseToken: claimed.leaseToken, scene })
        } catch {
          busyRef.current = false
        }
      })()
      break
    }
  }, [nodes, job, onlyNodeId])

  if (!job) return null
  const onDone = () => {
    setJob(null)
    busyRef.current = false
  }
  if (job.pending.mode === 'clip') {
    return <OffscreenClipRender job={job} onDone={onDone} />
  }
  return <OffscreenCapture job={job} onDone={onDone} />
}

/**
 * 从 capture job 派生离屏渲染用的 DirectorScene（角色 + 单个 capture-cam）。
 * image / clip 两个离屏组件共用，避免重复 40 行场景重建逻辑。
 * clip 模式下 capture-cam 的 position/lookAt/fov 由动画逐帧覆盖，此处初值无所谓。
 */
function useRenderSceneFromJob(job: CaptureJob, camId: string): DirectorScene {
  return React.useMemo(() => {
    const cam = asRecord(job.scene.camera)
    const rawCharacters = Array.isArray(job.scene.characters) ? job.scene.characters : []
    const characters: CharacterObj[] = rawCharacters.map((raw, idx) => {
      const c = asRecord(raw)
      return {
        id: typeof c.id === 'string' ? c.id : `char-${idx}`,
        name: typeof c.name === 'string' ? c.name : `角色${idx + 1}`,
        modelId: typeof c.modelId === 'string' ? c.modelId : '',
        position: asVec3(c.position, [0, 0, 0]),
        rotation: asVec3(c.rotation, [0, 0, 0]),
        scale: asVec3(c.scale, [1, 1, 1]),
        uniformScale: typeof c.uniformScale === 'number' ? c.uniformScale : 1,
        colorHex: typeof c.colorHex === 'string' ? c.colorHex : '#9aa7b8',
        posePresetId: typeof c.posePresetId === 'string' ? c.posePresetId : undefined,
        pose: c.pose && typeof c.pose === 'object' ? (c.pose as CharacterObj['pose']) : undefined,
      }
    })
    const aspect = (typeof job.scene.aspect === 'string' ? job.scene.aspect : '16:9') as AspectKey
    return {
      characters,
      cameras: [
        {
          id: camId,
          name: '截图机位',
          position: asVec3(cam.position, [6, 4.5, 13]),
          lookAtMode: typeof cam.lookAtMode === 'string' ? cam.lookAtMode : 'manual',
          lookAt: asVec3(cam.lookAt, [0, 1, 0]),
          fovDeg: typeof cam.fovDeg === 'number' ? cam.fovDeg : 45,
        },
      ],
      aspect,
      activeCameraId: camId,
      skybox: typeof job.scene.skybox === 'string' ? job.scene.skybox : undefined,
      skyboxYaw: typeof (job.scene as { skyboxYaw?: unknown }).skyboxYaw === 'number' ? (job.scene as { skyboxYaw?: number }).skyboxYaw : undefined,
      skyboxPitch: typeof (job.scene as { skyboxPitch?: unknown }).skyboxPitch === 'number' ? (job.scene as { skyboxPitch?: number }).skyboxPitch : undefined,
      customMotions: Array.isArray((job.scene as { customMotions?: unknown }).customMotions)
        ? ((job.scene as { customMotions?: DirectorScene['customMotions'] }).customMotions)
        : undefined,
    }
  }, [job.scene, camId])
}

function OffscreenCapture({ job, onDone }: { job: CaptureJob; onDone: () => void }) {
  const ref = React.useRef<ViewportHandle | null>(null)
  const firedRef = React.useRef(false)
  const camId = 'capture-cam'

  // 看门狗：GLB 挂起/onSceneReady 不触发时，限时上报失败并释放执行器，
  // 否则 busyRef 永久卡死，本页面从此不再认领任何 capture（服务端表现为 claim 超时）。
  React.useEffect(() => {
    const watchdog = window.setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      void reportDirectorCapture({
        captureId: job.pending.captureId,
        leaseToken: job.leaseToken,
        status: 'failed',
        error: '离屏渲染超时（场景未就绪）',
      }).catch(() => {}).then(() => onDone())
    }, 60_000)
    return () => window.clearTimeout(watchdog)
  }, [job, onDone])

  const renderScene = useRenderSceneFromJob(job, camId)

  const ratio = aspectRatio(renderScene.aspect, 16 / 9) || 16 / 9
  const w = 1280
  const h = Math.round(w / ratio)

  const onReady = React.useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    void (async () => {
      try {
        const dataUrl = ref.current?.captureView()
        if (!dataUrl) throw new Error('captureView 返回空')
        const blob = await dataUrlToBlob(dataUrl)
        const hosted = await uploadCanvasImageBlob({
          blob,
          label: '导演台占位图',
          filePrefix: 'director-shot',
          ownerNodeId: job.nodeId,
        })
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'succeeded',
          imageUrl: hosted.url,
          assetId: hosted.assetId,
        })
      } catch (e) {
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'failed',
          error: String((e as Error)?.message ?? e),
        }).catch(() => {})
      } finally {
        onDone()
      }
    })()
  }, [job, onDone])

  return (
    <div
      style={{ position: 'fixed', left: -10000, top: 0, width: w, height: h, visibility: 'hidden', pointerEvents: 'none' }}
      aria-hidden
    >
      <Viewport
        ref={ref}
        scene={renderScene}
        viewpoint="camera"
        onSceneReady={onReady}
        onSelect={() => {}}
        onPatchCharacter={() => {}}
        onPatchCamera={() => {}}
      />
    </div>
  )
}

/** anim 是否可直接喂采样器：cameras/characters 必须是对象（否则 sampleAnimationAt 会 Object.entries(null) 崩）。 */
function isUsableClipAnim(a: unknown): a is ClipAnimation {
  if (!a || typeof a !== 'object') return false
  const o = a as Record<string, unknown>
  return typeof o.fps === 'number'
    && !!o.cameras && typeof o.cameras === 'object'
    && !!o.characters && typeof o.characters === 'object'
}

/** clip 缺/坏 animation 时，从场景机位合成默认 360° 环绕 clip（满足「镜头环绕」诉求，且 cameras={} 不崩）。 */
function synthOrbitClip(scene: DirectorScene, durationSeconds: number): ClipAnimation {
  const cam0 = scene.cameras[0]
  const p = cam0?.position
  const orbit: CameraOrbit = {
    center: [0, 0, 0],
    radius: p ? Math.max(2, Math.hypot(p[0], p[2])) : 6,
    height: p ? p[1] : 1.6,
    degrees: 360,
    lookAtHeight: cam0?.lookAt ? cam0.lookAt[1] : 1.3,
    fovDeg: cam0?.fovDeg ?? 40,
  }
  return buildShotClip(scene, { id: 'auto-orbit', name: 'auto', durationSeconds: Math.max(0.5, durationSeconds), cameraMove: { kind: 'orbit', orbit } }, 24)
}

/**
 * clip 模式离屏执行器：把 pending.animation 用确定性采样器逐帧展开 → Viewport.captureClipFrames
 * 离屏渲一段 clay 灰模动画 → WebCodecs 硬编 mp4（缺失降级 ffmpeg.wasm）→ 上传 TOS →
 * reportDirectorCapture({ videoUrl })，后端据此建带 sourceVideoUrl 的 video 节点（seedance v2v 入口）。
 */
function OffscreenClipRender({ job, onDone }: { job: CaptureJob; onDone: () => void }) {
  const ref = React.useRef<ViewportHandle | null>(null)
  const firedRef = React.useRef(false)
  const camId = 'capture-cam'
  const anim = job.pending.animation
  const renderScene = useRenderSceneFromJob(job, camId)

  // 看门狗：样片渲染 + 编码耗时长（数十帧逐帧 readback + 编码），watchdog 设 220s。
  // 必须 < 服务端 clip 渲染窗口（240s），让浏览器有机会先自报失败、服务端再据此收尾，
  // 而非服务端先超时把任务判死还堵住下一次 claim（长 clip 帧多务必配合降帧率，见下方提示）。
  React.useEffect(() => {
    const watchdog = window.setTimeout(() => {
      if (firedRef.current) return
      firedRef.current = true
      void reportDirectorCapture({
        captureId: job.pending.captureId,
        leaseToken: job.leaseToken,
        status: 'failed',
        error: '离屏渲染超时（样片渲染/编码未完成）',
      }).catch(() => {}).then(() => onDone())
    }, 220_000)
    return () => window.clearTimeout(watchdog)
  }, [job, onDone])

  const onReady = React.useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    // 缺/坏 animation（小T 常给不出合法逐帧轨道、或 cameras=null）→ 从场景机位合成默认 360° 环绕 clip，
    // 而非崩在 Object.entries(null) 或直接判失败。所见即所得地满足「镜头环绕」。
    const animDur = typeof anim?.durationSeconds === 'number' ? anim.durationSeconds : 4
    const effectiveAnim: ClipAnimation = isUsableClipAnim(anim) ? anim : synthOrbitClip(renderScene, animDur)
    void (async () => {
      try {
        // 采成每帧 camera/character transform（camId 命名容错：取 capture-cam，缺则取第一个相机轨道）
        const frames: ClipFrame[] = frameTimestamps(effectiveAnim).map((t) => {
          const s = sampleAnimationAt(effectiveAnim, t)
          const cam = s.cameras[camId] ?? Object.values(s.cameras)[0]
          return {
            position: cam?.position ?? [6, 4.5, 13],
            lookAt: cam?.lookAt ?? [0, 1, 0],
            fovDeg: cam?.fovDeg ?? 45,
            characters: s.characters,
          }
        })
        const useWebCodecs = isWebCodecsMp4Supported()
        // holder 对象：编码器在 onFrame 闭包内惰性创建（需首帧尺寸），用对象属性避免闭包内 let 重赋值丢失类型收窄
        const encHolder: { enc: Mp4ClipEncoder | null } = { enc: null }
        const fallback: ImageBitmap[] = []
        await ref.current!.captureClipFrames({
          frames,
          clay: true,
          onFrame: async (bmp, i) => {
            if (useWebCodecs) {
              if (!encHolder.enc) encHolder.enc = createWebCodecsEncoder({ width: bmp.width, height: bmp.height, fps: effectiveAnim.fps })
              encHolder.enc.addBitmap(bmp, i)
            } else {
              // Viewport 回调返回后会 close 原 bitmap，兜底路径需 clone 留存到编码时
              fallback.push(await createImageBitmap(bmp))
            }
          },
        })
        const mp4 = encHolder.enc ? await encHolder.enc.finish() : await encodeBitmapsWithFfmpeg(fallback, effectiveAnim.fps)
        const hosted = await uploadCanvasVideoBlob({
          blob: mp4,
          label: '导演台灰模样片',
          filePrefix: 'director-clip',
          ownerNodeId: job.nodeId,
        })
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'succeeded',
          videoUrl: hosted.url,
          assetId: hosted.assetId,
        })
      } catch (e) {
        await reportDirectorCapture({
          captureId: job.pending.captureId,
          leaseToken: job.leaseToken,
          status: 'failed',
          error: String((e as Error)?.message ?? e),
        }).catch(() => {})
      } finally {
        onDone()
      }
    })()
  }, [job, onDone, anim])

  const ratio = aspectRatio(renderScene.aspect, 16 / 9) || 16 / 9
  const w = 1280
  const h = Math.round(w / ratio)

  return (
    <div
      style={{ position: 'fixed', left: -10000, top: 0, width: w, height: h, visibility: 'hidden', pointerEvents: 'none' }}
      aria-hidden
    >
      <Viewport
        ref={ref}
        scene={renderScene}
        viewpoint="camera"
        onSceneReady={onReady}
        onSelect={() => {}}
        onPatchCharacter={() => {}}
        onPatchCamera={() => {}}
      />
    </div>
  )
}
