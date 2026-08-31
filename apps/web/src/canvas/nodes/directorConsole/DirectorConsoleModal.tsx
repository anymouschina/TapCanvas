import React from 'react'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { useRFStore } from '../../store'
import { useUIStore } from '../../../ui/uiStore'
import { DirectorCaptureRunner, openDirectorModalNodes } from './DirectorCaptureRunner'
import type { DirectorConsoleData, CameraShot, Vec3 } from './types'
import {
  addCharacter, addCamera, selectObject, removeObject,
  patchCharacter, patchCamera, setAspect, setViewpoint, setActiveCamera, setSkybox, setSkyboxYaw, setSkyboxPitch,
} from './state/scene'
import { createHistory, pushHistory, undoHistory, redoHistory, snapshotOf, type HistorySnapshot } from './state/history'
import { copySelection, pasteClipboard, type DirectorClipboard } from './state/clipboard'
import { addCrowdCharacters, patchCrowdMembers, removeCrowd, crowdMembers, CROWD_BROADCAST_KEYS, type CrowdBroadcastPatch, type CrowdInput } from './state/crowd'
import { aspectFrameRect } from './state/aspect'
import { AspectFrameOverlay } from './panels/AspectFrameOverlay'
import { Viewport, type ViewportHandle, type GizmoMode, type ClipFrame } from './scene/Viewport'
import { SceneTreePanel } from './panels/SceneTreePanel'
import { CharacterPropertiesPanel } from './panels/CharacterPropertiesPanel'
import { CameraPropertiesPanel, type ClipSettings } from './panels/CameraPropertiesPanel'
import { Toolbar } from './panels/Toolbar'
import { uploadCanvasImageBlob, dataUrlToBlob } from './uploadCanvasImageBlob'
import { uploadCanvasVideoBlob } from './uploadCanvasVideoBlob'
import { sendShotsToCanvas, sendClipsToCanvas, sendClipChainToCanvas, type HostedClip } from './sendToCanvas'
import { sampleAnimationAt, frameTimestamps, type ClipAnimation } from './scene/clipAnimation'
import { buildRecordedCamera, type FlySample, type RecordedCamera } from './state/cameraRecording'
import { createWebCodecsEncoder, encodeBitmapsWithFfmpeg, isWebCodecsMp4Supported, type Mp4ClipEncoder } from '../../../utils/clipEncode'
import { addWaypoint, moveWaypoint } from './state/motionEdit'
import { TimelinePanel } from './panels/TimelinePanel'
import { ensureTimeline, timelineDuration, activeShotAt, sampleShotCamera, addShot as tlAddShot, patchShot as tlPatchShot, removeShot as tlRemoveShot, moveShot as tlMoveShot, type Shot, type SceneTimeline } from './state/timeline'
import { buildShotClip } from './state/previewClip'
import { concatMotionPresets } from './state/motionPresets'
import { shotCameraPathPoints } from './state/cameraPath'
import { advancePlayhead } from './state/playback'
import { buildTimelineFrames, buildTimelineFramesRange, timelineFrameAt } from './state/timelineRender'
import { addCamWaypoint, moveCamWaypoint, setCamPathMode, setCamPathHeight, setCamPathLookAt, clearCamPath } from './state/cameraPathEdit'

let uidCounter = 0
const uid = (p: string) => `${p}-${Date.now()}-${uidCounter++}`

type Props = { nodeId: string; onClose: () => void }

