export function setTapImageDragData(
  evt: React.DragEvent,
  url: string,
): void {
  const trimmed = (url || '').trim()
  if (!trimmed) return
  if (!evt.dataTransfer) return

  try {
    evt.dataTransfer.effectAllowed = 'copy'
  } catch {
    // ignore
  }

  // Used by canvas drop handler.
  try {
    evt.dataTransfer.setData('application/tap-image-url', JSON.stringify({ url: trimmed }))
  } catch {
    // ignore
  }

  // Safari / generic fallbacks.
  try {
    evt.dataTransfer.setData('text/plain', trimmed)
  } catch {
    // ignore
  }
}

