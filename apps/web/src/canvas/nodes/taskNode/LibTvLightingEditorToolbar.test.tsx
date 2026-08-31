// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { DEFAULT_IMAGE_LIGHTING_RIG, type ImageLightingRigConfig } from '@tapcanvas/image-view-controls'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LIBTV_LIGHTING_CONTROL_STATE,
  LibTvLightingEditorToolbar,
  type LibTvLightingControlState,
} from './LibTvLightingEditorToolbar'

vi.mock('@xyflow/react', () => ({
  NodeToolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Position: { Bottom: 'bottom' },
  useViewport: () => ({ zoom: 0.5, x: 0, y: 0 }),
}))

vi.mock('../../../domain/resource-runtime', () => ({
  ManagedImage: ({ alt, className }: { alt: string; className: string }) => (
    <div role="img" aria-label={alt} className={className} />
  ),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  })
})

afterEach(cleanup)

function Harness({ onApply = vi.fn(), onReset = vi.fn() }: { onApply?: () => void; onReset?: () => void } = {}): JSX.Element {
  const [lightingRig, setLightingRig] = React.useState<ImageLightingRigConfig>(DEFAULT_IMAGE_LIGHTING_RIG)
  const [controlState, setControlState] = React.useState<LibTvLightingControlState>(DEFAULT_LIBTV_LIGHTING_CONTROL_STATE)
  const [smartPrompt, setSmartPrompt] = React.useState('')
  const [referenceUrl, setReferenceUrl] = React.useState<string | null>(null)
  return (
    <MantineProvider>
      <LibTvLightingEditorToolbar
        isOpen
        lightingRig={lightingRig}
        controlState={controlState}
        smartPrompt={smartPrompt}
        lightingReferenceImageUrl={referenceUrl}
        lightingReferenceUploading={false}
        applying={false}
        preview={(mode) => <div aria-label={`灯光球预览-${mode}`} />}
        onLightingRigChange={setLightingRig}
        onControlStateChange={setControlState}
        onSmartPromptChange={setSmartPrompt}
        onSelectLightingReferenceImage={vi.fn()}
        onRemoveLightingReferenceImage={() => setReferenceUrl(null)}
        onLightingReferenceImageUrlChange={setReferenceUrl}
        onReset={onReset}
        onClose={vi.fn()}
        onApply={onApply}
      />
    </MantineProvider>
  )
}

describe('LibTvLightingEditorToolbar', () => {
  it('renders the current LibTV controls without the obsolete material-softness control', () => {
    render(<Harness />)

    expect(screen.getByRole('region', { name: '打光效果' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '透视' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '正面' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('灯光球预览-perspective')).toBeInTheDocument()
    expect(screen.getByRole('slider')).toHaveValue(50)
    expect(screen.getByRole('group', { name: '主光源方向' })).toBeInTheDocument()
    for (const label of ['左侧', '顶部', '右侧', '前方', '底部', '后方']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByText('全局')).toBeInTheDocument()
    expect(screen.getByText('亮度')).toBeInTheDocument()
    expect(screen.getByText('颜色')).toBeInTheDocument()
    expect(screen.getByText('主光源')).toBeInTheDocument()
    expect(screen.getByText('轮廓光')).toBeInTheDocument()
    expect(screen.queryByText('质感')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '正面' }))
    expect(screen.getByRole('tab', { name: '正面' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('灯光球预览-front')).toBeInTheDocument()
  })

  it('opens the eight smart presets and disables rim light for a rear main light', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('switch', { name: '智能模式' }))
    expect(screen.getByPlaceholderText('简单描述你想实现的打光效果，或者情绪风格')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打光参考图' })).toBeInTheDocument()
    for (const label of ['过曝胶片', '蓝色逆光', '伦勃朗光', '赛博朋克', '落日迷幻', '神秘暗调', '黄金时刻', '诺兰冷灰']) {
      expect(screen.getByTitle(label)).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: '后方' }))
    expect(screen.getByRole('switch', { name: '轮廓光' })).toBeDisabled()
  })

  it('keeps reset and generation connected to the real editor callbacks', () => {
    const onApply = vi.fn()
    const onReset = vi.fn()
    render(<Harness onApply={onApply} onReset={onReset} />)

    fireEvent.click(screen.getByRole('button', { name: '重置参数' }))
    fireEvent.click(screen.getByRole('button', { name: '生成打光图片' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
