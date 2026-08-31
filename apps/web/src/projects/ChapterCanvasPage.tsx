import React from 'react'
import { Stack, Button, Alert } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { useRFStore } from '../canvas/store'
import Canvas from '../canvas/Canvas'
import KeyboardShortcuts from '../KeyboardShortcuts'
import {
  getChapterCanvasFlow,
  putChapterCanvasFlow,
  ChapterCanvasFlowConflictError,
  type ChapterCanvasFlowGetResponse,
} from './chapterCanvasFlow'
import type { CanvasFlow } from './chapterCanvasFlow.types'
import { toast } from '../ui/toast'
import { useUIStore } from '../ui/uiStore'
import { useCanvasSync, type SyncPatch } from '../canvas/sync/useCanvasSync'
import { derivedApplyGuard, remoteApplyGuard } from '../canvas/sync/remoteApplyGuard'
import { conflictBackoffMs } from './chapterAutosaveBackoff'
import {
  applyServerPatchToAcknowledgedFlow,
} from './chapterFlowMerge'
import { rebaseCanvasFlowOnConflict } from '../canvas/persistence/flowConflictRebase'
import { isSelectionOnlyNodeDiff } from '../canvas/persistence/isSelectionOnlyNodeDiff'
import { VideoRunIndicator } from '../canvas/components/VideoRunIndicator'
import { loadChapterSnapshot, saveChapterSnapshot, getChapterSnapshotSync } from '../canvas/sync/canvasSnapshotCache'
import { CanvasLoadingScreen } from '../ui/CanvasLoadingScreen'
import { usePinnedWorkflowExecutionProjection } from '../canvas/hooks/usePinnedWorkflowExecutionProjection'
import {
  canReuseChapterCanvasSnapshot,
  createChapterCanvasGraphIdentity,
} from './chapterCanvasGraphIdentity'

const CHAPTER_EMPTY_TEXT_PLACEHOLDER =
  '该章节尚无构思或正文。可在左侧目录编辑本章构思，也可以新增文本节点，与小T逐步完成本章。'
const CODEX_SAVE_WAIT_TIMEOUT_MS = 15_000
const CODEX_SAVE_POLL_INTERVAL_MS = 25

type ChapterCanvasRuntimeWindow = Window & {
  __TAPCANVAS_CHAPTER_SAVE__?: () => Promise<void>
  __TAPCANVAS_CODEX_CHAPTER_SAVE__?: (chapterId: string) => Promise<number>
}

type ChapterCanvasPageProps = {
  projectId: string
  bookId: string | null
  chapterId: string
  chapterTitle: string
  chapterText: string
  saveRef?: React.MutableRefObject<(() => Promise<void>) | null>
}

const SEED_NODE_ID_PREFIX = 'chapter-seed-'

function buildSeedNode(params: {
  chapterId: string
  title: string
  text: string
}) {
  const displayText = params.text || CHAPTER_EMPTY_TEXT_PLACEHOLDER
  return {
    id: `${SEED_NODE_ID_PREFIX}${params.chapterId}`,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'text',
      preset: 'chapter-info',
      locked: true,
      readOnly: true,
      chapterTitle: params.title,
      chapterText: displayText,
      label: params.title,
      content: displayText,
      prompt: `【${params.title}】\n\n${displayText}`,
    },
  } as any
}

