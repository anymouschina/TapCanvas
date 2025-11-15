export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface BaseTaskRequest {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, any>
}

export interface TextToImageRequest extends BaseTaskRequest {
  kind: 'text_to_image'
}

export interface TextToVideoRequest extends BaseTaskRequest {
  kind: 'text_to_video'
  durationSeconds?: number
}

export type AnyTaskRequest = BaseTaskRequest | TextToImageRequest | TextToVideoRequest

export interface TaskAsset {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
}

export interface TaskResult {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAsset[]
  raw: any
}

export interface ProviderContext {
  baseUrl: string
  apiKey: string
  userId: string
  modelKey?: string | null
}

export interface ProviderAdapter {
  name: string
  supports: TaskKind[]

  runChat?(req: BaseTaskRequest, ctx: ProviderContext): Promise<TaskResult>
  textToImage?(req: TextToImageRequest, ctx: ProviderContext): Promise<TaskResult>
  textToVideo?(req: TextToVideoRequest, ctx: ProviderContext): Promise<TaskResult>
}

