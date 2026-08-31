import React from 'react'
import { ActionIcon, Text } from '@mantine/core'
import { IconBrain, IconBulb, IconPhoto } from '@tabler/icons-react'
import type { PromptMediaKind } from '../../../../api/promptLibrary'
import { AssetMentionPanel } from './AssetMentionPanel'
import { CanvasPromptLibraryPicker } from './CanvasPromptLibraryPicker'
import {
  buildPromptMentionAliasMap,
  collectPromptMentionAliases,
  getPromptMentionTokenCore,
  normalizePromptMentionAlias,
} from '../../../../runner/promptMentionAliases'

// ── types ────────────────────────────────────────────────────────────────────

type MentionMenuPosition = {
  left: number
  top: number
  width: number
}

export type MentionSuggestionItem = {
  username: string
  display_name: string
  profile_picture_url?: string | null
  source: 'character' | 'asset'
  nodeId?: string | null
  mentionAliases?: readonly string[]
  isConnected?: boolean
  assetBinding?: {
    url: string
    assetId?: string | null
    assetRefId?: string | null
    assetName?: string | null
    role?: 'style' | 'reference'
  }
}

// ── rich-text helpers ─────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

type ChipEntry = {
  username: string
  displayName?: string
  avatarUrl: string | null
  aliases?: readonly string[]
}

function buildChipHtml(entry: ChipEntry, sourceToken = entry.username): string {
  const img = entry.avatarUrl
    ? `<img src="${escAttr(entry.avatarUrl)}" class="task-node-prompt__chip-thumb" alt="" crossorigin="anonymous" referrerpolicy="no-referrer" />`
    : `<span class="task-node-prompt__chip-thumb task-node-prompt__chip-thumb--placeholder">@</span>`
  const displayName = entry.displayName?.trim() || entry.username
  return (
    `<span class="task-node-prompt__chip" contenteditable="false" data-mention="${escAttr(sourceToken)}">` +
    img +
    `<span class="task-node-prompt__chip-text">@${escHtml(displayName)}</span>` +
    `</span>`
  )
}

function textToHtml(text: string, chips: readonly ChipEntry[]): string {
  if (!text) return ''
  if (!chips.length) return escHtml(text).replace(/\n/g, '<br>')
  const aliasMap = buildPromptMentionAliasMap(chips)
  if (!aliasMap.size) return escHtml(text).replace(/\n/g, '<br>')

  const matcher = /@[^\s@]+/g
  let html = ''
  let cursor = 0
  for (const match of text.matchAll(matcher)) {
    const rawMention = match[0]
    const start = match.index ?? cursor
    html += escHtml(text.slice(cursor, start)).replace(/\n/g, '<br>')
    const tokenCore = getPromptMentionTokenCore(rawMention)
    const entry = aliasMap.get(normalizePromptMentionAlias(tokenCore))
    if (!entry) {
      html += escHtml(rawMention)
    } else {
      const suffix = rawMention.slice(tokenCore.length + 1)
      html += buildChipHtml(entry, tokenCore)
      html += escHtml(suffix)
    }
    cursor = start + rawMention.length
  }
  html += escHtml(text.slice(cursor)).replace(/\n/g, '<br>')
  return html
}

function htmlToText(el: HTMLElement): string {
  let out = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
    } else if (node instanceof HTMLElement) {
      const mention = node.dataset.mention
      if (mention != null) {
        out += `@${mention}`
      } else if (node.tagName === 'BR') {
        out += '\n'
      } else {
        out += htmlToText(node)
        if (node.tagName === 'DIV' || node.tagName === 'P') out += '\n'
      }
    }
  }
  return out
}

function getPlainCaret(editor: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  const pre = document.createRange()
  pre.selectNodeContents(editor)
  pre.setEnd(range.startContainer, range.startOffset)
  const tmp = document.createElement('div')
  tmp.appendChild(pre.cloneContents())
  return htmlToText(tmp).length
}

