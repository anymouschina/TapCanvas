import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, waitFor } from '@testing-library/react'

const captureView = vi.fn(() => 'data:image/jpeg;base64,AAAA')
let readyCb: (() => void) | null = null

vi.mock('./scene/Viewport', () => ({
  Viewport: React.forwardRef((props: any, ref: any) => {
    readyCb = props.onSceneReady
    React.useImperativeHandle(ref, () => ({ captureView }))
    return null
  }),
}))
vi.mock('../../../api/server', () => ({
  claimDirectorCapture: vi.fn(),
  reportDirectorCapture: vi.fn(async () => {}),
}))
vi.mock('./uploadCanvasImageBlob', () => ({
  uploadCanvasImageBlob: vi.fn(async () => ({ url: 'https://r2/x.jpg', assetId: 'a1' })),
  dataUrlToBlob: vi.fn(async () => new Blob([''], { type: 'image/jpeg' })),
}))
vi.mock('./state/aspect', () => ({ aspectRatio: () => 16 / 9 }))

import { DirectorCaptureRunner } from './DirectorCaptureRunner'
import { claimDirectorCapture, reportDirectorCapture } from '../../../api/server'
import { useRFStore } from '../../store'

const pendingNode = {
  id: 'd1',
  data: {
    kind: 'directorConsole',
    pendingCapture: {
      captureId: 'cap1',
      status: 'queued',
      scene: { characters: [], camera: { position: [0, 0, 5] }, aspect: '16:9' },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  readyCb = null
  useRFStore.setState({ nodes: [pendingNode as any], edges: [] } as any)
})

describe('DirectorCaptureRunner', () => {
  it('claim 成功 → captureView 一次 → report succeeded', async () => {
    ;(claimDirectorCapture as any).mockResolvedValue({
      ok: true,
      leaseToken: 'lt',
      scene: pendingNode.data.pendingCapture.scene,
    })
    render(<DirectorCaptureRunner />)
    await waitFor(() => expect(claimDirectorCapture).toHaveBeenCalledWith('cap1'))
    await waitFor(() => expect(readyCb).toBeTruthy())
    readyCb!()
    await waitFor(() =>
      expect(reportDirectorCapture).toHaveBeenCalledWith(
        expect.objectContaining({ captureId: 'cap1', status: 'succeeded', imageUrl: 'https://r2/x.jpg' }),
      ),
    )
    expect(captureView).toHaveBeenCalledTimes(1)
  })

  it('claim 409 → 不渲染不 report', async () => {
    ;(claimDirectorCapture as any).mockResolvedValue({ ok: false, code: 'already_claimed' })
    render(<DirectorCaptureRunner />)
    await waitFor(() => expect(claimDirectorCapture).toHaveBeenCalled())
    expect(reportDirectorCapture).not.toHaveBeenCalled()
    expect(readyCb).toBeNull()
  })
})
