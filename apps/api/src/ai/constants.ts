export type SupportedProvider = 'openai' | 'anthropic' | 'google'

export const MODEL_PROVIDER_MAP: Record<string, SupportedProvider> = {
  'gpt-4o-mini': 'openai',
  'gpt-4o': 'openai',
  'gpt-4.1-mini': 'openai',
  'claude-3.5-sonnet': 'anthropic',
  'claude-3.5-haiku': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',
  'glm-4.5': 'anthropic',
  'models/glm-4.5': 'anthropic',
  'glm-4.5-air': 'anthropic',
  'models/glm-4.5-air': 'anthropic',
  'glm-4.6': 'anthropic',
  'models/glm-4.6': 'anthropic',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'models/gemini-3-pro-preview': 'google',
}

export const ACTION_TYPES = [
  'createNode',
  'updateNode',
  'deleteNode',
  'connectNodes',
  'disconnectNodes',
  'getNodes',
  'findNodes',
  'autoLayout',
  'runDag',
  'formatAll'
] as const

export const PROVIDER_VENDOR_ALIASES: Record<SupportedProvider, string[]> = {
  openai: ['openai'],
  anthropic: ['anthropic'],
  google: ['google', 'gemini']
}

export const SYSTEM_PROMPT = `你是TapCanvas的AI工作流助手，负责帮助创作者在暗黑科技风格的画布上构建AI流程。

## 可用操作（actions）
- createNode: { type(text|image|video|audio|subtitle|composeVideo), label?, config?, position? }
- updateNode: { nodeId, label?, config? }
- deleteNode: { nodeId }
- connectNodes: { sourceNodeId, targetNodeId }
- disconnectNodes: { edgeId }
- getNodes: {}
- findNodes: { label?, type? }
- autoLayout: { layoutType: grid|horizontal|hierarchical }
- formatAll: {}  // 全选并自动布局
- runDag: { concurrency?: number }  // 执行工作流

## 输出要求
1. 使用工具调用（tool calls）完成操作，不要直接输出 JSON 结果；用中文简洁说明进展。
2. 无法确定意图时，先调用 getNodes/findNodes/formatAll 等安全工具再继续。
3. 关键节点可在 tool 输入里注明 storeResultAs 便于后续引用。
4. reasoning 简述“为什么做这一步”，语气冷静、专业、暗黑科技感。

牢记：以工具调用驱动工作流，回复应为可读文本 + 流式 tool calls，而非 JSON 块。`
