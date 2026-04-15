export type MainImageMountStateInput = {
  hasImageUrl: boolean
  selected: boolean
  viewportVisible: boolean
  hasEverBeenVisible: boolean
  viewportMoving: boolean
}

export function shouldKeepMainImageMounted(input: MainImageMountStateInput): boolean {
  if (!input.hasImageUrl) return false
  if (input.selected || input.viewportVisible) return true
  return input.viewportMoving && input.hasEverBeenVisible
}
