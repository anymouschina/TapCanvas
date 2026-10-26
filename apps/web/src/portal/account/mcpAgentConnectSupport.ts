import type { ApiKeyScope } from '../../api/server'

// MCP itself needs agent:execute. Its delegated canvas tools also read public
// context/assets and write generated assets, so all three scopes are required.
export const MCP_AGENT_KEY_SCOPES: ApiKeyScope[] = ['public:read', 'public:write', 'agent:execute']

export function buildMcpEndpoint(apiBase: string): string {
  let base = apiBase
  while (base.endsWith('/')) base = base.slice(0, -1)
  return `${base}/public/mcp`
}

export function buildMcpAgentKeyLabel(now: Date): string {
  return `智能体 MCP 接入 ${now.toISOString().slice(0, 16).replace('T', ' ')}`
}

export function buildMcpAgentConnectPrompt(input: { endpoint: string; apiKey: string }): string {
  const { endpoint, apiKey } = input
  return [
    '请把 TapCanvas 小T 接入为你的 MCP 工具，接好后我会用它创作视频。',
    `MCP 地址（Streamable HTTP）：${endpoint}`,
    `鉴权头：Authorization: Bearer ${apiKey}`,
    '工具：ask_tapcanvas（传 canvasProjectId 才会在对应画布出图、出视频，按这把密钥的计费账户扣费）。',
    '请用你自己的 MCP 配置方式完成接入：',
    `- Claude Code：claude mcp add --transport http tapcanvas ${endpoint} --header "Authorization: Bearer ${apiKey}"`,
    `- Codex：把环境变量 TAPCANVAS_TOKEN 设为上面的密钥，再运行 codex mcp add tapcanvas --url ${endpoint} --bearer-token-env-var TAPCANVAS_TOKEN`,
    '- 鲁班、WorkBuddy、Cursor 等支持 MCP 的客户端：使用上面的地址和鉴权头完成连接。',
    '仅将密钥保存到客户端所需的本地安全配置，不要写入项目文件、日志或回复。',
    '接入后调用一次 ask_tapcanvas（message：“你好，请确认连接”），如实告诉我返回结果；调用失败时报告错误，不要声称连接成功。',
  ].join('\n')
}
