import React from 'react'
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import type { ModelCatalogVendorDto } from '../deps'
import { clearModelCatalogVendorApiKey, toast, upsertModelCatalogVendorApiKey } from '../deps'

export function VendorApiKeyModal({
  opened,
  vendor,
  onClose,
  onSaved,
}: {
  opened: boolean
  vendor: ModelCatalogVendorDto | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}): JSX.Element {
  const [submitting, setSubmitting] = React.useState(false)
  const [apiKeyValue, setApiKeyValue] = React.useState('')

  React.useEffect(() => {
    if (!opened) return
    setApiKeyValue('')
    setSubmitting(false)
  }, [opened, vendor?.key])

  const submitVendorApiKey = React.useCallback(async () => {
    if (!vendor) return
    const apiKey = apiKeyValue.trim()
    if (!apiKey) {
      toast('请填写 API Key', 'error')
      return
    }
    if (submitting) return
    setSubmitting(true)
    try {
      await upsertModelCatalogVendorApiKey(vendor.key, { apiKey })
      toast('已保存 API Key（不会回显）', 'success')
      onClose()
      await onSaved()
    } catch (err: any) {
      console.error('save vendor api key failed', err)
      toast(err?.message || '保存 API Key 失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [apiKeyValue, onClose, onSaved, submitting, vendor])

  const clearVendorApiKey = React.useCallback(async () => {
    if (!vendor) return
    if (!window.confirm(`确定清除厂商「${vendor.name}（${vendor.key}）」的 API Key？\n\n清除后，该厂商将无法使用系统级全局 Key 进行调用。`)) return
    try {
      await clearModelCatalogVendorApiKey(vendor.key)
      toast('已清除 API Key', 'success')
      onClose()
      await onSaved()
    } catch (err: any) {
      console.error('clear vendor api key failed', err)
      toast(err?.message || '清除 API Key 失败', 'error')
    }
  }, [onClose, onSaved, vendor])

  return (
    <Modal
      className="stats-model-catalog-vendor-api-key-modal"
      opened={opened}
      onClose={onClose}
      title={vendor ? `设置 API Key：${vendor.name}（${vendor.key}）` : '设置 API Key'}
      size="md"
      radius="md"
      centered
      lockScroll={false}
    >
      <Stack className="stats-model-catalog-vendor-api-key-form" gap="sm">
        <Alert className="stats-model-catalog-vendor-api-key-alert" variant="light" color="blue" title="系统级全局 Key">
          <Text className="stats-model-catalog-vendor-api-key-alert-text" size="sm" c="dimmed">
            仅用于服务商侧统一调用；保存后不会回显。导出“配置”默认不含 Key；导出“迁移包”会包含 Key（明文）。
          </Text>
        </Alert>
        <TextInput
          className="stats-model-catalog-vendor-api-key-input"
          label="API Key"
          placeholder="粘贴厂商 API Key（保存后不回显）"
          value={apiKeyValue}
          onChange={(e) => setApiKeyValue(e.currentTarget.value)}
          type="password"
          autoComplete="off"
        />
        <Group className="stats-model-catalog-vendor-api-key-actions" justify="space-between" gap={8} wrap="wrap">
          <Button className="stats-model-catalog-vendor-api-key-clear" variant="light" color="red" onClick={() => void clearVendorApiKey()} disabled={!vendor?.hasApiKey}>
            清除
          </Button>
          <Group className="stats-model-catalog-vendor-api-key-actions-right" gap={8} wrap="nowrap">
            <Button className="stats-model-catalog-vendor-api-key-cancel" variant="subtle" onClick={onClose}>取消</Button>
            <Button className="stats-model-catalog-vendor-api-key-save" onClick={() => void submitVendorApiKey()} loading={submitting}>
              保存
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  )
}
