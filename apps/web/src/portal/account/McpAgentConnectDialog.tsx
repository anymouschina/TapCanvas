import React from 'react'
import { Button, Modal } from '@mantine/core'
import { IconCheck, IconCopy, IconKey } from '@tabler/icons-react'
import { createApiKey } from '../../api/server'
import { toast } from '../../ui/toast'
import { MCP_AGENT_KEY_SCOPES, buildMcpAgentConnectPrompt, buildMcpAgentKeyLabel } from './mcpAgentConnectSupport'
import './McpAgentConnectDialog.css'

type McpAgentConnectDialogProps = {
  opened: boolean
  endpoint: string
  onClose: () => void
}

// A fresh mounted session owns the one-time secret. Closing/unmounting invalidates
// pending requests so a late response cannot expose it in a subsequent session.
export function McpAgentConnectDialog({ opened, ...props }: McpAgentConnectDialogProps): JSX.Element | null {
  return opened ? <McpAgentConnectSession className="mcp-agent-connect-dialog" {...props} /> : null
}

function McpAgentConnectSession({ endpoint, onClose, className }: Omit<McpAgentConnectDialogProps, 'opened'> & { className: string }): JSX.Element {
  const [prompt, setPrompt] = React.useState('')
  const [minting, setMinting] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState('')
  const active = React.useRef(true)
  const inFlight = React.useRef(false)

  React.useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const close = () => {
    active.current = false
    setPrompt('')
    setError('')
    setCopied(false)
    onClose()
  }

  const mint = async () => {
    if (inFlight.current || prompt || !active.current) return
    inFlight.current = true
    setMinting(true)
    setError('')
    try {
      const created = await createApiKey({
        label: buildMcpAgentKeyLabel(new Date()),
        allowedOrigins: ['*'],
        scopes: [...MCP_AGENT_KEY_SCOPES],
      })
      if (!active.current) return
      if (typeof created.key !== 'string' || !created.key.trim()) throw new Error('服务端未返回接入密钥')
      setPrompt(buildMcpAgentConnectPrompt({ endpoint, apiKey: created.key }))
    } catch (reason: unknown) {
      if (active.current) setError(`生成接入密钥失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      inFlight.current = false
      if (active.current) setMinting(false)
    }
  }

  const copy = async () => {
    if (!prompt || copying || !active.current) return
    setCopying(true)
    setError('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不允许直接写入剪贴板，请手动复制提示词')
      await navigator.clipboard.writeText(prompt)
      if (!active.current) return
      setCopied(true)
      toast('含密钥的接入提示词已复制', 'success')
    } catch (reason: unknown) {
      if (active.current) setError(`复制失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (active.current) setCopying(false)
    }
  }

  return (
    <Modal className="mcp-agent-connect-modal" opened onClose={close} closeButtonProps={{ 'aria-label': '关闭 MCP 接入' }} title="通过 AI 助手接入 MCP" size="lg" centered>
      <div className={className} aria-busy={minting || copying}>
        <p className="mcp-agent-connect-dialog__description">
          生成专用密钥和接入提示词，发给你信任的 AI 助手，由它配置 MCP 并调用 ask_tapcanvas 验证连接。
        </p>
        <p className="mcp-agent-connect-dialog__notice">
          提示词含账号凭据，仅本次展示；关闭后清空。请求发出后，关闭弹窗不会撤销已创建的密钥，可在「API 管理」查看并吊销。工具调用按密钥的计费账户扣费。
        </p>
        {prompt ? (
          <section className="mcp-agent-connect-dialog__prompt-section" aria-label="接入提示词（含密钥）">
            <strong className="mcp-agent-connect-dialog__prompt-label">接入提示词（含密钥，只展示这一次）</strong>
            <code className="mcp-agent-connect-dialog__prompt">{prompt}</code>
          </section>
        ) : null}
        {error ? <p className="mcp-agent-connect-dialog__error" role="alert">{error}</p> : null}
        <div className="mcp-agent-connect-dialog__actions">
          {prompt ? (
            <Button
              className="mcp-agent-connect-dialog__button"
              loading={copying}
              leftSection={copied
                ? <IconCheck className="mcp-agent-connect-dialog__icon" size={15} />
                : <IconCopy className="mcp-agent-connect-dialog__icon" size={15} />}
              onClick={() => void copy()}
            >{copied ? '再次复制（含密钥）' : '复制提示词（含密钥）'}</Button>
          ) : (
            <Button
              className="mcp-agent-connect-dialog__button"
              loading={minting}
              leftSection={<IconKey className="mcp-agent-connect-dialog__icon" size={15} />}
              onClick={() => void mint()}
            >{minting ? '正在生成密钥' : '生成密钥和提示词'}</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
