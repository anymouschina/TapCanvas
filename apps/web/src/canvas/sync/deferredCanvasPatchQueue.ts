export type DeferredCanvasPatch<TPatch> = {
  patch: TPatch
  onApplied?: (patch: TPatch) => void
}

export function drainDeferredCanvasPatches<TPatch>(
  queue: DeferredCanvasPatch<TPatch>[],
  apply: (patch: TPatch) => void,
): void {
  const pending = queue.splice(0)
  for (const item of pending) {
    apply(item.patch)
    item.onApplied?.(item.patch)
  }
}
