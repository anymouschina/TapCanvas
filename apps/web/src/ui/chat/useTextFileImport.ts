import { useCallback, useRef, useState } from 'react'
import { buildImportedTextBlock, extractTextFromFile, isSupportedTextFile } from './textFileImport'

export type TextFileAttachment = { id: string; name: string } & (
  | { status: 'reading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; error: string }
)

/** Attachments stay separate from the editable instruction until submission. */
export function buildTextAttachmentMessage(prompt: string, attachments: readonly TextFileAttachment[]): string {
  return attachments.reduce((content, attachment) => {
    if (attachment.status !== 'ready') throw new Error(`${attachment.name} 尚未读取成功`)
    return buildImportedTextBlock(content, attachment.name, attachment.text)
  }, prompt.trim())
}

export function useTextFileImport() {
  const [attachments, setAttachments] = useState<TextFileAttachment[]>([])
  const current = useRef<TextFileAttachment[]>([])
  const update = useCallback((transform: (items: TextFileAttachment[]) => TextFileAttachment[]) => {
    current.current = transform(current.current)
    setAttachments(current.current)
  }, [])
  const importFiles = useCallback((files: File[]) => {
    const entries = files.map((file) => ({ file, id: crypto.randomUUID() }))
    update((items) => [...items, ...entries.map(({ file, id }): TextFileAttachment => ({ id, name: file.name, status: 'reading' }))])
    for (const { file, id } of entries) {
      void (async () => {
        try {
          if (!isSupportedTextFile(file)) throw new Error('支持 TXT、MD、DOC、DOCX 文本文件')
          const text = await extractTextFromFile(file)
          if (!text) throw new Error('未读取到文字内容')
          // Removed attachments cannot reappear when parsing completes.
          update((items) => items.map((item) => item.id === id ? { id, name: file.name, status: 'ready', text } : item))
        } catch (error: unknown) {
          console.error('text_file_import_failed', { fileName: file.name, size: file.size, error })
          const message = error instanceof Error ? error.message : '读取失败'
          update((items) => items.map((item) => item.id === id ? { id, name: file.name, status: 'error', error: message } : item))
        }
      })()
    }
  }, [update])
  const remove = useCallback((id: string) => update((items) => items.filter((item) => item.id !== id)), [update])
  const buildMessage = useCallback((prompt: string) => buildTextAttachmentMessage(prompt, current.current), [])

  return {
    attachments, importFiles, remove, buildMessage,
    importing: attachments.some((item) => item.status === 'reading'),
    canSend: attachments.every((item) => item.status === 'ready'),
  }
}
