import React from 'react'
import type { TaskNodeFeature } from '../taskNodeSchema'
import type { TaskNodeFeatureFlags } from './features'
import { CharacterContent } from './components/CharacterContent'
import { MosaicContent } from './components/MosaicContent'
import { ImageContent } from './components/ImageContent'

export type FeatureRendererContext = {
  featureFlags: TaskNodeFeatureFlags
  isMosaicNode: boolean
  videoContent: React.ReactNode | null
  characterProps: React.ComponentProps<typeof CharacterContent> | null
  mosaicProps: React.ComponentProps<typeof MosaicContent>
  imageProps: React.ComponentProps<typeof ImageContent>
}

type Renderer = (ctx: FeatureRendererContext) => React.ReactNode

const featureRenderers: Partial<Record<TaskNodeFeature, Renderer>> = {
  character: (ctx) => (ctx.characterProps ? <CharacterContent {...ctx.characterProps} /> : null),
  image: (ctx) => (ctx.isMosaicNode ? <MosaicContent {...ctx.mosaicProps} /> : <ImageContent {...ctx.imageProps} />),
  video: (ctx) => ctx.videoContent,
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
