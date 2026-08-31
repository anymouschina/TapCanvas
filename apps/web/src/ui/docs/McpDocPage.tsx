import { Box, Code, List, Stack, Text, Title } from '@mantine/core'
import { IconBook2 } from '@tabler/icons-react'
import { ConnectPanel } from './ConnectPanel'
import './McpDocPage.css'

export function McpDocPage(): JSX.Element {
  const baseUrl = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <Box className="mcp-doc-page">
      <Stack className="mcp-doc-page__content" gap="xl">
        <header className="mcp-doc-page__header">
          <IconBook2 className="mcp-doc-page__icon" size={22} />
          <div className="mcp-doc-page__heading">
            <Title className="mcp-doc-page__title" order={2}>TapCanvas MCP 接入</Title>
            <Text className="mcp-doc-page__description" size="sm" c="dimmed">
              外部 AI 客户端统一通过 MCP Streamable HTTP 调用小T，不再提供平行的 Agent 接入协议。
            </Text>
          </div>
        </header>

        <ConnectPanel baseUrl={baseUrl} />

        <section className="mcp-doc-page__section" aria-labelledby="mcp-contract-title">
          <Title className="mcp-doc-page__section-title" id="mcp-contract-title" order={3}>协议合同</Title>
          <List className="mcp-doc-page__list" size="sm" spacing="xs">
            <List.Item className="mcp-doc-page__item">Endpoint：<Code className="mcp-doc-page__code">/public/mcp</Code></List.Item>
            <List.Item className="mcp-doc-page__item">Transport：MCP Streamable HTTP，JSON-RPC 请求与响应</List.Item>
            <List.Item className="mcp-doc-page__item">鉴权：<Code className="mcp-doc-page__code">Authorization: Bearer tc_sk_*</Code></List.Item>
            <List.Item className="mcp-doc-page__item">公开工具：<Code className="mcp-doc-page__code">ask_tapcanvas</Code></List.Item>
          </List>
        </section>

        <section className="mcp-doc-page__section" aria-labelledby="mcp-failure-title">
          <Title className="mcp-doc-page__section-title" id="mcp-failure-title" order={3}>失败语义</Title>
          <Text className="mcp-doc-page__text" size="sm">
            MCP 只负责协议适配；权限、模型调用、工具执行和交付校验仍由 TapCanvas 的统一 Agents
            对话链路处理。关键输入缺失或执行失败会原样返回，不做隐式协议回退或模型降级。
          </Text>
        </section>
      </Stack>
    </Box>
  )
}

export default McpDocPage
