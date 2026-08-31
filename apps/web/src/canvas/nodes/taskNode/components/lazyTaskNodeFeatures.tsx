import { createLazyTaskNodeComponent } from './createLazyTaskNodeComponent'

export const LazyPromptSampleDrawer = createLazyTaskNodeComponent(async () => {
  const module = await import('../../../components/PromptSampleDrawer')
  return { default: module.PromptSampleDrawer }
})

export const LazyImagePickerModal = createLazyTaskNodeComponent(async () => {
  const module = await import('../../../../ui/ImagePickerModal')
  return { default: module.ImagePickerModal }
})

export const LazyAiCharacterLibraryModal = createLazyTaskNodeComponent(async () => {
  const module = await import('../../../../ui/assets/AiCharacterLibraryModal')
  return { default: module.AiCharacterLibraryModal }
})

export const LazyHdUpscalePanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../HdUpscalePanel')
  return { default: module.HdUpscalePanel }
})

export const LazyEmotionPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../EmotionPanel')
  return { default: module.EmotionPanel }
})

export const LazyExpandPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../ExpandPanel')
  return { default: module.ExpandPanel }
})

export const LazyRotatePanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../RotatePanel')
  return { default: module.RotatePanel }
})

export const LazyCropOverlayEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../CropOverlayEditor')
  return { default: module.CropOverlayEditor }
})

export const LazyVideoTrimEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../VideoTrimEditor')
  return { default: module.VideoTrimEditor }
})

export const LazyVideoContinuationPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../VideoContinuationPanel')
  return { default: module.VideoContinuationPanel }
})

export const LazyVideoToolEditorPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('../VideoToolEditorPanel')
  return { default: module.VideoToolEditorPanel }
})

export const LazyElementEditEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../ElementEditEditor')
  return { default: module.ElementEditEditor }
})

export const LazyPortraitTextureEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../PortraitTextureEditor')
  return { default: module.PortraitTextureEditor }
})

export const LazyMaskDrawingEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../MaskDrawingEditor')
  return { default: module.MaskDrawingEditor }
})

export const LazyAnnotationEditor = createLazyTaskNodeComponent(async () => {
  const module = await import('../AnnotationEditor')
  return { default: module.AnnotationEditor }
})

export const LazyVideoResultModal = createLazyTaskNodeComponent(async () => {
  const module = await import('../VideoResultModal')
  return { default: module.VideoResultModal }
})

export const LazyImage3DPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('./Image3DPanel')
  return { default: module.Image3DPanel }
})

export const LazyVideoEnhancePanel = createLazyTaskNodeComponent(async () => {
  const module = await import('./VideoEnhancePanel')
  return { default: module.VideoEnhancePanel }
})

export const LazyModel3DOverlay = createLazyTaskNodeComponent(async () => {
  const module = await import('./Model3DOverlay')
  return { default: module.Model3DOverlay }
})

export const LazyCharacterFissionEditorPortal = createLazyTaskNodeComponent(async () => {
  const module = await import('./CharacterFissionEditorPortal')
  return { default: module.CharacterFissionEditorPortal }
})

export const LazyWorkflowPresetSelector = createLazyTaskNodeComponent(async () => {
  const module = await import('./WorkflowPresetSelector')
  return { default: module.WorkflowPresetSelector }
})

export const LazyVideoComposeEditorModal = createLazyTaskNodeComponent(async () => {
  const module = await import('./VideoComposeEditorModal')
  return { default: module.VideoComposeEditorModal }
})

export const LazyStyleImagePickerModal = createLazyTaskNodeComponent(async () => {
  const module = await import('./StyleImagePickerModal')
  return { default: module.StyleImagePickerModal }
})

export const LazyMediaPromptLibraryModal = createLazyTaskNodeComponent(async () => {
  const module = await import('./MediaPromptLibraryModal')
  return { default: module.MediaPromptLibraryModal }
})

export const LazyVeoImageModal = createLazyTaskNodeComponent(async () => {
  const module = await import('./VeoImageModal')
  return { default: module.VeoImageModal }
})

export const LazyVideoMarkerToolbar = createLazyTaskNodeComponent(async () => {
  const module = await import('./VideoMarkerToolbar')
  return { default: module.VideoMarkerToolbar }
})

export const LazySaveToLibraryModal = createLazyTaskNodeComponent(async () => {
  const module = await import('./SaveToLibraryModal')
  return { default: module.SaveToLibraryModal }
})

export const LazyVideoContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./VideoContent')
  return { default: module.VideoContent }
})

export const LazySegmentRemakeContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./SegmentRemakeContent')
  return { default: module.SegmentRemakeContent }
})

export const LazyIntentConfigModal = createLazyTaskNodeComponent(async () => {
  const module = await import('../IntentConfigModal')
  return { default: module.IntentConfigModal }
})

export const LazyDoubaoVoicePicker = createLazyTaskNodeComponent(async () => {
  const module = await import('./DoubaoVoicePicker')
  return { default: module.default }
})

export const LazyGridCustomPicker = createLazyTaskNodeComponent(async () => {
  const module = await import('./GridSplitView')
  return { default: module.GridCustomPicker }
})

export const LazyControlChips = createLazyTaskNodeComponent(async () => {
  const module = await import('./ControlChips')
  return { default: module.ControlChips }
})

export const LazyLibTvPresetLibrary = createLazyTaskNodeComponent(async () => {
  const module = await import('./LibTvPresetLibrary')
  return { default: module.LibTvPresetLibrary }
})

export const LazyLibTvMediaQuickActions = createLazyTaskNodeComponent(async () => {
  const module = await import('./LibTvMediaQuickActions')
  return { default: module.LibTvMediaQuickActions }
})

export const LazyPromptSection = createLazyTaskNodeComponent(async () => {
  const module = await import('./PromptSection')
  return { default: module.PromptSection }
})

export const LazyStructuredPromptSection = createLazyTaskNodeComponent(async () => {
  const module = await import('./StructuredPromptSection')
  return { default: module.StructuredPromptSection }
})

export const LazyVideoContinuityInspector = createLazyTaskNodeComponent(async () => {
  const module = await import('./VideoClipCanvasMeta')
  return { default: module.VideoContinuityInspector }
})

export const LazyTextContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./TextContent')
  return { default: module.TextContent }
})

export const LazyTaskNodeTextInlineToolbar = createLazyTaskNodeComponent(async () => {
  const module = await import('./TaskNodeTextInlineToolbar')
  return { default: module.TaskNodeTextInlineToolbar }
})

export const LazyPortraitTextureControls = createLazyTaskNodeComponent(async () => {
  const module = await import('./PortraitTextureControls')
  return { default: module.PortraitTextureControls }
})

export const LazyCameraControlPanel = createLazyTaskNodeComponent(async () => {
  const module = await import('./CameraControlPanel')
  return { default: module.CameraControlPanel }
})

export const LazyIntentActionGroup = createLazyTaskNodeComponent(async () => {
  const module = await import('../IntentActionGroup')
  return { default: module.IntentActionGroup }
})
