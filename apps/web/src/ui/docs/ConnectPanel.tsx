import React from "react"
import {
  Box,
  Stack,
  Title,
  Text,
  Button,
  Group,
  Tabs,
  Alert,
  Badge,
  Loader,
  Anchor,
  Tooltip,
} from "@mantine/core"
import { CodeHighlight } from "@mantine/code-highlight"
import {
  IconPlugConnected,
  IconAlertTriangle,
  IconCircleCheck,
  IconDownload,
  IconRocket,
} from "@tabler/icons-react"
import { absoluteApiBase, createApiKey } from "../../api/server"
import { hasAuthSession } from "../../auth/store"

/**
 * 一键连接智能体面板：登录态点一下 → 后端铸一把 scoped API Key → 给出已填好 Key 的接入物料。
 *
 * 各客户端「集成程度」按真实能力分档（浏览器无法替你在终端跑命令，只有 Cursor 提供深链一键装）：
 *  - Cursor：真·一键——`cursor://…/mcp/install` 深链按钮，点击直接装进 Cursor。
 *  - Claude Code：命令复制(粘贴回车装) + 下载项目级 `.mcp.json`（丢进仓库根目录即自动识别，零终端）。
 *  - Codex CLI：命令复制（`codex mcp add … --bearer-token-env-var`）+ 下载 `config.toml` 片段。
 * Key 由 createApiKey 当场铸出（仅返回一次），不落库前端、只放内存 state。
 */

const KEY_PLACEHOLDER = "tc_sk_你的Key"
const MCP_PATH = "/public/mcp"

function mcpUrl(base: string): string {
  return `${base}${MCP_PATH}`
}

