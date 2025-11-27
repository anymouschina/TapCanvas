/**
 * TapCanvas 智能系统核心类型定义
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

export interface CanvasCapability {
  domain: CanvasActionDomain
  name: string
  description: string

  operationModes: OperationMode[]
  intentPatterns: IntentPattern[]
  webActions: WebActionMapping

  prerequisites?: string[]
  sideEffects?: string[]
}

export interface OperationMode {
  type: 'direct' | 'batch' | 'conditional' | 'iterative'
  description: string
  parameters: ParameterSchema[]
}

export interface ParameterSchema {
  name: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object'
  required?: boolean
  default?: any
  options?: string[]
  description?: string
}

export interface IntentPattern {
  patterns: string[]
  confidence: number
  context?: string[]
  examples?: string[]
}

export interface WebActionMapping {
  frontendFunction?: string
  eventType?: string
  apiCall?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE'
    endpoint: string
    payload: any
  }
  socketMessage?: {
    channel: string
    payload: any
  }
  urlState?: {
    pathname?: string
    params?: Record<string, string>
    hash?: string
  }
}

export interface ParsedCanvasIntent {
  type: CanvasActionDomain
  capabilityName?: string
  confidence: number
  entities: Record<string, any>
  rawText: string
  extractedParams: Record<string, any>
  reasoning: string
  planSteps: string[]
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
  operation?: CanvasOperation
  reasoning: string
  estimatedTime?: number
  dependencies?: string[]
  result?: any
  error?: string
  acceptanceCriteria?: string[]
}

export interface ExecutionPlan {
  id: string
  strategy: ExecutionStrategy
  steps: ExecutionStep[]
  dependencies: DependencyGraph
  parallelGroups: ParallelGroup[]
  risks: ExecutionRisk[]
  estimatedTime: number
  estimatedCost: number
  rollbackPlan: RollbackPlan
}

export interface ExecutionStrategy {
  name: string
  description: string
  efficiency: 'low' | 'medium' | 'high' | 'very_high'
  risk: 'low' | 'medium' | 'high'
  reasoning: string
}

export interface DependencyGraph {
  nodes: string[]
  edges: Array<{source: string, target: string}>
}

export interface ParallelGroup {
  id: string
  name: string
  steps: string[]
  reason: string
}

export interface ExecutionRisk {
  level: 'low' | 'medium' | 'high'
  description: string
  mitigation: string
  probability: number
}

export interface RollbackPlan {
  possible: boolean
  steps: Array<{description: string, revertFunction: string}>
}

export interface CanvasOperation {
  id: string
  planStepId?: string
  capability: CanvasCapability
  parameters: Record<string, any>
  context: ExecutionContext
  priority: number
}

export interface ExecutionContext {
  userId: string
  canvasId?: string
  sessionId: string
  currentCanvas: any
  userHistory?: any
  timestamp: Date
}

export interface ExecutionResult {
  success: boolean
  operation: CanvasOperation
  result?: any
  error?: string
  duration: number
  affectedElements?: string[]
  sideEffects?: string[]
}
