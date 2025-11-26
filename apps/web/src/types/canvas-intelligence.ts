/**
 * 前端画布智能系统类型定义
 * 与后端类型保持同步
 */

export enum CanvasActionDomain {
  NODE_MANIPULATION = 'node_manipulation',
  CONNECTION_FLOW = 'connection_flow',
  VIEW_NAVIGATION = 'view_navigation',
  LAYOUT_ARRANGEMENT = 'layout_arrangement',
  PROJECT_MANAGEMENT = 'project_management',
  TEMPLATE_SYSTEM = 'template_system',
  SETTINGS_CONFIG = 'settings_config',
  ASSET_MANAGEMENT = 'asset_management',
  EXECUTION_DEBUG = 'execution_debug'
}

export interface ThinkingEvent {
  id: string
  type: 'intent_analysis' | 'planning' | 'reasoning' | 'decision' | 'execution' | 'result'
  timestamp: Date
  content: string
  metadata?: {
    confidence?: number
    alternatives?: Array<{option: string, reason: string}>
    context?: Record<string, any>
    operationType?: string
    parameters?: Record<string, any>
  }
}

export interface ExecutionStep {
  id: string
  name: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  reasoning: string
  estimatedTime?: number
  dependencies?: string[]
  result?: any
  error?: string
}

export interface ExecutionPlan {
  id: string
  strategy: {
    name: string
    description: string
    efficiency: 'low' | 'medium' | 'high' | 'very_high'
    risk: 'low' | 'medium' | 'high'
    reasoning: string
  }
  steps: ExecutionStep[]
  estimatedTime: number
  estimatedCost: number
}

export interface ParsedCanvasIntent {
  type: CanvasActionDomain
  capabilityName?: string
  confidence: number
  entities: Record<string, any>
  rawText: string
  extractedParams: Record<string, any>
  reasoning: string
}

export interface CanvasOperation {
  id: string
  capability: {
    domain: CanvasActionDomain
    name: string
    description: string
    webActions: {
      frontendFunction?: string
      eventType?: string
      apiCall?: {
        method: string
        endpoint: string
        payload: any
      }
      socketMessage?: {
        channel: string
        payload: any
      }
    }
  }
  parameters: Record<string, any>
  context: {
    userId: string
    sessionId: string
    currentCanvas: any
    timestamp: Date
  }
  priority: number
}

export interface IntelligentChatResponse {
  reply: string
  plan: string[]
  actions: any[]
  thinkingEvents: ThinkingEvent[]
  intent: {
    type: string
    confidence: number
    reasoning: string
  }
  optimizations?: any[]
}

// WebSocket 事件类型
export interface CanvasThinkingEvent {
  type: 'thinking-event'
  payload: ThinkingEvent
}

export interface CanvasOperationEvent {
  type: 'canvas.operation'
  payload: {
    action: string
    parameters: Record<string, any>
    timestamp: number
  }
}

export interface CanvasLayoutEvent {
  type: 'canvas.layout.apply'
  payload: {
    algorithm: string
    options: Record<string, any>
    timestamp: number
  }
}

export interface CanvasOptimizationEvent {
  type: 'canvas.optimization.analyze'
  payload: {
    analysisType: string
    scope: string
    timestamp: number
  }
}

export type CanvasWebSocketEvent =
  | CanvasThinkingEvent
  | CanvasOperationEvent
  | CanvasLayoutEvent
  | CanvasOptimizationEvent

// React Hook 类型
export interface UseIntelligentChatOptions {
  userId: string
  intelligentMode?: boolean
  enableThinking?: boolean
  context?: any
  onThinkingEvent?: (event: ThinkingEvent) => void
  onOperationExecuted?: (operation: CanvasOperation) => void
  onError?: (error: Error) => void
}

export interface UseIntelligentChatReturn {
  messages: IntelligentChatMessage[]
  thinkingEvents: ThinkingEvent[]
  currentPlan?: ExecutionPlan
  isLoading: boolean
  error?: Error
  sendMessage: (message: string, options?: any) => Promise<void>
  clearSession: () => void
  toggleIntelligentMode: () => void
}

export interface IntelligentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  thinkingEvents?: ThinkingEvent[]
  plan?: string[]
  intent?: {
    type: string
    confidence: number
    reasoning: string
  }
  actions?: any[]
}