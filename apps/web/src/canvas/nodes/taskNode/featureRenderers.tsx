import React from 'react'
import type { TaskNodeFeature } from '../taskNodeSchema'
import type { AudioContent } from './components/AudioContent'
import type { ImageContent } from './components/ImageContent'
import type { StoryboardEditorContent } from './components/StoryboardEditorContent'
import type { VideoComposeContent } from './components/VideoComposeContent'
import type { ShotTableContent } from './shotTable/ShotTableContent'
import type { VideoAnalysisContent } from './videoAnalysis/VideoAnalysisContent'
import type { WorkflowStageContent } from './components/WorkflowStageContent'
import type { WorkflowTriggerContent } from './components/WorkflowTriggerContent'
import { createLazyTaskNodeComponent } from './components/createLazyTaskNodeComponent'

const LazyImageContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/ImageContent')
  return { default: module.ImageContent }
})

const LazyStoryboardEditorContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/StoryboardEditorContent')
  return { default: module.StoryboardEditorContent }
})

const LazyVideoComposeContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/VideoComposeContent')
  return { default: module.VideoComposeContent }
})

const LazyAudioContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/AudioContent')
  return { default: module.AudioContent }
})

const LazyVideoAnalysisContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./videoAnalysis/VideoAnalysisContent')
  return { default: module.VideoAnalysisContent }
})

const LazyShotTableContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./shotTable/ShotTableContent')
  return { default: module.ShotTableContent }
})

const LazyWorkflowStageContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/WorkflowStageContent')
  return { default: module.WorkflowStageContent }
})

const LazyWorkflowTriggerContent = createLazyTaskNodeComponent(async () => {
  const module = await import('./components/WorkflowTriggerContent')
  return { default: module.WorkflowTriggerContent }
})

export type FeatureRendererContext = {
  videoContent: React.ReactNode | null
  imageProps: React.ComponentProps<typeof ImageContent>
  storyboardEditorProps: React.ComponentProps<typeof StoryboardEditorContent>
  videoComposeProps?: React.ComponentProps<typeof VideoComposeContent> | undefined
  audioProps?: React.ComponentProps<typeof AudioContent> | undefined
  videoAnalysisProps?: Omit<React.ComponentProps<typeof VideoAnalysisContent>, 'className'> | undefined
  shotTableProps?: Omit<React.ComponentProps<typeof ShotTableContent>, 'className'> | undefined
  workflowStageProps?: React.ComponentProps<typeof WorkflowStageContent> | undefined
  workflowTriggerProps?: React.ComponentProps<typeof WorkflowTriggerContent> | undefined
}

type Renderer = (ctx: FeatureRendererContext) => React.ReactNode

const featureRenderers: Partial<Record<TaskNodeFeature, Renderer>> = {
  image: (ctx) => <LazyImageContent {...ctx.imageProps} />,
  video: (ctx) => ctx.videoContent,
  storyboardEditor: (ctx) => <LazyStoryboardEditorContent {...ctx.storyboardEditorProps} />,
  videoCompose: (ctx) => ctx.videoComposeProps ? <LazyVideoComposeContent {...ctx.videoComposeProps} /> : null,
  audio: (ctx) => ctx.audioProps ? <LazyAudioContent {...ctx.audioProps} /> : null,
  videoAnalysis: (ctx) => ctx.videoAnalysisProps
    ? <LazyVideoAnalysisContent className="task-node-feature task-node-feature--video-analysis" {...ctx.videoAnalysisProps} />
    : null,
  shotTable: (ctx) => ctx.shotTableProps
    ? <LazyShotTableContent className="task-node-feature task-node-feature--shot-table" {...ctx.shotTableProps} />
    : null,
  workflowStage: (ctx) => ctx.workflowStageProps
    ? <LazyWorkflowStageContent {...ctx.workflowStageProps} />
    : null,
  workflowTrigger: (ctx) => ctx.workflowTriggerProps
    ? <LazyWorkflowTriggerContent {...ctx.workflowTriggerProps} />
    : null,
}

export const renderFeatureBlocks = (features: TaskNodeFeature[], ctx: FeatureRendererContext) => {
  const rendered: React.ReactNode[] = []
  const seen = new Set<TaskNodeFeature>()
  features.forEach((feature) => {
    const canonical = feature === 'videoResults'
      ? 'video'
      : feature === 'imageResults'
        ? 'image'
        : feature
    if (seen.has(canonical as TaskNodeFeature)) return
    const renderer = featureRenderers[canonical as TaskNodeFeature]
    if (!renderer) return
    const node = renderer(ctx)
    if (node) {
      const key = `feature-${canonical}`
      if (React.isValidElement(node)) {
        rendered.push(React.cloneElement(node, { key }))
      } else {
        rendered.push(<React.Fragment key={key}>{node}</React.Fragment>)
      }
    }
    seen.add(canonical as TaskNodeFeature)
  })
  return rendered
}
