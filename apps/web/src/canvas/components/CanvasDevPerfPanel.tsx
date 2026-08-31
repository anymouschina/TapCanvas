import React, { useEffect, useRef, useState } from 'react'
import {
  selectResourceRuntimeDiagnosticsSnapshot,
  useResourceRuntimeStore,
} from '../../domain/resource-runtime/store/resourceRuntimeStore'

// 画布性能观察面板（仅本地 dev 模式挂载，由 Canvas.tsx 以 import.meta.env.DEV 控制）。
//
// 设计约束：面板自身不能成为新的性能负担 ——
// - 指标采样（rAF 帧间隔 / longtask / long-animation-frame / event timing）只写 ref，不触发 React 状态更新；
// - 每 500ms 一次把数字直接写进 DOM textContent，除折叠切换外整个生命周期零 re-render；
// - DOM/媒体计数用 querySelectorAll，只在面板展开时执行。
//
// 指标含义速查：
// - 帧率/掉帧：rAF 相邻时间戳差；掉帧 = 窗口内 >33ms 的帧数（肉眼可感）
// - 长任务：主线程连续占用 >50ms（React 大提交、布局风暴、同步解码等）
// - 卡顿归因：Long Animation Frame API 给出的最长帧脚本来源（Chrome 123+）
// - 交互延迟：event timing，输入事件从触发到下一帧渲染完的耗时（INP 同源）
// - 节点/边 挂载/总：差值 = onlyRenderVisibleElements 虚拟化省掉的部分
// - 图片管线/内存：ManagedImage 资源运行时（三层缓存）就绪数、估算字节、LRU 修剪
// - 播放中 video：拉远时压垮主线程的常见元凶（解码器不释放）

export type CanvasPerfStats = {
  zoom: number
  lodDegraded: boolean
  heavyCanvas: boolean
  nodeCount: number
  edgeCount: number
  virtualized: boolean
}

type Stamped = { t: number; d: number; label?: string }

type LongAnimationFrameScript = {
  duration?: number
  sourceURL?: string
  invoker?: string
}

type LongAnimationFrameEntry = PerformanceEntry & {
  scripts?: LongAnimationFrameScript[]
}

type BrowserPerformance = Performance & {
  memory?: {
    usedJSHeapSize?: number
  }
}

const PANEL_COLLAPSE_KEY = 'tc-dev-perf-collapsed'
const WINDOW_MS = 5000

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  whiteSpace: 'nowrap',
}

