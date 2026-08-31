// 共享「远端应用」守卫(进程内单例,跨模块共享)。
//
// 背景:章节画布有两个独立的 useRFStore 订阅者会在节点变化时各自落盘——
//   · useCanvasSync   → POST /canvas-patches(增量,SSE 广播给其他端)
//   · ChapterCanvasPage → PUT  /canvas-flow(整图,带乐观锁 revision)
// 当某端经 SSE 收到别端的 patch 并 applyPatch 到本地 store 时,这本是「远端变更」,
// 不该再被本端当成本地编辑回写。useCanvasSync 自己有 ref 守卫,但 ChapterCanvasPage
// 在另一个模块、看不到那个 ref,于是照常整图 PUT → 携带过期 revision → 409 →
// 取回合并 → load() → 又触发订阅 → 再 PUT…… 与对端来回乒乓(每秒级 409 风暴)。
//
// 这个单例让「正在应用远端 patch」成为所有订阅者都能读到的事实,从根上断掉回写。
// 用深度计数而非布尔,容忍嵌套 apply 不至于提前复位。

type ApplyGuard = {
  begin: () => void
  end: () => void
  readonly active: boolean
  run: <T>(fn: () => T) => T
}

function createApplyGuard(): ApplyGuard {
  let depth = 0
  return {
    begin(): void {
      depth += 1
    },
    end(): void {
      if (depth > 0) depth -= 1
    },
    get active(): boolean {
      return depth > 0
    },
    run<T>(fn: () => T): T {
      depth += 1
      try {
        return fn()
      } finally {
        if (depth > 0) depth -= 1
      }
    },
  }
}

export const remoteApplyGuard = createApplyGuard()

// Media natural-size hydration and other render-derived normalization update the
// in-memory graph, but are not user edits. Keeping a distinct guard prevents those
// updates from entering autosave/collaboration loops while preserving remote-change
// semantics and observability.
export const derivedApplyGuard = createApplyGuard()
