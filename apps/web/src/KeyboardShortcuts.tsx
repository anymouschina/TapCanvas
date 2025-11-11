import { useEffect } from 'react'
import { useRFStore, persistToLocalStorage } from './canvas/store'

export default function KeyboardShortcuts() {
  const removeSelected = useRFStore((s) => s.removeSelected)
  const copySelected = useRFStore((s) => s.copySelected)
  const pasteFromClipboard = useRFStore((s) => s.pasteFromClipboard)
  const undo = useRFStore((s) => s.undo)
  const redo = useRFStore((s) => s.redo)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      // Delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT','TEXTAREA'].includes((e.target as any)?.tagName)) {
        e.preventDefault()
        removeSelected()
      }
      // Copy
      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copySelected()
      }
      // Paste
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        pasteFromClipboard()
      }
      // Undo / Redo
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if ((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault()
        redo()
      }
      // Save
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        persistToLocalStorage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected, copySelected, pasteFromClipboard])

  return null
}
