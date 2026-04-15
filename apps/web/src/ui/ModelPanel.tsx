import React from 'react'
import { ActionIcon, Button, Checkbox, Divider, Group, Paper, PasswordInput, Stack, Switch, Text, Title, Tooltip, Transition } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRestore } from '@tabler/icons-react'
import { PanelCard } from './PanelCard'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { stopPanelWheelPropagation } from './utils/panelWheel'

type VendorOption = { value: string; label: string; description: string }

const DEFAULT_ENABLED_VENDORS: VendorOption[] = [
  { value: 'openai', label: 'OpenAI', description: 'GPT / 图像理解 / 图像编辑 等' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude / GLM（Claude 兼容）等' },
  { value: 'gemini', label: 'Gemini', description: 'Nano Banana / Imagen 等' },
  { value: 'qwen', label: 'Qwen', description: '绘图（严格像素宽高常用）' },
  { value: 'veo', label: 'Veo', description: '视频生成' },
]

const normalizeApiKey = (value: string): string => String(value || '').trim()

export default function ModelPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const mounted = active === 'models'

  const [saving, setSaving] = React.useState(false)
  const storedApiKey = useUIStore((s) => s.publicApiKey)
  const setStoredApiKey = useUIStore((s) => s.setPublicApiKey)
  const storedVendorCandidates = useUIStore((s) => s.publicVendorCandidates)
  const setStoredVendorCandidates = useUIStore((s) => s.setPublicVendorCandidates)

  const [enabled, setEnabled] = React.useState(true)
  const [vendorCandidates, setVendorCandidates] = React.useState<string[]>([])
  const [apiKey, setApiKey] = React.useState('')
  const [apiKeyVisible, setApiKeyVisible] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!mounted) return
    setEnabled(true)
    setVendorCandidates(Array.isArray(storedVendorCandidates) ? storedVendorCandidates : [])
    setApiKey(storedApiKey || '')
    setError(null)
  }, [mounted, storedApiKey, storedVendorCandidates])

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      if (enabled) {
        const normalizedKey = normalizeApiKey(apiKey)
        if (!normalizedKey) throw new Error('请填写 API Key')
        setStoredApiKey(normalizedKey)
        setStoredVendorCandidates(vendorCandidates)
      } else {
        setStoredApiKey('')
        setStoredVendorCandidates([])
      }

      notifications.show({ title: '已保存', message: '模型配置已更新', color: 'teal' })
    } catch (err: any) {
      const msg = err?.message || '保存失败'
      setError(msg)
      notifications.show({ title: '保存失败', message: msg, color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [apiKey, enabled, setStoredApiKey, setStoredVendorCandidates, vendorCandidates])

  const toggleVendor = React.useCallback((vendor: string, nextChecked: boolean) => {
    setVendorCandidates((prev) => {
      const set = new Set(prev)
      if (nextChecked) set.add(vendor)
      else set.delete(vendor)
      return Array.from(set)
    })
  }, [])

  const selectAll = React.useCallback(() => {
    setVendorCandidates(DEFAULT_ENABLED_VENDORS.map((v) => v.value))
  }, [])

  const clearAll = React.useCallback(() => {
    setVendorCandidates([])
  }, [])

  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 120)
  const apiKeyHint = 'API Key（保存到本地 localStorage）'

  return (
    <div className="tc-model-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 160 : 140, zIndex: 200 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="tc-model-panel-transition" style={styles}>
            <PanelCard
              className="glass"
              style={{
                width: 360,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transformOrigin: 'left center',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="tc-model-panel-arrow panel-arrow" />
              <div className="tc-model-panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
                <Group className="tc-model-panel-header" justify="space-between" align="center" wrap="nowrap" mb={6}>
                  <div className="tc-model-panel-header-left">
                    <Title className="tc-model-panel-title" order={6}>
                      模型设置
                    </Title>
                    <Text className="tc-model-panel-subtitle" size="xs" c="dimmed">
                      配置画布调用参数（可选）。
                    </Text>
                  </div>
                  <Group className="tc-model-panel-header-actions" gap={6} wrap="nowrap">
                    <Tooltip label="关闭" withArrow>
                      <ActionIcon
                        className="tc-model-panel-close"
                        size="sm"
                        variant="subtle"
                        aria-label="close"
                        onClick={() => setActivePanel(null)}
                      >
                        ×
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>

                <Stack className="tc-model-panel-form" gap="sm">
                    <Switch
                      className="tc-model-panel-enabled"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.currentTarget.checked)}
                      label="启用 API Key"
                      description="关闭后会清空 Key。"
                    />

                    <PasswordInput
                      className="tc-model-panel-apikey"
                      label="API Key"
                      placeholder={apiKeyHint}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.currentTarget.value)}
                      visible={apiKeyVisible}
                      onVisibilityChange={setApiKeyVisible}
                      disabled={saving}
                    />

                    <Group className="tc-model-panel-reset-row" gap={6} wrap="wrap">
                      <Button
                        className="tc-model-panel-reset-host"
                        size="xs"
                        variant="light"
                        leftSection={<IconRestore size={14} />}
                        onClick={() => setApiKey('')}
                        disabled={saving}
                      >
                        清空 Key
                      </Button>
                      <Button className="tc-model-panel-select-all" size="xs" variant="subtle" onClick={selectAll} disabled={saving}>
                        全选
                      </Button>
                      <Button className="tc-model-panel-clear-all" size="xs" variant="subtle" onClick={clearAll} disabled={saving}>
                        全不选
                      </Button>
                    </Group>

                    <Divider className="tc-model-panel-divider" label="vendorCandidates（可选）" labelPosition="left" />
                    <Text className="tc-model-panel-hint" size="xs" c="dimmed">
                      留空表示 `vendor=auto` 使用系统级可用厂商；勾选则限制自动回退范围。
                    </Text>
                    <Stack className="tc-model-panel-vendor-list" gap={6}>
                      {DEFAULT_ENABLED_VENDORS.map((opt) => {
                        const checked = vendorCandidates.includes(opt.value)
                        return (
                          <Checkbox
                            key={opt.value}
                            className="tc-model-panel-vendor-item"
                            checked={checked}
                            onChange={(e) => toggleVendor(opt.value, e.currentTarget.checked)}
                            label={
                              <span className="tc-model-panel-vendor-label">
                                {opt.label}
                                <span className="tc-model-panel-vendor-desc" style={{ marginLeft: 6, opacity: 0.7 }}>
                                  {opt.description}
                                </span>
                              </span>
                            }
                            disabled={saving}
                          />
                        )
                      })}
                    </Stack>

                    {error && (
                      <Text className="tc-model-panel-error" size="xs" c="red">
                        {error}
                      </Text>
                    )}

                    <Group className="tc-model-panel-actions" justify="flex-end" gap="xs">
                      <Button
                        className="tc-model-panel-save"
                        size="xs"
                        onClick={handleSave}
                        loading={saving}
                        disabled={false}
                      >
                        保存
                      </Button>
                    </Group>
                  </Stack>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
