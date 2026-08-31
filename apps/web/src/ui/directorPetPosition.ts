export type DirectorPetPosition = { x: number; y: number }
export type DirectorPetViewport = { width: number; height: number }
export type DirectorPetWallSide = 'left' | 'right'

export const DIRECTOR_PET_WIDTH = 116
export const DIRECTOR_PET_HEIGHT = 136
export const DIRECTOR_PET_VISIBLE_HEAD_WIDTH = 64
export const DIRECTOR_PET_EDGE_GAP = 18
export const DIRECTOR_PET_BOTTOM_GAP = 86

export function defaultDirectorPetPosition(viewport: DirectorPetViewport): DirectorPetPosition {
  return {
    x: Math.max(DIRECTOR_PET_EDGE_GAP, viewport.width - DIRECTOR_PET_WIDTH - DIRECTOR_PET_EDGE_GAP),
    y: Math.max(DIRECTOR_PET_EDGE_GAP, viewport.height - DIRECTOR_PET_HEIGHT - DIRECTOR_PET_BOTTOM_GAP),
  }
}

export function clampDirectorPetPosition(
  position: DirectorPetPosition,
  viewport: DirectorPetViewport,
): DirectorPetPosition {
  const minX = -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH)
  const maxX = Math.max(minX, viewport.width - DIRECTOR_PET_VISIBLE_HEAD_WIDTH)
  const maxY = Math.max(0, viewport.height - DIRECTOR_PET_HEIGHT)
  return {
    x: Math.max(minX, Math.min(position.x, maxX)),
    y: Math.max(0, Math.min(position.y, maxY)),
  }
}

export function settleDirectorPetPosition(
  position: DirectorPetPosition,
  viewport: DirectorPetViewport,
): DirectorPetPosition {
  const clamped = clampDirectorPetPosition(position, viewport)
  const maxFullyVisibleX = Math.max(0, viewport.width - DIRECTOR_PET_WIDTH)
  if (clamped.x < 0) {
    return { ...clamped, x: -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH) }
  }
  if (clamped.x > maxFullyVisibleX) {
    return { ...clamped, x: Math.max(0, viewport.width - DIRECTOR_PET_VISIBLE_HEAD_WIDTH) }
  }
  return clamped
}

export function resolveDirectorPetWallSide(
  position: DirectorPetPosition,
  viewport: DirectorPetViewport,
): DirectorPetWallSide | null {
  const leftWallX = -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH)
  const rightWallX = Math.max(leftWallX, viewport.width - DIRECTOR_PET_VISIBLE_HEAD_WIDTH)
  if (position.x <= leftWallX) return 'left'
  if (position.x >= rightWallX) return 'right'
  return null
}

export function placeDirectorPetAtWall(
  side: DirectorPetWallSide,
  y: number,
  viewport: DirectorPetViewport,
): DirectorPetPosition {
  return clampDirectorPetPosition({
    x: side === 'left'
      ? -(DIRECTOR_PET_WIDTH - DIRECTOR_PET_VISIBLE_HEAD_WIDTH)
      : viewport.width - DIRECTOR_PET_VISIBLE_HEAD_WIDTH,
    y,
  }, viewport)
}