// ── 各客户端物料 ───────────────────────────────────────────────────────────────
function claudeCmd(base: string, key: string): string {
  return `claude mcp add --transport http tapcanvas ${mcpUrl(base)} \\\n  --header "Authorization: Bearer ${key}"`
}
function claudeMcpJson(base: string, key: string): string {
  return JSON.stringify(
    { mcpServers: { tapcanvas: { type: "http", url: mcpUrl(base), headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  )
}
function codexCmd(base: string, key: string): string {
  return `export TAPCANVAS_TOKEN="${key}"\ncodex mcp add tapcanvas --url ${mcpUrl(base)} --bearer-token-env-var TAPCANVAS_TOKEN`
}
function codexToml(base: string): string {
  return `# ~/.codex/config.toml\n[mcp_servers.tapcanvas]\nurl = "${mcpUrl(base)}"\nbearer_token_env_var = "TAPCANVAS_TOKEN"   # 另需: export TAPCANVAS_TOKEN=tc_sk_...`
}
function cursorDeepLink(base: string, key: string): string {
  const cfg = { url: mcpUrl(base), headers: { Authorization: `Bearer ${key}` } }
  // Cursor 深链要求 config 为 base64(JSON)。物料皆 ASCII，btoa 安全。
  const b64 = typeof btoa === "function" ? btoa(JSON.stringify(cfg)) : ""
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=tapcanvas&config=${encodeURIComponent(b64)}`
}
function downloadText(filename: string, content: string, mime = "text/plain"): void {
  try {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    /* 下载失败静默：用户仍可从代码块复制 */
  }
}

export function ConnectPanel({ baseUrl }: { baseUrl: string }): JSX.Element {
  // MCP 端点必须指向 API（VITE_API_BASE）。API_BASE 可能是相对前缀（同源部署的
  // '/api'），而这里的端点是给外部程序用的，必须绝对化 —— 故走 absoluteApiBase。
  const apiBase = absoluteApiBase(baseUrl)
  const [apiKey, setApiKey] = React.useState<string>("")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>("")
  const loggedIn = hasAuthSession()
  const key = apiKey || KEY_PLACEHOLDER
  const minted = Boolean(apiKey)

  const handleConnect = React.useCallback(async () => {
    setError("")
    setLoading(true)
    try {
      const label = `智能体接入 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`
      // MCP 由客户端直接调用且通常无 Origin 头，用 "*"。
      const res = await createApiKey({
        label,
        allowedOrigins: ["*"],
        scopes: ["public:read", "public:write", "agent:execute"],
      })
      setApiKey(res.key)
    } catch (e) {
      const msg = String((e as Error)?.message || e)
      setError(/401|unauthor/i.test(msg) ? "需要先登录 TapCanvas 才能一键生成密钥。" : `生成失败：${msg}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const gateTip = minted ? "" : "请先点上方「生成接入密钥」"

  return (
    <Box id="connect" style={{ scrollMarginTop: 16 }}>
      <Group justify="space-between" align="center" mb={4} wrap="nowrap">
        <Group gap={8} wrap="nowrap">
          <IconPlugConnected size={22} />
          <Title order={3}>一键连接智能体</Title>
        </Group>
        {minted ? (
          <Badge color="green" variant="light" leftSection={<IconCircleCheck size={13} />}>
            密钥已生成
          </Badge>
        ) : null}
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        生成一把仅显示一次的 API Key，然后复制对应 MCP 客户端的安装命令或配置。
      </Text>

      {!minted ? (
        <Group mb="sm" gap="sm">
          <Button
            leftSection={loading ? <Loader size={14} color="white" /> : <IconPlugConnected size={16} />}
            onClick={handleConnect}
            disabled={loading || !loggedIn}
          >
            {loading ? "生成中…" : "生成接入密钥并连接"}
          </Button>
          {!loggedIn ? (
            <Text size="xs" c="dimmed">
              未登录：请先{" "}
              <Anchor href="/" size="xs">
                登录 TapCanvas
              </Anchor>{" "}
              再回到本页，或在控制台「API 管理」手动建 Key。
            </Text>
          ) : null}
        </Group>
      ) : null}

      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="sm" variant="light">
          {error}
        </Alert>
      ) : null}

      {minted ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mb="sm" variant="light">
          这把密钥<strong>只显示这一次</strong>，请立刻用下面的按钮安装或保存。它等同账号凭据，泄露会被盗用扣费——可随时在控制台「API
          管理」吊销。
        </Alert>
      ) : null}

      <Tabs defaultValue="claude" variant="outline">
        <Tabs.List>
          <Tabs.Tab value="claude">Claude Code</Tabs.Tab>
          <Tabs.Tab value="codex">Codex CLI</Tabs.Tab>
          <Tabs.Tab value="cursor">Cursor（一键）</Tabs.Tab>
        </Tabs.List>

        {/* Claude Code：复制命令 / 下载项目级 .mcp.json */}
        <Tabs.Panel value="claude" pt="sm">
          <Text size="sm" mb={6}>
            <strong>方式一</strong>：终端粘贴这行回车即装（默认 local scope）。
          </Text>
          <CodeHighlight code={claudeCmd(apiBase, key)} language="bash" style={{ borderRadius: 8, overflow: "hidden" }} />
          <Text size="sm" mt="sm" mb={6}>
            <strong>方式二（零终端）</strong>：下载 <Text span fw={600}>.mcp.json</Text> 放进你项目根目录，下次在该项目打开
            Claude Code 会提示批准。
          </Text>
          <Tooltip label={gateTip} disabled={minted}>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDownload size={14} />}
              disabled={!minted}
              onClick={() => downloadText(".mcp.json", claudeMcpJson(apiBase, key), "application/json")}
            >
              下载 .mcp.json（项目级）
            </Button>
          </Tooltip>
        </Tabs.Panel>

        {/* Codex CLI：命令(env var bearer) / 下载 config.toml 片段 */}
        <Tabs.Panel value="codex" pt="sm">
          <Text size="sm" mb={6}>
            终端粘贴（密钥走环境变量 <Text span ff="monospace">TAPCANVAS_TOKEN</Text>；想持久化把 export 写进 ~/.zshrc）：
          </Text>
          <CodeHighlight code={codexCmd(apiBase, key)} language="bash" style={{ borderRadius: 8, overflow: "hidden" }} />
          <Text size="sm" mt="sm" mb={6}>
            或手写进 <Text span fw={600}>~/.codex/config.toml</Text>：
          </Text>
          <CodeHighlight code={codexToml(apiBase)} language="toml" style={{ borderRadius: 8, overflow: "hidden" }} />
          <Tooltip label={gateTip} disabled={minted}>
            <Button
              mt="sm"
              size="xs"
              variant="light"
              leftSection={<IconDownload size={14} />}
              disabled={!minted}
              onClick={() => downloadText("tapcanvas.codex.toml", codexToml(apiBase), "text/plain")}
            >
              下载 config.toml 片段
            </Button>
          </Tooltip>
        </Tabs.Panel>

        {/* Cursor：真·一键深链 */}
        <Tabs.Panel value="cursor" pt="sm">
          <Text size="sm" mb={8}>
            Cursor 支持深链一键安装——生成密钥后点下面按钮，Cursor 会弹窗确认并直接装好。
          </Text>
          <Tooltip label={gateTip} disabled={minted}>
            <Button
              component="a"
              href={minted ? cursorDeepLink(apiBase, key) : undefined}
              leftSection={<IconRocket size={16} />}
              color="grape"
              disabled={!minted}
            >
              🚀 一键添加到 Cursor
            </Button>
          </Tooltip>
          <Text size="xs" c="dimmed" mt={8}>
            没反应？把上面 Claude/Codex 的 MCP 配置（url + Authorization 头）手动填进 Cursor 的 mcp.json 也一样。
          </Text>
        </Tabs.Panel>
      </Tabs>
    </Box>
  )
}

export default ConnectPanel
