export { useImageResource } from './hooks/useImageResource'
export { ManagedImage } from './components/ManagedImage'
export { resourceManager } from './services/resourceManager'
export {
  ensureNodePreviewReady,
  invalidateResource,
  pauseBackgroundLoading,
  prefetchViewportResources,
  releaseNodeResources,
  resumeBackgroundLoading,
  trimToBudget,
} from './services/resourceUseCases'
export type {
  AcquireImageResourceInput,
  ImageResourceSnapshot,
  ImageResourceEntry,
  ImageResourceId,
  ImageTransportKind,
  ResourceKind,
  ResourceLifecycleState,
  ResourceOwnerSurface,
  ResourcePriority,
  ResourceVariantKey,
} from './model/resourceTypes'
export { useViewportVisibility } from './hooks/useViewportVisibility'
