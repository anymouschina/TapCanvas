export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
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

export interface ImageEditRequest extends BaseTaskRequest {
  kind: 'image_edit'
}

export interface TextToVideoRequest extends BaseTaskRequest {
  kind: 'text_to_video'
  durationSeconds?: number
}

export interface ImageToPromptRequest extends BaseTaskRequest {
  kind: 'image_to_prompt'
}

export type AnyTaskRequest =
  | BaseTaskRequest
  | TextToImageRequest
  | ImageEditRequest
  | TextToVideoRequest
  | ImageToPromptRequest

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
  onProgress?: (update: ProviderProgressUpdate) => void
}

export interface TaskProgressEvent {
  taskId?: string
  nodeId?: string
  nodeKind?: string
  taskKind?: TaskKind
  vendor?: string
  status: TaskStatus
  progress?: number
  message?: string
  assets?: TaskAsset[]
  raw?: any
  timestamp?: number
}

export interface ProviderProgressUpdate {
  status?: TaskStatus
  progress?: number
  message?: string
  data?: any
}

export interface ProviderAdapter {
  name: string
  supports: TaskKind[]

  runChat?(req: BaseTaskRequest, ctx: ProviderContext): Promise<TaskResult>
  textToImage?(req: TextToImageRequest, ctx: ProviderContext): Promise<TaskResult>
  imageEdit?(req: ImageEditRequest, ctx: ProviderContext): Promise<TaskResult>
  textToVideo?(req: TextToVideoRequest, ctx: ProviderContext): Promise<TaskResult>
  imageToPrompt?(req: ImageToPromptRequest, ctx: ProviderContext): Promise<TaskResult>
}