export default function ChapterCanvasPage(props: ChapterCanvasPageProps) {
  const { chapterId, chapterTitle, chapterText, saveRef } = props

  usePinnedWorkflowExecutionProjection(`chapter:${chapterId}`)

  const [status, setStatus] = React.useState<
    'loading' | 'ready' | 'error'
  >('loading')
  const [error, setError] = React.useState<string | null>(null)
  const revisionRef = React.useRef<number>(0)
  // Last graph acknowledged by the server at revisionRef. Conflict handling
  // diffs this base against the current store and replays only actual local
  // edits onto the latest server graph. Keeping the base is what distinguishes
  // a local addition from a remotely deleted node still present in a stale UI.
  const acknowledgedFlowRef = React.useRef<CanvasFlow>({ nodes: [], edges: [] })
  const saveTimerRef = React.useRef<number | null>(null)
  const flushInFlightRef = React.useRef(false)
  const flushPendingRef = React.useRef(false)
  // 多页签同章防乒乓：内容指纹（没变不发 PUT）+ 连续 409 指数退避
  const lastSavedFingerprintRef = React.useRef<string>('')
  // 引用快速路径：记录上次干净保存时 store 的 nodes/edges 数组引用。store 是不可变更新，
  // 任何真实内容变化都会产生新引用，故「引用未变 ⇒ 内容必未变」，可跳过整图 JSON.stringify。
  // 这只是纯优化守卫：引用若不匹配就回落到下方权威的指纹比对，绝不会漏存或误存。
  const lastSavedNodesRef = React.useRef<unknown>(null)
  const lastSavedEdgesRef = React.useRef<unknown>(null)
  const conflictStreakRef = React.useRef(0)
  const conflictBackoffUntilRef = React.useRef(0)
  // 退避期内的「待重试」定时器。退避分支必须走异步定时器重试，绝不能靠 flushPendingRef +
  // finally 同步重入——那样退避未过时每次 flush 都立刻再唤起 flush，形成同步无限递归爆栈。
  const backoffRetryTimerRef = React.useRef<number | null>(null)
  // 删除墓碑:本地刚删、尚未被服务端确认删除的节点 id。
  // 409 合并 / 服务端整图回灌时据此剔除服务端仍存的同 id 节点,
  // 防止用户删掉的节点被「并集合并」从服务端无脑捞回(对话即复活根因)。
  // 一次干净保存(或合并写回)成功后清掉已覆盖的 id——届时服务端也已不含它们。
  const deletedNodeIdsRef = React.useRef<Set<string>>(new Set())
  // 切章竞态守卫：快速切换 A→B 时，A 的服务端响应可能晚于 B 到达。此前靠离章 cleanup 清空 store
  // 兜底，现在切章不再清空/不再重挂，必须用递增 seq 让「已被取代的 load」在每个 await 后自行作废，
  // 否则会把 A 的节点、A 的 revision 灌进正在显示 B 的 store（内容闪回 + 拿错 revision 触发 409）。
  const loadSeqRef = React.useRef(0)
  const chapterCanvasMountedRef = React.useRef(false)
  // 切章「绘制前」同步换图的守卫：记录上一次已同步过的 chapterId。
  // useEffect 里的 load() 跑在浏览器绘制【之后】且是异步(await 快照/服务端)，
  // 所以切章后必然先画一帧旧 store 内容(上一章的图+文本节点)才轮到换图——这正是闪一下的根因。
  // 用 useLayoutEffect(绘制前同步执行)把 store 先换成目标章：暖切用同步内存快照秒绘完整图，
  // 冷切至少只留新章种子节点，旧章内容绝不上屏。异步 load() 随后再与 IndexedDB/服务端对账。
  const lastSyncChapterRef = React.useRef<string | null>(null)
  // 切章后重新框选视口：Canvas 不再随切章重挂，onInit 的首屏 fitView+退档+LOD降级只在首挂跑一次。
  // 切到「节点坐标不同的章节」会停在上一章的平移位置（空白）。每章内容载入后调一次
  // __tcReframeForChapter（与首屏 onInit 同序：fitView→applyDefaultZoom，含 LOD 降级 → 总览轻卡便宜渲染），
  // 每章仅一次，避免重复动画。
  const lastFittedChapterRef = React.useRef<string | null>(null)
  const scheduleFitView = React.useCallback(() => {
    if (lastFittedChapterRef.current === chapterId) return
    lastFittedChapterRef.current = chapterId
    // 略延迟：等 store.load 后 React Flow 完成节点处理/测量，重框才能框准。
    window.setTimeout(() => {
      try {
        ;(window as any).__tcReframeForChapter?.()
      } catch { /* Canvas 未挂载则忽略 */ }
    }, 120)
  }, [chapterId])

  const load = React.useCallback(async () => {
    const seq = ++loadSeqRef.current
    setError(null)
    // 进入/切换章节即重置删除墓碑：墓碑是「本章的本地删除账本」，不能跨章带过来。
    // （原先靠离章 cleanup 清空 store 时顺带清；现在切章不再清空 store，改在此处显式重置。）
    deletedNodeIdsRef.current.clear()
    const seed = buildSeedNode({
      chapterId,
      title: chapterTitle,
      text: chapterText,
    })

    // 程序化整图替换统一包在 remoteApplyGuard 内：让 store 订阅者（自动保存 / 删除墓碑 / 增量同步）
    // 忽略这次「载入」引发的变更——否则切章会把上一章节点整批误判成删除、或拿刚载入的服务端图
    // 反手再整图 PUT / 广播。设 provenance 让后续 flush 归属到本章。
    const applyFlow = (nodes: Record<string, unknown>[], edges: Record<string, unknown>[]) => {
      acknowledgedFlowRef.current = { nodes, edges }
      remoteApplyGuard.run(() => {
        useRFStore.getState().load({ nodes, edges } as any)
        useRFStore.getState().setGraphProvenance(`chapter:${chapterId}`)
      })
    }

    // Step 1 (fast): 有本地快照就即时重绘。Canvas 全程不卸载，切章零加载态。
    let snapshotApplied = false
    let appliedSnapshotRevision: number | null = null
    let appliedSnapshotGraphIdentity: string | null = null
    try {
      const snap = await loadChapterSnapshot(chapterId)
      if (!chapterCanvasMountedRef.current || seq !== loadSeqRef.current) return // 已离开或切到别的章，丢弃过期载入
      if (snap) {
        // 暖切时上方 useLayoutEffect 已用同步内存快照把本章完整图绘制在屏（相同 revision）。
        // 此处再 applyFlow 会用全新对象引用重建【所有】节点 → 整图重渲一遍（重章 ~700ms 纯浪费）。
        // store 已归属本章且 revision 已对齐即视为「已画好」，跳过重复 applyFlow；种子文本由
        // layout effect 的同章分支保持最新，跳过不会残留旧种子。
        const alreadyPainted =
          useRFStore.getState().graphProvenanceKey === `chapter:${chapterId}` &&
          revisionRef.current === snap.revision
        revisionRef.current = snap.revision
        appliedSnapshotRevision = snap.revision
        const withoutOldSeed = (snap.nodes as Record<string, unknown>[]).filter(
          (node) => node.id !== seed.id,
        )
        const snapshotNodes = [
          seed as unknown as Record<string, unknown>,
          ...withoutOldSeed,
        ]
        const snapshotEdges = snap.edges as Record<string, unknown>[]
        appliedSnapshotGraphIdentity = createChapterCanvasGraphIdentity({
          nodes: withoutOldSeed,
          edges: snapshotEdges,
        })
        acknowledgedFlowRef.current = { nodes: snapshotNodes, edges: snapshotEdges }
        if (!alreadyPainted) {
          applyFlow(snapshotNodes, snapshotEdges)
        }
        setStatus('ready')
        scheduleFitView()
        snapshotApplied = true
      }
    } catch { /* swallow — server fetch will fill in */ }

    // 只有「冷启动（无快照可画）」才亮加载浮层；有快照时保持已就绪，杜绝多余加载闪烁。
    if (!snapshotApplied) setStatus('loading')

    // Step 2: fetch latest from server, replace store contents if different.
    try {
      const resp: ChapterCanvasFlowGetResponse = await getChapterCanvasFlow(chapterId)
      if (!chapterCanvasMountedRef.current || seq !== loadSeqRef.current) return // 已离开或切到别的章：绝不能把本章 revision/节点写回 store
      revisionRef.current = resp.revision
      const incoming = resp.flow ?? { nodes: [], edges: [] }
      const persistedSeed = incoming.nodes.find((node) => node.id === seed.id)
      const withoutOldSeed = incoming.nodes.filter((node) => node.id !== seed.id)
      const serverGraphIdentity = createChapterCanvasGraphIdentity({
        nodes: withoutOldSeed,
        edges: incoming.edges,
      })
      // revision 是并发写围栏，不是内容身份。服务端会保护已生成媒体并把 stale 整图
      // canonicalize 后再保存，因此浏览器旧快照可能与权威图共享 revision。只有 revision
      // 与图内容都相同才跳过第二次 store.load；任一不一致都必须让服务端事实覆盖快照。
      if (
        snapshotApplied
        && appliedSnapshotRevision !== null
        && appliedSnapshotGraphIdentity !== null
        && canReuseChapterCanvasSnapshot({
          snapshotRevision: appliedSnapshotRevision,
          serverRevision: resp.revision,
          snapshotGraphIdentity: appliedSnapshotGraphIdentity,
          serverGraphIdentity,
        })
      ) {
        return
      }
      applyFlow(
        [
          (persistedSeed ?? seed) as unknown as Record<string, unknown>,
          ...withoutOldSeed,
        ],
        incoming.edges,
      )
      setStatus('ready')
      scheduleFitView()
      // Persist snapshot so next visit is instant.
      void saveChapterSnapshot({
        chapterId,
        revision: resp.revision,
        nodes: withoutOldSeed,
        edges: incoming.edges as unknown[],
        updatedAt: Date.now(),
      })
    } catch (e: any) {
      if (!chapterCanvasMountedRef.current || seq !== loadSeqRef.current) return // 过期 load 的失败不该污染当前章的错误态
      if (snapshotApplied) {
        // We already painted from cache — fail silently. The next save will retry.
        return
      }
      setError(e?.message ?? 'Load failed')
      setStatus('error')
    }
  }, [chapterId, chapterTitle, chapterText, scheduleFitView])

  React.useEffect(() => {
    ;(window as any).__TAPCANVAS_CURRENT_CHAPTER__ = {
      projectId: props.projectId,
      bookId: props.bookId,
      chapterId,
    }
    // 同步到 uiStore（reactive 源），让聊天会话 key 按章节权威隔离，
    // 不再依赖滞后的 currentProject/currentFlow。
    useUIStore.getState().setCurrentChapter({
      projectId: props.projectId,
      bookId: props.bookId,
      chapterId,
      chapterTitle,
    })
    return () => {
      ;(window as any).__TAPCANVAS_CURRENT_CHAPTER__ = undefined
      useUIStore.getState().setCurrentChapter(null)
    }
  }, [props.projectId, props.bookId, chapterId])

  // 仅在「真正离开章节画布（组件卸载）」时清空全局 store 并摘掉归属标记，
  // 防止章节图残留到下一页面（项目主画布）被那边的整图自动保存固化。
  // 关键：切换章节【不】清空 store —— load() 会带 remoteApplyGuard 原地把内容替换成新章，
  // Canvas 与 ReactFlowProvider 全程保持挂载，从根上消除切章时的卸载重挂闪烁。
  React.useLayoutEffect(() => {
    chapterCanvasMountedRef.current = true
    return () => {
      chapterCanvasMountedRef.current = false
      loadSeqRef.current += 1
      flushPendingRef.current = false
      remoteApplyGuard.run(() => {
        useRFStore.getState().reset()
      })
      useUIStore.setState({
        currentFlow: { id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null },
        currentChapter: null,
        currentChapterCreativeOverride: null,
        restoreViewport: null,
        canvasViewport: null,
        creationSession: null,
        isDirty: false,
      })
      deletedNodeIdsRef.current.clear()
    }
  }, [])

  // 绘制前同步换图：消除切章时闪一帧上一章内容。必须用 useLayoutEffect（在浏览器绘制前跑），
  // 不能靠下方异步的 load()（useEffect 绘制后 + await → 注定晚一拍）。
  React.useLayoutEffect(() => {
    const seed = buildSeedNode({ chapterId, title: chapterTitle, text: chapterText })
    const provKey = `chapter:${chapterId}`
    if (lastSyncChapterRef.current === chapterId) {
      // 同章内种子文本/标题变化（章节 meta 网络请求晚到解析）：仅就地替换只读种子节点，
      // 其余节点对象引用保持不变 → React Flow 只重渲种子，不触发整图重渲。
      remoteApplyGuard.run(() => {
        useRFStore.setState((s) => {
          const idx = (s.nodes as any[]).findIndex((n) => n?.id === seed.id)
          if (idx < 0) return s as any
          const nextNodes = (s.nodes as any[]).slice()
          nextNodes[idx] = seed
          return { nodes: nextNodes } as any
        })
      })
      return
    }
    // 章节切换：绘制前把 store 同步替换成目标章。暖切命中同步内存快照 → 完整图秒绘；
    // 冷切无内存快照 → 只留种子，避免上一章整图闪现（真图交给异步 load 从服务端补齐）。
    lastSyncChapterRef.current = chapterId
    const mem = getChapterSnapshotSync(chapterId)
    const rest = mem ? (mem.nodes as any[]).filter((n) => n?.id !== seed.id) : []
    const edges = mem ? (mem.edges as any[]) : []
    // revision 必须与所画内容对齐：暖切用内存快照 revision；冷切置 0(未知)，
    // 让下方 load() 不会因残留的上一章 revision 而误判「已是最新」跳过服务端补图。
    revisionRef.current = mem ? mem.revision : 0
    acknowledgedFlowRef.current = {
      nodes: [
        seed as unknown as Record<string, unknown>,
        ...(rest as Record<string, unknown>[]),
      ],
      edges: edges as Record<string, unknown>[],
    }
    remoteApplyGuard.run(() => {
      useRFStore.getState().load({ nodes: [seed, ...rest], edges } as any)
      useRFStore.getState().setGraphProvenance(provKey)
    })
  }, [chapterId, chapterTitle, chapterText])

  React.useEffect(() => {
    void load()
  }, [load])

  const flush = React.useCallback(async () => {
    const sessionSeq = loadSeqRef.current
    if (!chapterCanvasMountedRef.current) return
    // Prevent concurrent saves: if one is already in-flight, mark pending and return.
    // The in-flight save will kick off another flush when it completes.
    if (flushInFlightRef.current) {
      flushPendingRef.current = true
      return
    }
    flushInFlightRef.current = true
    try {
      const { nodes, edges, graphProvenanceKey } = useRFStore.getState()
      // 归属守卫：全局 store 里的图必须确属本章节才允许整图 PUT。
      // SPA 导航/晚到的回调会让 store 残留上一画布（主画布或别章）的内容，
      // 盲存会把外来图固化进本章节行（ch6/7/10 串台实证根因）。
      if (graphProvenanceKey !== `chapter:${chapterId}`) return
      // 引用快速路径：store 图自上次干净保存以来引用未变 ⇒ 内容必未变（不可变更新），
      // 直接跳过。这一步消除了大图上每次 flush（600ms 编辑节流）都要跑一遍整图
      // JSON.stringify 的主线程周期性卡顿——该序列化即便随后跳过 PUT 也已发生。
      if (nodes === lastSavedNodesRef.current && edges === lastSavedEdgesRef.current) return
      // 指纹跳过：内容与上次成功保存完全一致就不发 PUT——
      // 两个页签开同一章时，盲目重存会互相顶 revision 形成每秒 409 乒乓（ch7 实测）。
      const fingerprint = JSON.stringify({ n: nodes, e: edges })
      if (fingerprint === lastSavedFingerprintRef.current) return
      // 本次 PUT 覆盖的墓碑快照:写回成功后(无论干净保存还是合并)服务端都已不含这些 id,
      // 据此清掉它们,避免墓碑无限增长 / 误压未来同 id 节点。期间新增的删除不在快照里、保留。
      const coveredTombstone = new Set(deletedNodeIdsRef.current)
      // 连续冲突退避：另一页签/端正在编辑，等退避窗口过了再试。
      // 用异步定时器重试，而不是 flushPendingRef + finally 同步重入：后者在退避未过期间会
      // 让每次 flush 立刻再调 flush（无任何 await 推进），同步无限递归直接爆栈（实测根因）。
      if (Date.now() < conflictBackoffUntilRef.current) {
        if (backoffRetryTimerRef.current == null) {
          const delay = Math.max(0, conflictBackoffUntilRef.current - Date.now()) + 50
          backoffRetryTimerRef.current = window.setTimeout(() => {
            backoffRetryTimerRef.current = null
            void flush()
          }, delay) as unknown as number
        }
        return
      }
      try {
        const resp = await putChapterCanvasFlow(chapterId, {
          expectedRevision: revisionRef.current,
          flow: { nodes: nodes as any, edges: edges as any },
          // 把删除墓碑一并上送：服务端写保护据此尊重显式删除，不再复活母板/分镜板（根因修复）。
          deletedNodeIds: [...coveredTombstone],
        })
        if (
          !chapterCanvasMountedRef.current
          || sessionSeq !== loadSeqRef.current
          || useRFStore.getState().graphProvenanceKey !== `chapter:${chapterId}`
        ) return
        revisionRef.current = resp.revision
        if (resp.authoritativeFlow) {
          // 服务端可能在保存 stale 整图时保护已经物化的视频/图片，并因此持久化一个与
          // 提交图不同的 canonical graph。用三方合并接回权威媒体事实，同时保留请求飞行
          // 期间发生的本地字段编辑；绝不能把旧本地图贴上新 revision 后继续缓存。
          const currentState = useRFStore.getState()
          const rebased = rebaseCanvasFlowOnConflict({
            base: { nodes, edges },
            local: { nodes: currentState.nodes, edges: currentState.edges },
            server: {
              nodes: resp.authoritativeFlow.nodes as unknown as typeof nodes,
              edges: resp.authoritativeFlow.edges as unknown as typeof edges,
            },
          })
          remoteApplyGuard.run(() => {
            useRFStore.getState().load({ nodes: rebased.nodes, edges: rebased.edges })
            useRFStore.getState().setGraphProvenance(`chapter:${chapterId}`)
          })
          acknowledgedFlowRef.current = resp.authoritativeFlow
          const authoritativeFingerprint = JSON.stringify({
            n: resp.authoritativeFlow.nodes,
            e: resp.authoritativeFlow.edges,
          })
          const rebasedFingerprint = JSON.stringify({ n: rebased.nodes, e: rebased.edges })
          lastSavedFingerprintRef.current = authoritativeFingerprint
          const appliedState = useRFStore.getState()
          if (rebasedFingerprint === authoritativeFingerprint) {
            lastSavedNodesRef.current = appliedState.nodes
            lastSavedEdgesRef.current = appliedState.edges
          } else {
            // The merge retained a concurrent local edit. It is intentionally not acknowledged;
            // schedule the normal CAS save path instead of silently treating it as persisted.
            lastSavedNodesRef.current = null
            lastSavedEdgesRef.current = null
            flushPendingRef.current = true
          }
        } else {
          acknowledgedFlowRef.current = {
            nodes: nodes as unknown as Record<string, unknown>[],
            edges: edges as unknown as Record<string, unknown>[],
          }
          lastSavedFingerprintRef.current = fingerprint
          // 记录本次已保存的图引用，供下次 flush 的引用快速路径比对。
          lastSavedNodesRef.current = nodes
          lastSavedEdgesRef.current = edges
        }
        conflictStreakRef.current = 0
        // 干净保存成功:服务端已与本地一致,本次覆盖的墓碑 id 已确认删除,清掉。
        coveredTombstone.forEach((id) => deletedNodeIdsRef.current.delete(id))
      } catch (e) {
        if (e instanceof ChapterCanvasFlowConflictError) {
          // 每发生一次 409 就升级退避（无论后续合并是否成功）——两个并发写者（同章双页签 /
          // 路由重挂导致的双份 autosave / 多端）据此错峰，几轮内收敛，而不是全速 409 乒乓。
          // 关键修复：只有上方「无冲突的干净保存」分支才把计数归零；合并重试成功不归零，
          // 否则计数每轮被清、退避永不启动（历史 bug 根因）。
          conflictStreakRef.current += 1
          conflictBackoffUntilRef.current = Date.now() + conflictBackoffMs(conflictStreakRef.current)
          if (conflictStreakRef.current === 3) {
            toast('画布正在其他窗口被编辑，已暂缓本窗口自动保存', 'info')
          }
          // Revision 被并发推进（典型：agent 服务端直写本章节行）。禁止拿本地 store 强写——
          // 那会击穿乐观锁、抹掉 agent 刚写入的节点。改为取回服务端最新图做「墓碑感知合并」：
          // 服务端独有节点保留（agent 写入不丢）、同 id 以本地为准（用户最新编辑不丢）、
          // 但本地已删的节点（墓碑）不被服务端捞回（否则一对话就复活）。
          try {
            const latest = await getChapterCanvasFlow(chapterId)
            if (
              !chapterCanvasMountedRef.current
              || sessionSeq !== loadSeqRef.current
              || useRFStore.getState().graphProvenanceKey !== `chapter:${chapterId}`
            ) return
            revisionRef.current = latest.revision
            const { nodes: ns, edges: es, graphProvenanceKey: prov } = useRFStore.getState()
            if (prov !== `chapter:${chapterId}`) return
            const serverFlow = latest.flow ?? { nodes: [], edges: [] }
            // 墓碑感知合并:服务端独有节点保留(agent 写入不丢)、同 id 以本地为准(用户最新
            // 编辑不丢)、但墓碑里的本地删除不被服务端捞回(对话即复活的根因修复)。
            const { nodes: mergedNodes, edges: mergedEdges } = rebaseCanvasFlowOnConflict({
              base: acknowledgedFlowRef.current,
              local: {
                nodes: ns as unknown as Record<string, unknown>[],
                edges: es as unknown as Array<Record<string, unknown> & { source?: unknown; target?: unknown }>,
              },
              server: serverFlow,
            })
            const retryFingerprint = JSON.stringify({ n: mergedNodes, e: mergedEdges })
            const resp = await putChapterCanvasFlow(chapterId, {
              expectedRevision: revisionRef.current,
              flow: { nodes: mergedNodes as any, edges: mergedEdges as any },
              // 合并写回同样上送墓碑：服务端护栏不复活用户已删的资产节点。
              deletedNodeIds: [...deletedNodeIdsRef.current],
            })
            if (
              !chapterCanvasMountedRef.current
              || sessionSeq !== loadSeqRef.current
              || useRFStore.getState().graphProvenanceKey !== `chapter:${chapterId}`
            ) return
            revisionRef.current = resp.revision
            acknowledgedFlowRef.current = { nodes: mergedNodes, edges: mergedEdges }
            lastSavedFingerprintRef.current = retryFingerprint
            // 合并路径 store 引用与本地 mergedNodes 未必一致（视是否回灌），
            // 直接作废引用快速路径，下次 flush 回落到权威指纹比对（安全）。
            lastSavedNodesRef.current = null
            lastSavedEdgesRef.current = null
            // 合并写回成功:mergedNodes 已剔除墓碑节点,服务端这下也不含它们了 → 清掉覆盖的墓碑。
            coveredTombstone.forEach((id) => deletedNodeIdsRef.current.delete(id))
            // 合并虽成功，但冲突确实发生过：不在此归零 conflictStreak，
            // 让退避继续随连续冲突升级，直到一次真正无冲突的干净保存才归零。
            // 把合并结果回灌 store，让用户立刻看到服务端新增的节点（agent 出图卡等）
            if (mergedNodes.length !== (ns as any[]).length || mergedEdges.length !== (es as any[]).length) {
              remoteApplyGuard.run(() => {
                useRFStore.getState().load({ nodes: mergedNodes, edges: mergedEdges } as any)
                useRFStore.getState().setGraphProvenance(`chapter:${chapterId}`)
              })
            }
          } catch {
            // 合并重试本身又失败：退避已在进入冲突分支时按 streak 设过，无需重复累加。
          }
        } else {
          toast(`保存失败：${String(e)}`, 'error')
        }
      }
    } finally {
      flushInFlightRef.current = false
      if (
        chapterCanvasMountedRef.current
        && sessionSeq === loadSeqRef.current
        && flushPendingRef.current
      ) {
        flushPendingRef.current = false
        void flush()
      }
    }
  }, [chapterId])

  const waitForFlushIdle = React.useCallback(async (): Promise<void> => {
    const deadline = Date.now() + CODEX_SAVE_WAIT_TIMEOUT_MS
    while (flushInFlightRef.current) {
      if (Date.now() >= deadline) {
        throw new Error('等待章节画布保存完成超时，Codex 派发已停止')
      }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, CODEX_SAVE_POLL_INTERVAL_MS)
      })
    }
  }, [])

  const flushForCodex = React.useCallback(async (
    requestedChapterId: string,
  ): Promise<number> => {
    if (requestedChapterId !== chapterId) {
      throw new Error('当前章节已切换，Codex 派发已停止')
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForFlushIdle()
      await flush()
      await waitForFlushIdle()
      const { nodes, edges, graphProvenanceKey } = useRFStore.getState()
      if (graphProvenanceKey !== `chapter:${chapterId}`) {
        throw new Error('当前画布内容不属于待派发章节，Codex 派发已停止')
      }
      const fingerprint = JSON.stringify({ n: nodes, e: edges })
      if (fingerprint === lastSavedFingerprintRef.current) {
        return revisionRef.current
      }
    }

    throw new Error('章节画布仍有未持久化编辑，请保存完成后重新派发 Codex')
  }, [chapterId, flush, waitForFlushIdle])

  React.useEffect(() => {
    if (saveRef) saveRef.current = flush
    // 暴露给画布内的组触发（generateGroupStoryboard）在章节画布上强制存盘后再派发 orchestrate。
    const runtimeWindow = window as ChapterCanvasRuntimeWindow
    runtimeWindow.__TAPCANVAS_CHAPTER_SAVE__ = flush
    runtimeWindow.__TAPCANVAS_CODEX_CHAPTER_SAVE__ = flushForCodex
    return () => {
      if (saveRef) saveRef.current = null
      if (runtimeWindow.__TAPCANVAS_CHAPTER_SAVE__ === flush) {
        delete runtimeWindow.__TAPCANVAS_CHAPTER_SAVE__
      }
      if (runtimeWindow.__TAPCANVAS_CODEX_CHAPTER_SAVE__ === flushForCodex) {
        delete runtimeWindow.__TAPCANVAS_CODEX_CHAPTER_SAVE__
      }
    }
  }, [saveRef, flush, flushForCodex])

  const scheduleSave = React.useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void flush()
    }, 600) as any
  }, [flush])

  // Local snapshot persistence — independent debounce, longer than server save
  // so we don't thrash IndexedDB on every keystroke but stay fresh enough.
  const snapshotTimerRef = React.useRef<number | null>(null)
  const scheduleSnapshot = React.useCallback(() => {
    if (snapshotTimerRef.current != null) {
      window.clearTimeout(snapshotTimerRef.current)
    }
    snapshotTimerRef.current = window.setTimeout(() => {
      const { nodes, edges, graphProvenanceKey } = useRFStore.getState()
      // 与 flush 同样的归属守卫：外来图不进本章节的本地快照缓存
      if (graphProvenanceKey !== `chapter:${chapterId}`) return
      const filteredNodes = (nodes as any[]).filter((n) => !String(n.id ?? '').startsWith(SEED_NODE_ID_PREFIX))
      void saveChapterSnapshot({
        chapterId,
        revision: revisionRef.current,
        nodes: filteredNodes,
        edges: edges as unknown[],
        updatedAt: Date.now(),
      })
    }, 1500) as any
  }, [chapterId])

  const handleRemoteCanvasPatch = React.useCallback((patch: SyncPatch) => {
    acknowledgedFlowRef.current = applyServerPatchToAcknowledgedFlow({
      nodes: acknowledgedFlowRef.current.nodes,
      edges: acknowledgedFlowRef.current.edges,
      patch: {
        upsertNodes: patch.upsertNodes as Record<string, unknown>[] | undefined,
        removeNodeIds: patch.removeNodeIds,
        upsertEdges: patch.upsertEdges as Record<string, unknown>[] | undefined,
        removeEdgeIds: patch.removeEdgeIds,
      },
    })
    if (typeof patch.revision === 'number' && patch.revision > revisionRef.current) {
      revisionRef.current = patch.revision
    }
  }, [])

  React.useEffect(() => {
    if (status !== 'ready') return
    const unsub = useRFStore.subscribe((state, prev) => {
      // 选中态变化不算图变更：selected 不入库（PUT 后回来也不带它），却会换掉节点引用，
      // 于是「点一下节点」就排一次整图 JSON.stringify + PUT + IndexedDB 快照——两段主线程
      // 阻塞正好落在聚焦挂载之后，把点击手感的尾巴拖长。这里按「除 selected 外是否同引用」
      // 判定，纯选中变化直接返回，其余（含 selected 与内容同时变）照旧走保存。
      if (state.edges === prev.edges && state.nodes !== prev.nodes && isSelectionOnlyNodeDiff(prev.nodes, state.nodes)) return
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) {
        // 维护删除墓碑:仅登记本地删除(远端 SSE 删除不计——那是对端已落盘的结果)。
        // prev 有、state 没有的 id = 用户本地删除 → 进墓碑;重新出现的 id(撤销 / agent
        // 重建被本地接受)→ 出墓碑。这样后续 409 合并能尊重删除,而不被并集捞回。
        if (!remoteApplyGuard.active && !derivedApplyGuard.active && state.nodes !== prev.nodes) {
          const nextIds = new Set((state.nodes as any[]).map((n) => String(n?.id ?? '')))
          for (const n of prev.nodes as any[]) {
            const id = String(n?.id ?? '')
            if (id && !nextIds.has(id)) deletedNodeIdsRef.current.add(id)
          }
          for (const id of nextIds) deletedNodeIdsRef.current.delete(id)
        }
        // 远端(SSE)patch 应用引发的 store 变更不触发整图 PUT——发起端已落盘,
        // 本端再整图 PUT 只会带着过期 revision 撞 409,与对端来回乒乓。
        // 本地快照缓存仍刷新,保证离线/重进时画面是最新的。
        if (!remoteApplyGuard.active && !derivedApplyGuard.active) scheduleSave()
        scheduleSnapshot()
      }
    })
    return () => {
      unsub()
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current)
      }
      if (snapshotTimerRef.current != null) {
        window.clearTimeout(snapshotTimerRef.current)
      }
      if (backoffRetryTimerRef.current != null) {
        window.clearTimeout(backoffRetryTimerRef.current)
        backoffRetryTimerRef.current = null
      }
    }
  }, [status, scheduleSave, scheduleSnapshot])

  useCanvasSync(chapterId, status === 'ready', '/chapters', {
    onRemoteCanvasPatch: handleRemoteCanvasPatch,
  })

  // Canvas / ReactFlowProvider 始终挂载：切章只在 store 内原地换图，绝不卸载重挂。
  // 加载态与错误态改为盖在画布之上的浮层（而非替换画布），避免切章的加载闪烁。
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minWidth: 0 }}>
      {/* 章节画布与工作台画布一致：挂载全局快捷键（复制/粘贴/撤销/删除/成组等）。
          此前仅 CanvasApp 挂载，章节路由走 ChapterCanvasFullPage 未挂 → Ctrl+C/V 等无效。 */}
      <KeyboardShortcuts />
      <Canvas />
      {/* 视频 run 真实进度 + 终止入口：章节画布同样需要（run-status 现已广播到 chapterId 房间）。
          显式传 projectId/chapterId，避免依赖可能滞后的 uiStore。 */}
      <div style={{ position: 'absolute', left: 16, top: 100, zIndex: 30, pointerEvents: 'none' }}>
        <VideoRunIndicator projectId={props.projectId} currentChapterId={chapterId} />
      </div>
      {/* 冷启动（本地无快照可画）用与 Canvas 初载遮罩同款的浮层盖住空画布，就绪后同样 0.4s 淡出，
          全程只呈现一种加载状态；有快照时开局即隐藏（opacity 0 + pointer-events none），无多余加载。 */}
      <CanvasLoadingScreen hidden={status !== 'loading'} />
      {status === 'error' ? (
        <Stack
          p="md"
          justify="center"
          style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'var(--mantine-color-body)' }}
        >
          <Alert color="red">{error ?? '加载失败'}</Alert>
          <Button
            leftSection={<IconRefresh size={14} />}
            onClick={() => void load()}
          >
            重试
          </Button>
        </Stack>
      ) : null}
    </div>
  )
}
