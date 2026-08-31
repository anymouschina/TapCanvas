// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recognizeElementAtPoint, type RecognizedElementMask } from './elementRecognition'
import {
  createPortraitEditMask,
  detectPeopleInImage,
  type NormalizedRect,
} from './portraitSelection'
import { PortraitTextureEditor } from './PortraitTextureEditor'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Top: 'top' },
}))

vi.mock('../../../domain/resource-runtime', () => ({
  ManagedImage: ({
    priority: _priority,
    ownerSurface: _ownerSurface,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    priority?: string
    ownerSurface?: string
  }) => <img {...props} />,
}))

vi.mock('./elementRecognition', () => ({
  recognizeElementAtPoint: vi.fn(),
}))

vi.mock('./portraitSelection', () => ({
  createPortraitEditMask: vi.fn(),
  detectPeopleInImage: vi.fn(),
  normalizedPointerPosition: vi.fn(),
  normalizedRectFromPoints: vi.fn(),
}))

const detectedRect: NormalizedRect = { x: 0.2, y: 0.1, width: 0.4, height: 0.8 }
const editMaskBlob = new Blob(['edit-mask'], { type: 'image/png' })
const recognizedMask: RecognizedElementMask = {
  point: { x: 0.4, y: 0.5 },
  label: 'person',
  score: 0.98,
  bounds: detectedRect,
  foregroundMaskBlob: new Blob(['foreground-mask'], { type: 'image/png' }),
  overlayBlob: new Blob(['overlay'], { type: 'image/png' }),
}

function loadSourceImage(): void {
  const image = screen.getByRole('img', { name: '待选择人物的原图' })
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 1200 },
    naturalHeight: { configurable: true, value: 800 },
  })
  fireEvent.load(image)
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:recognized-overlay'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  vi.mocked(detectPeopleInImage).mockResolvedValue([detectedRect])
  vi.mocked(recognizeElementAtPoint).mockResolvedValue(recognizedMask)
  vi.mocked(createPortraitEditMask).mockResolvedValue(editMaskBlob)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PortraitTextureEditor selection handoff', () => {
  it('confirms a detected person immediately after the user selects it', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <PortraitTextureEditor
        imageUrl="https://assets.example.com/person.png"
        isDarkUi
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    loadSourceImage()
    fireEvent.pointerDown(await screen.findByRole('button', { name: '人物 1' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({
      maskBlob: editMaskBlob,
      rect: detectedRect,
      source: 'detected',
      imageWidth: 1200,
      imageHeight: 800,
    }))
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument()
  })

  it('keeps a visible retry action when automatic confirmation fails', async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('人物蒙版上传失败'))
      .mockResolvedValueOnce(undefined)
    render(
      <PortraitTextureEditor
        imageUrl="https://assets.example.com/person.png"
        isDarkUi
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    loadSourceImage()
    fireEvent.pointerDown(await screen.findByRole('button', { name: '人物 1' }))

    expect(await screen.findByText('人物蒙版上传失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试确认' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  })
})
