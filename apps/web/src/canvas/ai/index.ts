/**
 * AI助手模块统一导出
 */

export { AICanvasTools, aiCanvasTools } from './tools'
export { AIAssistant, aiAssistant } from './aiAssistant'
export type { AIMessage, ToolCall, ChatOptions } from './aiAssistant'
export type {
  AddNodeToolParams,
  EditNodeToolParams,
  DeleteNodeToolParams,
  ConnectNodesToolParams,
  FindNodesToolParams,
  GetCanvasInfoToolParams,
  ToolResult
} from './tools'
export { default as AIAssistantPanel } from './AIAssistantPanel'