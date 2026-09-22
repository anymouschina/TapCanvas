import React from 'react'
import type { NodeProps, Node } from '@xyflow/react'
import { IconArrowUpRight, IconStack2 } from '@tabler/icons-react'
import { AsyncDialogLoading } from '../../../ui/AsyncLoadingFeedback'
import type { DirectorConsoleData } from './types'
import './DirectorConsoleNode.css'

const DirectorDeskFrame = React.lazy(() => import('./DirectorDeskFrame'))

type DirectorConsoleCanvasNode = Node<DirectorConsoleData, 'directorConsole'>

/**
 * 画布上的导演台入口。
 *
 * 三维预演由嵌入的导演台（apps/director-desk，构建到 /director-desk/）承担，
 * 本节点只负责入口。场景与镜头数据由导演台自己的工程持有，因此节点不承载 3D 场景结构，
 * 也没有图像出入边；整张卡片即入口，不额外放重复的按钮。
 */
export function DirectorConsoleNode({ id, data }: NodeProps<DirectorConsoleCanvasNode>) {
  const [open, setOpen] = React.useState(false)
  // 只读快照/投影（data.readOnly === true）：导演台入口禁用，避免在只读视图中打开编辑器。
  const readOnly = (data as unknown as Record<string, unknown> | undefined)?.readOnly === true
  const label = data.label?.trim() || '导演台'

  return (
    <div className="tc-director-console-node">
      <button
        type="button"
        className="tc-director-console-node__entry nodrag nopan"
        disabled={readOnly}
        title={readOnly ? '只读视图不可打开导演台' : '打开导演台'}
        aria-label={`打开导演台：${label}`}
        onClick={(event) => {
          event.stopPropagation()
          if (!readOnly) setOpen(true)
        }}
      >
        <span className="tc-director-console-node__icon" aria-hidden="true">
          <IconStack2 size={16} />
        </span>
        <span className="tc-director-console-node__body">
          <span className="tc-director-console-node__title">{label}</span>
          <span className="tc-director-console-node__meta">搭场景 · 排走位 · 设计运镜 · 导出参考视频</span>
        </span>
        <IconArrowUpRight className="tc-director-console-node__affordance" size={15} aria-hidden="true" />
      </button>
      {open ? (
        <React.Suspense fallback={<AsyncDialogLoading onClose={() => setOpen(false)} />}>
          <DirectorDeskFrame nodeId={id} onClose={() => setOpen(false)} />
        </React.Suspense>
      ) : null}
    </div>
  )
}

export default DirectorConsoleNode
