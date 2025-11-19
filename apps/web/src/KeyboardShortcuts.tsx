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
  const undo = useRFStore((s) => s.undo)
  const redo = useRFStore((s) => s.redo)
  const selectAll = useRFStore((s) => s.selectAll)
  const clearSelection = useRFStore((s) => s.clearSelection)
  const invertSelection = useRFStore((s) => s.invertSelection)
  const focusStack = useUIStore(s => s.focusStack)
  const exitGroupFocus = useUIStore(s => s.exitGroupFocus)
  const addGroupForSelection = useRFStore((s) => s.addGroupForSelection)
  const layoutGridSelected = useRFStore((s) => s.layoutGridSelected)
  const layoutHorizontalSelected = useRFStore((s) => s.layoutHorizontalSelected)
  const renameSelectedGroup = useRFStore((s) => s.renameSelectedGroup)
  const runSelectedGroup = useRFStore((s) => s.runSelectedGroup)
  const removeGroupById = useRFStore((s) => s.removeGroupById)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      const target = e.target as HTMLElement | null
      const focusTarget = document.activeElement as HTMLElement | null
      const isTextInput =
        isTextInputElement(target) ||
        isTextInputElement(focusTarget)
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
        e.preventDefault()
        removeSelected()
      }
      // Copy (skip when focused in an input/textarea/contenteditable)
      if (mod && e.key.toLowerCase() === 'c' && !isTextInput) {
        e.preventDefault()
        copySelected()
      }
      // Paste (skip when focused in an input/textarea/contenteditable)
      if (mod && e.key.toLowerCase() === 'v' && !isTextInput) {
        e.preventDefault()
        pasteFromClipboard()
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
        if (!e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); layoutGridSelected() }
        if (e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); layoutHorizontalSelected() }
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected, copySelected, pasteFromClipboard])

  return null
}
