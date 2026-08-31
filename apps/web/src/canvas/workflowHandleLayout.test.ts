import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { buildHandleStyle, computeHandleLayout } from './nodes/taskNodeHelpers'
import { WORKFLOW_ICON_NODE_HANDLE_OFFSET } from './workflowNodeGeometry'

describe('workflow icon handle layout', () => {
  it('distributes input ports down the left and keeps them close to the icon', () => {
    const handles = [
      { id: 'input', pos: Position.Left },
      { id: 'skills', pos: Position.Left },
      { id: 'tools', pos: Position.Left },
    ]
    const layout = computeHandleLayout(handles)
    const offsets = {
      horizontal: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      vertical: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
    }

    expect(buildHandleStyle(handles[0], layout, offsets)).toMatchObject({
      left: -WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      top: '25%',
    })
    expect(buildHandleStyle(handles[1], layout, offsets)).toMatchObject({
      left: -WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      top: '50%',
    })
    expect(buildHandleStyle(handles[2], layout, offsets)).toMatchObject({
      left: -WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      top: '75%',
    })
  })

  it('anchors outputs to the right instead of in the full-size card gutter', () => {
    const handle = { id: 'result', pos: Position.Right }
    const layout = computeHandleLayout([handle])
    const style = buildHandleStyle(handle, layout, {
      horizontal: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      vertical: WORKFLOW_ICON_NODE_HANDLE_OFFSET,
    })

    expect(style).toMatchObject({
      right: -WORKFLOW_ICON_NODE_HANDLE_OFFSET,
      top: '50%',
    })
  })
})
