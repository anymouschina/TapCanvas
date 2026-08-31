import React from 'react'
import { Button } from '@mantine/core'
import { IconFileUpload } from '@tabler/icons-react'
import { SUPPORTED_TEXT_ACCEPT, extractTextFromFile, isSupportedTextFile } from '../../ui/chat/textFileImport'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'
import { PersistedWorkflowField, readString } from './workflowNodeInspectorShared'

export function WorkflowTextInputConfiguration(props: Readonly<{
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
  executionModeField: React.JSX.Element
}>): React.JSX.Element {
  const [importing, setImporting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const sourceFileName = readString(props.data, 'workflowSourceFileName')
  const text = readString(props.data, 'workflowTextInput')

  const importFile = React.useCallback(async (file: File): Promise<void> => {
    if (!isSupportedTextFile(file)) {
      toast('只支持 TXT、Markdown 与 DOCX 文本文件', 'error')
      return
    }
    setImporting(true)
    try {
      const importedText = await extractTextFromFile(file)
      if (!importedText.trim()) throw new Error('文档解析成功，但没有可执行的正文文本')
      useRFStore.getState().updateNodeData(props.nodeId, {
        workflowTextInput: importedText,
        workflowSourceFileName: file.name,
        workflowSourceFileSize: file.size,
        workflowSourceImportedAt: new Date().toISOString(),
      })
      toast(`已读取 ${file.name}，共 ${importedText.length.toLocaleString('zh-CN')} 个字符`, 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '无法读取文本文件', 'error')
    } finally {
      setImporting(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [props.nodeId])

  return (
    <div className="workflow-node-inspector__tab-content">
      {props.executionModeField}
      <PersistedWorkflowField
        nodeId={props.nodeId}
        dataKey="workflowTextInput"
        label="文本"
        placeholder="输入正文，或导入 TXT / Markdown / DOCX"
        value={text}
        readOnly={props.readOnly}
        multiline
        buildPersistedPatch={(value) => ({
          workflowTextInput: value,
          workflowSourceFileName: undefined,
          workflowSourceFileSize: undefined,
          workflowSourceImportedAt: undefined,
        })}
      />
      <div className="workflow-node-inspector__run-actions">
        <input
          className="workflow-node-inspector__file-input"
          ref={inputRef}
          type="file"
          accept={SUPPORTED_TEXT_ACCEPT}
          disabled={props.readOnly || importing}
          aria-label="导入工作流文本文件"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void importFile(file)
          }}
        />
        <Button
          className="workflow-node-inspector__button"
          variant="default"
          leftSection={<IconFileUpload className="workflow-node-inspector__button-icon" size={15} aria-hidden="true" />}
          loading={importing}
          disabled={props.readOnly}
          onClick={() => inputRef.current?.click()}
        >
          导入 TXT / DOCX
        </Button>
      </div>
      <p className="workflow-node-inspector__help">
        {sourceFileName
          ? `来源：${sourceFileName} · ${text.length.toLocaleString('zh-CN')} 字符。文件只在浏览器读取，保存的是解析后的正文与来源元数据。`
          : `当前文本 ${text.length.toLocaleString('zh-CN')} 字符。工作流会保存完整输入，不按固定长度静默截断。`}
      </p>
    </div>
  )
}
