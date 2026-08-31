import type { LibTvImageToolbarIconName } from './components/LibTvImageToolbarIcon'
import type { LibTvImagePresetKey } from './libTvImagePresets'

export const LIBTV_IMAGE_PORTRAIT_ACTIONS = [
  { key: 'portrait-adjust', label: '人像调节', icon: 'portrait' },
  { key: 'emotion-adjust', label: '情绪调节', icon: 'emotion' },
] as const

export const LIBTV_IMAGE_HD_ACTIONS = [
  { key: 'upscale', label: '高清', icon: 'hd' },
  { key: 'expand', label: '扩图', icon: 'expand' },
  { key: 'repaint', label: '重绘', icon: 'repaint' },
  { key: 'erase', label: '擦除', icon: 'erase' },
  { key: 'cutout', label: '抠图', icon: 'cutout' },
  { key: 'crop', label: '裁剪', icon: 'crop' },
] as const

export const LIBTV_IMAGE_GRID_SPLIT_ACTIONS = [
  { key: '2x2', label: '4宫格 (2×2)', rows: 2, cols: 2 },
  { key: '3x3', label: '9宫格 (3×3)', rows: 3, cols: 3 },
  { key: '4x4', label: '16宫格 (4×4)', rows: 4, cols: 4 },
  { key: '5x5', label: '25宫格 (5×5)', rows: 5, cols: 5 },
] as const

export const LIBTV_IMAGE_NINE_GRID_ICONS: Readonly<Partial<Record<LibTvImagePresetKey, LibTvImageToolbarIconName>>> = {
  'multi-camera-9': 'nine-grid',
  'plot-4': 'four-grid',
  'character-face-3view': 'face-three-view',
  'character-setting': 'character-setting',
  'scene-setting': 'scene-setting',
  'product-setting': 'product-setting',
  'storyboard-25': 'twenty-five-grid',
  'lighting-correction': 'lighting-correction',
  'character-3view': 'character-three-view',
  'evolution-3s-after': 'after-three',
  'evolution-5s-before': 'before-five',
}
