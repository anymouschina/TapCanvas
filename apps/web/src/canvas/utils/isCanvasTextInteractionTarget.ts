/**
 * Returns whether a target belongs to a native text editing or text-selection
 * surface. Canvas-level shortcuts must leave these surfaces to the browser.
 */
export function isCanvasTextInteractionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
  if (target.getAttribute('contenteditable') === 'true') return true

  return Boolean(
    target.closest('input') ||
    target.closest('textarea') ||
    target.closest('[contenteditable="true"]') ||
    target.closest('[data-canvas-text-selection]'),
  )
}
