import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition, Modal, TextInput, Badge } from '@mantine/core'
import { useUIStore } from './uiStore'
import { deleteModelToken, listModelProviders, listModelTokens, upsertModelProvider, upsertModelToken, type ModelProviderDto, type ModelTokenDto } from '../api/server'

export default function ModelPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const mounted = active === 'models'
  const [providers, setProviders] = React.useState<ModelProviderDto[]>([])
  const [soraProvider, setSoraProvider] = React.useState<ModelProviderDto | null>(null)
  const [tokens, setTokens] = React.useState<ModelTokenDto[]>([])
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingToken, setEditingToken] = React.useState<ModelTokenDto | null>(null)
  const [label, setLabel] = React.useState('')
  const [secret, setSecret] = React.useState('')

  React.useEffect(() => {
    if (!mounted) return
    listModelProviders()
      .then(async (ps) => {
        setProviders(ps)
        let sora = ps.find((p) => p.vendor === 'sora')
        if (!sora) {
          sora = await upsertModelProvider({ name: 'Sora', vendor: 'sora' })
          setProviders((prev) => [...prev, sora!])
        }
        setSoraProvider(sora)
        const ts = await listModelTokens(sora.id)
        setTokens(ts)
      })
      .catch(() => {})
  }, [mounted])

  if (!mounted) return null

  const openModalForNew = () => {
    setEditingToken(null)
    setLabel('')
    setSecret('')
    setModalOpen(true)
  }

  const handleSaveToken = async () => {
    if (!soraProvider) return
    const saved = await upsertModelToken({
      id: editingToken?.id,
      providerId: soraProvider.id,
      label: label || '未命名密钥',
      secretToken: secret || (editingToken?.secretToken ?? ''),
    })
    const next = editingToken
      ? tokens.map((t) => (t.id === saved.id ? saved : t))
      : [...tokens, saved]
    setTokens(next)
    setModalOpen(false)
  }

  const handleDeleteToken = async (id: string) => {
    if (!confirm('确定删除该密钥吗？')) return
    await deleteModelToken(id)
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <div style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 6001 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 420, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>模型配置</Title>
                <Button size="xs" variant="light" onClick={() => setActivePanel(null)}>
                  关闭
                </Button>
              </Group>
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                <Stack gap="sm">
                  <Paper withBorder radius="md" p="sm" style={{ position: 'relative' }}>
                    <Badge color="blue" size="xs" style={{ position: 'absolute', top: 8, right: 8 }}>
                      Beta
                    </Badge>
                    <Group justify="space-between" mb={4}>
                      <div>
                        <Title order={6}>Sora</Title>
                        <Text size="xs" c="dimmed">
                          配置多个 Sora API Token，共享同一厂商额度
                        </Text>
                      </div>
                      <Button size="xs" onClick={openModalForNew}>
                        管理密钥
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      已配置密钥：{tokens.length}
                    </Text>
                  </Paper>
                </Stack>
              </div>
            </Paper>
            <Modal
              opened={modalOpen}
              onClose={() => setModalOpen(false)}
              fullScreen
              withinPortal
              title="Sora 身份配置"
            >
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  你可以为 Sora 添加多个 Token，类似 n8n 的身份配置。它们将共用同一厂商额度。
                </Text>
                <Group justify="space-between">
                  <Title order={5}>已保存的密钥</Title>
                  <Button size="xs" variant="light" onClick={openModalForNew}>
                    新增密钥
                  </Button>
                </Group>
                {tokens.length === 0 && <Text size="sm">暂无密钥，请先新增一个。</Text>}
                <Stack gap="xs">
                  {tokens.map((t) => (
                    <Group key={t.id} justify="space-between">
                      <div>
                        <Text size="sm">{t.label}</Text>
                        <Text size="xs" c="dimmed">
                          {t.secretToken ? t.secretToken.slice(0, 4) + '••••' : '已保存的密钥'}
                        </Text>
                      </div>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          onClick={() => {
                            setEditingToken(t)
                            setLabel(t.label)
                            setSecret('')
                            setModalOpen(true)
                          }}
                        >
                          编辑
                        </Button>
                        <Button size="xs" variant="light" color="red" onClick={() => handleDeleteToken(t.id)}>
                          删除
                        </Button>
                      </Group>
                    </Group>
                  ))}
                </Stack>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="sm">
                    <Title order={6}>{editingToken ? '编辑密钥' : '新增密钥'}</Title>
                    <TextInput label="名称" placeholder="例如：主账号 Token" value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
                    <TextInput
                      label="API Token"
                      placeholder={editingToken ? '留空则不修改已有密钥' : '粘贴你的 Sora API Token'}
                      value={secret}
                      onChange={(e) => setSecret(e.currentTarget.value)}
                    />
                    <Group justify="flex-end" mt="sm">
                      <Button variant="default" onClick={() => setModalOpen(false)}>
                        取消
                      </Button>
                      <Button onClick={handleSaveToken}>保存</Button>
                    </Group>
                  </Stack>
                </Paper>
              </Stack>
            </Modal>
          </div>
        )}
      </Transition>
    </div>
  )
}

