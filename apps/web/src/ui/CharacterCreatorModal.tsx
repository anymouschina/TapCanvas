import React from 'react'
import { Modal, Stack, Text, Group, Loader, Select, Button } from '@mantine/core'
import { useUIStore, type CharacterCreatorPayload } from './uiStore'
import { listModelProviders, listModelTokens, type ModelTokenDto } from '../api/server'
import { toast } from './toast'
import { CHARACTER_CLIP_MAX } from '../canvas/nodes/taskNodeHelpers'

const buildTitle = (payload?: CharacterCreatorPayload | null) => {
  if (!payload?.name) return '一键创建角色'
  return payload.name
}

export function CharacterCreatorModal(): JSX.Element | null {
  const { open, payload } = useUIStore((s) => s.characterCreatorModal)
  const close = useUIStore((s) => s.closeCharacterCreatorModal)
  const requestCharacterCreator = useUIStore((s) => s.requestCharacterCreator)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const [tokens, setTokens] = React.useState<ModelTokenDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedTokenId, setSelectedTokenId] = React.useState<string | null>(null)

  const videoVendor = (payload?.videoVendor || '').toLowerCase()
  const allowTokenless = videoVendor === 'sora2api' || videoVendor === 'grsai'

  React.useEffect(() => {
    if (!open) return
    const initialToken = payload?.soraTokenId || payload?.videoTokenId || null
    setSelectedTokenId(initialToken)
    if (allowTokenless) {
      setTokens([])
      setLoading(false)
      setError(null)
      return
    }
    let canceled = false
    const loadTokens = async () => {
      setLoading(true)
      setError(null)
      try {
        const providers = await listModelProviders()
        const sora = providers.find((p) => p.vendor === 'sora')
        if (!sora) {
          if (!canceled) {
            setTokens([])
            setError('未配置 Sora Provider')
          }
          return
        }
        const result = await listModelTokens(sora.id)
        if (!canceled) {
          setTokens(result || [])
          if (!initialToken && result?.[0]) {
            setSelectedTokenId(result[0].id)
          }
        }
      } catch (err: any) {
        if (!canceled) {
          setTokens([])
          setError(err?.message || '加载 Sora Token 失败')
        }
      } finally {
        if (!canceled) {
          setLoading(false)
        }
      }
    }
    loadTokens()
    return () => {
      canceled = true
    }
  }, [open, payload, allowTokenless])

  const handleConfirm = React.useCallback(() => {
    if (!payload) return
    const effectiveTokenId = selectedTokenId || payload.soraTokenId || payload.videoTokenId || null
    if (!allowTokenless && !effectiveTokenId) {
      toast('暂无可用的 Sora Token，请先前往资产面板绑定', 'error')
      return
    }
    requestCharacterCreator({
      ...payload,
      soraTokenId: effectiveTokenId,
      videoTokenId: payload.videoTokenId || effectiveTokenId,
    })
    setActivePanel('assets')
    close()
  }, [allowTokenless, close, payload, requestCharacterCreator, selectedTokenId, setActivePanel])

  if (!open || !payload) return null

  return (
    <Modal
      className="character-creator-modal"
      opened={open}
      onClose={close}
      title="一键创建角色"
      centered
      withinPortal
      zIndex={14000}
    >
      <Stack className="character-creator-body" gap="sm">
        <div className="character-creator-summary">
          <Text className="character-creator-title" size="sm" fw={500}>{buildTitle(payload)}</Text>
          {payload.summary && (
            <Text className="character-creator-description" size="xs" c="dimmed" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
              {payload.summary}
            </Text>
          )}
          {payload.videoUrl && (
            <Text className="character-creator-video-hint" size="xs" c="dimmed" mt={4}>
              将使用当前视频片段创建角色。
            </Text>
          )}
          <Text className="character-creator-clip-hint" size="xs" c="dimmed" mt={6}>
            {payload.clipRange
              ? `默认截取 ${payload.clipRange.start.toFixed(2)}s - ${payload.clipRange.end.toFixed(2)}s，最长 ${CHARACTER_CLIP_MAX}s`
              : '请在下一步选择截取区间（建议 1.2-3 秒）'}
          </Text>
        </div>

        {!allowTokenless && (
          <>
            {loading ? (
              <Group className="character-creator-loading" gap="xs">
                <Loader className="character-creator-loading-icon" size="xs" />
                <Text className="character-creator-loading-text" size="xs" c="dimmed">正在加载 Sora Token…</Text>
              </Group>
            ) : tokens.length > 0 ? (
              <Select
                className="character-creator-select"
                label="Sora Token"
                placeholder="请选择 Token"
                data={tokens.map((t) => ({
                  value: t.id,
                  label: `${t.label || '未命名'}${t.shared ? '（共享）' : ''}`,
                }))}
                value={selectedTokenId}
                onChange={(value) => setSelectedTokenId(value)}
                withinPortal
                size="xs"
              />
            ) : (
              <Stack className="character-creator-empty" gap={4}>
                <Text className="character-creator-empty-title" size="xs" c="red">
                  暂无可用的 Sora Token
                </Text>
                <Text className="character-creator-empty-desc" size="xs" c="dimmed">
                  请先前往资产面板绑定密钥，再尝试创建角色。
                </Text>
              </Stack>
            )}
            {error && (
              <Text className="character-creator-error" size="xs" c="red">
                {error}
              </Text>
            )}
          </>
        )}
        {allowTokenless && (
          <Text className="character-creator-tokenless" size="xs" c="dimmed">
            当前使用 Sora2API，可不选 Token，直接提交。
          </Text>
        )}

        <Group className="character-creator-actions" justify="flex-end" mt="xs">
          <Button className="character-creator-cancel" variant="default" onClick={close}>
            取消
          </Button>
          <Button className="character-creator-confirm" onClick={handleConfirm} disabled={!allowTokenless && !selectedTokenId}>
            开始创建
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
