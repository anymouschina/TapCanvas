import React from 'react'
import { Button, SegmentedControl, Text } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import type { ShotTableColumnScope, ShotTableData } from '@tapcanvas/shot-table-protocol'
import {
  createEmptyShotTable,
  normalizeShotTable,
  parseShotTableText,
  serializeShotTable,
} from '@tapcanvas/shot-table-protocol'
import { useRFStore } from '../../../store'
import {
  ShotTableAssetPicker,
  type ShotTableAssetReference,
} from './ShotTableAssetPicker'
import { ShotTableColumnEditor } from './ShotTableColumnEditor'
import { ShotTableGrid, type ShotTableGridActiveCell } from './ShotTableGrid'
import { ShotTableHistoryBar } from './ShotTableHistoryBar'
import { ShotTableOverview } from './ShotTableOverview'
import { ShotTableRawEditor } from './ShotTableRawEditor'
import { ShotTableScriptPanel } from './ShotTableScriptPanel'
import { ShotTableToolbar } from './ShotTableToolbar'
import {
  addShotRow,
  addShotTableColumn,
  addTimelineRow,
  changeShotTableColumnScope,
  deleteShotTableColumn,
  deleteShotTableRow,
  duplicateTimelineRow,
  renameShotTableColumn,
  updateShotTableCell,
  updateShotTableOverview,
  type ShotTableIdFactory,
} from './shotTableOperations'
import {
  downloadShotTableWorkbook,
  parseShotTableWorkbook,
} from './shotTableWorkbook'
import {
  findActiveMentionRange,
  insertShotTableAssetReference,
  readShotTableAssetBindings,
} from './shotTableAssetBinding'
import { readShotTableHistory } from './shotTableHistory'
import { useShotTableSplit } from './useShotTableSplit'
import './shotTable.css'

export type ShotTableContentProps = {
  className: string
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
  nodeHeight: number
  assetReferences: readonly ShotTableAssetReference[]
}

const createSecureId = (prefix: string): string => {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('当前浏览器不支持安全 UUID，无法创建分镜结构。')
  }
  return `${prefix}-${crypto.randomUUID()}`
}

const createId: ShotTableIdFactory = createSecureId

const readText = (value: unknown): string => typeof value === 'string' ? value : ''

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : fallback