function setCaretAt(editor: HTMLElement, offset: number): void {
  let rem = offset
  function walk(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length
      if (rem <= len) {
        const r = document.createRange()
        r.setStart(node, rem)
        r.collapse(true)
        const s = window.getSelection()
        if (s) { s.removeAllRanges(); s.addRange(r) }
        return true
      }
      rem -= len
      return false
    }
    if (node instanceof HTMLElement) {
      if (node.dataset.mention != null) {
        const len = `@${node.dataset.mention}`.length
        if (rem <= len) {
          const r = document.createRange()
          r.setStartAfter(node)
          r.collapse(true)
          const s = window.getSelection()
          if (s) { s.removeAllRanges(); s.addRange(r) }
          return true
        }
        rem -= len
        return false
      }
      if (node.tagName === 'BR') {
        if (rem === 0) {
          const r = document.createRange()
          r.setStartBefore(node)
          r.collapse(true)
          const s = window.getSelection()
          if (s) { s.removeAllRanges(); s.addRange(r) }
          return true
        }
        rem -= 1
        return false
      }
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true
      }
    }
    return false
  }
  if (!walk(editor)) {
    const r = document.createRange()
    r.selectNodeContents(editor)
    r.collapse(false)
    const s = window.getSelection()
    if (s) { s.removeAllRanges(); s.addRange(r) }
  }
}

function getCaretViewportRect(editor: HTMLElement): { left: number; top: number; height: number } | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  const { startContainer, startOffset } = range
  if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
    const charRange = document.createRange()
    charRange.setStart(startContainer, startOffset - 1)
    charRange.setEnd(startContainer, startOffset)
    const rects = charRange.getClientRects()
    if (rects.length > 0) {
      const r = rects[rects.length - 1]
      if (r.height > 0) return { left: r.right, top: r.top, height: r.height }
    }
  }
  const editorRect = editor.getBoundingClientRect()
  if (!editorRect.height) return null
  return { left: editorRect.left + 16, top: editorRect.top + 14, height: 22 }
}

// ── props ─────────────────────────────────────────────────────────────────────

type PromptSectionProps = {
  layout?: 'default' | 'media-focus'
  toolbarLead?: React.ReactNode
  hideBrainButton?: boolean
  readOnly?: boolean
  readOnlyHint?: string
  prompt: string
  setPrompt: (value: string) => void
  onUpdateNodeData: (patch: Record<string, unknown>) => void
  placeholder?: string
  minRows?: number
  mentionOpen: boolean
  mentionItems: MentionSuggestionItem[]
  setMentionFilter: (value: string) => void
  setMentionOpen: (value: boolean) => void
  mentionMetaRef: React.MutableRefObject<{
    at: number
    caret: number
    target?: 'prompt' | 'storyboard_scene' | 'storyboard_notes'
    sceneId?: string
  } | null>
  isDarkUi: boolean
  nodeShellText: string
  onOpenPromptSamples?: () => void
  promptLibraryMediaType?: PromptMediaKind
  onSelectPromptLibraryPrompt?: (promptText: string) => void
  onPickFromLibrary?: () => void
  onGenerateStoryboardScript?: () => void
  generateStoryboardScriptLoading?: boolean
  generateStoryboardScriptDisabled?: boolean
  onMentionApplied?: (item: MentionSuggestionItem) => void
  promptInputMinHeight?: number
  canvasScale?: number
  projectId?: string
}

// ── component ─────────────────────────────────────────────────────────────────

