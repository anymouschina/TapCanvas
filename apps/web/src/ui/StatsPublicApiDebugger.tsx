import React from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Paper, Select, Stack, Switch, Text, Textarea, TextInput, Tooltip, type SelectProps } from '@mantine/core'
import { IconEye, IconEyeOff, IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons-react'
import { toast } from './toast'

export type PublicApiDebuggerEndpoints = {
  chat: string
  draw: string
  video: string
  taskResult: string
}

type DebugEndpointKind = keyof PublicApiDebuggerEndpoints

const API_KEY_STORAGE_KEY = 'tapcanvas_public_api_debug_key'

function readStoredApiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.sessionStorage.getItem(API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeStoredApiKey(next: string) {
  if (typeof window === 'undefined') return
  try {
    if (next) window.sessionStorage.setItem(API_KEY_STORAGE_KEY, next)
    else window.sessionStorage.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function templateFor(kind: DebugEndpointKind): unknown {
  if (kind === 'draw') {
    return {
      vendor: 'auto',
      prompt: '一个赛博风格的透明玻璃徽章，中文“TapCanvas”，高细节，干净背景',
      extras: { modelKey: 'nano-banana-pro' },
    }
  }
  if (kind === 'video') {
    return {
      vendor: 'auto',
      prompt: '一只白猫在雨夜霓虹街头慢慢走过，电影感镜头，稳定光影',
      durationSeconds: 10,
      extras: { modelKey: 'veo3.1-fast' },
    }
  }
  if (kind === 'taskResult') {
    return {
      taskId: '<TASK_ID>',
      taskKind: 'text_to_video',
    }
  }
  return {
    vendor: 'auto',
    prompt: '你好，帮我用中文回答：TapCanvas 是什么？',
  }
}

function prettyJson(text: string): string {
  const raw = String(text || '')
  if (!raw.trim()) return raw
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export default function StatsPublicApiDebugger({
  className,
  endpoints,
}: {
  className?: string
  endpoints: PublicApiDebuggerEndpoints
}): JSX.Element {
  const rootClassName = ['stats-public-debugger', className].filter(Boolean).join(' ')

  const [enabled, setEnabled] = React.useState(false)
  const [apiKey, setApiKey] = React.useState(() => readStoredApiKey())
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false)
  const [endpointKind, setEndpointKind] = React.useState<DebugEndpointKind>('draw')
  const [bodyText, setBodyText] = React.useState(() => JSON.stringify(templateFor('draw'), null, 2))
  const [loading, setLoading] = React.useState(false)
  const [responseText, setResponseText] = React.useState<string>('')
  const [responseMeta, setResponseMeta] = React.useState<{ status: number; ok: boolean; tookMs: number } | null>(null)

  React.useEffect(() => {
    writeStoredApiKey(apiKey.trim())
  }, [apiKey])

  const endpointOptions = React.useMemo<SelectProps['data']>(
    () => [
      { value: 'draw', label: '绘图 /public/draw' },
      { value: 'video', label: '视频 /public/video' },
      { value: 'taskResult', label: '查任务 /public/tasks/result' },
      { value: 'chat', label: '文本 /public/chat' },
    ],
    [],
  )

  const currentUrl = endpoints[endpointKind]

  const resetTemplate = React.useCallback(() => {
    setBodyText(JSON.stringify(templateFor(endpointKind), null, 2))
    toast('已重置模板', 'success')
  }, [endpointKind])

  const clearKey = React.useCallback(() => {
    setApiKey('')
    toast('已清除 Key', 'success')
  }, [])

  const send = React.useCallback(async () => {
    const key = apiKey.trim()
    if (!key) {
      toast('请先填写 X-API-Key', 'error')
      return
    }
    let body: any
    try {
      body = JSON.parse(bodyText)
    } catch {
      toast('请求体不是合法 JSON', 'error')
      return
    }

    setLoading(true)
    setResponseText('')
    setResponseMeta(null)
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    try {
      const res = await fetch(currentUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      const tookMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      setResponseMeta({ status: res.status, ok: res.ok, tookMs })
      setResponseText(prettyJson(text))
      if (!res.ok) toast(`请求失败：${res.status}`, 'error')
    } catch (err: any) {
      const tookMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)
      setResponseMeta({ status: 0, ok: false, tookMs })
      setResponseText(String(err?.message || err || 'request failed'))
      toast(err?.message || '请求失败（网络或 CORS）', 'error')
    } finally {
      setLoading(false)
    }
  }, [apiKey, bodyText, currentUrl])

  return (
    <Paper className={rootClassName} withBorder radius="lg" p="md">
      <Group className="stats-public-debugger-header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group className="stats-public-debugger-header-left" gap={8} align="center">
          <Text className="stats-public-debugger-title" fw={700} size="sm">
            在线调试
          </Text>
          <Badge className="stats-public-debugger-badge" size="xs" variant="light">
            x-api-key
          </Badge>
        </Group>
        <Switch
          className="stats-public-debugger-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          label="开启"
        />
      </Group>

      <Divider className="stats-public-debugger-divider" my="sm" />

      {!enabled ? (
        <Text className="stats-public-debugger-hint" size="sm" c="dimmed">
          打开开关后可直接在页面内携带 Key 调试 /public 接口；Key 会保存在当前标签页的 sessionStorage，并作为请求头发送。
        </Text>
      ) : (
        <Stack className="stats-public-debugger-body" gap="sm">
          <Group className="stats-public-debugger-key-row" gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              className="stats-public-debugger-key"
              label="X-API-Key"
              placeholder="粘贴你的 key…"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              type={apiKeyVisible ? 'text' : 'password'}
              w={420}
              rightSection={
                <Tooltip className="stats-public-debugger-key-visibility-tooltip" label={apiKeyVisible ? '隐藏' : '显示'} withArrow>
                  <ActionIcon
                    className="stats-public-debugger-key-visibility"
                    size="sm"
                    variant="subtle"
                    aria-label="toggle-key-visibility"
                    onClick={() => setApiKeyVisible((v) => !v)}
                  >
                    {apiKeyVisible ? (
                      <IconEyeOff className="stats-public-debugger-key-visibility-icon" size={16} />
                    ) : (
                      <IconEye className="stats-public-debugger-key-visibility-icon" size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
              }
            />

            <Tooltip className="stats-public-debugger-key-clear-tooltip" label="清除 Key" withArrow>
              <ActionIcon
                className="stats-public-debugger-key-clear"
                size="md"
                variant="light"
                aria-label="clear-key"
                onClick={clearKey}
                disabled={!apiKey}
              >
                <IconTrash className="stats-public-debugger-key-clear-icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          <Group className="stats-public-debugger-endpoint-row" gap="sm" align="flex-end" wrap="wrap">
            <Select
              className="stats-public-debugger-endpoint"
              label="接口"
              data={endpointOptions}
              value={endpointKind}
              onChange={(v) => {
                const next = (v as DebugEndpointKind) || 'draw'
                setEndpointKind(next)
              }}
              w={260}
            />
            <Stack className="stats-public-debugger-endpoint-meta" gap={2}>
              <Text className="stats-public-debugger-endpoint-label" size="xs" c="dimmed">
                URL
              </Text>
              <Text className="stats-public-debugger-endpoint-url" size="sm" style={{ wordBreak: 'break-all' }}>
                {currentUrl}
              </Text>
            </Stack>
          </Group>

          <Textarea
            className="stats-public-debugger-request"
            label="请求 JSON"
            value={bodyText}
            onChange={(e) => setBodyText(e.currentTarget.value)}
            minRows={8}
            autosize
            styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' } }}
          />

          <Group className="stats-public-debugger-actions" gap={8} justify="flex-start" wrap="wrap">
            <Button
              className="stats-public-debugger-send"
              size="sm"
              variant="light"
              onClick={() => void send()}
              loading={loading}
              leftSection={<IconPlayerPlay className="stats-public-debugger-send-icon" size={14} />}
            >
              发送请求
            </Button>
            <Button
              className="stats-public-debugger-reset"
              size="sm"
              variant="subtle"
              onClick={resetTemplate}
              leftSection={<IconRefresh className="stats-public-debugger-reset-icon" size={14} />}
              disabled={loading}
            >
              重置模板
            </Button>
          </Group>

          <Stack className="stats-public-debugger-response" gap={6}>
            <Group className="stats-public-debugger-response-header" justify="space-between" align="center" wrap="wrap">
              <Text className="stats-public-debugger-response-title" size="sm" fw={700}>
                响应
              </Text>
              {responseMeta && (
                <Group className="stats-public-debugger-response-meta" gap={10} wrap="wrap">
                  <Badge className="stats-public-debugger-response-status" size="sm" variant="light" color={responseMeta.ok ? 'green' : 'red'}>
                    {responseMeta.status || 'ERR'}
                  </Badge>
                  <Text className="stats-public-debugger-response-timing" size="xs" c="dimmed">
                    {responseMeta.tookMs}ms
                  </Text>
                </Group>
              )}
            </Group>
            <pre
              className="stats-public-debugger-response-pre"
              style={{ margin: 0, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.18)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              <code className="stats-public-debugger-response-code">{responseText || (loading ? '请求中…' : '—')}</code>
            </pre>
          </Stack>
        </Stack>
      )}
    </Paper>
  )
}
