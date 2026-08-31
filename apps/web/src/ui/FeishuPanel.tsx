import React from 'react'
import { ActionIcon, Button, Loader, Select, Stack, Text, TextInput, Transition } from '@mantine/core'
import { useUIStore } from './uiStore'
import { PanelCard } from './PanelCard'
import { getLarkApp, saveLarkApp, type LarkApp } from '../api/lark'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarPanelMetrics,
  bottomBarPanelStyle,
} from './utils/panelPosition'
import { stopPanelWheelPropagation } from './utils/panelWheel'

function FeishuIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 L19 8.5 L12 11.5 L5 8.5 Z" />
      <path d="M12 12.5 L19 15.5 L12 21 L5 15.5 Z" />
    </svg>
  )
}

export default function FeishuPanel({ className }: { className?: string }): JSX.Element {
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorX = useUIStore((s) => s.panelAnchorX)

  const [mounted, setMounted] = React.useState(false)
  const [app, setApp] = React.useState<LarkApp | null | undefined>(undefined)

  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [brand, setBrand] = React.useState<string>('feishu')
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setMounted(activePanel === 'feishu')
  }, [activePanel])

  React.useEffect(() => {
    if (activePanel !== 'feishu') return
    if (app !== undefined) return
    getLarkApp().then(setApp).catch(() => setApp(null))
  }, [activePanel, app])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await saveLarkApp({ appId: appId.trim(), appSecret: appSecret.trim(), brand })
      setApp(saved)
    } catch {
      setSaveError('保存失败，请检查凭证')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setApp(null)
    setAppId('')
    setAppSecret('')
    setSaveError(null)
  }

  const panelMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.compact)
  const panelStyle: React.CSSProperties = {
    ...bottomBarPanelStyle(anchorX, { zIndex: 200, halfWidth: panelMetrics.width / 2 }),
    width: panelMetrics.width,
  }

  return (
    <div className={['feishu-panel', className].filter(Boolean).join(' ')} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="feishu-panel-transition-inner" style={{ ...panelStyle, ...styles }}>
            <PanelCard
              className="feishu-panel-shell glass"
              style={{
                display: 'flex',
                width: '100%',
                height: panelMetrics.height,
                maxHeight: panelMetrics.height,
                minHeight: 0,
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FeishuIcon size={16} />
                  <Text size="sm" fw={600}>飞书</Text>
                </div>
                <ActionIcon variant="subtle" size={24} radius="md" onClick={() => setActivePanel(null)} aria-label="关闭">
                  <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </ActionIcon>
              </div>

              <div
                className="feishu-panel-content"
                style={{ flex: '1 1 auto', minHeight: 0, padding: '0 12px 12px', overflowY: 'auto' }}
              >
                {app === undefined ? (
                  <Stack align="center" pt="xl"><Loader size="sm" /></Stack>
                ) : app !== null ? (
                  <Stack gap="xs" pt="xs">
                    <Text size="xs" c="dimmed">已连接飞书应用</Text>
                    <Text size="xs" fw={500}>{app.appId}</Text>
                    <Text size="xs" c="dimmed">{app.brand === 'lark' ? 'Lark' : '飞书'}</Text>
                    <Button size="xs" variant="subtle" color="gray" onClick={handleReset} fullWidth>
                      重新配置
                    </Button>
                  </Stack>
                ) : (
                  <Stack gap="xs" pt="xs">
                    <Text size="xs" c="dimmed">
                      填写飞书自建应用凭证，AI 即可操作飞书文档与多维表格。
                    </Text>
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                      在{' '}
                      <a href="https://open.feishu.cn/app" target="_blank" rel="noopener noreferrer" style={{ color: '#6e7580' }}>
                        飞书开放平台
                      </a>{' '}
                      创建自建应用后，复制 App ID 和 App Secret 填入下方。
                    </Text>
                    <Select
                      label="品牌" size="xs" value={brand}
                      onChange={(v) => setBrand(v ?? 'feishu')}
                      data={[{ value: 'feishu', label: '飞书' }, { value: 'lark', label: 'Lark' }]}
                    />
                    <TextInput label="App ID" size="xs" placeholder="cli_xxxxxxxx" value={appId} onChange={(e) => setAppId(e.currentTarget.value)} />
                    <TextInput label="App Secret" size="xs" placeholder="xxxxxxxx" type="password" value={appSecret} onChange={(e) => setAppSecret(e.currentTarget.value)} />
                    {saveError && <Text size="xs" c="red">{saveError}</Text>}
                    <Button size="xs" loading={saving} disabled={!appId.trim() || !appSecret.trim()} onClick={handleSave} fullWidth>
                      保存并连接
                    </Button>
                  </Stack>
                )}
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
