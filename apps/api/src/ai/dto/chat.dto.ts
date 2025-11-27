export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessageDto {
  role: ChatRole
  content?: string
  parts?: Array<Record<string, any>>
  metadata?: Record<string, any>
}

export interface CanvasCharacterContextDto {
  nodeId: string
  label?: string
  username?: string
  description?: string
  avatarUrl?: string
}

export interface CanvasVideoBindingContextDto {
  nodeId: string
  label?: string
  promptPreview?: string
  remixSourceLabel?: string
  characters?: Array<{
    nodeId: string
    label?: string
    username?: string
  }>
}

export interface CanvasContextDto {
  nodes?: Array<Record<string, any>>
  edges?: Array<Record<string, any>>
  summary?: Record<string, any>
  characters?: CanvasCharacterContextDto[]
  videoBindings?: CanvasVideoBindingContextDto[]
}

export interface ChatRequestDto {
  model: string
  messages: ChatMessageDto[]
  context?: CanvasContextDto
  temperature?: number
  apiKey?: string
  baseUrl?: string
  provider?: string
  tools?: Record<string, any>
  clientToolExecution?: boolean
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool', name: string }
  maxToolRoundtrips?: number
  maxTokens?: number
  headers?: Record<string, string>
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

export interface ToolResultDto {
  toolCallId: string
  toolName: string
  output?: any
  errorText?: string
}
