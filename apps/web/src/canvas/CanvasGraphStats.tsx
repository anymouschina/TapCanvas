import { Panel } from '@xyflow/react'
import { Tooltip } from '@mantine/core'
import { IconBox, IconGitBranch } from '@tabler/icons-react'

import { useRFStore } from './store'
import './CanvasGraphStats.css'

export function CanvasGraphStats(): JSX.Element {
  const nodeCount = useRFStore((state) => state.nodes.length)
  const edgeCount = useRFStore((state) => state.edges.length)

  return (
    <Panel
      className="tc-canvas-graph-stats-panel"
      position="bottom-right"
      style={{ margin: 0, right: 12, bottom: 12 }}
    >
      <div className="tc-canvas-graph-stats" aria-label={`${nodeCount} 个节点，${edgeCount} 条连线`}>
        <Tooltip className="tc-canvas-graph-stats__tooltip" label="节点数量" position="top" withArrow>
          <span className="tc-canvas-graph-stats__metric">
            <IconBox className="tc-canvas-graph-stats__icon" size={15} stroke={1.8} aria-hidden="true" />
            <span className="tc-canvas-graph-stats__value">{nodeCount}</span>
          </span>
        </Tooltip>
        <span className="tc-canvas-graph-stats__divider" aria-hidden="true" />
        <Tooltip className="tc-canvas-graph-stats__tooltip" label="连线数量" position="top" withArrow>
          <span className="tc-canvas-graph-stats__metric">
            <IconGitBranch className="tc-canvas-graph-stats__icon" size={15} stroke={1.8} aria-hidden="true" />
            <span className="tc-canvas-graph-stats__value">{edgeCount}</span>
          </span>
        </Tooltip>
      </div>
    </Panel>
  )
}

