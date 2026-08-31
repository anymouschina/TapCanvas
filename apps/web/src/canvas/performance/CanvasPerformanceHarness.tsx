import React from 'react'
import type { Node } from '@xyflow/react'
import { IconPlayerPlay } from '@tabler/icons-react'
import Canvas from '../Canvas'
import { useRFStore } from '../store'
import type { TaskNodeData } from '../nodes/taskNodeSchema'
import type { CanvasPerformanceApi } from './canvasPerformanceApi'
import { hostedAssetUrl } from '../../config/objectStorageAssets'
import './CanvasPerformanceHarness.css'

const DEFAULT_NODE_COUNT = 1000
const GRID_COLUMNS = 40
const NODE_WIDTH = 320
const NODE_HEIGHT = 180
const COLUMN_GAP = 48
const ROW_GAP = 64
const PHASE_DURATION_MS = 2400
const PHASE_SETTLE_MS = 500

const HARNESS_IMAGES = [
  '/storyboard-recipes/cinematic-narrative.jpg',
  '/storyboard-recipes/anime-op.jpg',
  '/storyboard-recipes/product-ad.jpg',
  '/storyboard-recipes/choreography-grid.jpg',
  '/storyboard-recipes/character-intro.jpg',
  '/storyboard-recipes/luxury-pitchdeck.jpg',
  '/storyboard-recipes/editorial-8panel.jpg',
  '/storyboard-recipes/game-ui-concept.jpg',
] as const

type PerformanceNode = Node<TaskNodeData, 'taskNode'>
type BenchmarkPhase = 'pan' | 'zoom' | 'drag'
type HarnessScenario = 'performance' | 'text-nodes' | 'reference-nodes'

type PhaseMetrics = {
  fps: number
  frameCount: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  jankFrames: number
  longTaskCount: number | null
  longTaskMaxMs: number | null
  mountedNodes: number
  mountedImages: number
  updateMaxMs: number
  slowFrames: Array<{
    intervalMs: number
    progress: number
    hasFocus: boolean
    visibilityState: DocumentVisibilityState
  }>
}

type BenchmarkReport = {
  nodeCount: number
  phases: Record<BenchmarkPhase, PhaseMetrics>
}

function shouldAutorunBenchmark(): boolean {
  return new URL(window.location.href).searchParams.get('autorun') === '1'
}

function readHarnessScenario(): HarnessScenario {
  const scenario = new URL(window.location.href).searchParams.get('scenario')
  if (scenario === 'reference-nodes' || scenario === 'text-nodes') return scenario
  return 'performance'
}

function readRequestedInitialZoom(): number | null {
  const rawValue = new URL(window.location.href).searchParams.get('zoom')
  if (rawValue === null) return null
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || parsed < 0.08 || parsed > 1.8) {
    throw new Error(`Invalid performance zoom: ${rawValue}`)
  }
  return parsed
}

function readRequestedRemoteImageUrl(): string | null {
  const enabled = new URL(window.location.href).searchParams.get('remoteImage') === '1'
  return enabled ? hostedAssetUrl('tapcanvas/lighting-presets/overexposed-film-v1.png') : null
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, durationMs))
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) throw new Error('Cannot calculate a frame percentile without samples')
  const ordered = [...values].sort((a, b) => a - b)
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)
  return ordered[Math.max(0, index)]
}