export default function DirectorConsoleModal({ nodeId, onClose }: Props) {
  const updateNodeData = useRFStore((s) => s.updateNodeData)
  const storeData = useRFStore((s) => s.nodes.find((n) => n.id === nodeId)?.data) as DirectorConsoleData | undefined
  const [data, setData] = React.useState<DirectorConsoleData>(() => storeData ?? ({} as DirectorConsoleData))
  const dataRef = React.useRef(data); dataRef.current = data
  const viewportRef = React.useRef<ViewportHandle | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [gizmoMode, setGizmoMode] = React.useState<GizmoMode>('translate')
  // 截图画廊：本地内存（dataURL），不写 node.data/Yjs，发送到画布时才上传——对齐 liblib
  const [shots, setShots] = React.useState<Record<string, CameraShot[]>>({})
  // 右栏 摄像机 面板 tab（受控：截图后自动切到「摄像机截图」）
  const [cameraTab, setCameraTab] = React.useState<'props' | 'shots'>('props')
  // 灰模样片渲染设置（人工）
  const [clipSettings, setClipSettings] = React.useState<ClipSettings>({ durationSeconds: 4, fps: 24, orbitDegrees: 360, orbitRadius: 6 })
  // 相机运镜预览（机位视角下当场按 orbit 或录制轨迹播放）
  const [previewOrbit, setPreviewOrbit] = React.useState(false)
  // 飞行录制 + 录得的运镜轨迹
  const [flyMode, setFlyMode] = React.useState(false)
  const [flyRecording, setFlyRecording] = React.useState(false)
  const [flySpeed, setFlySpeed] = React.useState(8)
  const [recordedCam, setRecordedCam] = React.useState<RecordedCamera | null>(null)
  const flySamplesRef = React.useRef<FlySample[]>([])
  const flyModeRef = React.useRef(flyMode)
  flyModeRef.current = flyMode

  const [drawPathActive, setDrawPathActive] = React.useState(false)
  const [drawCamPathActive, setDrawCamPathActive] = React.useState(false)
  const [selWp, setSelWp] = React.useState<number | undefined>(undefined)
  // 导演台内吐司（modal 在画布之上，全局 toast 会被盖住）
  const [modalToast, setModalToast] = React.useState<{ msg: string; type: 'success' | 'error' | 'warning' | 'info' } | null>(null)
  const toastTimerRef = React.useRef<number | null>(null)
  const showToast = React.useCallback((msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setModalToast({ msg, type })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setModalToast(null), 2800)
  }, [])
  // 全局时间线播放：playhead(全局秒)/playing/倍速/选中镜头
  const [playhead, setPlayhead] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [playSpeed, setPlaySpeed] = React.useState(1)
  const [selectedShotId, setSelectedShotId] = React.useState<string | undefined>(undefined)
  // 「当前镜头机位」POV 小窗（对齐参考视频右上预览）；默认开，性能吃紧可关
  const [showPov, setShowPov] = React.useState(true)
  // 时间轴镜头片段缩略图胶片条（每镜头沿时长 ~每秒一帧，看相机运动）；scene 变更后防抖重渲
  const [shotThumbs, setShotThumbs] = React.useState<Record<string, string[]>>({})
  // 导演台内「小T·动画师」聊天面板
  // 复用画布右侧那个对话抽屉(AiChatDialog)，不另起一套。它的真正显隐开关是 AiChatDialog 暴露的
  // window.__tcExpandChat/__tcToggleChat（compact 模式的右下浮标已隐藏、入口并进底部栏，被全屏 modal 盖住）；
  // uiStore.aiChatOpen 只是 AiChatDialog 回写的镜像，用来高亮按钮。
  const aiChatOpen = useUIStore((s) => s.aiChatOpen)
  const toggleCanvasChat = React.useCallback(() => {
    const w = window as unknown as { __tcToggleChat?: () => void; __tcExpandChat?: () => void }
    ;(w.__tcToggleChat ?? w.__tcExpandChat)?.()
  }, [])
  // 导演台是全屏 modal(z 4000)，画布抽屉默认 z 650 会被盖住；挂 body class 让 CSS 把抽屉抬到 modal 之上。
  React.useEffect(() => {
    document.body.classList.add('tc-director-console-open')
    return () => { document.body.classList.remove('tc-director-console-open') }
  }, [])
  // 接管本节点的 capture 认领：打开导演台时由 Modal 内挂的 scoped runner 负责（鲜活、不会被全局 runner 的 busyRef 卡死），
  // 全局 runner 跳过本节点。这样「在导演台里让小T 出图/出片」不再出现「无浏览器认领」。
  React.useEffect(() => {
    openDirectorModalNodes.add(nodeId)
    return () => { openDirectorModalNodes.delete(nodeId) }
  }, [nodeId])
  // 导演台内的小T 会话与项目主对话隔离：打开时把本节点写入会话作用域，AiChatDialog 据此切到 director lane；关闭清空。
  const setDirectorChatScopeNodeId = useUIStore((s) => s.setDirectorChatScopeNodeId)
  React.useEffect(() => {
    setDirectorChatScopeNodeId(nodeId)
    return () => setDirectorChatScopeNodeId(null)
  }, [nodeId, setDirectorChatScopeNodeId])
  // 时间线长片拆分提示：合成时若超出单段上限(15s)，弹确认对话框（对话内补充每段时长后确认拆分 / 直接输出整段）
  const [splitPrompt, setSplitPrompt] = React.useState<{ totalSec: number } | null>(null)
  const [splitSeconds, setSplitSeconds] = React.useState(15)

  // 变换模式快捷键 V/R/S（工具条按钮 title 中已标注）
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flyModeRef.current) return // 飞行录制中 WSAD/R/F 归飞行控制器
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'v') setGizmoMode('translate')
      else if (k === 'r') setGizmoMode('rotate')
      else if (k === 's') setGizmoMode('scale')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── 撤销/重做：所有变更都经 apply() 单点落盘 → scene 引用变化即入栈（连续拖拽按时间窗合并） ──
  const historyRef = React.useRef(createHistory())
  const [histCounts, setHistCounts] = React.useState({ undo: 0, redo: 0 })
  const syncHistCounts = React.useCallback(() => {
    setHistCounts({ undo: historyRef.current.undo.length, redo: historyRef.current.redo.length })
  }, [])

  const apply = React.useCallback((next: DirectorConsoleData) => {
    const before = dataRef.current
    if (before.scene && next.scene !== before.scene) {
      historyRef.current = pushHistory(historyRef.current, snapshotOf(before.scene, before.selectedObjectId), performance.now())
      syncHistCounts()
    }
    setData(next)
    updateNodeData(nodeId, { scene: next.scene, activeViewpoint: next.activeViewpoint, selectedObjectId: next.selectedObjectId } as Record<string, unknown>)
  }, [nodeId, updateNodeData, syncHistCounts])

  // 撤销/重做恢复：不经 apply（不能再入栈）
  const restoreSnapshot = React.useCallback((snap: HistorySnapshot) => {
    const d = dataRef.current
    const next = { ...d, scene: snap.scene, selectedObjectId: snap.selectedObjectId }
    setData(next)
    updateNodeData(nodeId, { scene: next.scene, activeViewpoint: next.activeViewpoint, selectedObjectId: next.selectedObjectId } as Record<string, unknown>)
  }, [nodeId, updateNodeData])

  const onUndo = React.useCallback(() => {
    const d = dataRef.current
    if (!d.scene) return
    const step = undoHistory(historyRef.current, snapshotOf(d.scene, d.selectedObjectId), performance.now())
    if (!step) return
    historyRef.current = step.history
    syncHistCounts()
    restoreSnapshot(step.snapshot)
  }, [restoreSnapshot, syncHistCounts])

  const onRedo = React.useCallback(() => {
    const d = dataRef.current
    if (!d.scene) return
    const step = redoHistory(historyRef.current, snapshotOf(d.scene, d.selectedObjectId), performance.now())
    if (!step) return
    historyRef.current = step.history
    syncHistCounts()
    restoreSnapshot(step.snapshot)
  }, [restoreSnapshot, syncHistCounts])

  // ── 复制/粘贴（对象级剪贴板）：Cmd/Ctrl+C 复制选中角色/机位，Cmd/Ctrl+V 递增偏移粘贴 ──
  const clipboardRef = React.useRef<DirectorClipboard | null>(null)
  const pasteCountRef = React.useRef(0)
  const onCopy = React.useCallback((): boolean => {
    const clip = copySelection(dataRef.current)
    if (!clip) return false
    clipboardRef.current = clip
    pasteCountRef.current = 0
    showToast(`已复制「${clip.kind === 'character' ? clip.character.name : clip.camera.name}」，Cmd/Ctrl+V 粘贴`, 'info')
    return true
  }, [showToast])
  const onPaste = React.useCallback((): boolean => {
    const clip = clipboardRef.current
    if (!clip) return false
    pasteCountRef.current += 1
    apply(pasteClipboard(dataRef.current, clip, uid(clip.kind === 'character' ? 'char' : 'cam'), pasteCountRef.current))
    return true
  }, [apply])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flyModeRef.current) return
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo()
        else onUndo()
      } else if (k === 'c' && !e.shiftKey) {
        if (window.getSelection()?.toString()) return // 有文本选区时让系统复制
        if (onCopy()) e.preventDefault()
      } else if (k === 'v' && !e.shiftKey) {
        if (onPaste()) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUndo, onRedo, onCopy, onPaste])

  // 选中对象的键盘操作：方向键微调（拖拽难精调）：←→↑↓ 沿地面、Alt+↑↓ 调高度；Shift=0.5m 粗调，默认 0.1m；
  // Delete/Backspace 删除（锁定对象不响应）。↑ 的方向取当前相机朝向在地面上的投影并吸附到最近世界轴，保证按键方向与屏幕直觉一致。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flyModeRef.current) return // 飞行录制中方向键归飞行控制器
      const isArrow = e.key.startsWith('Arrow')
      const isDelete = e.key === 'Delete' || e.key === 'Backspace'
      if (!isArrow && !isDelete) return
      if (e.metaKey || e.ctrlKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const id = data.selectedObjectId
      if (!id || !data.scene) return
      const ch = data.scene.characters.find((c) => c.id === id)
      const cam = ch ? undefined : data.scene.cameras.find((c) => c.id === id)
      const obj = ch ?? cam
      if (!obj || obj.locked) return
      e.preventDefault()
      if (isDelete) {
        apply(removeObject(data, id))
        return
      }
      const step = e.shiftKey ? 0.5 : 0.1
      let dx = 0, dy = 0, dz = 0
      if (e.altKey) {
        if (e.key === 'ArrowUp') dy = step
        else if (e.key === 'ArrowDown') dy = -step
        else return
      } else {
        let fx = 0, fz = -1
        const view = viewportRef.current?.getCurrentCamera()
        if (view) {
          const vx = view.lookAt[0] - view.position[0]
          const vz = view.lookAt[2] - view.position[2]
          if (Math.abs(vx) > Math.abs(vz)) { fx = Math.sign(vx) || 1; fz = 0 } else { fx = 0; fz = Math.sign(vz) || -1 }
        }
        const rx = -fz, rz = fx // forward 绕 y 轴 -90° 即屏幕右方
        if (e.key === 'ArrowUp') { dx = fx * step; dz = fz * step }
        else if (e.key === 'ArrowDown') { dx = -fx * step; dz = -fz * step }
        else if (e.key === 'ArrowRight') { dx = rx * step; dz = rz * step }
        else if (e.key === 'ArrowLeft') { dx = -rx * step; dz = -rz * step }
      }
      const r3 = (v: number) => Math.round(v * 1000) / 1000 // 消浮点累加噪声（0.6000000000000001）
      const pos: Vec3 = [r3(obj.position[0] + dx), r3(obj.position[1] + dy), r3(obj.position[2] + dz)]
      apply(ch ? patchCharacter(data, id, { position: pos }) : patchCamera(data, id, { position: pos }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, apply])

  // 全景背景：读取连入导演台左侧输入口的图片节点 URL（对齐 liblib：连线喂入）
  const connectedPanoUrl = useRFStore((s) => {
    const inc = s.edges.find((e) => e.target === nodeId)
    if (!inc) return undefined
    const src = s.nodes.find((n) => n.id === inc.source)
    const d = src?.data as any
    if (!d) return undefined
    if (typeof d.imageUrl === 'string' && d.imageUrl.trim()) return d.imageUrl.trim()
    if (Array.isArray(d.imageResults) && typeof d.imageResults[0]?.url === 'string') return d.imageResults[0].url
    if (Array.isArray(d.results) && typeof d.results[0]?.url === 'string') return d.results[0].url
    if (typeof d.url === 'string' && d.url.trim()) return d.url.trim()
    return undefined
  }) as string | undefined

  const scene = data.scene
  const selectedId = data.selectedObjectId
  const selectedCamera = scene?.cameras.find((c) => c.id === selectedId)
  const selectedCharacter = scene?.characters.find((c) => c.id === selectedId)

  // 选中对象变化时重置路径绘制和路点选中
  React.useEffect(() => { setDrawPathActive(false); setDrawCamPathActive(false); setSelWp(undefined) }, [selectedId])

  // ── 全局时间线（动画化 blocking 的编排/播放层） ──────────────────────────────

  // 实时同步：小T(或其它外部 flow_patch)改了本节点 scene → 灌进模态。
  // 判源靠 scene 引用：自己 apply 后 store.scene === 本地 scene（同引用，不回灌）；外部改 = 新引用 → 同步。
  // 外部改动也入撤销栈：Cmd+Z 可回滚小T 的摆位。
  React.useEffect(() => {
    if (storeData?.scene && storeData.scene !== dataRef.current.scene) {
      if (dataRef.current.scene) {
        historyRef.current = pushHistory(historyRef.current, snapshotOf(dataRef.current.scene, dataRef.current.selectedObjectId), performance.now())
        syncHistCounts()
      }
      setData(storeData)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData])
  const timeline = React.useMemo(() => ensureTimeline(scene?.timeline), [scene?.timeline])
  // 全局时间线总长 = max(各镜头时长之和, 各角色动作时长) —— 让 ▶播放/播放头也覆盖角色（即便镜头较短/没镜头）
  const maxCharDur = (scene?.characters ?? []).reduce((m, c) => Math.max(m, c.motion?.durationSeconds ?? 0), 0)
  const totalDuration = Math.max(timelineDuration(timeline), maxCharDur)
  const active = React.useMemo(() => activeShotAt(timeline, playhead), [timeline, playhead])
  const selectedShot = timeline.shots.find((s) => s.id === selectedShotId)
  // 播放中聚焦当前镜头；停时聚焦选中镜头（无则当前镜头）
  const focusShot: Shot | undefined = playing ? active?.shot : (selectedShot ?? active?.shot)
  // 时间线镜头 → 既有预览/渲染管线吃的 ClipAnimation；有镜头时优先于旧 previewOrbit 流
  const timelineClip = React.useMemo(
    () => (scene && focusShot ? buildShotClip(scene, focusShot, clipSettings.fps) : null),
    [scene, focusShot, clipSettings.fps],
  )
  // 始终把 POV 采样钉在【时间轴播放头】：播放=跟着走，暂停=冻结在当前帧（不再自循环空转）。
  // 时间轴是唯一时间源——拖动播放头即 scrub 所有相机。
  const timelinePreviewTime = active ? active.localT : null
  const cameraPath = React.useMemo(() => {
    // 绘制相机路径时，直接画该机位的路径（不依赖时间线）
    if (drawCamPathActive && selectedCamera?.path && (selectedCamera.path.waypoints?.length ?? 0) >= 2 && scene) {
      return shotCameraPathPoints(scene, { id: '_draw', name: '_', durationSeconds: 4, cameraId: selectedCamera.id, cameraMove: { kind: 'path' } })
    }
    return scene && focusShot ? shotCameraPathPoints(scene, focusShot) : undefined
  }, [drawCamPathActive, selectedCamera, scene, focusShot])
  // 相机图标沿运镜路径滑行 —— 同样钉在播放头（暂停冻结、scrub 跟随），与 POV 一致。
  const liveCamera = React.useMemo(() => {
    if (!active || !scene) return null
    const { cameraId, camera } = sampleShotCamera(scene, active.shot, active.localT)
    if (!cameraId || !camera) return null
    return { id: cameraId, position: camera.position, lookAt: camera.lookAt, fovDeg: camera.fovDeg }
  }, [active, scene])

  // 人物动画与全局时间线同步：有镜头时全体角色由播放头驱动（暂停冻结、scrub 跟随、和相机同一个时钟）；
  // 无镜头时退回旧的单角色自播预览（MotionPanel 的预览开关）。
  // 有镜头或有角色动作 → 全体由全局播放头驱动（暂停冻结、scrub 跟随）；都没有则静态
  const timelineDrive = timeline.shots.length > 0 || (scene?.characters ?? []).some((c) => c.motion || c.motionClip || (c.motionSequence?.length ?? 0) > 0)
  const motionDriveTime = timelineDrive ? playhead : null
  const motionPreviewObj = { playing: timelineDrive, characterId: undefined as string | undefined }

  const withTimeline = React.useCallback((fn: (tl: SceneTimeline) => SceneTimeline): DirectorConsoleData => {
    const d = dataRef.current
    return { ...d, scene: { ...d.scene, timeline: fn(ensureTimeline(d.scene?.timeline)) } }
  }, [])

  // rAF 播放循环：playing 时按 dt*倍速 推进 playhead（回绕循环）
  const playRefs = React.useRef({ playSpeed, playhead, total: totalDuration })
  playRefs.current = { playSpeed, playhead, total: totalDuration }
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now
      const r = playRefs.current
      const step = advancePlayhead(r.playhead, dt, r.playSpeed, r.total, true)
      r.playhead = step.t
      setPlayhead(step.t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // 播放中跨镜头切机位（让主视口 POV 切到当前镜头的机位）
  React.useEffect(() => {
    if (!playing) return
    const camId = active?.shot.cameraId
    const d = dataRef.current
    if (camId && d.scene?.activeCameraId !== camId) apply(setActiveCamera(d, camId))
  }, [playing, active?.shot.id, apply])

  const onPlayToggle = React.useCallback(() => {
    setPlaying((p) => {
      const next = !p
      if (next) {
        // 起播：确保有机位即可。主视口保持导演视角（看场景+角色+相机路径动），
        // 右侧「当前镜头机位」小窗负责实时 POV（对齐参考视频的同屏布局）。
        const d = dataRef.current
        if (!(d.scene?.cameras?.length)) apply(addCamera(d, { id: uid('cam'), position: [0, 1.6, 6], lookAt: [0, 1.3, 0], fovDeg: 40 }))
      }
      return next
    })
  }, [apply])
  const onResetPlayhead = React.useCallback(() => { setPlayhead(0); playRefs.current.playhead = 0 }, [])
  const onSeek = React.useCallback((t: number) => { setPlayhead(t); playRefs.current.playhead = t }, [])
  const onAddShot = React.useCallback(() => {
    const d = dataRef.current
    const camId = d.scene?.activeCameraId ?? d.scene?.cameras?.[0]?.id
    apply(withTimeline((tl) => tlAddShot(tl, { cameraId: camId, durationSeconds: clipSettings.durationSeconds })))
  }, [apply, withTimeline, clipSettings.durationSeconds])
  const onPatchShot = React.useCallback((id: string, patch: Partial<Shot>) => apply(withTimeline((tl) => tlPatchShot(tl, id, patch))), [apply, withTimeline])
  const onRemoveShot = React.useCallback((id: string) => {
    apply(withTimeline((tl) => tlRemoveShot(tl, id)))
    setSelectedShotId((s) => (s === id ? undefined : s))
  }, [apply, withTimeline])
  const onSelectShot = React.useCallback((id: string | undefined) => {
    setSelectedShotId(id)
    if (!id) return
    // 定位 playhead 到该镜头起点
    const tl = ensureTimeline(dataRef.current.scene?.timeline)
    let acc = 0
    for (const s of tl.shots) { if (s.id === id) break; acc += Math.max(0, s.durationSeconds || 0) }
    onSeek(acc)
  }, [onSeek])
  const onMoveShot = React.useCallback((id: string, toIndex: number) => apply(withTimeline((tl) => tlMoveShot(tl, id, toIndex))), [apply, withTimeline])
  const onCaptureShot = React.useCallback(() => {
    const d = dataRef.current
    const camId = d.scene?.activeCameraId ?? d.scene?.cameras?.[0]?.id
    const cs = d.scene?.characters ?? []
    let move: Shot['cameraMove']
    let dur = clipSettings.durationSeconds
    if (recordedCam) {
      move = { kind: 'recorded', tracks: recordedCam.tracks }; dur = recordedCam.durationSeconds
    } else {
      const cx = cs.length ? cs.reduce((a, c) => a + c.position[0], 0) / cs.length : 0
      const cz = cs.length ? cs.reduce((a, c) => a + c.position[2], 0) / cs.length : 0
      move = { kind: 'orbit', orbit: { center: [cx, 0, cz], radius: clipSettings.orbitRadius, degrees: clipSettings.orbitDegrees, height: 1.6, lookAtHeight: 1.3, fovDeg: 40 } }
    }
    apply(withTimeline((tl) => tlAddShot(tl, { cameraId: camId, durationSeconds: dur, cameraMove: move })))
    showToast('已把当前运镜加入时间线', 'success')
  }, [recordedCam, clipSettings, apply, withTimeline])

  // 截图（对齐 liblib）：在当前视角新建一个机位 + 给它拍 1 张图（一机位一图）
  // 画幅框可见时按 框高/视口高 收窄 FOV → 截图只含框内内容（所见即所得）
  const onCapture = React.useCallback(() => {
    const view = viewportRef.current?.getCurrentCamera()
    const box = viewportBoxRef.current
    const frame = box && scene ? aspectFrameRect(scene.aspect, box.clientWidth, box.clientHeight) : null
    const fovScale = frame && box && box.clientHeight > 0 ? frame.height / box.clientHeight : undefined
    const dataUrl = viewportRef.current?.captureView(fovScale ? { fovScale } : undefined)
    if (!view || !dataUrl) { showToast('截图失败，请重试', 'error'); return }
    const newCamId = uid('cam')
    const next = addCamera(data, { id: newCamId, position: view.position, lookAt: view.lookAt, fovDeg: view.fovDeg })
    apply(next) // 持久化新机位 + 设为激活/选中
    const camName = next.scene.cameras.find((c) => c.id === newCamId)?.name ?? '机位'
    setShots((prev) => ({
      ...prev,
      [newCamId]: [{ id: uid('shot'), name: `${camName}-截图01`, imageUrl: dataUrl, aspect: scene.aspect, createdAt: Date.now() }],
    }))
    setCameraTab('shots') // 截图后自动切到「摄像机截图」，立刻看到结果——对齐 liblib
  }, [scene, data, apply])

  const onClearAll = React.useCallback(() => setShots({}), [])

  const onDeleteShot = React.useCallback((cameraId: string, shotId: string) => {
    setShots((prev) => ({ ...prev, [cameraId]: (prev[cameraId] ?? []).filter((s) => s.id !== shotId) }))
  }, [])

  // 上传 dataURL → 托管 URL → 生成参考图节点（批量或单张共用）
  const uploadAndSend = React.useCallback(async (list: CameraShot[]) => {
    if (!list.length) { showToast('该机位还没有截图', 'warning'); return }
    setBusy(true)
    try {
      const hosted: CameraShot[] = []
      for (const s of list) {
        const blob = await dataUrlToBlob(s.imageUrl)
        const h = await uploadCanvasImageBlob({ blob, label: s.name, filePrefix: 'director-shot', ownerNodeId: nodeId })
        hosted.push({ ...s, imageUrl: h.url, serverAssetId: h.assetId })
      }
      sendShotsToCanvas({
        addNode: (type, label, extra) => {
          const before = new Set(useRFStore.getState().nodes.map((n) => n.id))
          useRFStore.getState().addNode(type, label, extra as any)
          const created = useRFStore.getState().nodes.find((n) => !before.has(n.id))
          return created?.id ?? ''
        },
        connectNodes: (src, dst) => { if (dst) useRFStore.getState().onConnect({ source: src, target: dst, sourceHandle: null, targetHandle: null }) },
        nodePosition: (id) => useRFStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 },
      }, nodeId, hosted)
      showToast(`已发送 ${hosted.length} 张截图到画布`, 'success')
    } catch (e: any) {
      showToast(e?.message || '发送失败，请重试', 'error')
    } finally {
      setBusy(false)
    }
  }, [nodeId])

  const onSendAll = React.useCallback(() => uploadAndSend(Object.values(shots).flat()), [shots, uploadAndSend])
  const onSendShot = React.useCallback((cameraId: string, shotId: string) => {
    const s = (shots[cameraId] ?? []).find((x) => x.id === shotId)
    if (s) uploadAndSend([s])
  }, [shots, uploadAndSend])

  // 人工渲染灰模样片：相机环绕 + 角色 motionClip → 离屏逐帧 clay 渲染 → mp4 → 落 video 节点
  // 相机运镜来源：优先「录制轨迹」(recordedCam),否则环绕(orbit,中心=角色质心)。供渲染与预览共用。
  const cameraSourceFor = React.useCallback((fallbackDuration: number): { durationSeconds: number; cameras: ClipAnimation['cameras']; cameraOrbit?: ClipAnimation['cameraOrbit'] } => {
    if (recordedCam) return { durationSeconds: recordedCam.durationSeconds, cameras: { 'capture-cam': recordedCam.tracks } }
    const cs = data.scene?.characters ?? []
    if (cs.length === 0) return { durationSeconds: fallbackDuration, cameras: {} }
    const cx = cs.reduce((a, c) => a + c.position[0], 0) / cs.length
    const cz = cs.reduce((a, c) => a + c.position[2], 0) / cs.length
    return { durationSeconds: fallbackDuration, cameras: {}, cameraOrbit: { center: [cx, 0, cz], radius: clipSettings.orbitRadius, degrees: clipSettings.orbitDegrees, height: 1.6, lookAtHeight: 1.3, fovDeg: 40 } }
  }, [recordedCam, data, clipSettings])

  const onRenderClip = React.useCallback(() => {
    const sc = data.scene
    if (!sc || sc.characters.length === 0) { showToast('场景里先放一个角色', 'warning'); return }
    setBusy(true)
    void (async () => {
      try {
        const cs = sc.characters
        const characters: ClipAnimation['characters'] = {}
        for (const c of cs) {
          const mc = c.motionSequence?.length ? concatMotionPresets(c.motionSequence)?.id : c.motionClip
          if (mc) characters[c.id] = { motionClip: mc }
        }
        // 相机:录制轨迹优先,否则环绕。时长随之(录制=轨迹时长,环绕=设置时长)
        const camSrc = cameraSourceFor(clipSettings.durationSeconds)
        const anim: ClipAnimation = {
          durationSeconds: camSrc.durationSeconds,
          fps: clipSettings.fps,
          cameras: camSrc.cameras,
          characters,
          ...(camSrc.cameraOrbit ? { cameraOrbit: camSrc.cameraOrbit } : {}),
        }
        const frames: ClipFrame[] = frameTimestamps(anim).map((t) => {
          const s = sampleAnimationAt(anim, t)
          const cam = s.cameras['capture-cam'] ?? Object.values(s.cameras)[0]
          return {
            position: cam?.position ?? [0, 1.6, clipSettings.orbitRadius],
            lookAt: cam?.lookAt ?? [0, 1.3, 0],
            fovDeg: cam?.fovDeg ?? 40,
            characters: s.characters,
          }
        })
        const useWebCodecs = isWebCodecsMp4Supported()
        const encHolder: { enc: Mp4ClipEncoder | null } = { enc: null }
        const fallback: ImageBitmap[] = []
        await viewportRef.current!.captureClipFrames({
          frames,
          clay: true,
          onFrame: async (bmp, i) => {
            if (useWebCodecs) {
              if (!encHolder.enc) encHolder.enc = createWebCodecsEncoder({ width: bmp.width, height: bmp.height, fps: anim.fps })
              encHolder.enc.addBitmap(bmp, i)
            } else {
              fallback.push(await createImageBitmap(bmp))
            }
          },
        })
        const mp4 = encHolder.enc ? await encHolder.enc.finish() : await encodeBitmapsWithFfmpeg(fallback, anim.fps)
        const hosted = await uploadCanvasVideoBlob({ blob: mp4, label: '导演台灰模样片', filePrefix: 'director-clip', ownerNodeId: nodeId })
        sendClipsToCanvas({
          addNode: (type, label, extra) => {
            const before = new Set(useRFStore.getState().nodes.map((n) => n.id))
            useRFStore.getState().addNode(type, label, extra as any)
            const created = useRFStore.getState().nodes.find((n) => !before.has(n.id))
            return created?.id ?? ''
          },
          connectNodes: (src, dst) => { if (dst) useRFStore.getState().onConnect({ source: src, target: dst, sourceHandle: null, targetHandle: null }) },
          nodePosition: (id) => useRFStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 },
        }, nodeId, [{ url: hosted.url, assetId: hosted.assetId, name: '导演台灰模样片' }])
        showToast('已渲染灰模样片并发送到画布', 'success')
      } catch (e: any) {
        showToast(e?.message || '渲染样片失败，请重试', 'error')
      } finally {
        setBusy(false)
      }
    })()
  }, [data, clipSettings, nodeId, cameraSourceFor])

  // 单段出片上限（秒）：超过则提示拆分。时间线本身可任意长（规划层），仅出片时受此约束。
  const SEGMENT_LIMIT = 15

  // 落画布 API（增节点/连边/取位置），单段与多段共用。
  const sendApi = React.useMemo(() => ({
    addNode: (type: string, label: string, extra: Record<string, unknown>) => {
      const before = new Set(useRFStore.getState().nodes.map((n) => n.id))
      useRFStore.getState().addNode(type, label, extra as any)
      const created = useRFStore.getState().nodes.find((n) => !before.has(n.id))
      return created?.id ?? ''
    },
    connectNodes: (src: string, dst: string) => { if (dst) useRFStore.getState().onConnect({ source: src, target: dst, sourceHandle: null, targetHandle: null }) },
    nodePosition: (id: string) => useRFStore.getState().nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 },
  }), [])

  // 一组帧 → mp4（WebCodecs 优先，否则 ffmpeg 兜底）。供整段/分段渲染共用。
  const encodeFrames = React.useCallback(async (frames: ClipFrame[], fps: number): Promise<Blob> => {
    const useWebCodecs = isWebCodecsMp4Supported()
    const encHolder: { enc: Mp4ClipEncoder | null } = { enc: null }
    const fallback: ImageBitmap[] = []
    await viewportRef.current!.captureClipFrames({
      frames,
      onFrame: async (bmp, i) => {
        if (useWebCodecs) {
          if (!encHolder.enc) encHolder.enc = createWebCodecsEncoder({ width: bmp.width, height: bmp.height, fps })
          encHolder.enc.addBitmap(bmp, i)
        } else {
          fallback.push(await createImageBitmap(bmp))
        }
      },
    })
    return encHolder.enc ? await encHolder.enc.finish() : await encodeBitmapsWithFfmpeg(fallback, fps)
  }, [])

  // 按【整条时间线】合成视频：多镜头硬切 + 角色走位（钳到片段长），离屏逐帧渲染 → mp4 → 落画布 video 节点。
  // segmentSeconds 给定且总长超过它时 → 均分成 ceil(total/segmentSeconds) 段（每段等长 ≤ segmentSeconds），
  // 各自出片后竖向排布、按序连接；否则整段出一条。
  const runComposeTimeline = React.useCallback((segmentSeconds?: number) => {
    const sc = data.scene
    const tl = ensureTimeline(sc?.timeline)
    if (!sc || tl.shots.length === 0) { showToast('先在时间线上加镜头', 'warning'); return }
    const total = timelineDuration(tl)
    setBusy(true)
    void (async () => {
      try {
        const fps = clipSettings.fps
        if (segmentSeconds && total > segmentSeconds) {
          const segCount = Math.max(1, Math.ceil(total / segmentSeconds))
          const segDur = total / segCount // 均分：每段等长且 ≤ segmentSeconds
          const clips: HostedClip[] = []
          for (let k = 0; k < segCount; k++) {
            const frames = buildTimelineFramesRange(sc, tl, fps, k * segDur, (k + 1) * segDur) as ClipFrame[]
            if (!frames.length) continue
            showToast(`渲染第 ${k + 1}/${segCount} 段…`, 'info')
            const mp4 = await encodeFrames(frames, fps)
            const hosted = await uploadCanvasVideoBlob({ blob: mp4, label: `导演台时间线 第${k + 1}段`, filePrefix: 'director-timeline', ownerNodeId: nodeId })
            clips.push({ url: hosted.url, assetId: hosted.assetId, name: `时间线成片 ${k + 1}/${segCount}` })
          }
          if (!clips.length) { showToast('时间线为空', 'warning'); return }
          sendClipChainToCanvas(sendApi, nodeId, clips)
          showToast(`已拆成 ${clips.length} 段（每段 ${segDur.toFixed(1)}s）并按序发送到画布`, 'success')
        } else {
          const frames = buildTimelineFrames(sc, tl, fps) as ClipFrame[]
          if (!frames.length) { showToast('时间线为空', 'warning'); return }
          const mp4 = await encodeFrames(frames, fps)
          const hosted = await uploadCanvasVideoBlob({ blob: mp4, label: '导演台时间线成片', filePrefix: 'director-timeline', ownerNodeId: nodeId })
          sendClipsToCanvas(sendApi, nodeId, [{ url: hosted.url, assetId: hosted.assetId, name: '导演台时间线成片' }])
          showToast('已按时间线合成视频并发送到画布', 'success')
        }
      } catch (e: any) {
        showToast(e?.message || '合成失败，请重试', 'error')
      } finally {
        setBusy(false)
      }
    })()
  }, [data, clipSettings, nodeId, sendApi, encodeFrames])

  // 合成入口：总长超过单段上限 → 先弹拆分对话框；否则直接整段出片。
  const onComposeTimeline = React.useCallback(() => {
    const total = timelineDuration(ensureTimeline(data.scene?.timeline))
    if (total > SEGMENT_LIMIT) {
      setSplitSeconds(SEGMENT_LIMIT)
      setSplitPrompt({ totalSec: total })
      return
    }
    runComposeTimeline()
  }, [data, runComposeTimeline])

  // 时间轴片段缩略图：scene 变更后（防抖）为每个镜头在其起点离屏渲染该机位视角的小图
  React.useEffect(() => {
    const tl = ensureTimeline(scene?.timeline)
    if (!scene || tl.shots.length === 0) { setShotThumbs({}); return }
    let cancelled = false
    const id = window.setTimeout(() => {
      const vp = viewportRef.current
      if (!vp || cancelled) return
      const next: Record<string, string[]> = {}
      let acc = 0
      for (const shot of tl.shots) {
        const dur = Math.max(0.5, shot.durationSeconds || 0.5)
        const count = Math.min(16, Math.max(1, Math.round(dur))) // ~每秒一帧，封顶 16
        const urls: string[] = []
        for (let k = 0; k < count; k++) {
          try {
            const tt = acc + ((k + 0.5) / count) * dur // 每格取中点时刻
            const frame = timelineFrameAt(scene, tl, tt) as ClipFrame
            urls.push(vp.captureFrameAt(frame, 120, 68) || '')
          } catch { urls.push('') }
        }
        next[shot.id] = urls
        acc += dur
      }
      if (!cancelled) setShotThumbs(next)
    }, 400)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [scene])

  // 摄像机截图画廊：汇总所有机位的截图，按机位分组（对齐 liblib）
  const shotGroups = (scene?.cameras ?? [])
    .map((c) => ({ cameraId: c.id, cameraName: c.name, shots: shots[c.id] ?? [] }))
    .filter((g) => g.shots.length > 0)

  // 群演阵列：行×列×间距×素体一键铺开，共享 crowdId（场景树按组折叠、属性面板可整组广播）
  const onAddCrowd = React.useCallback((input: CrowdInput) => {
    const res = addCrowdCharacters(dataRef.current, input, () => uid('char'))
    apply(res.data)
    showToast(`已铺 ${res.memberIds.length} 个群演（${res.data.scene.characters.find((c) => c.crowdId === res.crowdId)?.crowdLabel ?? ''}）`, 'success')
  }, [apply, showToast])

  // 群演成员属性修改路由：广播开关开启时，白名单键（姿势/动作/颜色/缩放/朝向/显隐/锁定）广播全组，其余（位置/名称）只落本人
  const [crowdBroadcast, setCrowdBroadcast] = React.useState(true)
  const onCharacterPatch = React.useCallback((id: string, patch: Partial<import('./types').CharacterObj>) => {
    const d = dataRef.current
    const ch = d.scene?.characters.find((c) => c.id === id)
    if (ch?.crowdId && crowdBroadcast) {
      const broadcastKeys = CROWD_BROADCAST_KEYS.filter((k) => k in patch)
      if (broadcastKeys.length) {
        let next = patchCrowdMembers(d, ch.crowdId, patch as CrowdBroadcastPatch)
        const solo: Record<string, unknown> = { ...patch }
        for (const k of broadcastKeys) delete solo[k]
        if (Object.keys(solo).length) next = patchCharacter(next, id, solo as Partial<import('./types').CharacterObj>)
        apply(next)
        return
      }
    }
    apply(patchCharacter(d, id, patch))
  }, [apply, crowdBroadcast])

  const onUploadModel = React.useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    apply(addCharacter(data, { id: uid('char'), modelId: url }))
    showToast('已加载本地模型', 'success')
  }, [data, apply])

  const onSetSkybox = React.useCallback((file: File | null) => {
    apply(setSkybox(data, file ? URL.createObjectURL(file) : undefined))
  }, [data, apply])

  // ── 画幅取景框：跟踪视口尺寸 → 非 auto 画幅时内切居中框（框外遮罩），截图按框收窄 FOV 所见即所得 ──
  const viewportBoxRef = React.useRef<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = React.useState({ w: 0, h: 0 })
  React.useEffect(() => {
    const el = viewportBoxRef.current
    if (!el) return
    const measure = () => setViewportSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const frameRect = React.useMemo(
    () => (scene ? aspectFrameRect(scene.aspect, viewportSize.w, viewportSize.h) : null),
    [scene, viewportSize],
  )
  const [showThirds, setShowThirds] = React.useState(false)

  // 预览动画(机位视角回放):开预览时按运镜来源构建,角色动作另由 CharacterObject 实时驱动
  const previewAnim = React.useMemo<ClipAnimation | null>(() => {
    if (!previewOrbit) return null
    if (!recordedCam && (scene?.characters?.length ?? 0) === 0) return null
    const src = cameraSourceFor(clipSettings.durationSeconds)
    return { durationSeconds: src.durationSeconds, fps: clipSettings.fps, characters: {}, cameras: src.cameras, ...(src.cameraOrbit ? { cameraOrbit: src.cameraOrbit } : {}) }
  }, [previewOrbit, recordedCam, scene, clipSettings, cameraSourceFor])

  // 开运镜回放预览:自动建机位(若无)+切机位视角
  const onTogglePreviewOrbit = React.useCallback(() => {
    const next = !previewOrbit
    setPreviewOrbit(next)
    if (next) {
      let d = data
      if (!(d.scene?.cameras?.length)) d = addCamera(d, { id: uid('cam'), position: [0, 1.6, 6], lookAt: [0, 1.3, 0], fovDeg: 40 })
      if (d.activeViewpoint !== 'camera') d = setViewpoint(d, 'camera')
      if (d !== data) apply(d)
    }
  }, [previewOrbit, data, apply])

  // 飞行录制:进穿梭机视角开始采样
  const onStartFlyRecord = React.useCallback(() => {
    flySamplesRef.current = []
    setPreviewOrbit(false)
    setFlyMode(true)
    setFlyRecording(true)
  }, [])
  const onFlyFrame = React.useCallback((s: { position: Vec3; lookAt: Vec3; fovDeg: number }) => {
    flySamplesRef.current.push({ t: performance.now() / 1000, ...s })
  }, [])
  const onStopFlyRecord = React.useCallback(() => {
    setFlyRecording(false)
    setFlyMode(false)
    const rec = buildRecordedCamera(flySamplesRef.current)
    if (rec) { setRecordedCam(rec); showToast(`运镜已录制(${rec.durationSeconds.toFixed(1)}s)`, 'success') }
    else showToast('录制太短,再飞久一点', 'warning')
  }, [])
  const onClearRecordedCam = React.useCallback(() => { setRecordedCam(null); setPreviewOrbit(false) }, [])

  if (!scene) return null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: '#0a0b0d', display: 'flex', flexDirection: 'column', color: '#e5e7eb' }}>
      {/* 顶部栏 */}
      <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid #1c1f26' }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>3D导演台</div>
        {/* 机位视角已由右侧「当前镜头机位」实时预览窗替代，顶栏不再需要视角切换 */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={toggleCanvasChat} title="打开画布右侧小T 对话，按你的描述在导演台上搭场景"
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid ' + (aiChatOpen ? '#16a34a' : '#2a2f3a'), background: aiChatOpen ? '#11261a' : '#16181d', color: aiChatOpen ? '#86efac' : '#cdd3dc', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            🎬 小T·动画师
          </button>
          <span style={{ fontSize: 11, color: '#5b6470' }} title="3D 素体模型许可证">素体 © Adobe Mixamo（X Bot）</span>
          <IconX size={20} color="#9ca3af" style={{ cursor: 'pointer' }} onClick={onClose} />
        </div>
      </div>
      {/* 主体三栏 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 240, borderRight: '1px solid #1c1f26', overflowY: 'auto' }}>
          <SceneTreePanel
            scene={scene}
            selectedId={selectedId}
            onSelect={(id) => apply(selectObject(data, id))}
            onToggleHidden={(id, hidden) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { hidden }) : patchCharacter(data, id, { hidden }))
            }}
            onToggleLocked={(id, locked) => {
              const isCam = scene.cameras.some((c) => c.id === id)
              apply(isCam ? patchCamera(data, id, { locked }) : patchCharacter(data, id, { locked }))
            }}
            onToggleCrowdHidden={(crowdId, hidden) => apply(patchCrowdMembers(data, crowdId, { hidden }))}
            onRemoveCrowd={(crowdId) => apply(removeCrowd(data, crowdId))}
          />
        </div>
        <div ref={viewportBoxRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <Viewport
            ref={viewportRef}
            scene={scene}
            viewpoint="director"
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            skyboxUrl={connectedPanoUrl ?? scene.skybox}
            onSelect={(id) => apply(selectObject(data, id))}
            onPatchCharacter={(id, patch) => apply(patchCharacter(data, id, patch))}
            onPatchCamera={(id, patch) => apply(patchCamera(data, id, patch))}
            previewAnim={timelineClip ?? previewAnim}
            previewTime={timelinePreviewTime}
            cameraPath={cameraPath}
            liveCamera={liveCamera}
            flyMode={flyMode}
            flySpeed={flySpeed}
            flyRecording={flyRecording}
            onFlyFrame={onFlyFrame}
            trajectory={recordedCam?.points}
            pathDraw={drawCamPathActive && selectedCamera ? {
              active: true,
              waypoints: selectedCamera.path?.waypoints ?? [],
              mode: selectedCamera.path?.mode ?? 'linear',
              onAddWaypoint: (xz) => apply(patchCamera(data, selectedCamera.id, { path: addCamWaypoint(selectedCamera.path, xz) })),
              onMoveWaypoint: (i, xz) => apply(patchCamera(data, selectedCamera.id, { path: moveCamWaypoint(selectedCamera.path, i, xz) })),
              selectedIndex: selWp,
              onSelectWaypoint: setSelWp,
            } : selectedCharacter ? {
              active: drawPathActive,
              waypoints: selectedCharacter.motion?.locomotion?.path?.waypoints ?? [],
              mode: selectedCharacter.motion?.locomotion?.path?.mode ?? 'linear',
              onAddWaypoint: (xz) => apply(patchCharacter(data, selectedCharacter.id, { motion: addWaypoint(selectedCharacter.motion, xz) })),
              onMoveWaypoint: (i, xz) => apply(patchCharacter(data, selectedCharacter.id, { motion: moveWaypoint(selectedCharacter.motion, i, xz) })),
              selectedIndex: selWp,
              onSelectWaypoint: setSelWp,
            } : undefined}
            motionPreview={motionPreviewObj}
            motionDriveTime={motionDriveTime}
          />
          {/* 画幅取景框 + 九宫格（框外遮罩；截图=框内所见） */}
          <AspectFrameOverlay frame={frameRect} showThirds={showThirds} />
          {!flyMode ? (
            <button
              onClick={() => viewportRef.current?.resetView()}
              style={{ position: 'absolute', top: 16, right: 16, padding: '6px 12px', borderRadius: 8, background: 'rgba(22,24,29,0.9)', color: '#cdd3dc', border: '1px solid #2a2f3a', cursor: 'pointer', fontSize: 12, zIndex: 6 }}
            >重置视角</button>
          ) : null}
          {flyMode ? (
            <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderRadius: 12, background: 'rgba(10,11,13,0.92)', border: '1px solid #3b82f6', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 6 }}>
              <span style={{ color: '#f87171', fontSize: 13, fontWeight: 600 }}>⏺ 录制运镜中</span>
              <span style={{ color: '#9ca3af', fontSize: 12 }}>WASD/方向键移动 · R/F 升降 · 鼠标拖拽转视角</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cdd3dc', fontSize: 12 }}>
                速度
                <input type="range" min={2} max={30} step={1} value={flySpeed} onChange={(e) => setFlySpeed(Number(e.target.value))} style={{ width: 90 }} />
                {flySpeed}
              </span>
              <button onClick={onStopFlyRecord} style={{ padding: '7px 16px', borderRadius: 8, background: '#fff', color: '#111', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>⏹ 停止并保存</button>
            </div>
          ) : null}
        </div>
        <div style={{ width: 320, borderLeft: '1px solid #1c1f26', overflowY: 'auto' }}>
          {/* 「当前镜头机位」POV 实时预览（对齐参考视频）：复用 Viewport 机位视角 + 与播放头同步 */}
          <div style={{ borderBottom: '1px solid #1c1f26', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>当前镜头机位{playing ? ' · 播放中' : ''}</span>
              <button onClick={() => setShowPov((v) => !v)} title={showPov ? '隐藏预览（省性能）' : '显示预览'}
                style={{ padding: '2px 8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#16181d', color: '#8b93a1', cursor: 'pointer', fontSize: 11 }}>
                {showPov ? '隐藏' : '显示'}
              </button>
            </div>
            {showPov ? (
              (scene?.cameras?.length ?? 0) > 0 ? (
                <div style={{ position: 'relative', width: '100%', height: 168, borderRadius: 8, overflow: 'hidden', background: '#000', border: '1px solid #2a2f3a' }}>
                  <Viewport
                    scene={scene}
                    viewpoint="camera"
                    skyboxUrl={connectedPanoUrl ?? scene.skybox}
                    previewAnim={timelineClip ?? previewAnim}
                    previewTime={timelinePreviewTime}
                    motionPreview={motionPreviewObj}
                    motionDriveTime={motionDriveTime}
                    onSelect={() => {}}
                    onPatchCharacter={() => {}}
                    onPatchCamera={() => {}}
                  />
                </div>
              ) : (
                <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 12, border: '1px dashed #2a2f3a', borderRadius: 8 }}>放一个机位后这里实时预览</div>
              )
            ) : null}
          </div>
          {selectedCamera ? (
            <CameraPropertiesPanel
              camera={selectedCamera}
              scene={scene}
              tab={cameraTab}
              onTab={setCameraTab}
              shotGroups={shotGroups}
              busy={busy}
              onPatch={(patch) => apply(patchCamera(data, selectedCamera.id, patch))}
              onSwitchCamera={(id) => apply(setActiveCamera(data, id))}
              onClearAll={onClearAll}
              onSendAll={onSendAll}
              onSendShot={onSendShot}
              onDeleteShot={onDeleteShot}
              clipSettings={clipSettings}
              onClipSettingsChange={(patch) => setClipSettings((prev) => ({ ...prev, ...patch }))}
              onRenderClip={onRenderClip}
              previewOrbit={previewOrbit}
              onTogglePreviewOrbit={onTogglePreviewOrbit}
              onStartFlyRecord={onStartFlyRecord}
              hasRecording={!!recordedCam}
              recordedDuration={recordedCam?.durationSeconds}
              onClearRecordedCam={onClearRecordedCam}
              camPath={{
                drawActive: drawCamPathActive,
                onToggleDraw: () => setDrawCamPathActive((v) => !v),
                hasWaypoints: (selectedCamera.path?.waypoints?.length ?? 0) > 0,
                mode: selectedCamera.path?.mode ?? 'linear',
                onSetMode: (m) => apply(patchCamera(data, selectedCamera.id, { path: setCamPathMode(selectedCamera.path, m) })),
                height: selectedCamera.path?.height ?? 1.6,
                onSetHeight: (h) => apply(patchCamera(data, selectedCamera.id, { path: setCamPathHeight(selectedCamera.path, h) })),
                lookAtCharacterId: selectedCamera.path?.lookAtCharacterId,
                onSetLookAt: (id) => apply(patchCamera(data, selectedCamera.id, { path: setCamPathLookAt(selectedCamera.path, { characterId: id }) })),
                onClear: () => apply(patchCamera(data, selectedCamera.id, { path: clearCamPath(selectedCamera.path) })),
                onUseAsShot: () => {
                  const next = withTimeline((tl) => tlAddShot(tl, { cameraId: selectedCamera.id, durationSeconds: clipSettings.durationSeconds, cameraMove: { kind: 'path' } }))
                  apply(next)
                  const tl = ensureTimeline(next.scene?.timeline)
                  const newShot = tl.shots[tl.shots.length - 1]
                  if (newShot) { setSelectedShotId(newShot.id); onSeek(0) }
                  showToast('已用此路径建了一个「路径运镜」镜头，按播放查看', 'success')
                },
              }}
            />
          ) : selectedCharacter ? (
            <CharacterPropertiesPanel
              character={selectedCharacter}
              customMotions={scene.customMotions}
              onPatch={(patch) => onCharacterPatch(selectedCharacter.id, patch)}
              crowd={selectedCharacter.crowdId ? {
                label: selectedCharacter.crowdLabel ?? '群演',
                count: crowdMembers(data, selectedCharacter.crowdId).length,
                broadcast: crowdBroadcast,
                onToggleBroadcast: setCrowdBroadcast,
              } : undefined}
              motionUi={{
                drawPathActive,
                onToggleDrawPath: () => setDrawPathActive((v) => !v),
                keyframeTime: Math.min(playhead, selectedCharacter?.motion?.durationSeconds ?? playhead),
                onSeekTo: (t) => onSeek(t),
              }}
            />
          ) : (
            <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>选中机位或角色以编辑属性</div>
          )}
        </div>
      </div>
      {/* 全局多镜头时间线（对齐参考视频底部时间线） */}
      <TimelinePanel
        timeline={timeline}
        cameras={(scene?.cameras ?? []).map((c) => ({ id: c.id, name: c.name, hasPath: (c.path?.waypoints?.length ?? 0) >= 2 }))}
        defaultCameraId={scene?.activeCameraId ?? scene?.cameras?.[0]?.id}
        characters={(scene?.characters ?? []).filter((c) => c.motion || c.motionClip || (c.motionSequence?.length ?? 0) > 0).map((c) => {
          const seqClip = c.motionSequence?.length ? concatMotionPresets(c.motionSequence) : null
          return {
            id: c.id,
            name: c.name,
            label: `${c.name} · ${c.motion?.locomotion?.clip === 'run' ? '跑步' : c.motion?.locomotion?.clip === 'walk' ? '走路' : (seqClip?.name || c.motionClip || '动作')}`,
            durationSeconds: c.motion?.durationSeconds ?? seqClip?.durationSeconds ?? 4,
          }
        })}
        playhead={playhead}
        playing={playing}
        speed={playSpeed}
        selectedShotId={selectedShotId}
        onPlayToggle={onPlayToggle}
        onReset={onResetPlayhead}
        onSeek={onSeek}
        onSpeed={setPlaySpeed}
        onAddShot={onAddShot}
        onSelectShot={onSelectShot}
        onPatchShot={onPatchShot}
        onRemoveShot={onRemoveShot}
        onMoveShot={onMoveShot}
        onCaptureShot={onCaptureShot}
        onComposeVideo={onComposeTimeline}
        busy={busy}
        thumbs={shotThumbs}
        onPatchCharDuration={(id, sec) => {
          const ch = dataRef.current.scene?.characters.find((c) => c.id === id)
          if (ch?.motion) apply(patchCharacter(dataRef.current, id, { motion: { ...ch.motion, durationSeconds: sec } }))
        }}
        onRemoveChar={(id) => apply(patchCharacter(dataRef.current, id, { motion: undefined, motionClip: undefined, motionSequence: undefined }))}
        onSelectCharacter={(id) => apply(selectObject(dataRef.current, id))}
      />
      {/* 底部工具条 */}
      <Toolbar
        busy={busy}
        aspect={scene.aspect}
        gizmoMode={gizmoMode}
        onSetGizmoMode={setGizmoMode}
        onAddCharacter={(modelId) => apply(addCharacter(data, { id: uid('char'), modelId }))}
        onAddCrowd={onAddCrowd}
        onUploadModel={onUploadModel}
        onSetSkybox={onSetSkybox}
        hasSkybox={!!scene.skybox}
        panoConnected={!!connectedPanoUrl}
        skyboxYaw={scene.skyboxYaw ?? 0}
        onSetSkyboxYaw={(deg) => apply(setSkyboxYaw(data, deg))}
        skyboxPitch={scene.skyboxPitch ?? 0}
        onSetSkyboxPitch={(deg) => apply(setSkyboxPitch(data, deg))}
        onAddCamera={() => apply(addCamera(data, { id: uid('cam') }))}
        onSetAspect={(a) => apply(setAspect(data, a))}
        showThirds={showThirds}
        onToggleThirds={() => setShowThirds((v) => !v)}
        onCapture={onCapture}
        onDeleteSelected={selectedId ? () => apply(removeObject(data, selectedId)) : undefined}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={histCounts.undo > 0}
        canRedo={histCounts.redo > 0}
      />
      {/* 本节点的 capture 认领器：Modal 打开期间由它负责（离屏渲染机位 POV/样片），全局 runner 让位 */}
      <DirectorCaptureRunner onlyNodeId={nodeId} />
      {/* 长片拆分确认对话框：合成时总长超出单段上限弹出，对话内补充每段时长 → 确认拆分 / 输出整段 */}
      {splitPrompt ? (() => {
        const seg = Math.max(1, Math.min(SEGMENT_LIMIT, splitSeconds))
        const segCount = Math.max(1, Math.ceil(splitPrompt.totalSec / seg))
        const segDur = splitPrompt.totalSec / segCount
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 4300, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setSplitPrompt(null)}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ width: 420, background: '#16181d', border: '1px solid #2a2f3a', borderRadius: 12, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e5e7eb', marginBottom: 8 }}>当前视频超出 15s，是否拆分？</div>
              <div style={{ fontSize: 12.5, color: '#9ca3af', lineHeight: 1.7, marginBottom: 14 }}>
                时间线总长 <b style={{ color: '#cdd3dc' }}>{splitPrompt.totalSec.toFixed(1)}s</b>，超过单段出片上限 {SEGMENT_LIMIT}s。
                拆分将均分成等时长片段，竖向排布、按序连接。
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: '#cdd3dc' }}>每段时长</span>
                <input type="number" min={1} max={SEGMENT_LIMIT} step={1} value={splitSeconds}
                  onChange={(e) => setSplitSeconds(Math.max(1, Math.min(SEGMENT_LIMIT, Math.round(Number(e.target.value) || SEGMENT_LIMIT))))}
                  style={{ width: 64, background: '#0d0f13', color: '#e5e7eb', border: '1px solid #2a2f3a', borderRadius: 6, fontSize: 13, padding: '4px 6px' }} />
                <span style={{ fontSize: 12, color: '#6b7280' }}>s（最多 {SEGMENT_LIMIT}s）</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#86efac' }}>→ {segCount} 段 × {segDur.toFixed(1)}s</span>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setSplitPrompt(null)}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#1a1d24', color: '#9ca3af', cursor: 'pointer', fontSize: 12.5 }}>取消</button>
                <button onClick={() => { setSplitPrompt(null); runComposeTimeline() }}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #2a2f3a', background: '#1a1d24', color: '#cdd3dc', cursor: 'pointer', fontSize: 12.5 }}>输出整段</button>
                <button onClick={() => { setSplitPrompt(null); runComposeTimeline(seg) }}
                  style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }}>确认拆分</button>
              </div>
            </div>
          </div>
        )
      })() : null}
      {/* 导演台内吐司：固定底部居中、在导演台之上（不被画布盖住） */}
      {modalToast ? (
        <div style={{ position: 'fixed', left: '50%', bottom: 88, transform: 'translateX(-50%)', zIndex: 4200,
          padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          background: modalToast.type === 'success' ? '#16a34a' : modalToast.type === 'error' ? '#dc2626' : modalToast.type === 'warning' ? '#b45309' : '#374151',
          maxWidth: '70vw', textAlign: 'center' }}
          onClick={() => setModalToast(null)}>
          {modalToast.msg}
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