function PromptSection({
  layout = 'default',
  toolbarLead,
  hideBrainButton = false,
  readOnly = false,
  readOnlyHint,
  prompt,
  setPrompt,
  onUpdateNodeData,
  mentionOpen,
  mentionItems,
  setMentionFilter,
  setMentionOpen,
  mentionMetaRef,
  isDarkUi,
  nodeShellText,
  onOpenPromptSamples,
  promptLibraryMediaType,
  onSelectPromptLibraryPrompt,
  onPickFromLibrary,
  onGenerateStoryboardScript,
  generateStoryboardScriptLoading,
  generateStoryboardScriptDisabled,
  onMentionApplied,
  placeholder,
  minRows,
  promptInputMinHeight,
  canvasScale = 1,
  projectId,
}: PromptSectionProps) {
  const hasStoryboardScriptGenerator = typeof onGenerateStoryboardScript === 'function'

  const editorRef = React.useRef<HTMLDivElement | null>(null)
  const inputWrapRef = React.useRef<HTMLDivElement | null>(null)
  const lastValueRef = React.useRef<string | null>(null)
  const isComposingRef = React.useRef(false)
  // Registry of inserted chips: username → avatarUrl (for re-rendering on external updates)
  const chipDataRef = React.useRef<Map<string, string | null>>(new Map())
  const applyingMentionRef = React.useRef(false)
  const mentionPanelActiveRef = React.useRef(false)
  const mentionTriggerArmedRef = React.useRef(false)
  const mentionOpenRef = React.useRef(mentionOpen)
  React.useEffect(() => { mentionOpenRef.current = mentionOpen }, [mentionOpen])

  const [dragMinHeight, setDragMinHeight] = React.useState<number | null>(
    typeof promptInputMinHeight === 'number' && promptInputMinHeight > 0
      ? promptInputMinHeight
      : null
  )
  const resizeDragAbortRef = React.useRef<AbortController | null>(null)
  const [activeMention, setActiveMention] = React.useState(0)
  const [mentionMenuPosition, setMentionMenuPosition] = React.useState<MentionMenuPosition | null>(null)

  const getChipEntries = React.useCallback((): ChipEntry[] => {
    const entriesByAlias = new Map<string, ChipEntry>()
    const addEntry = (entry: ChipEntry) => {
      const key = normalizePromptMentionAlias(entry.username)
      if (!key) return
      const existing = entriesByAlias.get(key)
      if (!existing) {
        entriesByAlias.set(key, entry)
        return
      }
      entriesByAlias.set(key, {
        ...existing,
        displayName: existing.displayName || entry.displayName,
        avatarUrl: existing.avatarUrl || entry.avatarUrl,
        aliases: Array.from(new Set([...(existing.aliases || []), ...(entry.aliases || [])])),
      })
    }

    chipDataRef.current.forEach((avatarUrl, username) => {
      addEntry({ username, avatarUrl })
    })
    for (const item of mentionItems) {
      const username = String(item.username || '').replace(/^@+/, '').trim()
      if (!username) continue
      const displayName = String(item.display_name || '').trim() || username
      const aliases = collectPromptMentionAliases({
        nodeId: item.nodeId,
        assetId: item.assetBinding?.assetId,
        assetRefId: item.assetBinding?.assetRefId,
        aliases: [username, ...(item.mentionAliases || [])],
        displayName,
      })
      addEntry({
        username,
        displayName,
        avatarUrl: String(item.profile_picture_url || '').trim() || null,
        aliases,
      })
    }
    return Array.from(entriesByAlias.values())
  }, [mentionItems])

  // Mount: render initial value
  React.useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.innerHTML = textToHtml(prompt, getChipEntries())
    lastValueRef.current = prompt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally mount-only

  // External value update
  React.useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (prompt === lastValueRef.current) return
    if (isComposingRef.current) return
    const hasFocus = document.activeElement === editor
    const editorValue = htmlToText(editor)
    // `onUpdateNodeData` refreshes the TaskNode while this editable field has
    // focus. While the editor owns focus, its live DOM is the authoritative
    // draft — even immediately after compositionend, when React/store/SSE
    // updates may still arrive out of order. Rebuilding innerHTML at that point
    // destroys the native IME range and can erase the just-confirmed CJK text.
    if (hasFocus) {
      if (prompt === editorValue) lastValueRef.current = prompt
      return
    }
    if (prompt === editorValue) {
      lastValueRef.current = prompt
      return
    }
    lastValueRef.current = prompt
    editor.innerHTML = textToHtml(prompt, getChipEntries())
  }, [prompt, getChipEntries])

  // AI updates can arrive before the asynchronous mention catalogue. Rebuild
  // the current value when aliases become available so an existing @UUID is
  // upgraded to a chip without changing the persisted prompt text.
  React.useEffect(() => {
    const editor = editorRef.current
    if (!editor || prompt !== lastValueRef.current) return
    if (isComposingRef.current || document.activeElement === editor) return
    editor.innerHTML = textToHtml(prompt, getChipEntries())
  }, [mentionItems, prompt, getChipEntries])

  React.useEffect(() => {
    return () => {
      resizeDragAbortRef.current?.abort()
    }
  }, [])

  React.useEffect(() => {
    if (typeof promptInputMinHeight === 'number' && promptInputMinHeight > 0) {
      setDragMinHeight(promptInputMinHeight)
    }
  }, [promptInputMinHeight])

  const handleResizeMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startHeight = editorRef.current ? editorRef.current.offsetHeight : 80
    const scale = canvasScale > 0 ? canvasScale : 1

    const handleEl = (e.currentTarget as HTMLElement)
    handleEl.classList.add('task-node-prompt__resize-handle--dragging')

    resizeDragAbortRef.current?.abort()
    const ac = new AbortController()
    resizeDragAbortRef.current = ac
    const { signal } = ac

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = (moveEvent.clientY - startY) / scale
      const next = Math.max(52, Math.min(400, startHeight + delta))
      setDragMinHeight(next)
    }

    const onMouseUp = (upEvent: MouseEvent) => {
      ac.abort()
      handleEl.classList.remove('task-node-prompt__resize-handle--dragging')
      const delta = (upEvent.clientY - startY) / scale
      const finalHeight = Math.max(52, Math.min(400, startHeight + delta))
      setDragMinHeight(finalHeight)
      onUpdateNodeData({ promptInputMinHeight: finalHeight })
    }

    document.addEventListener('mousemove', onMouseMove, { signal })
    document.addEventListener('mouseup', onMouseUp, { signal })
  }, [readOnly, canvasScale, onUpdateNodeData])

  const updateMentionMenuPosition = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor) { setMentionMenuPosition(null); return }
    const caretRect = getCaretViewportRect(editor)
    if (!caretRect) { setMentionMenuPosition(null); return }
    const editorRect = editor.getBoundingClientRect()
    const preferredWidth = Math.min(320, Math.max(220, editorRect.width - 16))
    const minLeft = 8
    const maxLeft = Math.max(minLeft, window.innerWidth - preferredWidth - 8)
    const left = Math.min(Math.max(caretRect.left, minLeft), maxLeft)
    const top = caretRect.top + caretRect.height + 6
    setMentionMenuPosition({ left, top, width: preferredWidth })
  }, [])

  const syncMentionState = React.useCallback((value: string, caretOffset: number) => {
    const before = value.slice(0, caretOffset)
    const lastAt = before.lastIndexOf('@')
    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))

    if (lastAt >= 0 && lastAt >= lastSpace) {
      const filter = before.slice(lastAt + 1)
      if (!/\s/.test(filter)) {
        // Only open the panel if the user just typed '@' or it's already open.
        // Backspace / arrow key drifting onto an existing '@token' must not auto-open.
        if (!mentionOpenRef.current && !mentionTriggerArmedRef.current) {
          return
        }
        mentionTriggerArmedRef.current = false
        setMentionFilter(filter)
        mentionMetaRef.current = { at: lastAt, caret: caretOffset }
        // Compute position synchronously before opening so Portal renders at correct place immediately
        const editor = editorRef.current
        if (editor) {
          const caretRect = getCaretViewportRect(editor)
          if (caretRect) {
            const editorRect = editor.getBoundingClientRect()
            const preferredWidth = Math.min(320, Math.max(220, editorRect.width - 16))
            const minLeft = 8
            const maxLeft = Math.max(minLeft, window.innerWidth - preferredWidth - 8)
            setMentionMenuPosition({
              left: Math.min(Math.max(caretRect.left, minLeft), maxLeft),
              top: caretRect.top + caretRect.height + 6,
              width: preferredWidth,
            })
          }
        }
        mentionOpenRef.current = true
        setMentionOpen(true)
        return
      }
    }

    mentionTriggerArmedRef.current = false
    mentionOpenRef.current = false
    setMentionOpen(false)
    setMentionFilter('')
    mentionMetaRef.current = null
    setMentionMenuPosition(null)
  }, [mentionMetaRef, setMentionFilter, setMentionOpen])

  React.useEffect(() => {
    if (!mentionOpen) {
      setActiveMention(0)
      setMentionMenuPosition(null)
      return
    }
    setActiveMention(0)
  }, [mentionOpen, mentionItems.length])

  React.useEffect(() => {
    if (!mentionOpen) return
    const handleViewportChange = () => updateMentionMenuPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [mentionOpen, updateMentionMenuPosition])

  const applyMention = React.useCallback((item: MentionSuggestionItem) => {
    const usernameRaw = String(item?.username || '').replace(/^@/, '').trim()
    if (!usernameRaw) return
    const editor = editorRef.current
    const meta = mentionMetaRef.current
    if (!editor || !meta) return

    const currentText = htmlToText(editor)
    const before = currentText.slice(0, meta.at)
    const after = currentText.slice(meta.caret)
    const needsSpace = after.length === 0 || !/^\s/.test(after)
    const suffix = needsSpace ? ' ' : ''
    const next = `${before}@${usernameRaw}${suffix}${after}`
    const nextCaret = before.length + `@${usernameRaw}`.length + suffix.length

    // Register chip data so future re-renders can rebuild it
    const avatarUrl = String(item.profile_picture_url || '').trim() || null
    chipDataRef.current.set(usernameRaw, avatarUrl)

    lastValueRef.current = next
    editor.innerHTML = textToHtml(next, getChipEntries())
    setPrompt(next)
    onUpdateNodeData({ prompt: next })
    onMentionApplied?.(item)
    setMentionOpen(false)
    setMentionFilter('')
    mentionMetaRef.current = null
    applyingMentionRef.current = true
    window.requestAnimationFrame(() => {
      const ed = editorRef.current
      if (ed) { ed.focus(); setCaretAt(ed, nextCaret) }
      applyingMentionRef.current = false
    })
  }, [mentionMetaRef, onMentionApplied, onUpdateNodeData, setMentionFilter, setMentionOpen, setPrompt, getChipEntries])

  const handleBeforeInput = React.useCallback((e: React.FormEvent<HTMLDivElement>) => {
    if (readOnly) return
    const evt = e.nativeEvent as InputEvent
    if (evt.inputType === 'insertText' && evt.data === '@') {
      mentionTriggerArmedRef.current = true
    }
  }, [readOnly])

  const commitEditorValue = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor || readOnly) return
    const text = htmlToText(editor)
    lastValueRef.current = text
    setPrompt(text)
    onUpdateNodeData({ prompt: text })
    syncMentionState(text, getPlainCaret(editor))
  }, [readOnly, setPrompt, onUpdateNodeData, syncMentionState])

  const handleInput = React.useCallback(() => {
    if (isComposingRef.current) return
    commitEditorValue()
  }, [commitEditorValue])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = React.useCallback(() => {
    isComposingRef.current = false
    commitEditorValue()
  }, [commitEditorValue])

  const handleFocus = React.useCallback(() => {
    const editor = editorRef.current
    if (!editor || isComposingRef.current) return
    const editorValue = htmlToText(editor)
    // A late project-asset catalog may arrive while the editor is already
    // focused. Upgrade persisted @tokens on the next focus only when the DOM
    // still equals the saved prompt, so an unsaved user draft is never rebuilt.
    if (editorValue !== prompt) return
    const caretOffset = getPlainCaret(editor)
    editor.innerHTML = textToHtml(editorValue, getChipEntries())
    setCaretAt(editor, caretOffset)
  }, [getChipEntries, prompt])

  const handleSelect = React.useCallback(() => {
    if (applyingMentionRef.current) return
    const editor = editorRef.current
    if (!editor || readOnly) return
    syncMentionState(htmlToText(editor), getPlainCaret(editor))
  }, [readOnly, syncMentionState])

  const handleBlur = React.useCallback(() => {
    if (readOnly) return
    // A focused editor owns the user's live draft. Commit once more on blur so
    // a delayed external prompt echo cannot become authoritative merely because
    // it arrived between the last input/composition event and focus leaving.
    commitEditorValue()
    // Delay so onMouseDown on the mention menu can fire applyMention before we close
    window.setTimeout(() => {
      if (mentionPanelActiveRef.current) return
      setMentionOpen(false)
      setMentionFilter('')
      setMentionMenuPosition(null)
    }, 120)
  }, [commitEditorValue, readOnly, setMentionFilter, setMentionOpen])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return
    // IMEs use Enter/Space/Backspace to edit or confirm their composition. Those
    // keys must remain entirely native; treating a candidate-confirming Enter as
    // our manual line break inserts stray punctuation/newlines and terminates the
    // composition. keyCode 229 covers Safari/WebKit's legacy composition event.
    if (isComposingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (e.key === '@') {
      mentionTriggerArmedRef.current = true
    }

    if (e.key === 'Backspace' && !mentionOpen) {
      const editor = editorRef.current
      const sel = window.getSelection()
      if (editor && sel && sel.rangeCount && sel.isCollapsed) {
        const range = sel.getRangeAt(0)
        const { startContainer, startOffset } = range
        let chip: HTMLElement | null = null
        if (startContainer.nodeType === Node.ELEMENT_NODE) {
          const beforeNode = (startContainer as Element).childNodes[startOffset - 1]
          if (beforeNode instanceof HTMLElement && beforeNode.dataset.mention != null) {
            chip = beforeNode
          }
        } else if (startContainer.nodeType === Node.TEXT_NODE && startOffset === 0) {
          const prev = startContainer.previousSibling
          if (prev instanceof HTMLElement && prev.dataset.mention != null) {
            chip = prev
          }
        }
        if (chip && editor.contains(chip)) {
          e.preventDefault()
          const removedUsername = chip.dataset.mention || ''
          const anchor = document.createTextNode('')
          chip.parentNode?.insertBefore(anchor, chip)
          chip.remove()
          const r = document.createRange()
          r.setStart(anchor, 0)
          r.collapse(true)
          sel.removeAllRanges()
          sel.addRange(r)
          const text = htmlToText(editor)
          lastValueRef.current = text
          setPrompt(text)
          onUpdateNodeData({ prompt: text })
          if (removedUsername && !text.includes(`@${removedUsername}`)) {
            chipDataRef.current.delete(removedUsername)
          }
          return
        }
      }
    }

    if (e.key === 'Enter') {
      if (mentionOpen) {
        const active = mentionItems[activeMention]
        if (active) { e.preventDefault(); applyMention(active) }
        return
      }
      // Insert <br> instead of letting the browser create a <div>
      e.preventDefault()
      const sel = window.getSelection()
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const br = document.createElement('br')
        range.insertNode(br)
        // After <br>, insert a zero-width text node to position the cursor
        const after = document.createTextNode('')
        range.setStartAfter(br)
        range.insertNode(after)
        range.setStart(after, 0)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      const editor = editorRef.current
      if (editor) {
        const text = htmlToText(editor)
        lastValueRef.current = text
        setPrompt(text)
        onUpdateNodeData({ prompt: text })
      }
      return
    }

    if (e.key === 'Escape') {
      if (mentionOpen) {
        e.stopPropagation()
        setMentionOpen(false)
        setMentionFilter('')
        mentionMetaRef.current = null
        return
      }
    }

    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        if (mentionItems.length > 0) {
          e.preventDefault()
          setActiveMention((idx) => (idx + 1) % mentionItems.length)
        }
        return
      }
      if (e.key === 'ArrowUp') {
        if (mentionItems.length > 0) {
          e.preventDefault()
          setActiveMention((idx) => (idx - 1 + mentionItems.length) % mentionItems.length)
        }
        return
      }
      if (e.key === 'Tab') {
        const active = mentionItems[activeMention]
        if (active) { e.preventDefault(); applyMention(active) }
        return
      }
    }

  }, [
    readOnly, mentionOpen, mentionItems, activeMention, applyMention,
    setMentionFilter, setMentionOpen, mentionMetaRef,
    setPrompt, onUpdateNodeData,
  ])

  const allowPromptEditing = !readOnly
  const hasToolbarContent = Boolean(
    toolbarLead ||
    (allowPromptEditing && promptLibraryMediaType && onSelectPromptLibraryPrompt) ||
    (allowPromptEditing && onPickFromLibrary) ||
    (allowPromptEditing && onOpenPromptSamples) ||
    (!hideBrainButton && allowPromptEditing && hasStoryboardScriptGenerator),
  )
  const rootClassName = [
    'task-node-prompt__root',
    layout === 'media-focus' ? 'task-node-prompt__root--media-focus' : '',
  ].filter(Boolean).join(' ')

  const editorMinHeight = React.useMemo(() => {
    if (dragMinHeight !== null) return dragMinHeight
    const base = typeof minRows === 'number' ? minRows : 2
    return Math.max(base, 2) * 21
  }, [dragMinHeight, minRows])

  const editorPlaceholder = readOnly
    ? (readOnlyHint || '当前为编译后的执行提示词预览')
    : (placeholder || '在这里输入提示词...')

  return (
    <div className={rootClassName}>
      <div className="task-node-prompt__input-wrap" ref={inputWrapRef} style={{ position: 'relative' }}>
        {hasToolbarContent && (
          <div
            className="task-node-prompt__toolbar"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
              display: 'flex',
              gap: 6,
            }}
          >
            {toolbarLead}
            {allowPromptEditing && promptLibraryMediaType && onSelectPromptLibraryPrompt ? (
              <CanvasPromptLibraryPicker
                mediaType={promptLibraryMediaType}
                currentPrompt={prompt}
                onPromptChange={(nextPrompt) => {
                  setPrompt(nextPrompt)
                  onUpdateNodeData({ prompt: nextPrompt })
                }}
                onSelect={onSelectPromptLibraryPrompt}
              />
            ) : null}
            {allowPromptEditing && onOpenPromptSamples && (
              <ActionIcon
                className="task-node-prompt__toolbar-button"
                variant="subtle"
                size="xs"
                onClick={onOpenPromptSamples}
                title="打开提示词支持共享配置"
                style={{
                  border: 'none',
                  background: isDarkUi ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
                }}
              >
                <IconBulb className="task-node-prompt__toolbar-icon" size={12} style={{ color: nodeShellText }} />
              </ActionIcon>
            )}
            {allowPromptEditing && onPickFromLibrary && (
              <ActionIcon
                className="task-node-prompt__toolbar-button"
                variant="subtle"
                size="xs"
                onClick={onPickFromLibrary}
                title="从素材库选择参考图"
                style={{
                  border: 'none',
                  background: isDarkUi ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
                }}
              >
                <IconPhoto className="task-node-prompt__toolbar-icon" size={12} style={{ color: nodeShellText }} />
              </ActionIcon>
            )}
            {!hideBrainButton && allowPromptEditing && hasStoryboardScriptGenerator && (
              <ActionIcon
                className="task-node-prompt__toolbar-button"
                variant="subtle"
                size="xs"
                onClick={() => {
                  onGenerateStoryboardScript?.()
                }}
                title="AI 生成分镜脚本"
                loading={!!generateStoryboardScriptLoading}
                disabled={!!generateStoryboardScriptDisabled}
                style={{
                  background: 'rgba(122, 129, 140, 0.1)',
                  border: 'none',
                }}
              >
                <IconBrain
                  className="task-node-prompt__toolbar-icon"
                  size={12}
                  style={{ color: 'rgb(122, 129, 140)' }}
                />
              </ActionIcon>
            )}
          </div>
        )}
        <div
          ref={editorRef}
          className={`task-node-prompt__editor notranslate${readOnly ? ' task-node-prompt__editor--readonly' : ''}`}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          translate="no"
          data-placeholder={editorPlaceholder}
          data-empty={!prompt ? 'true' : undefined}
          style={{ minHeight: editorMinHeight }}
          onInput={handleInput}
          onBeforeInput={handleBeforeInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onSelect={handleSelect}
        />
        {readOnlyHint ? (
          <Text className="task-node-prompt__readonly-hint" size="xs" c="dimmed" mt={6}>
            {readOnlyHint}
          </Text>
        ) : null}
        {allowPromptEditing && (
          <AssetMentionPanel
            open={mentionOpen && mentionMenuPosition !== null}
            position={mentionMenuPosition}
            projectId={projectId || ''}
            baseItems={mentionItems}
            onApply={applyMention}
            onClose={() => {
              setMentionOpen(false)
              setMentionFilter('')
              setMentionMenuPosition(null)
            }}
            isDarkUi={isDarkUi}
            panelActiveRef={mentionPanelActiveRef}
          />
        )}
      </div>
      {!readOnly && (
        <div
          className="task-node-prompt__resize-handle nodrag"
          onMouseDown={handleResizeMouseDown}
        >
          <div className="task-node-prompt__resize-dots" />
        </div>
      )}
    </div>
  )
}

const _PromptSection = React.memo(PromptSection)
export { _PromptSection as PromptSection }
