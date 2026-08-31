// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmotionPanel } from './EmotionPanel'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Bottom: 'bottom' },
}))

vi.mock('../../../domain/resource-runtime/components/ManagedImage', () => ({
  ManagedImage: ({ alt, className }: { alt: string; className: string }) => (
    <div role="img" aria-label={alt} className={className} />
  ),
}))

afterEach(cleanup)

const selection = {
  maskBlob: new Blob(['mask'], { type: 'image/png' }),
  rect: { x: 0.2, y: 0.1, width: 0.3, height: 0.5 },
  source: 'detected' as const,
  imageWidth: 1000,
  imageHeight: 800,
}

describe('EmotionPanel LibTV contract', () => {
  it('renders the compact 580px editor and all 25 interactive emotion positions', () => {
    render(
      <EmotionPanel
        isOpen
        isDarkUi
        sourceImageUrl="https://assets.example.com/person.png"
        selection={selection}
        onClose={vi.fn()}
        onReplacePerson={vi.fn()}
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    expect(screen.getByRole('region', { name: '情绪调节' })).toHaveStyle({ width: '580px' })
    expect(screen.getAllByRole('gridcell')).toHaveLength(25)
    expect(screen.getByText('淡然自若')).toBeInTheDocument()
    expect(screen.getByText('激动')).toBeInTheDocument()
    expect(screen.getByText('平静')).toBeInTheDocument()
    expect(screen.getByText('亲近')).toBeInTheDocument()
    expect(screen.getByText('疏离')).toBeInTheDocument()
  })

  it('updates the selected emotion and submits resolution, count and exact grid cell', () => {
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(
      <EmotionPanel
        isOpen
        isDarkUi
        sourceImageUrl="https://assets.example.com/person.png"
        selection={selection}
        onClose={vi.fn()}
        onReplacePerson={vi.fn()}
        onApply={onApply}
      />,
    )

    fireEvent.click(screen.getByRole('gridcell', { name: '含情凝望' }))
    fireEvent.change(screen.getByRole('combobox', { name: '情绪图分辨率' }), { target: { value: '1K' } })
    fireEvent.change(screen.getByRole('combobox', { name: '情绪图生成数量' }), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '生成情绪图' }))

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      cell: expect.objectContaining({ x: 1, y: 0, zh: '含情凝望' }),
      resolution: '1K',
      sampleCount: 3,
    }))
  })
})