function Row({ label, valueRef, title }: { label: string; valueRef: React.RefObject<HTMLSpanElement>; title?: string }) {
  return (
    <div className="tc-canvas-dev-perf__row" style={rowStyle} title={title}>
      <span className="tc-canvas-dev-perf__label" style={{ opacity: 0.65 }}>{label}</span>
      <span className="tc-canvas-dev-perf__value" ref={valueRef} style={{ fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>—</span>
    </div>
  )
}

const GREEN = '#4ade80'
const YELLOW = '#facc15'
const RED = '#f87171'

export function CanvasDevPerfPanel({ getStats }: { getStats: () => CanvasPerfStats }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(PANEL_COLLAPSE_KEY) === '1' } catch { return false }
  })

  const fpsRef = useRef<HTMLSpanElement>(null)
  const worstRef = useRef<HTMLSpanElement>(null)
  const longTaskRef = useRef<HTMLSpanElement>(null)
  const loafRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLSpanElement>(null)
  const nodesRef = useRef<HTMLSpanElement>(null)
  const edgesRef = useRef<HTMLSpanElement>(null)
  const mediaRef = useRef<HTMLSpanElement>(null)
  const imgPipeRef = useRef<HTMLSpanElement>(null)
  const imgMemRef = useRef<HTMLSpanElement>(null)
  const domRef = useRef<HTMLSpanElement>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const lodRef = useRef<HTMLSpanElement>(null)
  const virtRef = useRef<HTMLSpanElement>(null)
  const heapRef = useRef<HTMLSpanElement>(null)
  const chipFpsRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false

    // ---- 帧率采样：最近 ~2s 的 rAF 帧间隔 ----
    const frames: number[] = []
    let lastTs = 0
    let rafId = 0
    const onFrame = (ts: number) => {
      if (disposed) return
      if (lastTs > 0) {
        const delta = ts - lastTs
        // 标签页切走再回来会出现巨大 delta，丢弃避免污染统计
        if (delta < 2000) {
          frames.push(delta)
          if (frames.length > 120) frames.shift()
        }
      }
      lastTs = ts
      rafId = requestAnimationFrame(onFrame)
    }
    rafId = requestAnimationFrame(onFrame)
    const onVisibility = () => { lastTs = 0 }
    document.addEventListener('visibilitychange', onVisibility)

    // ---- PerformanceObserver 三件套（按浏览器支持逐个降级） ----
    const longTasks: Stamped[] = []
    const loafs: Stamped[] = []
    const slowInputs: Stamped[] = []
    const observers: PerformanceObserver[] = []
    const tryObserve = (type: string, cb: (entries: PerformanceEntry[]) => void, extra?: PerformanceObserverInit) => {
      try {
        const ob = new PerformanceObserver((list) => cb(list.getEntries()))
        ob.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
        observers.push(ob)
        return true
      } catch { return false }
    }
    const hasLongTask = tryObserve('longtask', (entries) => {
      for (const e of entries) longTasks.push({ t: performance.now(), d: e.duration })
    })
    const hasLoaf = tryObserve('long-animation-frame', (entries) => {
      for (const e of entries) {
        const scripts = (e as LongAnimationFrameEntry).scripts
        const worstScript = scripts?.slice().sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0]
        const src: string = worstScript?.sourceURL || worstScript?.invoker || ''
        const label = src ? src.split('/').pop()?.split('?')[0] : ''
        loafs.push({ t: performance.now(), d: e.duration, label })
      }
    })
    // durationThreshold 最小 16ms；只关心 >40ms 的输入响应
    const hasEventTiming = tryObserve('event', (entries) => {
      for (const e of entries) {
        if (e.duration >= 40) slowInputs.push({ t: performance.now(), d: e.duration, label: e.name })
      }
    }, { durationThreshold: 40 } as PerformanceObserverInit & { durationThreshold: number })

    // ---- 每 500ms 刷一次读数（直接写 DOM，不走 React） ----
    const setText = (ref: React.RefObject<HTMLSpanElement>, text: string, color?: string) => {
      const el = ref.current
      if (!el) return
      el.textContent = text
      el.style.color = color || ''
    }
    const prune = (arr: Stamped[], now: number) => {
      while (arr.length && now - arr[0].t > WINDOW_MS) arr.shift()
    }
    const worstOf = (arr: Stamped[]) => arr.reduce<Stamped | null>((m, r) => (!m || r.d > m.d ? r : m), null)
    const fpsColor = (fps: number) => (fps >= 50 ? GREEN : fps >= 28 ? YELLOW : RED)
    const fmtMB = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`
    const percentile = (values: readonly number[], ratio: number): number => {
      if (values.length === 0) return 0
      const ordered = [...values].sort((a, b) => a - b)
      const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)
      return ordered[Math.max(0, index)]
    }

    const tick = () => {
      const now = performance.now()

      if (frames.length > 0) {
        const avg = frames.reduce((a, b) => a + b, 0) / frames.length
        const worst = Math.max(...frames)
        const p50 = percentile(frames, 0.5)
        const p95 = percentile(frames, 0.95)
        const p99 = percentile(frames, 0.99)
        const jank = frames.reduce((c, d) => (d > 33 ? c + 1 : c), 0)
        const fps = 1000 / avg
        setText(fpsRef, `${fps.toFixed(0)} fps · 掉帧${jank}`, jank > 0 ? YELLOW : fpsColor(fps))
        setText(chipFpsRef, `${fps.toFixed(0)}`, fpsColor(fps))
        setText(worstRef, `p50 ${p50.toFixed(1)} · p95 ${p95.toFixed(1)} · p99 ${p99.toFixed(1)} · max ${worst.toFixed(0)} ms`, p95 > 33 ? RED : p95 > 20 ? YELLOW : GREEN)
        const panel = panelRef.current
        if (panel) {
          panel.dataset.fps = fps.toFixed(2)
          panel.dataset.frameP50Ms = p50.toFixed(2)
          panel.dataset.frameP95Ms = p95.toFixed(2)
          panel.dataset.frameP99Ms = p99.toFixed(2)
          panel.dataset.frameMaxMs = worst.toFixed(2)
          panel.dataset.jankFrames = String(jank)
        }
      }

      prune(longTasks, now); prune(loafs, now); prune(slowInputs, now)
      if (hasLongTask) {
        const worst = worstOf(longTasks)
        setText(longTaskRef, worst ? `${longTasks.length} 个 / 峰值 ${worst.d.toFixed(0)}ms` : '0', worst ? (worst.d > 200 ? RED : YELLOW) : GREEN)
      } else setText(longTaskRef, 'n/a')
      if (hasLoaf) {
        const worst = worstOf(loafs)
        setText(loafRef, worst ? `${worst.d.toFixed(0)}ms ${worst.label || '(未知脚本)'}` : '无', worst ? YELLOW : GREEN)
      } else setText(loafRef, 'n/a')
      if (hasEventTiming) {
        const worst = worstOf(slowInputs)
        setText(inputRef, worst ? `${slowInputs.length} 次 / 峰值 ${worst.d.toFixed(0)}ms` : '流畅', worst ? YELLOW : GREEN)
      } else setText(inputRef, 'n/a')

      const stats = getStats()
      const mountedNodes = document.querySelectorAll('.react-flow__node').length
      const mountedEdges = document.querySelectorAll('.react-flow__edge').length
      const flowRoot = document.querySelector('.react-flow')
      const imgs = flowRoot ? flowRoot.querySelectorAll('img').length : 0
      const videoEls = flowRoot ? [...flowRoot.querySelectorAll('video')] : []
      const playing = videoEls.filter((v) => !v.paused && !v.ended).length
      setText(nodesRef, `${mountedNodes} / ${stats.nodeCount}`)
      setText(edgesRef, `${mountedEdges} / ${stats.edgeCount}`)
      setText(
        mediaRef,
        `${imgs} img · ${videoEls.length} video(播放${playing})`,
        playing > 2 || videoEls.length > 8 ? RED : undefined,
      )
      setText(domRef, `${document.getElementsByTagName('*').length}`)
      setText(zoomRef, stats.zoom.toFixed(2))
      setText(
        lodRef,
        stats.lodDegraded ? '降级(overview)' : stats.heavyCanvas ? '重画布·未降级' : '正常',
        stats.lodDegraded ? YELLOW : undefined,
      )
      setText(virtRef, stats.virtualized ? '开(仅渲染可见)' : '关(全量挂载)')
      const panel = panelRef.current
      if (panel) {
        panel.dataset.totalNodes = String(stats.nodeCount)
        panel.dataset.mountedNodes = String(mountedNodes)
        panel.dataset.mountedEdges = String(mountedEdges)
        panel.dataset.mountedImages = String(imgs)
        panel.dataset.domElements = String(document.getElementsByTagName('*').length)
        panel.dataset.zoom = stats.zoom.toFixed(4)
        panel.dataset.virtualized = String(stats.virtualized)
        panel.dataset.longTasks = String(longTasks.length)
        panel.dataset.longTaskMaxMs = (worstOf(longTasks)?.d ?? 0).toFixed(2)
      }

      // ManagedImage 资源运行时（三层缓存）诊断
      try {
        const snap = selectResourceRuntimeDiagnosticsSnapshot(useResourceRuntimeStore.getState())
        setText(
          imgPipeRef,
          `就绪${snap.readyHandleCount}/${snap.handleCount} · 下载${snap.activeDownloadCount} · 解码${snap.activeDecodeCount}`,
          snap.failedHandleCount > 0 ? YELLOW : undefined,
        )
        setText(
          imgMemRef,
          `${fmtMB(snap.totalEstimatedBytes)} / 上限${fmtMB(useResourceRuntimeStore.getState().maxEstimatedBytes)} · LRU修剪${snap.lruTrimCount}`,
        )
      } catch { setText(imgPipeRef, 'n/a'); setText(imgMemRef, 'n/a') }

      const heap = (performance as BrowserPerformance).memory?.usedJSHeapSize
      setText(heapRef, heap ? fmtMB(heap) : 'n/a')
    }
    tick()
    const timer = window.setInterval(tick, 500)

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', onVisibility)
      observers.forEach((ob) => ob.disconnect())
      window.clearInterval(timer)
    }
  }, [getStats, collapsed])

  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(PANEL_COLLAPSE_KEY, v ? '0' : '1') } catch { /* ignore */ }
      return !v
    })
  }

  // 左上角（顶栏下方），避开左下角的小地图/资产管理和右上角工具条
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: 12,
    top: 72,
    zIndex: 60,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    lineHeight: 1.7,
    color: 'rgba(255,255,255,0.92)',
    background: 'rgba(15,16,20,0.82)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    backdropFilter: 'blur(6px)',
    userSelect: 'none',
    pointerEvents: 'auto',
  }

  if (collapsed) {
    return (
      <div className="tc-canvas-dev-perf tc-canvas-dev-perf--collapsed" ref={panelRef} data-testid="canvas-dev-perf-panel" style={{ ...baseStyle, padding: '4px 10px', cursor: 'pointer' }} onClick={toggle} title="展开性能面板">
        <span className="tc-canvas-dev-perf__chip-fps" ref={chipFpsRef}>—</span> fps ▸
      </div>
    )
  }

  return (
    <div className="tc-canvas-dev-perf" ref={panelRef} data-testid="canvas-dev-perf-panel" style={{ ...baseStyle, padding: '8px 12px', minWidth: 330 }}>
      <div className="tc-canvas-dev-perf__header" style={{ ...rowStyle, marginBottom: 4, fontWeight: 700, opacity: 0.9 }}>
        <span className="tc-canvas-dev-perf__title">性能观察 (dev)</span>
        <span
          className="tc-canvas-dev-perf__collapse"
          onClick={toggle}
          title="折叠面板"
          style={{ cursor: 'pointer', padding: '0 6px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', lineHeight: 1.4 }}
        >
          折叠 —
        </span>
      </div>
      <Row label="帧率" valueRef={fpsRef} title="rAF 平均帧率；掉帧=窗口内 >33ms 的帧数" />
      <Row label="帧间隔" valueRef={worstRef} title="最近 120 帧的 p50 / p95 / p99 / 最大帧间隔" />
      <Row label="长任务(5s)" valueRef={longTaskRef} title="主线程连续占用 >50ms 的任务" />
      <Row label="卡顿归因" valueRef={loafRef} title="最长动画帧的脚本来源 (Long Animation Frame API)" />
      <Row label="交互延迟(5s)" valueRef={inputRef} title="输入事件到渲染完成 >40ms 的次数与峰值 (INP 同源)" />
      <Row label="节点 挂载/总" valueRef={nodesRef} title="React Flow 已挂载 DOM 节点数 / 数据总数" />
      <Row label="边 挂载/总" valueRef={edgesRef} />
      <Row label="画布媒体" valueRef={mediaRef} title="画布内 img/video 元素数；播放中的 video 是掉帧常见元凶" />
      <Row label="图片管线" valueRef={imgPipeRef} title="ManagedImage 资源运行时：就绪/总句柄 · 下载中 · 解码中" />
      <Row label="图片内存" valueRef={imgMemRef} title="估算解码内存 / 预算上限 · LRU 修剪次数" />
      <Row label="页面 DOM" valueRef={domRef} title="整页元素总数" />
      <Row label="缩放" valueRef={zoomRef} />
      <Row label="LOD 状态" valueRef={lodRef} title="节点数 >60 且 zoom<0.3 时降级为概览渲染" />
      <Row label="虚拟化" valueRef={virtRef} title="onlyRenderVisibleElements，节点数 >60 时开启" />
      <Row label="JS 堆" valueRef={heapRef} />
    </div>
  )
}
