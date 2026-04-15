import { useEffect } from 'react'
import { useRFStore, persistToLocalStorage } from './canvas/store'
import { useUIStore } from './ui/uiStore'
import { extractCanvasGraph, type CanvasImportData } from './canvas/utils/serialization'

function isTextInputElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName
  if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true
  if (target.getAttribute('contenteditable') === 'true') return true
  if (target.closest('input') || target.closest('textarea')) return true
  if (target.closest('[contenteditable="true"]')) return true
  return false
}

function handleDeleteShortcut(e: KeyboardEvent, isTextInput: boolean, removeSelected: () => void) {
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextInput) {
    e.preventDefault()
    removeSelected()
  }
}

function handleCopyShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  hasTextSelection: boolean,
  copySelected: () => void,
) {
  if (mod && e.key.toLowerCase() === 'c' && !isTextInput && !hasTextSelection) {
    e.preventDefault()
    copySelected()
  }
}

function handlePasteShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  pasteFromClipboard: () => void,
) {
  if (mod && e.key.toLowerCase() === 'v' && !isTextInput) {
    const downAt = Date.now()
    // Let "paste" event handlers (e.g. image paste) run first, then fallback to node paste.
    window.setTimeout(() => {
      const lastImagePasteAt = (window as any).__tcLastImagePasteAt
      const lastWorkflowPasteAt = (window as any).__tcLastWorkflowPasteAt
      if (typeof lastImagePasteAt === 'number' && lastImagePasteAt >= downAt && lastImagePasteAt - downAt < 800) {
        return
      }
      if (typeof lastWorkflowPasteAt === 'number' && lastWorkflowPasteAt >= downAt && lastWorkflowPasteAt - downAt < 800) {
        return
      }
      pasteFromClipboard()
    }, 0)
  }
}

function handleImportWorkflowShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  importWorkflow: (data: CanvasImportData | null | undefined, pos: { x: number; y: number }) => void,
) {
  if (mod && e.shiftKey && e.key.toLowerCase() === 'v' && !isTextInput) {
    e.preventDefault()
    navigator.clipboard.readText().then(text => {
      try {
        const data = JSON.parse(text) as CanvasImportData
        const extracted = extractCanvasGraph(data)
        if (extracted?.nodes.length) {
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
}

function handleUndoRedoShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  undo: () => void,
  redo: () => void,
) {
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !isTextInput) {
    e.preventDefault()
    undo()
  }
  if (((mod && e.key.toLowerCase() === 'z' && e.shiftKey) || (mod && e.key.toLowerCase() === 'y')) && !isTextInput) {
    e.preventDefault()
    redo()
  }
}

function handleSaveShortcut(e: KeyboardEvent, mod: boolean, isTextInput: boolean) {
  if (mod && e.key.toLowerCase() === 's' && !isTextInput) {
    e.preventDefault()
    persistToLocalStorage()
  }
}

function handleSelectionShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  selectAll: () => void,
  invertSelection: () => void,
) {
  if (mod && e.key.toLowerCase() === 'a' && !e.shiftKey && !isTextInput) {
    e.preventDefault()
    selectAll()
  }
  if (mod && e.key.toLowerCase() === 'a' && e.shiftKey && !isTextInput) {
    e.preventDefault()
    invertSelection()
  }
}

function handleGroupShortcut(
  e: KeyboardEvent,
  mod: boolean,
  isTextInput: boolean,
  addGroupForSelection: () => void,
  ungroupGroupNode: (id: string) => void,
  findGroupMatchingSelection: () => { id: string } | null,
) {
  if (!(mod && e.key.toLowerCase() === 'g' && !isTextInput)) return
  e.preventDefault()

  if (e.shiftKey) {
    const state = useRFStore.getState()
    const selectedGroupIds = state.nodes
      .filter((n) => n.selected && n.type === 'groupNode')
      .map((n) => n.id)
    if (selectedGroupIds.length) {
      selectedGroupIds.forEach((id) => ungroupGroupNode(id))
      return
    }
    const matched = findGroupMatchingSelection()
    if (matched) ungroupGroupNode(matched.id)
    return
  }

  addGroupForSelection()
}

function handleEscapeShortcut(e: KeyboardEvent, clearSelection: () => void, clearFocusedSubgraph: () => void) {
  if (e.key === 'Escape') {
    e.preventDefault()
    const focusedNodeId = useUIStore.getState().focusedNodeId
    if (focusedNodeId) clearFocusedSubgraph()
    else clearSelection()
  }
}

function handleLayoutShortcut(e: KeyboardEvent, isTextInput: boolean, formatTree: () => void) {
  if (!isTextInput && e.key.toLowerCase() === 'l') {
    e.preventDefault()
    formatTree()
  }
}

function handleRunShortcut(e: KeyboardEvent, mod: boolean, isTextInput: boolean) {
  if (mod && e.key === 'Enter' && !isTextInput) {
    e.preventDefault()
    useRFStore.getState().runSelected()
  }
}

export default function KeyboardShortcuts({ className }: { className?: string }) {
  void className
  const removeSelected = useRFStore((s) => s.removeSelected)
  const copySelected = useRFStore((s) => s.copySelected)
  const pasteFromClipboard = useRFStore((s) => s.pasteFromClipboard)
  const importWorkflow = useRFStore((s) => s.importWorkflow)
  const undo = useRFStore((s) => s.undo)
  const redo = useRFStore((s) => s.redo)
  const selectAll = useRFStore((s) => s.selectAll)
  const clearSelection = useRFStore((s) => s.clearSelection)
  const invertSelection = useRFStore((s) => s.invertSelection)
  const addGroupForSelection = useRFStore((s) => s.addGroupForSelection)
  const ungroupGroupNode = useRFStore((s) => s.ungroupGroupNode)
  const findGroupMatchingSelection = useRFStore((s) => s.findGroupMatchingSelection)
  const clearFocusedSubgraph = useUIStore(s => s.clearFocusedSubgraph)
  const formatTree = useRFStore((s) => s.formatTree)

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
      handleDeleteShortcut(e, isTextInput, removeSelected)
      handleCopyShortcut(e, mod, isTextInput, hasTextSelection, copySelected)
      handlePasteShortcut(e, mod, isTextInput, pasteFromClipboard)
      handleImportWorkflowShortcut(e, mod, isTextInput, importWorkflow)
      handleUndoRedoShortcut(e, mod, isTextInput, undo, redo)
      handleSaveShortcut(e, mod, isTextInput)
      handleSelectionShortcut(e, mod, isTextInput, selectAll, invertSelection)
      handleGroupShortcut(
        e,
        mod,
        isTextInput,
        addGroupForSelection,
        ungroupGroupNode,
        findGroupMatchingSelection,
      )
      handleEscapeShortcut(e, clearSelection, clearFocusedSubgraph)
      handleLayoutShortcut(e, isTextInput, formatTree)
      handleRunShortcut(e, mod, isTextInput)
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
  }, [
    removeSelected,
    copySelected,
    pasteFromClipboard,
    importWorkflow,
    addGroupForSelection,
    ungroupGroupNode,
    findGroupMatchingSelection,
    undo,
    redo,
    selectAll,
    clearSelection,
    invertSelection,
    clearFocusedSubgraph,
    formatTree,
  ])

  return null
}
