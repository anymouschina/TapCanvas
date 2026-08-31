const HIDE_EDGES_AT = 0.32
const SHOW_EDGES_AT = 0.36

export function shouldHideEdgesAtZoom(zoom: number, currentlyHidden: boolean): boolean {
  return currentlyHidden ? zoom < SHOW_EDGES_AT : zoom <= HIDE_EDGES_AT
}