async function runAnimation(
  durationMs: number,
  update: (progress: number) => void,
): Promise<{
  intervals: number[]
  startTime: number
  endTime: number
  updateDurations: number[]
  slowFrames: PhaseMetrics['slowFrames']
}> {
  if (document.visibilityState !== 'visible') {
    throw new Error('Canvas benchmark requires a foreground browser tab')
  }

  return new Promise((resolve, reject) => {
    const intervals: number[] = []
    const updateDurations: number[] = []
    const slowFrames: PhaseMetrics['slowFrames'] = []
    let firstTimestamp: number | null = null
    let previousTimestamp: number | null = null
    let frameId = 0
    let completed = false

    const finishWithError = (error: Error) => {
      if (completed) return
      completed = true
      window.cancelAnimationFrame(frameId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearTimeout(timeoutId)
      reject(error)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        finishWithError(new Error('Canvas benchmark tab lost foreground visibility'))
      }
    }
    const timeoutId = window.setTimeout(() => {
      finishWithError(new Error(`Canvas benchmark phase exceeded ${durationMs + 5000}ms`))
    }, durationMs + 5000)

    const frame = (timestamp: number) => {
      if (completed) return
      if (firstTimestamp === null) firstTimestamp = timestamp
      if (previousTimestamp !== null) {
        const interval = timestamp - previousTimestamp
        intervals.push(interval)
        if (interval > 33) {
          slowFrames.push({
            intervalMs: interval,
            progress: Math.min(1, (timestamp - firstTimestamp) / durationMs),
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState,
          })
        }
      }
      previousTimestamp = timestamp
      const progress = Math.min(1, (timestamp - firstTimestamp) / durationMs)
      const updateStartedAt = performance.now()
      update(progress)
      updateDurations.push(performance.now() - updateStartedAt)
      if (progress < 1) {
        frameId = window.requestAnimationFrame(frame)
        return
      }
      completed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearTimeout(timeoutId)
      if (intervals.length < 30) {
        reject(new Error(`Canvas benchmark captured too few frames: ${intervals.length}`))
        return
      }
      resolve({
        intervals,
        startTime: firstTimestamp,
        endTime: timestamp,
        updateDurations,
        slowFrames,
      })
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    frameId = window.requestAnimationFrame(frame)
  })
}

async function measurePhase(
  update: (progress: number) => void,
): Promise<PhaseMetrics> {
  const longTasks: PerformanceEntry[] = []
  let observer: PerformanceObserver | null = null
  try {
    observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
    observer.observe({ type: 'longtask', buffered: false })
  } catch {
    observer = null
  }

  try {
    const { intervals, startTime, endTime, updateDurations, slowFrames } = await runAnimation(PHASE_DURATION_MS, update)
    await delay(0)
    const phaseLongTasks = longTasks.filter((entry) => (
      entry.startTime >= startTime && entry.startTime <= endTime
    ))
    const averageMs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    return {
      fps: 1000 / averageMs,
      frameCount: intervals.length,
      p50Ms: percentile(intervals, 0.5),
      p95Ms: percentile(intervals, 0.95),
      p99Ms: percentile(intervals, 0.99),
      maxMs: Math.max(...intervals),
      jankFrames: intervals.filter((value) => value > 33).length,
      longTaskCount: observer ? phaseLongTasks.length : null,
      longTaskMaxMs: observer
        ? phaseLongTasks.reduce((maximum, entry) => Math.max(maximum, entry.duration), 0)
        : null,
      mountedNodes: document.querySelectorAll('.react-flow__node').length,
      mountedImages: document.querySelectorAll('.react-flow img').length,
      updateMaxMs: Math.max(...updateDurations),
      slowFrames,
    }
  } finally {
    observer?.disconnect()
  }
}

function viewportCenteredOn(
  viewportSize: { width: number; height: number },
  point: { x: number; y: number },
  zoom: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
) {
  return {
    x: viewportSize.width / 2 - point.x * zoom + offset.x,
    y: viewportSize.height / 2 - point.y * zoom + offset.y,
    zoom,
  }
}

async function runBenchmark(
  api: CanvasPerformanceApi,
  nodeCount: number,
  nodeKind: 'image' | 'text',
  onPhase: (phase: BenchmarkPhase) => void,
): Promise<BenchmarkReport> {
  const benchmarkNodeIndex = Math.min(nodeCount, Math.floor(nodeCount / 2) + 1)
  const benchmarkNodeId = `performance-${nodeKind}-${benchmarkNodeIndex}`
  const originalPosition = api.getNodePosition(benchmarkNodeId)
  if (!originalPosition) throw new Error(`Benchmark node is unavailable: ${benchmarkNodeId}`)
  const center = { x: originalPosition.x + NODE_WIDTH / 2, y: originalPosition.y + NODE_HEIGHT / 2 }
  const viewportSize = api.getViewportSize()

  api.setViewport(viewportCenteredOn(viewportSize, center, 0.5))
  await delay(PHASE_SETTLE_MS)
  onPhase('pan')
  api.beginViewportMove()
  let lastViewport = api.getViewport()
  const pan = await (async () => {
    try {
      return await measurePhase((progress) => {
        lastViewport = viewportCenteredOn(viewportSize, center, 0.5, {
          x: (progress - 0.5) * 1200,
          y: Math.sin(progress * Math.PI * 4) * 180,
        })
        api.setViewport(lastViewport)
      })
    } finally {
      api.endViewportMove(lastViewport)
    }
  })()

  await delay(PHASE_SETTLE_MS)
  onPhase('zoom')
  api.beginViewportMove()
  const zoom = await (async () => {
    try {
      return await measurePhase((progress) => {
        const scale = 0.55 + Math.sin(progress * Math.PI * 2) * 0.2
        lastViewport = viewportCenteredOn(viewportSize, center, scale)
        api.setViewport(lastViewport)
      })
    } finally {
      api.endViewportMove(lastViewport)
    }
  })()

  api.setViewport(viewportCenteredOn(viewportSize, center, 1))
  await delay(PHASE_SETTLE_MS)
  onPhase('drag')
  if (!api.beginNodeDrag(benchmarkNodeId)) {
    throw new Error(`Cannot begin benchmark drag for missing node: ${benchmarkNodeId}`)
  }
  const drag = await (async () => {
    try {
      return await measurePhase((progress) => {
        api.setNodeDragPosition(benchmarkNodeId, {
          x: originalPosition.x + Math.sin(progress * Math.PI) * 320,
          y: originalPosition.y + Math.sin(progress * Math.PI * 2) * 80,
        })
      })
    } finally {
      api.endNodeDrag(benchmarkNodeId, originalPosition)
    }
  })()

  return { nodeCount, phases: { pan, zoom, drag } }
}

function readRequestedNodeCount(): number {
  const rawValue = new URL(window.location.href).searchParams.get('nodes')
  if (rawValue === null) return DEFAULT_NODE_COUNT
  const parsed = Number(rawValue)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5000) {
    throw new Error(`Invalid performance node count: ${rawValue}`)
  }
  return parsed
}

