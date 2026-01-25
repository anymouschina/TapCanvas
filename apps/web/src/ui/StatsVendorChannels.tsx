import React from 'react'
import { ActionIcon, Badge, Button, Divider, Group, Loader, MultiSelect, Stack, Switch, Text, TextInput, Title, Tooltip } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { APIMART_PROXY_DEFAULT_HOST, APIMART_PROXY_VENDOR } from '../constants/apimart'
import { COMFLY_PROXY_DEFAULT_HOST, COMFLY_PROXY_VENDOR } from '../constants/comfly'
import { GRSAI_PROXY_VENDOR } from '../constants/grsai'
import { getProxyConfig, upsertProxyConfig, type ProxyConfigDto } from '../api/server'
import { toast } from './toast'

const TARGET_OPTIONS = [
  { value: 'sora2api', label: 'Sora2 / 视频（sora2api）' },
  { value: 'veo', label: 'Veo 视频（veo）' },
  { value: 'gemini', label: 'Nano Banana 图片（gemini）' },
  { value: 'minimax', label: 'Hailuo / MiniMax（minimax）' },
]

function normalizeVendorList(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : []
  return Array.from(new Set(arr.map((v) => String(v || '').trim()).filter(Boolean)))
}

function buildProxyPayload(params: {
  baseUrl: string
  enabled: boolean
  enabledVendors: string[]
  apiKey: string
  apiKeyTouched: boolean
  name: string
}): Parameters<typeof upsertProxyConfig>[1] {
  const payload: any = {
    name: params.name,
    baseUrl: params.baseUrl,
    enabled: params.enabled,
    enabledVendors: params.enabledVendors,
  }
  if (params.apiKeyTouched) payload.apiKey = params.apiKey
  return payload
}

