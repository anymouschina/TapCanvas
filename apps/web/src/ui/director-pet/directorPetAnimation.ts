import { hostedAssetUrl } from '../../config/objectStorageAssets'

export type DirectorPetAnimationState =
  | 'idle'
  | 'working'
  | 'peek'
  | 'playful'
  | 'idea'
  | 'gacha'
  | 'gaming'

export type DirectorPetSpriteSheet = {
  src: string
  frameCount: number
  columns: number
}

const DIRECTOR_PET_ASSET_BASE = hostedAssetUrl('static/team/xiaot-pet')

function directorPetAssetUrl(fileName: string): string {
  return `${DIRECTOR_PET_ASSET_BASE}/${fileName}`
}

export const DIRECTOR_PET_SPRITE_SHEETS: Record<DirectorPetAnimationState, DirectorPetSpriteSheet> = {
  idle: {
    src: directorPetAssetUrl('sprite-idle-v3-1babd0a3.png'),
    frameCount: 4,
    columns: 2,
  },
  working: {
    src: directorPetAssetUrl('sprite-working-v3-4d806d92.png'),
    frameCount: 4,
    columns: 2,
  },
  peek: {
    src: directorPetAssetUrl('sprite-peek-v3-5b9372e1.png'),
    frameCount: 4,
    columns: 2,
  },
  playful: {
    src: directorPetAssetUrl('sprite-playful-v3-681ef0d9.png'),
    frameCount: 4,
    columns: 2,
  },
  idea: {
    src: directorPetAssetUrl('sprite-idea-v3-ea8908b7.png'),
    frameCount: 4,
    columns: 2,
  },
  gacha: {
    src: directorPetAssetUrl('sprite-gacha-v3-ce107e24.png'),
    frameCount: 4,
    columns: 2,
  },
  gaming: {
    src: directorPetAssetUrl('sprite-gaming-v3-6ca7ebe4.png'),
    frameCount: 4,
    columns: 2,
  },
}

const DIRECTOR_PET_SEQUENCES: Record<DirectorPetAnimationState, readonly number[]> = {
  idle: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2],
  working: [0, 0, 3, 3, 0, 0, 2, 2],
  peek: [0],
  playful: [0, 0, 1, 1, 2, 2, 3, 3, 2, 1, 0, 0],
  idea: [0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 0, 0],
  gacha: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0],
  gaming: [0, 0, 1, 1, 2, 2, 1, 2, 3, 3, 3, 0],
}

export const DIRECTOR_PET_FRAME_INTERVAL_MS: Record<DirectorPetAnimationState, number> = {
  idle: 260,
  working: 180,
  peek: 320,
  playful: 100,
  idea: 150,
  gacha: 110,
  gaming: 120,
}

export function resolveDirectorPetFrameIndex(
  state: DirectorPetAnimationState,
  step: number,
  paused: boolean,
): number {
  if (paused) return 0
  const sequence = DIRECTOR_PET_SEQUENCES[state]
  const normalizedStep = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0
  return sequence[normalizedStep % sequence.length]
}

export function resolveDirectorPetFrameOffset(
  sheet: DirectorPetSpriteSheet,
  frameIndex: number,
): { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number } {
  const rows = Math.ceil(sheet.frameCount / sheet.columns)
  const boundedFrameIndex = Math.max(0, Math.min(Math.floor(frameIndex), sheet.frameCount - 1))
  const column = boundedFrameIndex % sheet.columns
  const row = Math.floor(boundedFrameIndex / sheet.columns)
  return {
    xPercent: column === 0 ? 0 : column * (-100 / sheet.columns),
    yPercent: row === 0 ? 0 : row * (-100 / rows),
    widthPercent: sheet.columns * 100,
    heightPercent: rows * 100,
  }
}
