import React from 'react'
import type { TaskNodeFeature } from '../taskNodeSchema'
import type { TaskNodeFeatureFlags } from './features'
import { ImageContent } from './components/ImageContent'
import { StoryboardEditorContent } from './components/StoryboardEditorContent'

export type FeatureRendererContext = {
  featureFlags: TaskNodeFeatureFlags
  videoContent: React.ReactNode | null
  imageProps: React.ComponentProps<typeof ImageContent>
  storyboardEditorProps: React.ComponentProps<typeof StoryboardEditorContent>
}

type Renderer = (ctx: FeatureRendererContext) => React.ReactNode

const featureRenderers: Partial<Record<TaskNodeFeature, Renderer>> = {
  image: (ctx) => <ImageContent {...ctx.imageProps} />,
  video: (ctx) => ctx.videoContent,
  storyboardEditor: (ctx) => <StoryboardEditorContent {...ctx.storyboardEditorProps} />,
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
