export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessageDto {
  role: ChatRole
  content: string
}

export interface CanvasContextDto {
  nodes?: Array<Record<string, any>>
  edges?: Array<Record<string, any>>
  summary?: Record<string, any>
}

export interface ChatRequestDto {
  model: string
  messages: ChatMessageDto[]
  context?: CanvasContextDto
  temperature?: number
  apiKey?: string
  baseUrl?: string
  provider?: string
}

export interface AssistantActionDto {
  type: string
  params: Record<string, any>
  reasoning?: string
}

export interface ChatResponseDto {
  reply: string
  plan: string[]
  actions: AssistantActionDto[]
}
