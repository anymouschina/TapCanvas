import type { Node } from '@xyflow/react'
import { bootstrapProjectFlow, type ProjectDto } from '../api/server'
import type { PromptLibraryCard, PromptLibraryMedia } from '../api/promptLibrary'

type PromptLibraryProjectRuntime = Readonly<{
  bootstrapProject: typeof bootstrapProjectFlow
}>

export type PromptLibraryProjectResult = Readonly<{
  project: ProjectDto
  flow: Readonly<{ id: string }>
}>

export class PromptLibraryCanvasSaveError extends Error {
  readonly project: ProjectDto

  constructor(project: ProjectDto, cause: unknown) {
    super(cause instanceof Error ? cause.message : '提示词写入画布失败')
    this.name = 'PromptLibraryCanvasSaveError'
    this.project = project
    this.cause = cause
  }
}

function mediaAspectRatio(media: PromptLibraryMedia): string | undefined {
  if (!media.width || !media.height) return undefined
  return `${media.width}:${media.height}`
}

function baseNodeData(entry: PromptLibraryCard, media: PromptLibraryMedia): Record<string, unknown> {
  return {
    label: entry.title,
    prompt: entry.promptText,
    status: 'success',
    nodeWidth: 380,
    promptLibraryEntryId: entry.id,
    promptLibraryMediaId: media.id,
  }
}

export function buildPromptLibraryCanvasNode(entry: PromptLibraryCard): Node {
  const media = entry.media[0]
  if (!media) throw new Error('当前提示词没有可添加到画布的媒体资源')
  const modelSlug = entry.models[0]?.slug
  const aspectRatio = mediaAspectRatio(media)
  const baseData = baseNodeData(entry, media)

  if (media.kind === 'video') {
    return {
      id: `prompt-library-${entry.id}`,
      type: 'taskNode',
      position: { x: 80, y: 80 },
      data: {
        ...baseData,
        kind: 'video',
        videoUrl: media.url,
        videoTitle: entry.title,
        videoResults: [{
          url: media.url,
          title: entry.title,
          thumbnailUrl: media.thumbnailUrl,
          duration: null,
        }],
        videoPrimaryIndex: 0,
        ...(media.thumbnailUrl ? { videoThumbnailUrl: media.thumbnailUrl } : null),
        ...(modelSlug ? { videoModel: modelSlug } : null),
        ...(aspectRatio ? { aspectRatio } : null),
      },
    }
  }

  return {
    id: `prompt-library-${entry.id}`,
    type: 'taskNode',
    position: { x: 80, y: 80 },
    data: {
      ...baseData,
      kind: 'image',
      imageUrl: media.url,
      imageResults: [{ url: media.url, title: entry.title }],
      imagePrimaryIndex: 0,
      ...(modelSlug ? { imageModel: modelSlug } : null),
      ...(aspectRatio ? { aspectRatio } : null),
    },
  }
}

export async function createPromptLibraryProject(
  entry: PromptLibraryCard,
  teamId: string | null,
  runtime: PromptLibraryProjectRuntime = { bootstrapProject: bootstrapProjectFlow },
): Promise<PromptLibraryProjectResult> {
  const node = buildPromptLibraryCanvasNode(entry)
  const result = await runtime.bootstrapProject({
    name: entry.title,
    teamId,
    flowName: entry.title,
    nodes: [node],
    edges: [],
    viewport: { x: 32, y: 32, zoom: 0.92 },
  })
  if (result.status === 'partial') {
    throw new PromptLibraryCanvasSaveError(result.project, new Error(result.error))
  }
  return { project: result.project, flow: result.flow }
}
