export const ASSET_REFRESH_EVENT = 'tapcanvas-assets-refresh'

export function notifyAssetRefresh() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASSET_REFRESH_EVENT))
}

