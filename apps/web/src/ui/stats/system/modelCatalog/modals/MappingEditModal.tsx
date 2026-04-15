import React from 'react'
import { Button, Divider, Group, Modal, Select, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core'
import type { ModelCatalogMappingDto, ProfileKind } from '../deps'
import { toast, upsertModelCatalogMapping } from '../deps'
import { buildRequestProfileV2Template, TASK_KIND_OPTIONS } from '../modelCatalog.constants'
import { extractRequestProfileFromMapping, isRequestProfileV2, prettyJson, safeParseJson } from '../modelCatalog.utils'

export type MappingEditorState = { mode: 'create' } | { mode: 'edit'; mapping: ModelCatalogMappingDto }

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

function parseProfileKind(value: string | null): ProfileKind {
  const matched = TASK_KIND_OPTIONS.find((item) => item.value === value)
  return matched?.value || 'text_to_image'
}

export function MappingEditModal({
  editor,
  vendorOptions,
  onClose,
  onSaved,
}: {
  editor: MappingEditorState | null
  vendorOptions: Array<{ value: string; label: string }>
  onClose: () => void
  onSaved: () => Promise<void> | void
}): JSX.Element {
  const opened = !!editor
  const editingMapping = editor && editor.mode === 'edit' ? editor.mapping : null

  const [submitting, setSubmitting] = React.useState(false)
  const [id, setId] = React.useState<string | null>(null)
  const [vendorKey, setVendorKey] = React.useState<string>('')
  const [taskKind, setTaskKind] = React.useState<ProfileKind>('text_to_image')
  const [name, setName] = React.useState('默认映射')
  const [enabled, setEnabled] = React.useState(true)
  const [requestProfileEnabled, setRequestProfileEnabled] = React.useState(true)
  const [requestProfileVersion, setRequestProfileVersion] = React.useState('v2')
  const [requestProfileAdvanced, setRequestProfileAdvanced] = React.useState(true)
  const [requestProfileTemplateKind, setRequestProfileTemplateKind] = React.useState<ProfileKind>('text_to_image')
  const [requestProfileJson, setRequestProfileJson] = React.useState('')
  const [requestMapping, setRequestMapping] = React.useState('')
  const [responseMapping, setResponseMapping] = React.useState('')

  React.useEffect(() => {
    if (!opened) return
    if (!editor || editor.mode === 'create') {
      const nextTaskKind: ProfileKind = 'text_to_image'
      setId(null)
      setVendorKey(vendorOptions[0]?.value || '')
      setTaskKind(nextTaskKind)
      setName('默认映射')
      setEnabled(true)
      setRequestProfileEnabled(true)
      setRequestProfileVersion('v2')
      setRequestProfileAdvanced(true)
      setRequestProfileTemplateKind(nextTaskKind)
      setRequestProfileJson(prettyJson(buildRequestProfileV2Template(nextTaskKind)))
      setRequestMapping('')
      setResponseMapping('')
      setSubmitting(false)
      return
    }

    if (!editingMapping) return

    const requestProfile = extractRequestProfileFromMapping(editingMapping)
    const nextTaskKind = editingMapping.taskKind
    setId(editingMapping.id)
    setVendorKey(editingMapping.vendorKey)
    setTaskKind(nextTaskKind)
    setName(editingMapping.name || '')
    setEnabled(!!editingMapping.enabled)
    setRequestProfileEnabled(!!requestProfile)
    setRequestProfileVersion(isRequestProfileV2(requestProfile) ? 'v2' : 'v2')
    setRequestProfileAdvanced(true)
    setRequestProfileTemplateKind(nextTaskKind)
    setRequestProfileJson(requestProfile ? prettyJson(requestProfile) : prettyJson(buildRequestProfileV2Template(nextTaskKind)))
    setRequestMapping(prettyJson(editingMapping.requestMapping))
    setResponseMapping(prettyJson(editingMapping.responseMapping))
    setSubmitting(false)
  }, [editor, editingMapping, opened, vendorOptions])

  const fillTemplate = React.useCallback(() => {
    setRequestProfileVersion('v2')
    setRequestProfileJson(prettyJson(buildRequestProfileV2Template(requestProfileTemplateKind)))
    setRequestProfileEnabled(true)
    setRequestProfileAdvanced(true)
  }, [requestProfileTemplateKind])

  const submitMapping = React.useCallback(async () => {
    const trimmedVendorKey = vendorKey.trim()
    const trimmedName = name.trim()
    if (!trimmedVendorKey) {
      toast('请选择厂商', 'error')
      return
    }
    if (!trimmedName) {
      toast('请填写映射名称（例如 默认映射 / v2）', 'error')
      return
    }

    let nextRequestMapping: unknown = undefined
    let nextResponseMapping: unknown = undefined

    if (requestProfileEnabled) {
      const requestProfileParsed = safeParseJson(requestProfileJson)
      if (!requestProfileParsed.ok) {
        toast(`request_profile JSON 无效：${requestProfileParsed.error}`, 'error')
        return
      }
      if (!isRequestProfileV2(requestProfileParsed.value)) {
        toast('request_profile 必须是 version = "v2" 的对象', 'error')
        return
      }
      nextRequestMapping = requestProfileParsed.value
      nextResponseMapping = requestProfileParsed.value
    } else {
      const reqParsed = safeParseJson(requestMapping)
      if (!reqParsed.ok) {
        toast(`requestMapping JSON 无效：${reqParsed.error}`, 'error')
        return
      }
      const resParsed = safeParseJson(responseMapping)
      if (!resParsed.ok) {
        toast(`responseMapping JSON 无效：${resParsed.error}`, 'error')
        return
      }
      nextRequestMapping = reqParsed.value
      nextResponseMapping = resParsed.value
    }

    if (submitting) return
    setSubmitting(true)
    try {
      await upsertModelCatalogMapping({
        ...(id ? { id } : {}),
        vendorKey: trimmedVendorKey,
        taskKind,
        name: trimmedName,
        enabled,
        ...(typeof nextRequestMapping === 'undefined' ? {} : { requestMapping: nextRequestMapping }),
        ...(typeof nextResponseMapping === 'undefined' ? {} : { responseMapping: nextResponseMapping }),
      })
      toast('已保存映射', 'success')
      onClose()
      await onSaved()
    } catch (error: unknown) {
      console.error('save mapping failed', error)
      toast(toErrorMessage(error, '保存映射失败'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [enabled, id, name, onClose, onSaved, requestMapping, requestProfileEnabled, requestProfileJson, responseMapping, submitting, taskKind, vendorKey])

  return (
    <Modal
      className="stats-model-catalog-mapping-modal"
      opened={opened}
      onClose={onClose}
      title={id ? '编辑请求策略' : '新增请求策略'}
      size="xl"
      radius="md"
      centered
      lockScroll={false}
    >
      <Stack className="stats-model-catalog-mapping-form" gap="sm">
        <Group className="stats-model-catalog-mapping-form-top" gap="sm" wrap="wrap" align="flex-end">
          <Select className="stats-model-catalog-mapping-form-vendor" label="所属平台" data={vendorOptions} value={vendorKey} onChange={(value) => setVendorKey(value || '')} searchable w={260} />
          <Select className="stats-model-catalog-mapping-form-taskkind" label="模板类型" data={TASK_KIND_OPTIONS} value={taskKind} onChange={(value) => {
            const nextValue = parseProfileKind(value)
            setTaskKind(nextValue)
            setRequestProfileTemplateKind(nextValue)
          }} w={260} />
        </Group>
        <TextInput className="stats-model-catalog-mapping-form-name" label="映射名称" placeholder="例如 默认映射 / v2 / 自定义" value={name} onChange={(event) => setName(event.currentTarget.value)} />
        <Switch className="stats-model-catalog-mapping-form-enabled" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} label="启用" />

        <Divider className="stats-model-catalog-mapping-form-divider" label="请求策略（request_profile）" labelPosition="left" />
        <Group className="stats-model-catalog-mapping-form-profile-top" gap="sm" wrap="wrap" align="flex-end">
          <Switch className="stats-model-catalog-mapping-form-profile-enabled" checked={requestProfileEnabled} onChange={(event) => setRequestProfileEnabled(event.currentTarget.checked)} label="启用策略" />
          <TextInput className="stats-model-catalog-mapping-form-profile-version" label="版本" value={requestProfileVersion} onChange={(event) => setRequestProfileVersion(event.currentTarget.value)} w={120} />
          <Switch className="stats-model-catalog-mapping-form-profile-advanced" checked={requestProfileAdvanced} onChange={(event) => setRequestProfileAdvanced(event.currentTarget.checked)} label="高级模式" />
          <Button className="stats-model-catalog-mapping-form-profile-fill" variant="light" onClick={fillTemplate}>
            按模板类型填充示例
          </Button>
        </Group>

        {requestProfileEnabled ? (
          <Stack className="stats-model-catalog-mapping-form-profile-json-wrap" gap={6}>
            <Text className="stats-model-catalog-mapping-form-profile-hint" size="xs" c="dimmed">
              {requestProfileAdvanced ? '直接编辑 request_profile v2 JSON。create/query 可以写 default + candidates，支持和导入 JSON 相同的结构。' : '当前是模板模式；建议先点“按模板类型填充示例”，再按你的厂商接口修改字段。'}
            </Text>
            <Textarea
              className="stats-model-catalog-mapping-form-profile-json"
              label="request_profile v2 JSON"
              value={requestProfileJson}
              onChange={(event) => setRequestProfileJson(event.currentTarget.value)}
              minRows={18}
              autosize
              placeholder="粘贴完整 request_profile v2 JSON"
            />
          </Stack>
        ) : (
          <Stack className="stats-model-catalog-mapping-form-legacy" gap="sm">
            <Text className="stats-model-catalog-mapping-form-legacy-hint" size="xs" c="dimmed">
              关闭策略后，将回退到旧的 requestMapping / responseMapping 双字段编辑。
            </Text>
            <Textarea className="stats-model-catalog-mapping-form-request" label="requestMapping（JSON，可选）" value={requestMapping} onChange={(event) => setRequestMapping(event.currentTarget.value)} minRows={6} autosize placeholder="把 TaskRequestDto 映射到三方请求体的规则" />
            <Textarea className="stats-model-catalog-mapping-form-response" label="responseMapping（JSON，可选）" value={responseMapping} onChange={(event) => setResponseMapping(event.currentTarget.value)} minRows={6} autosize placeholder="把三方响应映射回 TaskResultDto 的规则" />
          </Stack>
        )}

        <Group className="stats-model-catalog-mapping-form-actions" justify="flex-end" gap={8}>
          <Button className="stats-model-catalog-mapping-form-cancel" variant="subtle" onClick={onClose}>取消</Button>
          <Button className="stats-model-catalog-mapping-form-save" onClick={() => void submitMapping()} loading={submitting}>
            保存
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
