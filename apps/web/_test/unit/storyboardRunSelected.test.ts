import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runNodeRemoteMock, runNodeMockMock } = vi.hoisted(() => ({
  runNodeRemoteMock: vi.fn(),
  runNodeMockMock: vi.fn(),
}))

vi.mock('../../src/runner/remoteRunner', () => ({
  runNodeRemote: runNodeRemoteMock,
}))

vi.mock('../../src/runner/mockRunner', () => ({
  runNodeMock: runNodeMockMock,
}))

import { useRFStore } from '../../src/canvas/store'

describe('storyboard runSelected', () => {
  beforeEach(() => {
    runNodeRemoteMock.mockReset()
    runNodeMockMock.mockReset()
    useRFStore.getState().reset()
  })

  it('routes storyboard nodes to the remote runner', async () => {
    useRFStore.getState().load({
      nodes: [
        {
          id: 'storyboard-1',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            label: '第一章九宫格分镜',
            kind: 'storyboard',
          },
          selected: true,
        },
      ],
      edges: [],
    })

    await useRFStore.getState().runSelected()

    expect(runNodeRemoteMock).toHaveBeenCalledTimes(1)
    expect(runNodeRemoteMock).toHaveBeenCalledWith(
      'storyboard-1',
      expect.any(Function),
      expect.any(Function),
    )
    expect(runNodeMockMock).not.toHaveBeenCalled()
  })
})
