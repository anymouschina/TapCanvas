import { TaskNodeFeature, TaskNodeSchema } from '../taskNodeSchema'

export type TaskNodeFeatureFlags = {
  featureSet: Set<TaskNodeFeature>
  isStoryboardNode: boolean
  isComposerNode: boolean
  isMosaicNode: boolean
  hasPrompt: boolean
  hasStoryboardEditor: boolean
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
  supportsSubflowHandles: boolean
}

export const buildTaskNodeFeatureFlags = (
  schema: TaskNodeSchema,
  kind?: string | null,
): TaskNodeFeatureFlags => {
  const featureSet = new Set<TaskNodeFeature>(schema.features)
  const isStoryboardNode = schema.category === 'storyboard'
  const isComposerNode = schema.category === 'composer' || isStoryboardNode
  const isMosaicNode = kind === 'mosaic'

  const hasPrompt = featureSet.has('prompt') || featureSet.has('storyboard')
  const hasStoryboardEditor = featureSet.has('storyboard')
  const hasSystemPrompt = featureSet.has('systemPrompt')
  const hasModelSelect = featureSet.has('modelSelect')
  const hasSampleCount = featureSet.has('sampleCount')
  const hasAspect = featureSet.has('aspect')
  const hasImageSize = featureSet.has('imageSize')
  const hasOrientation = featureSet.has('orientation')
  const hasDuration = featureSet.has('duration')
  const hasTextResults = featureSet.has('textResults')

  const hasImageResults = featureSet.has('imageResults')
  const hasImage = hasImageResults || featureSet.has('image') || schema.category === 'image'
  const hasImageUpload = featureSet.has('imageUpload')
  const hasReversePrompt = featureSet.has('reversePrompt')

  const hasVideoResults = featureSet.has('videoResults')
  const hasVideo = hasVideoResults || featureSet.has('video') || schema.category === 'video'
  const hasAudio = featureSet.has('audio') || schema.category === 'audio'
  const hasSubtitle = featureSet.has('subtitle') || schema.category === 'subtitle'
  const hasCharacter = featureSet.has('character') || schema.category === 'character'

  const supportsSubflowHandles = featureSet.has('subflow')

  return {
    featureSet,
    isStoryboardNode,
    isComposerNode,
    isMosaicNode,
    hasPrompt,
    hasStoryboardEditor,
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
    supportsSubflowHandles,
  }
}
