// Test-only stand-in for vite-plugin-pwa's virtual module; individual tests override it with vi.mock.
export function useRegisterSW() {
  return {
    needRefresh: [false, () => undefined] as const,
    offlineReady: [false, () => undefined] as const,
    updateServiceWorker: async () => undefined,
  }
}