export function ShotTableContent({
  className,
  nodeId,
  data,
  readOnly,
  nodeHeight,
  assetReferences,
}: ShotTableContentProps): JSX.Element {
  const updateNodeData = useRFStore((state) => state.updateNodeData)
  const normalized = React.useMemo(() => normalizeShotTable(data.shotTable), [data.shotTable])
  const history = React.useMemo(() => readShotTableHistory(data.shotTableHistory), [data.shotTableHistory])
  const assetBindings = React.useMemo(
    () => readShotTableAssetBindings(data.shotTableAssetBindings),
    [data.shotTableAssetBindings],
  )
  const persistedRaw = readText(data.shotTableRawText)
  const persistedView = data.shotTableViewMode === 'text' ? 'text' : 'table'
  const [table, setTable] = React.useState<ShotTableData | null>(normalized.ok ? normalized.table : null)
  const tableRef = React.useRef<ShotTableData | null>(table)
  const [viewMode, setViewMode] = React.useState<'table' | 'text'>(persistedView)
  const [rawDraft, setRawDraft] = React.useState(persistedRaw || (table ? serializeShotTable(table) : ''))
  const [rawDirty, setRawDirty] = React.useState(false)
  const [selectedRowId, setSelectedRowId] = React.useState<string | null>(table?.rows[0]?.id ?? null)
  const [selectedColumnKey, setSelectedColumnKey] = React.useState<string | null>(table?.columns[0]?.key ?? null)
  const [columnsOpen, setColumnsOpen] = React.useState(false)
  const [scriptOpen, setScriptOpen] = React.useState(false)
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false)
  const [assetQuery, setAssetQuery] = React.useState('')
  const [overviewOpen, setOverviewOpen] = React.useState(false)
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const activeCellRef = React.useRef<ShotTableGridActiveCell | null>(null)
  const [activeCellReady, setActiveCellReady] = React.useState(false)
  const assetBindingsValid = !assetBindings.error
  const splitControl = useShotTableSplit({
    nodeId,
    data,
    table,
    readOnly,
    rawDirty,
    assetBindings,
    onSuccess: setNotice,
  })

  React.useEffect(() => {
    if (!normalized.ok) {
      setTable(null)
      tableRef.current = null
      return
    }
    setTable(normalized.table)
    tableRef.current = normalized.table
    if (!rawDirty) setRawDraft(persistedRaw || serializeShotTable(normalized.table))
  }, [normalized, persistedRaw, rawDirty])

  const writeTable = React.useCallback((next: ShotTableData, patch: Record<string, unknown> = {}): void => {
    const rawText = serializeShotTable(next)
    tableRef.current = next
    setTable(next)
    setRawDraft(rawText)
    setRawDirty(false)
    updateNodeData(nodeId, {
      shotTable: next,
      shotTableRawText: rawText,
      prompt: rawText,
      ...patch,
    })
  }, [nodeId, updateNodeData])

  const replaceTable = React.useCallback((
    next: ShotTableData,
    input: { source: string; rawText?: string; note?: string; metadata?: Record<string, unknown> },
  ): void => {
    if (history.error) {
      throw new Error(`版本历史损坏：${history.error} 为避免丢失既有版本，当前禁止替换分镜表。`)
    }
    const current = tableRef.current
    const nextHistory = [...history.snapshots]
    if (current) {
      const currentSource = readText(data.shotTableCurrentSource).trim()
      if (!currentSource) {
        throw new Error('当前分镜表缺少版本来源，无法在不丢失追溯信息的前提下替换。')
      }
      nextHistory.push({
        id: createSecureId('snapshot'),
        createdAt: new Date().toISOString(),
        source: currentSource,
        table: current,
        rawText: serializeShotTable(current),
        note: '替换前自动保存',
      })
    }
    const rawText = input.rawText === undefined ? serializeShotTable(next) : input.rawText.trim()
    if (!rawText) throw new Error('替换结果缺少可追溯的分镜表原文。')
    tableRef.current = next
    setTable(next)
    setRawDraft(rawText)
    setRawDirty(false)
    setSelectedRowId(next.rows[0]?.id ?? null)
    setSelectedColumnKey(next.columns[0]?.key ?? null)
    activeCellRef.current = null
    setActiveCellReady(false)
    updateNodeData(nodeId, {
      shotTable: next,
      shotTableRawText: rawText,
      prompt: rawText,
      shotTableHistory: nextHistory,
      shotTableCurrentSource: input.source,
      shotTableCurrentNote: input.note ?? '',
      ...(input.metadata ?? {}),
    })
  }, [data.shotTableCurrentSource, history.error, history.snapshots, nodeId, updateNodeData])

  const runAction = React.useCallback((action: () => void): void => {
    setError('')
    setNotice('')
    try {
      action()
    } catch (actionError: unknown) {
      setError(errorMessage(actionError, '分镜表操作失败。'))
    }
  }, [])

  if (!table) {
    const reason = normalized.ok ? '分镜表数据缺失。' : normalized.issues.join('；')
    return (
      <div className="tc-shot-table-empty nodrag nopan">
        <Text className="tc-shot-table-empty__title" size="sm" fw={650}>分镜表无法打开</Text>
        <Text className="tc-shot-table-empty__reason" size="xs" c="red">{reason}</Text>
        {!readOnly ? (
          <Button
            className="tc-shot-table-empty__button"
            size="compact-sm"
            variant="light"
            onClick={() => runAction(() => replaceTable(createEmptyShotTable(), { source: '手动初始化' }))}
          >
            明确初始化为空表
          </Button>
        ) : null}
      </div>
    )
  }

  const selectedColumn = table.columns.find((column) => column.key === selectedColumnKey) ?? null
  const selectedRow = table.rows.find((row) => row.id === selectedRowId) ?? null
  const height = Math.max(300, nodeHeight - 70)

  const commitLocal = (): void => {
    const current = tableRef.current
    if (current) writeTable(current)
  }

  const handleImport = async (file: File | null): Promise<void> => {
    if (!file) return
    setError('')
    setNotice('')
    try {
      const imported = parseShotTableWorkbook(new Uint8Array(await file.arrayBuffer()))
      replaceTable(imported.table, { source: 'Excel 导入', note: file.name })
      if (imported.warnings.length > 0) setNotice(imported.warnings.join('；'))
    } catch (importError: unknown) {
      setError(errorMessage(importError, '导入 Excel 失败。'))
    }
  }

  const handleApplyRaw = (): void => runAction(() => {
    const parsed = parseShotTableText(rawDraft, { expectedColumns: table.columns })
    if (!parsed.ok) throw new Error(parsed.issues.join('；'))
    replaceTable(parsed.table, { source: '原文解析', rawText: rawDraft })
    setNotice('原文已按严格契约解析并应用；上一版本已保留。')
  })

  const handleActiveCellChange = (cell: ShotTableGridActiveCell): void => {
    activeCellRef.current = cell
    setActiveCellReady(true)
    if (readOnly) return
    const mention = cell.selectionStart === cell.selectionEnd
      ? findActiveMentionRange(cell.value, cell.selectionStart)
      : null
    if (!mention) return
    setAssetQuery(mention.query)
    setAssetPickerOpen(true)
  }

  const handleAssetPick = (reference: ShotTableAssetReference): void => runAction(() => {
    const activeCell = activeCellRef.current
    if (!activeCell) throw new Error('请先选择一个分镜表单元格。')
    const inserted = insertShotTableAssetReference({
      table: tableRef.current ?? table,
      activeCell,
      reference,
      existingBindings: data.shotTableAssetBindings,
      bindingId: createSecureId('asset-binding'),
      createdAt: new Date().toISOString(),
    })
    writeTable(inserted.table, { shotTableAssetBindings: inserted.bindings })
    setAssetPickerOpen(false)
    setAssetQuery('')
    window.requestAnimationFrame(() => {
      activeCell.element.focus()
      activeCell.element.setSelectionRange(inserted.caret, inserted.caret)
    })
  })

  return (
    <section className={`tc-shot-table nodrag nopan ${className}`} style={{ height }} aria-label="分镜表编辑器">
      <div className="tc-shot-table__summary">
        <button
          className="tc-shot-table__overview-toggle"
          type="button"
          onClick={() => setOverviewOpen((current) => !current)}
        >
          {new Set(table.rows.map((row) => row.shotId)).size} 镜 · {table.rows.length} 时序 · {table.columns.length} 列
        </button>
        <SegmentedControl
          className="tc-shot-table__view-switch"
          size="xs"
          value={viewMode}
          data={[{ value: 'table', label: '表格' }, { value: 'text', label: rawDirty ? '原文*' : '原文' }]}
          onChange={(value) => {
            if (value !== 'table' && value !== 'text') return
            if (value === 'text' && !rawDirty) setRawDraft(serializeShotTable(tableRef.current ?? table))
            setViewMode(value)
            updateNodeData(nodeId, { shotTableViewMode: value })
          }}
        />
      </div>

      {overviewOpen ? (
        <ShotTableOverview
          className="tc-shot-table__overview-section"
          table={table}
          readOnly={readOnly}
          onChange={(key, value) => {
            const next = updateShotTableOverview(tableRef.current ?? table, key, value)
            tableRef.current = next
            setTable(next)
          }}
          onCommit={commitLocal}
        />
      ) : null}

      <ShotTableToolbar
        className="tc-shot-table__toolbar-section"
        readOnly={readOnly}
        hasSelectedRow={Boolean(selectedRow)}
        hasSelectedColumn={Boolean(selectedColumn)}
        hasActiveCell={viewMode === 'table' && activeCellReady}
        canDeleteRow={table.rows.length > 1}
        assetBindingsValid={assetBindingsValid}
        columnsOpen={columnsOpen}
        scriptOpen={scriptOpen}
        assetPickerOpen={assetPickerOpen}
        splitDisabled={splitControl.disabled}
        splitTooltip={splitControl.tooltip}
        onAddTimeline={() => runAction(() => {
          if (!selectedRow) throw new Error('请先选择一行。')
          const next = addTimelineRow(tableRef.current ?? table, selectedRow.id, createId)
          writeTable(next)
          setSelectedRowId(next.rows[table.rows.findIndex((row) => row.id === selectedRow.id) + 1]?.id ?? selectedRow.id)
        })}
        onAddShot={() => runAction(() => {
          const next = addShotRow(tableRef.current ?? table, selectedRow?.id ?? null, createId)
          writeTable(next)
          const previousShotIds = new Set(table.rows.map((row) => row.shotId))
          setSelectedRowId(next.rows.find((row) => !previousShotIds.has(row.shotId))?.id ?? null)
        })}
        onDuplicateRow={() => runAction(() => {
          if (!selectedRow) throw new Error('请先选择一行。')
          writeTable(duplicateTimelineRow(tableRef.current ?? table, selectedRow.id, createId))
        })}
        onDeleteRow={() => runAction(() => {
          if (!selectedRow) throw new Error('请先选择一行。')
          const index = table.rows.findIndex((row) => row.id === selectedRow.id)
          const next = deleteShotTableRow(tableRef.current ?? table, selectedRow.id)
          writeTable(next)
          setSelectedRowId(next.rows[Math.min(index, next.rows.length - 1)]?.id ?? null)
          activeCellRef.current = null
          setActiveCellReady(false)
        })}
        onToggleColumns={() => setColumnsOpen((current) => !current)}
        onToggleAssets={() => {
          setError('')
          setAssetQuery('')
          setAssetPickerOpen((current) => !current)
        }}
        onSplit={() => runAction(splitControl.split)}
        onToggleScript={() => setScriptOpen((current) => !current)}
        onExport={() => runAction(() => downloadShotTableWorkbook(tableRef.current ?? table, readText(data.label) || '分镜表'))}
        onImport={(file) => { void handleImport(file) }}
      />

      <ShotTableAssetPicker
        className="tc-shot-table__asset-picker-section"
        open={assetPickerOpen}
        nodeId={nodeId}
        references={assetReferences}
        query={assetQuery}
        readOnly={readOnly}
        onQueryChange={setAssetQuery}
        onPick={handleAssetPick}
        onClose={() => {
          setAssetPickerOpen(false)
          setAssetQuery('')
        }}
      />

      {columnsOpen ? (
        <ShotTableColumnEditor
          className="tc-shot-table__column-editor-section"
          selectedColumn={selectedColumn}
          readOnly={readOnly}
          onClose={() => setColumnsOpen(false)}
          onAdd={(label: string, scope: ShotTableColumnScope) => runAction(() => writeTable(addShotTableColumn(tableRef.current ?? table, { label, scope }, createId)))}
          onRename={(columnKey, label) => runAction(() => writeTable(renameShotTableColumn(tableRef.current ?? table, columnKey, label)))}
          onScopeChange={(columnKey, scope) => runAction(() => writeTable(changeShotTableColumnScope(tableRef.current ?? table, columnKey, scope)))}
          onDelete={(columnKey) => runAction(() => {
            writeTable(deleteShotTableColumn(tableRef.current ?? table, columnKey))
            setSelectedColumnKey(null)
            activeCellRef.current = null
            setActiveCellReady(false)
          })}
        />
      ) : null}

      {scriptOpen ? (
        <ShotTableScriptPanel
          className="tc-shot-table__script-panel-section"
          nodeId={nodeId}
          table={table}
          readOnly={readOnly}
          replacementBlockedReason={history.error
            ? `版本历史损坏：${history.error} 修复历史后才能执行剧本转换。`
            : ''}
          onClose={() => setScriptOpen(false)}
          onGenerated={(result) => {
            replaceTable(result.table, {
              source: 'Agents 剧本转分镜',
              rawText: result.rawText,
              note: `Skill：${result.skillName}（${result.skillKey}）`,
              metadata: {
                shotTableGeneration: {
                  skillKey: result.skillKey,
                  skillName: result.skillName,
                  model: result.model,
                  completedAt: new Date().toISOString(),
                },
              },
            })
            setNotice('剧本已转换为分镜表；替换前版本已保留。')
          }}
        />
      ) : null}

      {history.error ? <Text className="tc-shot-table__message" size="xs" c="red">版本历史损坏：{history.error}</Text> : null}
      {!assetBindingsValid ? <Text className="tc-shot-table__message" size="xs" c="red">素材绑定历史损坏：{assetBindings.error}</Text> : null}
      <ShotTableHistoryBar
        className="tc-shot-table__history-section"
        snapshots={history.snapshots}
        selectedSnapshotId={selectedSnapshotId}
        readOnly={readOnly}
        onSelect={setSelectedSnapshotId}
        onRestore={() => runAction(() => {
          const snapshot = history.snapshots.find((candidate) => candidate.id === selectedSnapshotId)
          if (!snapshot) throw new Error('请选择有效的历史版本。')
          replaceTable(snapshot.table, {
            source: `恢复：${snapshot.source}`,
            rawText: snapshot.rawText,
            note: snapshot.note,
          })
          setNotice('历史版本已恢复；恢复前的当前版本也已保留。')
        })}
      />

      {error ? <Text className="tc-shot-table__message" size="xs" c="red">{error}</Text> : null}
      {notice ? <Text className="tc-shot-table__message" size="xs" c="blue">{notice}</Text> : null}

      <div className="tc-shot-table__workspace">
        {viewMode === 'table' ? (
          <ShotTableGrid
            className="tc-shot-table__grid-section"
            table={table}
            selectedRowId={selectedRowId}
            selectedColumnKey={selectedColumnKey}
            readOnly={readOnly}
            onSelectRow={setSelectedRowId}
            onSelectColumn={setSelectedColumnKey}
            onCellChange={(rowId, columnKey, value) => runAction(() => {
              const next = updateShotTableCell(tableRef.current ?? table, rowId, columnKey, value)
              tableRef.current = next
              setTable(next)
            })}
            onCellBlur={commitLocal}
            onActiveCellChange={handleActiveCellChange}
          />
        ) : (
          <ShotTableRawEditor
            className="tc-shot-table__raw-section"
            value={rawDraft}
            dirty={rawDirty}
            readOnly={readOnly}
            onChange={(value) => {
              setRawDraft(value)
              setRawDirty(true)
            }}
            onApply={handleApplyRaw}
          />
        )}
      </div>
      <div className="tc-shot-table__format-hint">
        <IconFileSpreadsheet className="tc-shot-table__format-icon" size={13} />
        <span className="tc-shot-table__format-text">镜头列会跨同镜头时序联动；时序列只修改当前行</span>
      </div>
    </section>
  )
}
