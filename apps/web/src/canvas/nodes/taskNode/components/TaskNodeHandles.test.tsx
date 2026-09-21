import { render } from '@testing-library/react'
import { ReactFlow, Position, type Node, type NodeProps } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { TaskNodeHandles } from './TaskNodeHandles'

type TestNode = Node<{ overview: boolean }, 'handles'>
function HandlesNode({ data }: NodeProps<TestNode>) {
  return <TaskNodeHandles
    targets={[{ id: 'in-image', type: 'image', pos: Position.Left }]}
    sources={[{ id: 'out-image', type: 'image', pos: Position.Right }]}
    layout={new Map()}
    defaultInputType="image"
    defaultOutputType="image"
    wideHandleBase={{ width: 16, height: 100 }}
    showHandles={!data.overview}
  />
}
const nodeTypes = { handles: HandlesNode }
const nodes = (overview: boolean): TestNode[] => [{
  id: 'node', type: 'handles', position: { x: 0, y: 0 },
  data: { overview }, style: { width: 200, height: 150 },
}]

describe('overview handle geometry', () => {
  it('preserves typed and wide endpoint elements across LOD transitions', () => {
    const { container, rerender } = render(<ReactFlow nodes={nodes(false)} nodeTypes={nodeTypes} />)
    const before = [...container.querySelectorAll('.react-flow__handle')]
    expect(before.map(handle => handle.getAttribute('data-handleid'))).toEqual([
      'in-image', 'out-image', 'in-image-wide', 'out-image-wide',
    ])
    rerender(<ReactFlow nodes={nodes(true)} nodeTypes={nodeTypes} />)
    const layer = container.querySelector('.tc-handle-layer')
    expect(layer).toHaveStyle({ visibility: 'hidden' })
    expect(layer).not.toHaveStyle({ display: 'none' })
    const hidden = [...container.querySelectorAll('.react-flow__handle')]
    hidden.forEach((handle, index) => expect(handle).toBe(before[index]))
    rerender(<ReactFlow nodes={nodes(false)} nodeTypes={nodeTypes} />)
    expect(layer).not.toHaveAttribute('aria-hidden')
    expect([...container.querySelectorAll('.react-flow__handle')]).toEqual(before)
  })
})
