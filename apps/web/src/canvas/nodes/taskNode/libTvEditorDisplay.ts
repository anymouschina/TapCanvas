export function resolveLibTvEditorScale(viewportZoom: number): number {
  if (!Number.isFinite(viewportZoom)) return 1
  return Math.min(1, Math.max(0.62, 0.5 + viewportZoom * 0.6))
}
