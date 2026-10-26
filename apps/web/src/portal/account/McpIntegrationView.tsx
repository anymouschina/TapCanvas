import { Button } from '@mantine/core'
import { IconApi, IconPlugConnected, IconRobot, IconTerminal2 } from '@tabler/icons-react'
import React from 'react'
import { absoluteApiBase } from '../../api/server'
import { toast } from '../../ui/toast'
import { AccountIntegrationMethod } from './AccountIntegrationMethod'
import { McpAgentConnectDialog } from './McpAgentConnectDialog'
import { buildMcpEndpoint } from './mcpAgentConnectSupport'

export function McpIntegrationView(): JSX.Element {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const endpoint = buildMcpEndpoint(absoluteApiBase(origin))
  const [agentDialogOpen, setAgentDialogOpen] = React.useState(false)
  const command = [
    `claude mcp add --transport http tapcanvas ${endpoint} \\`,
    '  --header "Authorization: Bearer tc_sk_你的Key"',
  ].join('\n')

  const copyCommand = React.useCallback(() => {
    void navigator.clipboard.writeText(command)
      .then(() => toast('MCP 安装命令已复制', 'success'))
      .catch((reason: unknown) => toast(reason instanceof Error ? reason.message : 'MCP 安装命令复制失败', 'error'))
  }, [command])

  return (
    <>
      <div className="account-mcp-agent-action">
        <div className="account-mcp-agent-action__copy">
          <strong className="account-mcp-agent-action__title">通过 AI 助手接入</strong>
          <span className="account-mcp-agent-action__description">生成专用密钥和提示词，交给 Codex、Claude Code、Cursor 等支持 MCP 的助手配置并验证连接。</span>
        </div>
        <Button className="account-mcp-agent-action__button" variant="light" onClick={() => setAgentDialogOpen(true)}>通过 AI 助手接入</Button>
      </div>
      <AccountIntegrationMethod
        icon={IconPlugConnected}
        title="MCP · 让小T成为 AI 客户端的远程工具"
        description="适合 Codex、Claude Code、Cursor 等支持 MCP 的助手。客户端通过标准 Streamable HTTP 发现 ask_tapcanvas 工具，不需要在本机运行 TapCanvas 服务。"
        scenarios={[
          { icon: IconTerminal2, title: 'Claude Code / Cursor', description: '把小T注册为远程 MCP Server，在现有 AI 客户端里直接调用。' },
          { icon: IconRobot, title: '工具式委派', description: '使用 ask_tapcanvas 传入自然语言任务，由小T返回真实执行结果。' },
          { icon: IconApi, title: '可选画布执行', description: '传 canvasProjectId 才解锁对应画布的出图、出视频和节点操作。' },
        ]}
        facts={[
          { label: 'MCP Endpoint', value: endpoint },
          { label: '公开工具', value: 'ask_tapcanvas' },
          { label: '鉴权', value: 'Authorization: Bearer tc_sk_*' },
        ]}
        codeLabel="Claude Code 安装命令"
        codeHint="将 tc_sk_你的Key 替换为拥有 agent:execute 权限的真实密钥"
        codeValue={command}
        copyLabel="复制 MCP 安装命令"
        onCopy={copyCommand}
        docsHref="/docs/mcp"
        docsLabel="查看 MCP 接入文档"
        footnote="Cursor 可使用同一 endpoint 和 Authorization 请求头。"
      />
      <McpAgentConnectDialog opened={agentDialogOpen} endpoint={endpoint} onClose={() => setAgentDialogOpen(false)} />
    </>
  )
}