export function buildPerformanceImageNodes(nodeCount: number, remoteImageUrl: string | null = null): PerformanceNode[] {
  return Array.from({ length: nodeCount }, (_, index) => {
    const column = index % GRID_COLUMNS
    const row = Math.floor(index / GRID_COLUMNS)
    const imageUrl = remoteImageUrl || HARNESS_IMAGES[index % HARNESS_IMAGES.length]
    return {
      id: `performance-image-${index + 1}`,
      type: 'taskNode',
      position: {
        x: column * (NODE_WIDTH + COLUMN_GAP),
        y: row * (NODE_HEIGHT + ROW_GAP),
      },
      draggable: true,
      selectable: true,
      focusable: true,
      data: {
        kind: 'image',
        label: `Performance image ${index + 1}`,
        imageUrl,
        imageResults: [{ url: imageUrl }],
        imagePrimaryIndex: 0,
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        status: 'success',
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
    }
  })
}

export function buildPerformanceTextNodes(nodeCount: number): PerformanceNode[] {
  return Array.from({ length: nodeCount }, (_, index) => {
    const column = index % GRID_COLUMNS
    const row = Math.floor(index / GRID_COLUMNS)
    return {
      id: `performance-text-${index + 1}`,
      type: 'taskNode',
      position: {
        x: column * (NODE_WIDTH + COLUMN_GAP),
        y: row * (NODE_HEIGHT + ROW_GAP),
      },
      draggable: true,
      selectable: true,
      focusable: true,
      data: {
        kind: 'text',
        label: `Performance text ${index + 1}`,
        prompt: 'Large-canvas text-node shell benchmark',
        nodeWidth: NODE_WIDTH,
        nodeHeight: NODE_HEIGHT,
        status: 'idle',
      },
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    }
  })
}

export function buildReferenceNodeShowcase(): PerformanceNode[] {
  return [
    {
      id: 'reference-text',
      type: 'taskNode',
      position: { x: 0, y: 0 },
      draggable: true,
      selectable: true,
      focusable: true,
      data: {
        kind: 'text',
        label: '文本节点',
        prompt: '在这里输入或粘贴文本内容',
        nodeWidth: 350,
        nodeHeight: 350,
        status: 'idle',
      },
      style: { width: 350, height: 350 },
    },
    {
      id: 'reference-image',
      type: 'taskNode',
      position: { x: 1210, y: 0 },
      draggable: true,
      selectable: true,
      focusable: true,
      data: {
        kind: 'image',
        label: '图片节点',
        prompt: '',
        aspect: '16:9',
        imageSize: '2K',
        nodeWidth: 622,
        nodeHeight: 350,
        status: 'idle',
      },
      style: { width: 622, height: 350 },
    },
    {
      id: 'reference-video',
      type: 'taskNode',
      position: { x: 470, y: 0 },
      selected: true,
      draggable: true,
      selectable: true,
      focusable: true,
      data: {
        kind: 'video',
        label: '视频节点',
        prompt: '',
        aspect: '16:9',
        videoDuration: 5,
        duration: 5,
        videoResolution: '720p',
        nodeWidth: 622,
        nodeHeight: 350,
        status: 'idle',
      },
      style: { width: 622, height: 350 },
    },
  ]
}

export default function CanvasPerformanceHarness(): JSX.Element {
  const originalStateRef = React.useRef(useRFStore.getState())
  const [ready, setReady] = React.useState(false)
  const [performanceApi, setPerformanceApi] = React.useState<CanvasPerformanceApi | null>(null)
  const [benchmarkStatus, setBenchmarkStatus] = React.useState<'idle' | 'running' | 'complete' | 'error'>('idle')
  const [activePhase, setActivePhase] = React.useState<BenchmarkPhase | null>(null)
  const [report, setReport] = React.useState<BenchmarkReport | null>(null)
  const [benchmarkError, setBenchmarkError] = React.useState<string | null>(null)
  const startedRef = React.useRef(false)
  const runningRef = React.useRef(false)
  const initialZoomTimerRef = React.useRef<number | null>(null)
  const nodeCount = React.useMemo(readRequestedNodeCount, [])
  const scenario = React.useMemo(readHarnessScenario, [])
  const autorun = React.useMemo(shouldAutorunBenchmark, [])
  const initialZoom = React.useMemo(readRequestedInitialZoom, [])
  const remoteImageUrl = React.useMemo(readRequestedRemoteImageUrl, [])
  const handlePerformanceApiReady = React.useCallback((api: CanvasPerformanceApi | null) => {
    setPerformanceApi(api)
    if (!api || initialZoom === null || initialZoomTimerRef.current !== null) return
    initialZoomTimerRef.current = window.setTimeout(() => {
      initialZoomTimerRef.current = null
      const viewport = { ...api.getViewport(), zoom: initialZoom }
      api.beginViewportMove()
      api.setViewport(viewport)
      api.endViewportMove(viewport)
    }, 750)
  }, [initialZoom])

  React.useLayoutEffect(() => {
    const nodes = scenario === 'reference-nodes'
      ? buildReferenceNodeShowcase()
      : scenario === 'text-nodes'
        ? buildPerformanceTextNodes(nodeCount)
        : buildPerformanceImageNodes(nodeCount, remoteImageUrl)
    useRFStore.setState({
      nodes,
      edges: [],
      graphProvenanceKey: null,
      historyPast: [],
      historyFuture: [],
    })
    setReady(true)

    return () => {
      if (initialZoomTimerRef.current !== null) {
        window.clearTimeout(initialZoomTimerRef.current)
        initialZoomTimerRef.current = null
      }
      useRFStore.setState(originalStateRef.current, true)
    }
  }, [nodeCount, remoteImageUrl, scenario])

  const runCurrentBenchmark = React.useCallback(() => {
    if (!performanceApi || runningRef.current) return
    runningRef.current = true
    setReport(null)
    setBenchmarkError(null)
    setBenchmarkStatus('running')
    void runBenchmark(performanceApi, nodeCount, scenario === 'text-nodes' ? 'text' : 'image', setActivePhase)
      .then((nextReport) => {
        setReport(nextReport)
        setActivePhase(null)
        setBenchmarkStatus('complete')
      })
      .catch((error: unknown) => {
        setBenchmarkError(error instanceof Error ? error.message : String(error))
        setActivePhase(null)
        setBenchmarkStatus('error')
      })
      .finally(() => {
        runningRef.current = false
      })
  }, [nodeCount, performanceApi, scenario])

  React.useEffect(() => {
    if (!autorun || !performanceApi || startedRef.current) return
    startedRef.current = true
    runCurrentBenchmark()
  }, [autorun, performanceApi, runCurrentBenchmark])

  const reportJson = report ? JSON.stringify(report) : ''

  return (
    <main
      className="tc-canvas-performance-harness"
      data-performance-node-count={nodeCount}
      data-harness-scenario={scenario}
    >
      {ready ? (
        <Canvas
          className="tc-canvas-performance-harness__canvas"
          onPerformanceApiReady={handlePerformanceApiReady}
        />
      ) : (
        <div className="tc-canvas-performance-harness__loading">Preparing canvas benchmark</div>
      )}
      <output
        className="tc-canvas-performance-harness__status"
        aria-live="polite"
        data-testid="canvas-performance-benchmark"
        data-benchmark-status={benchmarkStatus}
        data-active-phase={activePhase ?? ''}
        data-benchmark-results={reportJson}
        data-benchmark-error={benchmarkError ?? ''}
      >
        <span className="tc-canvas-performance-harness__status-label">
          {scenario === 'reference-nodes'
            ? 'Text · image · video'
            : `${nodeCount} ${scenario === 'text-nodes' ? 'text' : 'image'} nodes`} ·{' '}
          {benchmarkStatus === 'running' ? activePhase ?? 'preparing' : benchmarkStatus}
        </span>
        {report ? (
          <span className="tc-canvas-performance-harness__metrics">
            {(['pan', 'zoom', 'drag'] as const).map((phase) => (
              <span className="tc-canvas-performance-harness__metric" key={phase}>
                {phase} {report.phases[phase].fps.toFixed(1)} fps · p95 {report.phases[phase].p95Ms.toFixed(1)}ms
              </span>
            ))}
          </span>
        ) : null}
        {benchmarkError ? (
          <span className="tc-canvas-performance-harness__error">{benchmarkError}</span>
        ) : null}
      </output>
      <button
        className="tc-canvas-performance-harness__run"
        type="button"
        data-testid="canvas-performance-run"
        aria-label="运行画布性能基准"
        title="运行画布性能基准"
        disabled={!performanceApi || benchmarkStatus === 'running'}
        onClick={runCurrentBenchmark}
      >
        <IconPlayerPlay className="tc-canvas-performance-harness__run-icon" size={16} stroke={1.8} />
      </button>
    </main>
  )
}
