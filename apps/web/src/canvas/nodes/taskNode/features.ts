import { TaskNodeFeature, TaskNodeSchema } from '../taskNodeSchema'

export type TaskNodeFeatureFlags = {
  featureSet: Set<TaskNodeFeature>
  isStoryboardNode: boolean
  isComposerNode: boolean
  isMosaicNode: boolean
  hasPrompt: boolean
  hasAnchorBinding: boolean
  hasSystemPrompt: boolean
  hasModelSelect: boolean
  hasSampleCount: boolean
  hasAspect: boolean
  hasImageSize: boolean
  hasOrientation: boolean
  hasDuration: boolean
  hasImage: boolean
  hasImageResults: boolean
  hasImageUpload: boolean
  hasReversePrompt: boolean
  hasVideo: boolean
  hasVideoResults: boolean
  hasAudio: boolean
  hasSubtitle: boolean
  hasCharacter: boolean
  hasTextResults: boolean
  hasStoryboardEditor: boolean
  supportsSubflowHandles: boolean
}

export const buildTaskNodeFeatureFlags = (
  schema: TaskNodeSchema,
  _kind?: string | null,
): TaskNodeFeatureFlags => {
  const featureSet = new Set<TaskNodeFeature>(schema.features)
  const isStoryboardNode = false
  const isComposerNode = schema.kind === 'video'
  const isMosaicNode = false

  const hasPrompt = featureSet.has('prompt') || featureSet.has('storyboard')
  const hasAnchorBinding = featureSet.has('anchorBinding')
  const hasSystemPrompt = featureSet.has('systemPrompt')
  const hasModelSelect = featureSet.has('modelSelect')
  const hasSampleCount = featureSet.has('sampleCount')
  const hasAspect = featureSet.has('aspect')
  const hasImageSize = featureSet.has('imageSize')
  const hasOrientation = featureSet.has('orientation')
  const hasDuration = featureSet.has('duration')
  const hasTextResults = featureSet.has('textResults')
  const hasStoryboardEditor = featureSet.has('storyboardEditor')

  const hasImageResults = featureSet.has('imageResults')
  const hasImage = hasImageResults || featureSet.has('image') || schema.category === 'image' || schema.category === 'storyboard'
  const hasImageUpload = featureSet.has('imageUpload')
  const hasReversePrompt = featureSet.has('reversePrompt')

  const hasVideoResults = featureSet.has('videoResults')
  const hasVideo = hasVideoResults || featureSet.has('video') || schema.category === 'video'
  const hasAudio = featureSet.has('audio')
  const hasSubtitle = featureSet.has('subtitle')
  const hasCharacter = featureSet.has('character')

  const supportsSubflowHandles = false

  return {
    featureSet,
    isStoryboardNode,
    isComposerNode,
    isMosaicNode,
    hasPrompt,
    hasAnchorBinding,
    hasSystemPrompt,
    hasModelSelect,
    hasSampleCount,
    hasAspect,
    hasImageSize,
    hasOrientation,
    hasDuration,
    hasImage,
    hasImageResults,
    hasImageUpload,
    hasReversePrompt,
    hasVideo,
    hasVideoResults,
    hasAudio,
    hasSubtitle,
    hasCharacter,
    hasTextResults,
    hasStoryboardEditor,
    supportsSubflowHandles,
  }
}
