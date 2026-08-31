// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TimelinePanel } from './TimelinePanel'
import type { SceneTimeline } from '../state/timeline'

afterEach(cleanup)

const timeline: SceneTimeline = {
  shots: [
    { id: 's1', name: '镜头1', durationSeconds: 4, cameraId: 'camA', cameraMove: { kind: 'static' } },
    { id: 's2', name: '镜头2', durationSeconds: 6, cameraMove: { kind: 'orbit', orbit: { radius: 6 } } },
  ],
}

function setup(over: Partial<React.ComponentProps<typeof TimelinePanel>> = {}) {
  const props = {
    timeline,
    cameras: [{ id: 'camA', name: '机位A' }],
    characters: [{ id: 'c1', name: '角色A', label: '角色A · 走路', durationSeconds: 5 }],
    playhead: 2,
    playing: false,
    speed: 1,
    selectedShotId: 's1',
    onPlayToggle: vi.fn(),
    onReset: vi.fn(),
    onSeek: vi.fn(),
    onSpeed: vi.fn(),
    onAddShot: vi.fn(),
    onSelectShot: vi.fn(),
    onPatchShot: vi.fn(),
    onRemoveShot: vi.fn(),
    onMoveShot: vi.fn(),
    onPatchCharDuration: vi.fn(),
    onRemoveChar: vi.fn(),
    onSelectCharacter: vi.fn(),
    ...over,
  }
  render(<TimelinePanel {...props} />)
  return props
}

describe('TimelinePanel — multi-track', () => {
  it('renders a camera track block per shot + a character track', () => {
    setup()
    expect(screen.getByText(/镜头1 ·/)).toBeTruthy()
    expect(screen.getByText(/镜头2 ·/)).toBeTruthy()
    expect(screen.getByText('角色A · 走路')).toBeTruthy()  // 角色轨道片段
    expect(screen.getByText('2.0s / 10.0s')).toBeTruthy()
  })

  it('selected shot shows the inspector (机位/运镜/时长/删除)', () => {
    setup({ selectedShotId: 's2' })
    expect(screen.getByLabelText('机位')).toBeTruthy()
    expect(screen.getByLabelText('时长')).toBeTruthy()
    expect(screen.getByLabelText('删除镜头2')).toBeTruthy()
  })

  it('inspector delete fires onRemoveShot', () => {
    const p = setup({ selectedShotId: 's2' })
    fireEvent.click(screen.getByLabelText('删除镜头2'))
    expect(p.onRemoveShot).toHaveBeenCalledWith('s2')
  })

  it('reorder arrows fire onMoveShot', () => {
    const p = setup({ selectedShotId: 's2' })
    fireEvent.click(screen.getByTitle('左移'))
    expect(p.onMoveShot).toHaveBeenCalledWith('s2', 0)
  })

  it('play / add / speed callbacks', () => {
    const p = setup()
    fireEvent.click(screen.getByLabelText('播放'))
    fireEvent.click(screen.getByText('+ 添加镜头'))
    fireEvent.click(screen.getByText('4x'))
    expect(p.onPlayToggle).toHaveBeenCalled()
    expect(p.onAddShot).toHaveBeenCalled()
    expect(p.onSpeed).toHaveBeenCalledWith(4)
  })

  it('character clip delete fires onRemoveChar; click selects character', () => {
    const p = setup()
    fireEvent.click(screen.getByLabelText('删除角色A动作'))
    expect(p.onRemoveChar).toHaveBeenCalledWith('c1')
    fireEvent.pointerDown(screen.getByText('角色A · 走路'))
    expect(p.onSelectCharacter).toHaveBeenCalledWith('c1')
  })

  it('empty timeline shows hint in the camera track', () => {
    setup({ timeline: { shots: [] }, characters: [], selectedShotId: undefined })
    expect(screen.getByText(/添加镜头.*运镜排进时间线/)).toBeTruthy()
  })
})
