import { useEffect } from 'react'
import { useRFStore, persistToLocalStorage } from './canvas/store'
import { useUIStore } from './ui/uiStore'

function isTextInputElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
  if (target.getAttribute('contenteditable') === 'true') return true
  if (target.closest('input') || target.closest('textarea')) return true
  if (target.closest('[contenteditable="true"]')) return true
  return false
}

export default function KeyboardShortcuts() {
  const removeSelected = useRFStore((s) => s.removeSelected)
  const copySelected = useRFStore((s) => s.copySelected)
  const pasteFromClipboard = useRFStore((s) => s.pasteFromClipboard)
  const importWorkflow = useRFStore((s) => s.importWorkflow)
  const undo = useRFStore((s) => s.undo)
  const redo = useRFStore((s) => s.redo)
  const selectAll = useRFStore((s) => s.selectAll)
  const clearSelection = useRFStore((s) => s.clearSelection)
  const invertSelection = useRFStore((s) => s.invertSelection)
  const focusStack = useUIStore(s => s.focusStack)
  const exitGroupFocus = useUIStore(s => s.exitGroupFocus)
  const addGroupForSelection = useRFStore((s) => s.addGroupForSelection)
  const formatTree = useRFStore((s) => s.formatTree)
  const renameSelectedGroup = useRFStore((s) => s.renameSelectedGroup)
  const runSelectedGroup = useRFStore((s) => s.runSelectedGroup)
  const removeGroupById = useRFStore((s) => s.removeGroupById)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    let windowFocused = typeof document === 'undefined' ? true : document.hasFocus()
    let lastInteractionInsideApp = true
    const handleWindowFocus = () => {
      windowFocused = true
    }
    const handleWindowBlur = () => {
      windowFocused = false
      lastInteractionInsideApp = false
    }
    const rootEl = document.getElementById('root')
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootEl) {
        lastInteractionInsideApp = true
        return
      }
      const target = event.target as Node | null
      lastInteractionInsideApp = target ? rootEl.contains(target) : false
    }
    function onKey(e: KeyboardEvent) {
      if (!windowFocused || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
        return
      }
      if (!lastInteractionInsideApp) {
        return
      }
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      const target = e.target as HTMLElement | null
      const focusTarget = document.activeElement as HTMLElement | null
      const isTextInput =
        isTextInputElement(target) ||
        isTextInputElement(focusTarget)
      const selection = window.getSelection()
      const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim().length)
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
        e.preventDefault()
        removeSelected()
      }
      // Copy (skip when focused in an input/textarea/contenteditable)
      if (mod && e.key.toLowerCase() === 'c' && !isTextInput && !hasTextSelection) {
        e.preventDefault()
        copySelected()
      }
      // Paste (skip when focused in an input/textarea/contenteditable)
      if (mod && e.key.toLowerCase() === 'v' && !isTextInput) {
        const downAt = Date.now()
        // Let "paste" event handlers (e.g. image paste) run first, then fallback to node paste.
        window.setTimeout(() => {
          const lastImagePasteAt = (window as any).__tcLastImagePasteAt
          if (typeof lastImagePasteAt === 'number' && lastImagePasteAt >= downAt && lastImagePasteAt - downAt < 800) {
            return
          }
          pasteFromClipboard()
        }, 0)
      }
      // Import Workflow from JSON (skip when focused in an input/textarea/contenteditable)
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && !isTextInput) {
        e.preventDefault()
        navigator.clipboard.readText().then(text => {
          try {
            const data = JSON.parse(text)
            if (data.nodes && Array.isArray(data.nodes) && data.edges && Array.isArray(data.edges)) {
              importWorkflow(data, { x: 100, y: 100 })
            } else {
              alert('剪贴板中的内容不是有效的工作流格式')
            }
          } catch (err) {
            alert('解析剪贴板 JSON 失败: ' + (err as Error).message)
          }
        }).catch(() => {
          alert('无法读取剪贴板内容')
        })
      }
      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTextInput) {
        e.preventDefault()
        undo()
      }
      if (((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) && !isTextInput) {
        e.preventDefault()
        redo()
      }
      // Save
      if (mod && e.key.toLowerCase() === 's' && !isTextInput) {
        e.preventDefault()
        persistToLocalStorage()
      }
      // Select All / Invert / Clear
      if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey && !isTextInput) {
        e.preventDefault(); selectAll()
      }
      if (mod && e.key.toLowerCase() === 'a' && e.shiftKey && !isTextInput) {
        e.preventDefault(); invertSelection()
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        const stack = useUIStore.getState().focusStack
        if (stack.length) exitGroupFocus(); else clearSelection()
      }
      // Group / Ungroup
      if (mod && e.key.toLowerCase() === 'g' && !e.shiftKey && !isTextInput) {
        e.preventDefault(); addGroupForSelection(undefined)
      }
      if (mod && e.key.toLowerCase() === 'g' && e.shiftKey && !isTextInput) {
        e.preventDefault();
        const s = useRFStore.getState()
        const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
        if (g) removeGroupById(g.id)
      }
      // Layout
      if (!isTextInput) {
        if (e.key.toLowerCase() === 'l') { e.preventDefault(); formatTree() }
      }
      // Rename (F2)
      if (e.key === 'F2') { e.preventDefault(); renameSelectedGroup() }
      // Run (mod+Enter): group if group selected, else node
      if (mod && e.key === 'Enter' && !isTextInput) {
        e.preventDefault();
        const s = useRFStore.getState()
        const g = s.nodes.find((n: any) => n.type === 'groupNode' && n.selected)
        if (g) runSelectedGroup(); else s.runSelected()
      }
    }
    const pointerOptions: AddEventListenerOptions = { capture: true }
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('pointerdown', handlePointerDown, pointerOptions)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('pointerdown', handlePointerDown, pointerOptions)
    }
  }, [removeSelected, copySelected, pasteFromClipboard, importWorkflow])

  return null
}