export default function StatsVendorChannels({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-vendor-channels', className].filter(Boolean).join(' ')

  const [loading, setLoading] = React.useState(false)
  const loadingRef = React.useRef(false)

  const [grsaiCfg, setGrsaiCfg] = React.useState<ProxyConfigDto | null>(null)
  const [grsaiHost, setGrsaiHost] = React.useState('https://api.grsai.com')
  const [grsaiEnabled, setGrsaiEnabled] = React.useState(false)
  const [grsaiEnabledVendors, setGrsaiEnabledVendors] = React.useState<string[]>(['veo', 'gemini', 'sora2api'])
  const [grsaiApiKey, setGrsaiApiKey] = React.useState('')
  const [grsaiApiKeyTouched, setGrsaiApiKeyTouched] = React.useState(false)
  const [grsaiSaving, setGrsaiSaving] = React.useState(false)

  const [comflyCfg, setComflyCfg] = React.useState<ProxyConfigDto | null>(null)
  const [comflyHost, setComflyHost] = React.useState(COMFLY_PROXY_DEFAULT_HOST)
  const [comflyEnabled, setComflyEnabled] = React.useState(false)
  const [comflyEnabledVendors, setComflyEnabledVendors] = React.useState<string[]>(['veo', 'gemini', 'sora2api'])
  const [comflyApiKey, setComflyApiKey] = React.useState('')
  const [comflyApiKeyTouched, setComflyApiKeyTouched] = React.useState(false)
  const [comflySaving, setComflySaving] = React.useState(false)

  const [apimartCfg, setApimartCfg] = React.useState<ProxyConfigDto | null>(null)
  const [apimartHost, setApimartHost] = React.useState(APIMART_PROXY_DEFAULT_HOST)
  const [apimartEnabled, setApimartEnabled] = React.useState(false)
  const [apimartEnabledVendors, setApimartEnabledVendors] = React.useState<string[]>(['sora2api', 'gemini'])
  const [apimartApiKey, setApimartApiKey] = React.useState('')
  const [apimartApiKeyTouched, setApimartApiKeyTouched] = React.useState(false)
  const [apimartSaving, setApimartSaving] = React.useState(false)

  const syncFromCfg = React.useCallback((vendor: 'grsai' | 'comfly' | 'apimart', cfg: ProxyConfigDto | null) => {
    if (vendor === 'grsai') {
      setGrsaiCfg(cfg)
      setGrsaiHost((cfg?.baseUrl || '').trim() || 'https://api.grsai.com')
      setGrsaiEnabled(!!cfg?.enabled)
      setGrsaiEnabledVendors(normalizeVendorList(cfg?.enabledVendors))
      setGrsaiApiKey('')
      setGrsaiApiKeyTouched(false)
      return
    }
    if (vendor === 'comfly') {
      setComflyCfg(cfg)
      setComflyHost((cfg?.baseUrl || '').trim() || COMFLY_PROXY_DEFAULT_HOST)
      setComflyEnabled(!!cfg?.enabled)
      setComflyEnabledVendors(normalizeVendorList(cfg?.enabledVendors))
      setComflyApiKey('')
      setComflyApiKeyTouched(false)
      return
    }
    setApimartCfg(cfg)
    setApimartHost((cfg?.baseUrl || '').trim() || APIMART_PROXY_DEFAULT_HOST)
    setApimartEnabled(!!cfg?.enabled)
    setApimartEnabledVendors(normalizeVendorList(cfg?.enabledVendors))
    setApimartApiKey('')
    setApimartApiKeyTouched(false)
  }, [])

  const reload = React.useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const [grsai, comfly, apimart] = await Promise.allSettled([
        getProxyConfig(GRSAI_PROXY_VENDOR),
        getProxyConfig(COMFLY_PROXY_VENDOR),
        getProxyConfig(APIMART_PROXY_VENDOR),
      ])
      if (grsai.status === 'fulfilled') {
        syncFromCfg('grsai', grsai.value)
      } else {
        console.warn('load grsai proxy failed', grsai.reason)
        syncFromCfg('grsai', null)
      }
      if (comfly.status === 'fulfilled') {
        syncFromCfg('comfly', comfly.value)
      } else {
        console.warn('load comfly proxy failed', comfly.reason)
        syncFromCfg('comfly', null)
      }
      if (apimart.status === 'fulfilled') {
        syncFromCfg('apimart', apimart.value)
      } else {
        console.warn('load apimart proxy failed', apimart.reason)
        syncFromCfg('apimart', null)
      }
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [syncFromCfg])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const saveGrsai = async () => {
    if (grsaiSaving) return
    const baseUrl = grsaiHost.trim()
    if (!baseUrl) {
      toast('请填写 grsai Host', 'error')
      return
    }
    const enabledVendors = normalizeVendorList(grsaiEnabledVendors)
    setGrsaiSaving(true)
    try {
      const payload = buildProxyPayload({
        name: 'grsai',
        baseUrl,
        enabled: grsaiEnabled,
        enabledVendors,
        apiKey: grsaiApiKey.trim(),
        apiKeyTouched: grsaiApiKeyTouched,
      })
      const saved = await upsertProxyConfig(GRSAI_PROXY_VENDOR, payload)
      syncFromCfg('grsai', saved)
      toast('已保存 grsai 配置', 'success')
    } catch (err: any) {
      console.error('save grsai proxy failed', err)
      toast(err?.message || '保存 grsai 配置失败', 'error')
    } finally {
      setGrsaiSaving(false)
    }
  }

  const saveComfly = async () => {
    if (comflySaving) return
    const baseUrl = comflyHost.trim()
    if (!baseUrl) {
      toast('请填写 comfly Host', 'error')
      return
    }
    const enabledVendors = normalizeVendorList(comflyEnabledVendors)
    setComflySaving(true)
    try {
      const payload = buildProxyPayload({
        name: 'comfly',
        baseUrl,
        enabled: comflyEnabled,
        enabledVendors,
        apiKey: comflyApiKey.trim(),
        apiKeyTouched: comflyApiKeyTouched,
      })
      const saved = await upsertProxyConfig(COMFLY_PROXY_VENDOR, payload)
      syncFromCfg('comfly', saved)
      toast('已保存 comfly 配置', 'success')
    } catch (err: any) {
      console.error('save comfly proxy failed', err)
      toast(err?.message || '保存 comfly 配置失败', 'error')
    } finally {
      setComflySaving(false)
    }
  }

  const saveApimart = async () => {
    if (apimartSaving) return
    const baseUrl = apimartHost.trim()
    if (!baseUrl) {
      toast('请填写 apimart Host', 'error')
      return
    }
    const enabledVendors = normalizeVendorList(apimartEnabledVendors)
    setApimartSaving(true)
    try {
      const payload = buildProxyPayload({
        name: 'apimart',
        baseUrl,
        enabled: apimartEnabled,
        enabledVendors,
        apiKey: apimartApiKey.trim(),
        apiKeyTouched: apimartApiKeyTouched,
      })
      const saved = await upsertProxyConfig(APIMART_PROXY_VENDOR, payload)
      syncFromCfg('apimart', saved)
      toast('已保存 apimart 配置', 'success')
    } catch (err: any) {
      console.error('save apimart proxy failed', err)
      toast(err?.message || '保存 apimart 配置失败', 'error')
    } finally {
      setApimartSaving(false)
    }
  }

  return (
    <Stack className={rootClassName} gap="sm">
      <Group className="stats-vendor-channels-header" justify="space-between" align="center" wrap="wrap" gap="xs">
        <div className="stats-vendor-channels-header-left">
          <Title className="stats-vendor-channels-title" order={5}>三方渠道配置</Title>
          <Text className="stats-vendor-channels-subtitle" size="xs" c="dimmed">
            管理 grsai/comfly/apimart 的 Host 与 API Key；外站调用会按成功率优先选择可用渠道。
          </Text>
        </div>
        <Tooltip className="stats-vendor-channels-reload-tooltip" label="刷新渠道配置" withArrow>
          <ActionIcon
            className="stats-vendor-channels-reload"
            size="sm"
            variant="subtle"
            aria-label="刷新渠道配置"
            onClick={() => void reload()}
            loading={loading}
          >
            <IconRefresh className="stats-vendor-channels-reload-icon" size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Divider className="stats-vendor-channels-divider" label="grsai" labelPosition="left" />
      <Stack className="stats-vendor-channels-grsai" gap="xs">
        <Group className="stats-vendor-channels-row" gap="sm" align="flex-start" wrap="wrap">
          <TextInput
            className="stats-vendor-channels-host"
            label="Host"
            value={grsaiHost}
            onChange={(e) => setGrsaiHost(e.currentTarget.value)}
            placeholder="https://api.grsai.com"
            w={360}
          />
          <Switch
            className="stats-vendor-channels-enabled"
            checked={grsaiEnabled}
            onChange={(e) => setGrsaiEnabled(e.currentTarget.checked)}
            label="启用"
            mt={26}
          />
          <Group className="stats-vendor-channels-badges" gap={6} mt={26}>
            {grsaiCfg?.hasApiKey ? (
              <Badge className="stats-vendor-channels-badge" size="xs" color="green" variant="light">已配置 Key</Badge>
            ) : (
              <Badge className="stats-vendor-channels-badge" size="xs" color="red" variant="light">未配置 Key</Badge>
            )}
          </Group>
          <Button
            className="stats-vendor-channels-save"
            size="sm"
            variant="light"
            mt={22}
            loading={grsaiSaving}
            onClick={() => void saveGrsai()}
            leftSection={grsaiSaving ? <Loader className="stats-vendor-channels-save-loader" size="xs" /> : undefined}
          >
            保存
          </Button>
        </Group>
        <MultiSelect
          className="stats-vendor-channels-vendors"
          label="代理能力（enabledVendors）"
          data={TARGET_OPTIONS}
          value={grsaiEnabledVendors}
          onChange={setGrsaiEnabledVendors}
          searchable
          clearable
          placeholder="选择该渠道可代理的厂商"
        />
        <TextInput
          className="stats-vendor-channels-api-key"
          label="API Key"
          type="password"
          value={grsaiApiKey}
          onChange={(e) => {
            setGrsaiApiKeyTouched(true)
            setGrsaiApiKey(e.currentTarget.value)
          }}
          placeholder={grsaiCfg?.hasApiKey ? '留空则不修改已保存的 Key' : '粘贴 grsai 提供的 API Key'}
        />
      </Stack>

      <Divider className="stats-vendor-channels-divider" label="apimart" labelPosition="left" />
      <Stack className="stats-vendor-channels-apimart" gap="xs">
        <Group className="stats-vendor-channels-row" gap="sm" align="flex-start" wrap="wrap">
          <TextInput
            className="stats-vendor-channels-host"
            label="Host"
            value={apimartHost}
            onChange={(e) => setApimartHost(e.currentTarget.value)}
            placeholder={APIMART_PROXY_DEFAULT_HOST}
            w={360}
          />
          <Switch
            className="stats-vendor-channels-enabled"
            checked={apimartEnabled}
            onChange={(e) => setApimartEnabled(e.currentTarget.checked)}
            label="启用"
            mt={26}
          />
          <Group className="stats-vendor-channels-badges" gap={6} mt={26}>
            {apimartCfg?.hasApiKey ? (
              <Badge className="stats-vendor-channels-badge" size="xs" color="green" variant="light">已配置 Key</Badge>
            ) : (
              <Badge className="stats-vendor-channels-badge" size="xs" color="red" variant="light">未配置 Key</Badge>
            )}
          </Group>
          <Button
            className="stats-vendor-channels-save"
            size="sm"
            variant="light"
            mt={22}
            loading={apimartSaving}
            onClick={() => void saveApimart()}
            leftSection={apimartSaving ? <Loader className="stats-vendor-channels-save-loader" size="xs" /> : undefined}
          >
            保存
          </Button>
        </Group>
        <MultiSelect
          className="stats-vendor-channels-vendors"
          label="代理能力（enabledVendors）"
          data={TARGET_OPTIONS}
          value={apimartEnabledVendors}
          onChange={setApimartEnabledVendors}
          searchable
          clearable
          placeholder="选择该渠道可代理的厂商"
        />
        <TextInput
          className="stats-vendor-channels-api-key"
          label="API Key"
          value={apimartApiKey}
          placeholder={apimartCfg?.hasApiKey ? '留空则不修改已保存的 Key' : '粘贴 apimart 提供的 API Key'}
          onChange={(e) => {
            setApimartApiKey(e.currentTarget.value)
            setApimartApiKeyTouched(true)
          }}
          type="password"
        />
      </Stack>

      <Divider className="stats-vendor-channels-divider" label="comfly" labelPosition="left" />
      <Stack className="stats-vendor-channels-comfly" gap="xs">
        <Group className="stats-vendor-channels-row" gap="sm" align="flex-start" wrap="wrap">
          <TextInput
            className="stats-vendor-channels-host"
            label="Host"
            value={comflyHost}
            onChange={(e) => setComflyHost(e.currentTarget.value)}
            placeholder={COMFLY_PROXY_DEFAULT_HOST}
            w={360}
          />
          <Switch
            className="stats-vendor-channels-enabled"
            checked={comflyEnabled}
            onChange={(e) => setComflyEnabled(e.currentTarget.checked)}
            label="启用"
            mt={26}
          />
          <Group className="stats-vendor-channels-badges" gap={6} mt={26}>
            {comflyCfg?.hasApiKey ? (
              <Badge className="stats-vendor-channels-badge" size="xs" color="green" variant="light">已配置 Key</Badge>
            ) : (
              <Badge className="stats-vendor-channels-badge" size="xs" color="red" variant="light">未配置 Key</Badge>
            )}
          </Group>
          <Button
            className="stats-vendor-channels-save"
            size="sm"
            variant="light"
            mt={22}
            loading={comflySaving}
            onClick={() => void saveComfly()}
            leftSection={comflySaving ? <Loader className="stats-vendor-channels-save-loader" size="xs" /> : undefined}
          >
            保存
          </Button>
        </Group>
        <MultiSelect
          className="stats-vendor-channels-vendors"
          label="代理能力（enabledVendors）"
          data={TARGET_OPTIONS}
          value={comflyEnabledVendors}
          onChange={setComflyEnabledVendors}
          searchable
          clearable
          placeholder="选择该渠道可代理的厂商"
        />
        <TextInput
          className="stats-vendor-channels-api-key"
          label="API Key"
          type="password"
          value={comflyApiKey}
          onChange={(e) => {
            setComflyApiKeyTouched(true)
            setComflyApiKey(e.currentTarget.value)
          }}
          placeholder={comflyCfg?.hasApiKey ? '留空则不修改已保存的 Key' : '粘贴 comfly 提供的 API Key'}
        />
      </Stack>
    </Stack>
  )
}
