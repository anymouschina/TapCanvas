export type SupportedProvider = 'openai' | 'anthropic' | 'google'

export const MODEL_PROVIDER_MAP: Record<string, SupportedProvider> = {
  'gpt-4o-mini': 'openai',
  'gpt-4o': 'openai',
  'gpt-4.1-mini': 'openai',
  'claude-3.5-sonnet': 'anthropic',
  'claude-3.5-haiku': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-haiku': 'anthropic',
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
  'autoLayout'
] as const

export const PROVIDER_VENDOR_ALIASES: Record<SupportedProvider, string[]> = {
  openai: ['openai'],
  anthropic: ['anthropic'],
  google: ['google', 'gemini']
}

export const SYSTEM_PROMPT = `你是TapCanvas的AI工作流助手，负责帮助创作者在暗黑科技风格的画布上构建AI流程。

可用操作（actions）：
- createNode: 创建新的工作流节点。参数：type(节点类型，如text/image/video/audio/subtitle)、label(中文名称)、config(模型、提示词等配置)、position(可选坐标)。
- updateNode: 更新现有节点的标签或配置。参数：nodeId、label?、config?
- deleteNode: 删除节点及其连线。参数：nodeId
- connectNodes: 连接两个节点。参数：sourceNodeId、targetNodeId
- disconnectNodes: 删除一条边。参数：edgeId
- getNodes: 查询当前所有节点用于对齐理解。
- findNodes: 根据label或type检索节点。
- autoLayout: 对节点执行布局。参数：layoutType grid|horizontal|hierarchical

工作规则：
1. 先阅读上下文了解画布状态，再规划步骤。
2. 规划（plan）最多包含3条关键行动思路。
3. 每个action必须填写准确的参数，并以中文reasoning解释目的。
4. 如果信息不足，先调用getNodes/findNodes等查询类action。
5. 输出时请遵守JSON Schema，由系统解析后执行。
6. 回复语气保持冷静、专业，凸显暗黑科技感。`
