import React from 'react'
import { ActionIcon, Alert, Badge, Button, Divider, Group, Loader, Modal, Select, Stack, Switch, Table, Text, TextInput, Textarea, Tooltip } from '@mantine/core'
import { IconCheck, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react'
import { deleteModelCatalogMapping, deleteModelCatalogModel, deleteModelCatalogVendor, importModelCatalogPackage, listModelCatalogMappings, listModelCatalogModels, listModelCatalogVendors, upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor, type BillingModelKind, type ModelCatalogImportPackageDto, type ModelCatalogImportResultDto, type ModelCatalogMappingDto, type ModelCatalogModelDto, type ModelCatalogVendorAuthType, type ModelCatalogVendorDto, type ProfileKind } from '../api/server'
import { toast } from './toast'

type JsonParseResult = { ok: true; value: any } | { ok: false; error: string }

function safeParseJson(input: string): JsonParseResult {
  const raw = String(input || '').trim()
  if (!raw) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'JSON 解析失败' }
  }
}

function prettyJson(value: any): string {
  if (typeof value === 'undefined' || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

const KIND_OPTIONS: Array<{ value: BillingModelKind; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

const TASK_KIND_OPTIONS: Array<{ value: ProfileKind; label: string }> = [
  { value: 'chat', label: 'chat（文本）' },
  { value: 'prompt_refine', label: 'prompt_refine（指令优化）' },
  { value: 'text_to_image', label: 'text_to_image（图片）' },
  { value: 'image_edit', label: 'image_edit（图像编辑）' },
  { value: 'image_to_prompt', label: 'image_to_prompt（图像理解）' },
  { value: 'text_to_video', label: 'text_to_video（视频）' },
  { value: 'image_to_video', label: 'image_to_video（图像转视频）' },
]

const AUTH_TYPE_OPTIONS: Array<{ value: ModelCatalogVendorAuthType; label: string }> = [
  { value: 'bearer', label: 'bearer（Authorization: Bearer <key>）' },
  { value: 'x-api-key', label: 'x-api-key（X-API-Key）' },
  { value: 'query', label: 'query（?api_key=...）' },
  { value: 'none', label: 'none（无需鉴权）' },
]

const IMPORT_TEMPLATE: ModelCatalogImportPackageDto = {
  version: 'v1',
  vendors: [
    {
      vendor: {
        key: 'acme',
        name: 'Acme AI',
        enabled: true,
        baseUrlHint: 'https://api.acme.com',
        authType: 'bearer',
      },
      models: [
        { modelKey: 'acme-text-1', labelZh: 'Acme 文本 1', kind: 'text', enabled: true },
        { modelKey: 'acme-image-1', labelZh: 'Acme 图片 1', kind: 'image', enabled: true },
      ],
      mappings: [
        {
          taskKind: 'text_to_image',
          name: '默认映射',
          enabled: true,
          requestMapping: { note: '把 TaskRequestDto 映射到三方请求体' },
          responseMapping: { note: '把三方响应映射到 TaskResultDto' },
        },
      ],
    },
  ],
}

function formatVendor(vendorKey: string | undefined | null): string {
  return String(vendorKey || '').trim() || '—'
}

function formatEnabled(enabled: boolean): JSX.Element {
  return (
    <Badge className="stats-model-catalog-enabled-badge" size="xs" variant="light" color={enabled ? 'green' : 'gray'}>
      {enabled ? '启用' : '禁用'}
    </Badge>
  )
}

function formatKind(kind: string | undefined | null): string {
  const k = String(kind || '').trim()
  if (!k) return '—'
  if (k === 'text') return '文本'
  if (k === 'image') return '图片'
  if (k === 'video') return '视频'
  return k
}

function formatTaskKind(kind: string | undefined | null): string {
  const k = String(kind || '').trim()
  if (!k) return '—'
  const map: Record<string, string> = {
    chat: 'chat（文本）',
    prompt_refine: 'prompt_refine（指令优化）',
    text_to_image: 'text_to_image（图片）',
    image_edit: 'image_edit（图像编辑）',
    image_to_prompt: 'image_to_prompt（图像理解）',
    text_to_video: 'text_to_video（视频）',
    image_to_video: 'image_to_video（图像转视频）',
  }
  return map[k] || k
}

export default function StatsModelCatalogManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-model-catalog', className].filter(Boolean).join(' ')

  const [loading, setLoading] = React.useState(false)
  const [vendors, setVendors] = React.useState<ModelCatalogVendorDto[]>([])
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [mappings, setMappings] = React.useState<ModelCatalogMappingDto[]>([])

  const [vendorFilter, setVendorFilter] = React.useState<string>('all')
  const [modelKindFilter, setModelKindFilter] = React.useState<BillingModelKind | 'all'>('all')
  const [taskKindFilter, setTaskKindFilter] = React.useState<ProfileKind | 'all'>('all')
  const [enabledOnly, setEnabledOnly] = React.useState(false)

  const [importText, setImportText] = React.useState('')
  const [importSubmitting, setImportSubmitting] = React.useState(false)
  const [lastImportResult, setLastImportResult] = React.useState<ModelCatalogImportResultDto | null>(null)

  const vendorSelectData = React.useMemo(() => {
    const base = vendors
      .map((v) => ({
        value: v.key,
        label: `${v.name}（${v.key}）`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    return [{ value: 'all', label: '全部厂商' }, ...base]
  }, [vendors])

  const modelKindSelectData = React.useMemo(() => [{ value: 'all', label: '全部类型' }, ...KIND_OPTIONS], [])

  const taskKindSelectData = React.useMemo(() => [{ value: 'all', label: '全部任务类型' }, ...TASK_KIND_OPTIONS], [])

  const filteredModels = React.useMemo(() => {
    let items = [...models]
    if (vendorFilter !== 'all') items = items.filter((m) => m.vendorKey === vendorFilter)
    if (modelKindFilter !== 'all') items = items.filter((m) => m.kind === modelKindFilter)
    if (enabledOnly) items = items.filter((m) => !!m.enabled)
    return items
  }, [enabledOnly, modelKindFilter, models, vendorFilter])

  const filteredMappings = React.useMemo(() => {
    let items = [...mappings]
    if (vendorFilter !== 'all') items = items.filter((m) => m.vendorKey === vendorFilter)
    if (taskKindFilter !== 'all') items = items.filter((m) => m.taskKind === taskKindFilter)
    if (enabledOnly) items = items.filter((m) => !!m.enabled)
    return items
  }, [enabledOnly, mappings, taskKindFilter, vendorFilter])

  const reloadAll = React.useCallback(async () => {
    setLoading(true)
    try {
      const [v, m, mp] = await Promise.allSettled([
        listModelCatalogVendors(),
        listModelCatalogModels(),
        listModelCatalogMappings(),
      ])

      if (v.status === 'fulfilled') setVendors(Array.isArray(v.value) ? v.value : [])
      else {
        setVendors([])
        toast((v.reason as any)?.message || '加载厂商列表失败', 'error')
      }

      if (m.status === 'fulfilled') setModels(Array.isArray(m.value) ? m.value : [])
      else {
        setModels([])
        toast((m.reason as any)?.message || '加载模型列表失败', 'error')
      }

      if (mp.status === 'fulfilled') setMappings(Array.isArray(mp.value) ? mp.value : [])
      else {
        setMappings([])
        toast((mp.reason as any)?.message || '加载映射列表失败', 'error')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  // ---- Vendor modal ----
  const [vendorEditOpen, setVendorEditOpen] = React.useState(false)
  const [vendorEditSubmitting, setVendorEditSubmitting] = React.useState(false)
  const [vendorEditIsNew, setVendorEditIsNew] = React.useState(true)
  const [vendorEditKey, setVendorEditKey] = React.useState('')
  const [vendorEditName, setVendorEditName] = React.useState('')
  const [vendorEditEnabled, setVendorEditEnabled] = React.useState(true)
  const [vendorEditBaseUrlHint, setVendorEditBaseUrlHint] = React.useState('')
  const [vendorEditAuthType, setVendorEditAuthType] = React.useState<ModelCatalogVendorAuthType>('bearer')
  const [vendorEditAuthHeader, setVendorEditAuthHeader] = React.useState('')
  const [vendorEditAuthQueryParam, setVendorEditAuthQueryParam] = React.useState('')
  const [vendorEditMeta, setVendorEditMeta] = React.useState('')

  const openCreateVendor = React.useCallback(() => {
    setVendorEditIsNew(true)
    setVendorEditKey('')
    setVendorEditName('')
    setVendorEditEnabled(true)
    setVendorEditBaseUrlHint('')
    setVendorEditAuthType('bearer')
    setVendorEditAuthHeader('')
    setVendorEditAuthQueryParam('')
    setVendorEditMeta('')
    setVendorEditOpen(true)
  }, [])

  const openEditVendor = React.useCallback((vendor: ModelCatalogVendorDto) => {
    setVendorEditIsNew(false)
    setVendorEditKey(vendor.key)
    setVendorEditName(vendor.name || '')
    setVendorEditEnabled(!!vendor.enabled)
    setVendorEditBaseUrlHint((vendor.baseUrlHint || '').trim())
    setVendorEditAuthType((vendor.authType as any) || 'bearer')
    setVendorEditAuthHeader((vendor.authHeader || '').trim())
    setVendorEditAuthQueryParam((vendor.authQueryParam || '').trim())
    setVendorEditMeta(prettyJson(vendor.meta))
    setVendorEditOpen(true)
  }, [])

  const submitVendor = React.useCallback(async () => {
    const key = vendorEditKey.trim()
    const name = vendorEditName.trim()
    if (!key) {
      toast('请填写厂商 Key（如 openai/gemini/xxx）', 'error')
      return
    }
    if (!name) {
      toast('请填写厂商名称', 'error')
      return
    }

    const metaParsed = safeParseJson(vendorEditMeta)
    if (!metaParsed.ok) {
      toast(`meta JSON 无效：${metaParsed.error}`, 'error')
      return
    }

    if (vendorEditSubmitting) return
    setVendorEditSubmitting(true)
    try {
      await upsertModelCatalogVendor({
        key,
        name,
        enabled: vendorEditEnabled,
        baseUrlHint: vendorEditBaseUrlHint.trim() || null,
        authType: vendorEditAuthType,
        authHeader: vendorEditAuthHeader.trim() || null,
        authQueryParam: vendorEditAuthQueryParam.trim() || null,
        ...(typeof metaParsed.value === 'undefined' ? {} : { meta: metaParsed.value }),
      })
      toast('已保存厂商配置', 'success')
      setVendorEditOpen(false)
      await reloadAll()
    } catch (err: any) {
      console.error('save vendor failed', err)
      toast(err?.message || '保存厂商失败', 'error')
    } finally {
      setVendorEditSubmitting(false)
    }
  }, [reloadAll, vendorEditAuthHeader, vendorEditAuthQueryParam, vendorEditAuthType, vendorEditBaseUrlHint, vendorEditEnabled, vendorEditKey, vendorEditMeta, vendorEditName, vendorEditSubmitting])

  const handleDeleteVendor = React.useCallback(async (vendor: ModelCatalogVendorDto) => {
    if (!window.confirm(`确定删除厂商「${vendor.name}（${vendor.key}）」？\n\n注意：若该厂商仍被模型/映射引用，数据库可能会拒绝删除。`)) return
    try {
      await deleteModelCatalogVendor(vendor.key)
      toast('已删除厂商', 'success')
      await reloadAll()
    } catch (err: any) {
      console.error('delete vendor failed', err)
      toast(err?.message || '删除厂商失败', 'error')
    }
  }, [reloadAll])

  // ---- Model modal ----
  const [modelEditOpen, setModelEditOpen] = React.useState(false)
  const [modelEditSubmitting, setModelEditSubmitting] = React.useState(false)
  const [modelEditIsNew, setModelEditIsNew] = React.useState(true)
  const [modelEditModelKey, setModelEditModelKey] = React.useState('')
  const [modelEditVendorKey, setModelEditVendorKey] = React.useState<string>('')
  const [modelEditLabelZh, setModelEditLabelZh] = React.useState('')
  const [modelEditKind, setModelEditKind] = React.useState<BillingModelKind>('text')
  const [modelEditEnabled, setModelEditEnabled] = React.useState(true)
  const [modelEditMeta, setModelEditMeta] = React.useState('')

  const vendorOnlyData = React.useMemo(() => {
    const items = vendors
      .map((v) => ({ value: v.key, label: `${v.name}（${v.key}）` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    return items
  }, [vendors])

  const openCreateModel = React.useCallback(() => {
    setModelEditIsNew(true)
    setModelEditModelKey('')
    setModelEditVendorKey(vendorOnlyData[0]?.value || '')
    setModelEditLabelZh('')
    setModelEditKind('text')
    setModelEditEnabled(true)
    setModelEditMeta('')
    setModelEditOpen(true)
  }, [vendorOnlyData])

  const openEditModel = React.useCallback((model: ModelCatalogModelDto) => {
    setModelEditIsNew(false)
    setModelEditModelKey(model.modelKey)
    setModelEditVendorKey(model.vendorKey)
    setModelEditLabelZh(model.labelZh || '')
    setModelEditKind(model.kind)
    setModelEditEnabled(!!model.enabled)
    setModelEditMeta(prettyJson(model.meta))
    setModelEditOpen(true)
  }, [])

  const submitModel = React.useCallback(async () => {
    const modelKey = modelEditModelKey.trim()
    const vendorKey = modelEditVendorKey.trim()
    const labelZh = modelEditLabelZh.trim()
    if (!vendorKey) {
      toast('请选择厂商', 'error')
      return
    }
    if (!modelKey) {
      toast('请填写模型 Key（例如 gpt-4.1 / nano-banana-pro）', 'error')
      return
    }
    if (!labelZh) {
      toast('请填写中文名称', 'error')
      return
    }

    const metaParsed = safeParseJson(modelEditMeta)
    if (!metaParsed.ok) {
      toast(`meta JSON 无效：${metaParsed.error}`, 'error')
      return
    }

    if (modelEditSubmitting) return
    setModelEditSubmitting(true)
    try {
      await upsertModelCatalogModel({
        modelKey,
        vendorKey,
        labelZh,
        kind: modelEditKind,
        enabled: modelEditEnabled,
        ...(typeof metaParsed.value === 'undefined' ? {} : { meta: metaParsed.value }),
      })
      toast('已保存模型', 'success')
      setModelEditOpen(false)
      await reloadAll()
    } catch (err: any) {
      console.error('save model failed', err)
      toast(err?.message || '保存模型失败', 'error')
    } finally {
      setModelEditSubmitting(false)
    }
  }, [modelEditEnabled, modelEditKind, modelEditLabelZh, modelEditMeta, modelEditModelKey, modelEditSubmitting, modelEditVendorKey, reloadAll])

  const handleDeleteModel = React.useCallback(async (model: ModelCatalogModelDto) => {
    if (!window.confirm(`确定删除模型「${model.labelZh}（${model.modelKey}）」？`)) return
    try {
      await deleteModelCatalogModel(model.modelKey)
      toast('已删除模型', 'success')
      await reloadAll()
    } catch (err: any) {
      console.error('delete model failed', err)
      toast(err?.message || '删除模型失败', 'error')
    }
  }, [reloadAll])

  // ---- Mapping modal ----
  const [mappingEditOpen, setMappingEditOpen] = React.useState(false)
  const [mappingEditSubmitting, setMappingEditSubmitting] = React.useState(false)
  const [mappingEditId, setMappingEditId] = React.useState<string | null>(null)
  const [mappingEditVendorKey, setMappingEditVendorKey] = React.useState<string>('')
  const [mappingEditTaskKind, setMappingEditTaskKind] = React.useState<ProfileKind>('text_to_image')
  const [mappingEditName, setMappingEditName] = React.useState('默认映射')
  const [mappingEditEnabled, setMappingEditEnabled] = React.useState(true)
  const [mappingEditRequest, setMappingEditRequest] = React.useState('')
  const [mappingEditResponse, setMappingEditResponse] = React.useState('')

  const openCreateMapping = React.useCallback(() => {
    setMappingEditId(null)
    setMappingEditVendorKey(vendorOnlyData[0]?.value || '')
    setMappingEditTaskKind('text_to_image')
    setMappingEditName('默认映射')
    setMappingEditEnabled(true)
    setMappingEditRequest('')
    setMappingEditResponse('')
    setMappingEditOpen(true)
  }, [vendorOnlyData])

  const openEditMapping = React.useCallback((mapping: ModelCatalogMappingDto) => {
    setMappingEditId(mapping.id)
    setMappingEditVendorKey(mapping.vendorKey)
    setMappingEditTaskKind(mapping.taskKind)
    setMappingEditName(mapping.name || '')
    setMappingEditEnabled(!!mapping.enabled)
    setMappingEditRequest(prettyJson(mapping.requestMapping))
    setMappingEditResponse(prettyJson(mapping.responseMapping))
    setMappingEditOpen(true)
  }, [])

  const submitMapping = React.useCallback(async () => {
    const vendorKey = mappingEditVendorKey.trim()
    const name = mappingEditName.trim()
    if (!vendorKey) {
      toast('请选择厂商', 'error')
      return
    }
    if (!name) {
      toast('请填写映射名称（例如 默认映射 / v2）', 'error')
      return
    }

    const reqParsed = safeParseJson(mappingEditRequest)
    if (!reqParsed.ok) {
      toast(`requestMapping JSON 无效：${reqParsed.error}`, 'error')
      return
    }
    const resParsed = safeParseJson(mappingEditResponse)
    if (!resParsed.ok) {
      toast(`responseMapping JSON 无效：${resParsed.error}`, 'error')
      return
    }

    if (mappingEditSubmitting) return
    setMappingEditSubmitting(true)
    try {
      await upsertModelCatalogMapping({
        ...(mappingEditId ? { id: mappingEditId } : {}),
        vendorKey,
        taskKind: mappingEditTaskKind,
        name,
        enabled: mappingEditEnabled,
        ...(typeof reqParsed.value === 'undefined' ? {} : { requestMapping: reqParsed.value }),
        ...(typeof resParsed.value === 'undefined' ? {} : { responseMapping: resParsed.value }),
      })
      toast('已保存映射', 'success')
      setMappingEditOpen(false)
      await reloadAll()
    } catch (err: any) {
      console.error('save mapping failed', err)
      toast(err?.message || '保存映射失败', 'error')
    } finally {
      setMappingEditSubmitting(false)
    }
  }, [mappingEditEnabled, mappingEditId, mappingEditName, mappingEditRequest, mappingEditResponse, mappingEditSubmitting, mappingEditTaskKind, mappingEditVendorKey, reloadAll])

  const handleDeleteMapping = React.useCallback(async (mapping: ModelCatalogMappingDto) => {
    if (!window.confirm(`确定删除映射「${mapping.vendorKey} / ${mapping.taskKind} / ${mapping.name}」？`)) return
    try {
      await deleteModelCatalogMapping(mapping.id)
      toast('已删除映射', 'success')
      await reloadAll()
    } catch (err: any) {
      console.error('delete mapping failed', err)
      toast(err?.message || '删除映射失败', 'error')
    }
  }, [reloadAll])

  // ---- Import ----
  const handleImportFile = React.useCallback((file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setImportText(text || '')
    }
    reader.onerror = () => {
      toast('读取文件失败', 'error')
    }
    reader.readAsText(file)
  }, [])

  const fillTemplate = React.useCallback(() => {
    setImportText(JSON.stringify(IMPORT_TEMPLATE, null, 2))
    toast('已填充导入模板（请按需修改）', 'success')
  }, [])

  const submitImport = React.useCallback(async () => {
    if (importSubmitting) return
    const parsed = safeParseJson(importText)
    if (!parsed.ok) {
      toast(`导入 JSON 无效：${parsed.error}`, 'error')
      return
    }
    if (!parsed.value || typeof parsed.value !== 'object') {
      toast('导入内容必须是 JSON 对象', 'error')
      return
    }
    setImportSubmitting(true)
    try {
      const result = await importModelCatalogPackage(parsed.value as any)
      setLastImportResult(result)
      toast(`导入完成：vendors=${result.imported.vendors} models=${result.imported.models} mappings=${result.imported.mappings}`, 'success')
      await reloadAll()
    } catch (err: any) {
      console.error('import model catalog failed', err)
      toast(err?.message || '导入失败', 'error')
    } finally {
      setImportSubmitting(false)
    }
  }, [importSubmitting, importText, reloadAll])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-model-catalog-toolbar" justify="space-between" align="flex-start" gap="md" wrap="wrap">
        <div className="stats-model-catalog-toolbar-left">
          <Text className="stats-model-catalog-title" size="sm" fw={700}>模型管理（系统级全局配置）</Text>
          <Text className="stats-model-catalog-subtitle" size="xs" c="dimmed">
            维护厂商/模型与字段映射（transform 配置）；企业（团队）只是你的用户，不做隔离。
          </Text>
        </div>
        <Group className="stats-model-catalog-toolbar-actions" gap={6} wrap="nowrap">
          <Tooltip className="stats-model-catalog-refresh-tooltip" label="刷新" withArrow>
            <ActionIcon className="stats-model-catalog-refresh" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reloadAll()} loading={loading}>
              <IconRefresh className="stats-model-catalog-refresh-icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider className="stats-model-catalog-divider" label="一键导入" labelPosition="left" />
      <Stack className="stats-model-catalog-import" gap="xs">
        <Group className="stats-model-catalog-import-actions" gap="xs" wrap="wrap" align="flex-end">
          <div className="stats-model-catalog-import-file">
            <Text className="stats-model-catalog-import-file-label" size="xs" c="dimmed">选择 JSON 文件</Text>
            <input
              className="stats-model-catalog-import-file-input"
              type="file"
              accept=".json,application/json"
              onChange={(e) => handleImportFile(e.currentTarget.files?.[0] || null)}
            />
          </div>
          <Button className="stats-model-catalog-import-template" size="xs" variant="light" onClick={fillTemplate}>
            填充模板
          </Button>
          <Button className="stats-model-catalog-import-submit" size="xs" leftSection={<IconCheck className="stats-model-catalog-import-submit-icon" size={14} />} onClick={() => void submitImport()} loading={importSubmitting}>
            导入
          </Button>
        </Group>
        <Textarea
          className="stats-model-catalog-import-text"
          value={importText}
          onChange={(e) => setImportText(e.currentTarget.value)}
          placeholder="粘贴导入 JSON（支持 vendors/models/mappings）"
          minRows={8}
          autosize
        />
        {lastImportResult && (
          <Alert className="stats-model-catalog-import-result" color={lastImportResult.errors?.length ? 'yellow' : 'green'} variant="light" title="最近一次导入结果">
            <Text className="stats-model-catalog-import-result-summary" size="sm">
              vendors={lastImportResult.imported.vendors} models={lastImportResult.imported.models} mappings={lastImportResult.imported.mappings}
            </Text>
            {lastImportResult.errors?.length ? (
              <pre className="stats-model-catalog-import-result-errors" style={{ margin: 0, marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.14)', overflowX: 'auto' }}>
                <code className="stats-model-catalog-import-result-errors-code">
                  {lastImportResult.errors.join('\n')}
                </code>
              </pre>
            ) : (
              <Text className="stats-model-catalog-import-result-ok" size="xs" c="dimmed" mt={6}>
                无错误
              </Text>
            )}
          </Alert>
        )}
      </Stack>

      <Divider className="stats-model-catalog-divider" label="厂商（Vendor）" labelPosition="left" />
      <Group className="stats-model-catalog-vendor-actions" gap={6} wrap="wrap">
        <Button className="stats-model-catalog-vendor-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-vendor-create-icon" size={14} />} onClick={openCreateVendor}>
          新增厂商
        </Button>
        <Switch className="stats-model-catalog-enabled-only" checked={enabledOnly} onChange={(e) => setEnabledOnly(e.currentTarget.checked)} label="仅看启用" />
        <Select className="stats-model-catalog-vendor-filter" value={vendorFilter} onChange={(v) => setVendorFilter(v || 'all')} data={vendorSelectData} searchable w={260} />
      </Group>

      <div className="stats-model-catalog-vendors-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-vendors-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-vendors-table-head">
            <Table.Tr className="stats-model-catalog-vendors-table-head-row">
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 140 }}>Key</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 180 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 160 }}>鉴权</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell">BaseUrl Hint</Table.Th>
              <Table.Th className="stats-model-catalog-vendors-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-vendors-table-body">
            {loading && !vendors.length ? (
              <Table.Tr className="stats-model-catalog-vendors-table-row-loading">
                <Table.Td className="stats-model-catalog-vendors-table-cell" colSpan={6}>
                  <Group className="stats-model-catalog-loading" gap="xs" align="center">
                    <Loader className="stats-model-catalog-loading-icon" size="sm" />
                    <Text className="stats-model-catalog-loading-text" size="sm" c="dimmed">加载中…</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ) : !vendors.length ? (
              <Table.Tr className="stats-model-catalog-vendors-table-row-empty">
                <Table.Td className="stats-model-catalog-vendors-table-cell" colSpan={6}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无厂商</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              vendors.map((v) => (
                <Table.Tr className="stats-model-catalog-vendors-table-row" key={v.key}>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-key" size="sm" fw={600}>{v.key}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-name" size="sm">{v.name}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    {formatEnabled(!!v.enabled)}
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-auth" size="sm" c="dimmed">{String(v.authType || 'bearer')}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Text className="stats-model-catalog-vendor-baseurl" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{(v.baseUrlHint || '').trim() || '—'}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-vendors-table-cell">
                    <Group className="stats-model-catalog-vendor-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Button className="stats-model-catalog-vendor-edit" size="xs" variant="light" onClick={() => openEditVendor(v)}>编辑</Button>
                      <ActionIcon className="stats-model-catalog-vendor-delete" size="sm" variant="light" color="red" aria-label="delete-vendor" onClick={() => void handleDeleteVendor(v)}>
                        <IconTrash className="stats-model-catalog-vendor-delete-icon" size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>

      <Divider className="stats-model-catalog-divider" label="模型（Model）" labelPosition="left" />
      <Group className="stats-model-catalog-model-actions" gap="xs" wrap="wrap">
        <Button className="stats-model-catalog-model-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-model-create-icon" size={14} />} onClick={openCreateModel}>
          新增模型
        </Button>
        <Select className="stats-model-catalog-model-kind-filter" value={modelKindFilter} onChange={(v) => setModelKindFilter((v as any) || 'all')} data={modelKindSelectData} w={200} />
      </Group>

      <div className="stats-model-catalog-models-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-models-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-models-table-head">
            <Table.Tr className="stats-model-catalog-models-table-head-row">
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 260 }}>模型 Key</Table.Th>
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 220 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 140 }}>厂商</Table.Th>
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 90 }}>类型</Table.Th>
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-models-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-models-table-body">
            {!filteredModels.length ? (
              <Table.Tr className="stats-model-catalog-models-table-row-empty">
                <Table.Td className="stats-model-catalog-models-table-cell" colSpan={6}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无模型</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filteredModels.map((m) => (
                <Table.Tr className="stats-model-catalog-models-table-row" key={m.modelKey}>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    <Text className="stats-model-catalog-model-key" size="sm" fw={600}>{m.modelKey}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    <Text className="stats-model-catalog-model-label" size="sm">{m.labelZh}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    <Text className="stats-model-catalog-model-vendor" size="sm" c="dimmed">{formatVendor(m.vendorKey)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    <Text className="stats-model-catalog-model-kind" size="sm">{formatKind(m.kind)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    {formatEnabled(!!m.enabled)}
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-models-table-cell">
                    <Group className="stats-model-catalog-model-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Button className="stats-model-catalog-model-edit" size="xs" variant="light" onClick={() => openEditModel(m)}>编辑</Button>
                      <ActionIcon className="stats-model-catalog-model-delete" size="sm" variant="light" color="red" aria-label="delete-model" onClick={() => void handleDeleteModel(m)}>
                        <IconTrash className="stats-model-catalog-model-delete-icon" size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>

      <Divider className="stats-model-catalog-divider" label="字段映射（Transform）" labelPosition="left" />
      <Group className="stats-model-catalog-mapping-actions" gap="xs" wrap="wrap">
        <Button className="stats-model-catalog-mapping-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-mapping-create-icon" size={14} />} onClick={openCreateMapping}>
          新增映射
        </Button>
        <Select className="stats-model-catalog-mapping-taskkind-filter" value={taskKindFilter} onChange={(v) => setTaskKindFilter((v as any) || 'all')} data={taskKindSelectData} w={260} />
      </Group>

      <div className="stats-model-catalog-mappings-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-mappings-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-mappings-table-head">
            <Table.Tr className="stats-model-catalog-mappings-table-head-row">
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 120 }}>厂商</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 170 }}>任务类型</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 180 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Request</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Response</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-mappings-table-body">
            {!filteredMappings.length ? (
              <Table.Tr className="stats-model-catalog-mappings-table-row-empty">
                <Table.Td className="stats-model-catalog-mappings-table-cell" colSpan={7}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无映射</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filteredMappings.map((mp) => (
                <Table.Tr className="stats-model-catalog-mappings-table-row" key={mp.id}>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-vendor" size="sm" fw={600}>{mp.vendorKey}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-taskkind" size="sm" c="dimmed">{formatTaskKind(mp.taskKind)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-name" size="sm">{mp.name}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    {formatEnabled(!!mp.enabled)}
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-request" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mp.requestMapping ? prettyJson(mp.requestMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-response" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mp.responseMapping ? prettyJson(mp.responseMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Group className="stats-model-catalog-mapping-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Button className="stats-model-catalog-mapping-edit" size="xs" variant="light" onClick={() => openEditMapping(mp)}>编辑</Button>
                      <ActionIcon className="stats-model-catalog-mapping-delete" size="sm" variant="light" color="red" aria-label="delete-mapping" onClick={() => void handleDeleteMapping(mp)}>
                        <IconTrash className="stats-model-catalog-mapping-delete-icon" size={14} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>

      <Modal className="stats-model-catalog-vendor-modal" opened={vendorEditOpen} onClose={() => setVendorEditOpen(false)} title={vendorEditIsNew ? '新增厂商' : '编辑厂商'} size="md" radius="lg" centered>
        <Stack className="stats-model-catalog-vendor-form" gap="sm">
          <TextInput className="stats-model-catalog-vendor-form-key" label="Key（唯一）" placeholder="例如 openai / gemini / minimax" value={vendorEditKey} onChange={(e) => setVendorEditKey(e.currentTarget.value)} disabled={!vendorEditIsNew} />
          <TextInput className="stats-model-catalog-vendor-form-name" label="名称" placeholder="显示名称" value={vendorEditName} onChange={(e) => setVendorEditName(e.currentTarget.value)} />
          <Switch className="stats-model-catalog-vendor-form-enabled" checked={vendorEditEnabled} onChange={(e) => setVendorEditEnabled(e.currentTarget.checked)} label="启用" />
          <Select className="stats-model-catalog-vendor-form-auth" label="鉴权方式（提示用）" data={AUTH_TYPE_OPTIONS} value={vendorEditAuthType} onChange={(v) => setVendorEditAuthType((v as any) || 'bearer')} />
          <TextInput className="stats-model-catalog-vendor-form-baseurl" label="BaseUrl Hint（可选）" placeholder="例如 https://api.openai.com" value={vendorEditBaseUrlHint} onChange={(e) => setVendorEditBaseUrlHint(e.currentTarget.value)} />
          <Group className="stats-model-catalog-vendor-form-auth-extra" gap="sm" wrap="wrap" align="flex-end">
            <TextInput className="stats-model-catalog-vendor-form-auth-header" label="Auth Header（可选）" placeholder="例如 X-API-Key" value={vendorEditAuthHeader} onChange={(e) => setVendorEditAuthHeader(e.currentTarget.value)} w={220} />
            <TextInput className="stats-model-catalog-vendor-form-auth-query" label="Auth Query Param（可选）" placeholder="例如 api_key" value={vendorEditAuthQueryParam} onChange={(e) => setVendorEditAuthQueryParam(e.currentTarget.value)} w={220} />
          </Group>
          <Textarea className="stats-model-catalog-vendor-form-meta" label="meta（JSON，可选）" value={vendorEditMeta} onChange={(e) => setVendorEditMeta(e.currentTarget.value)} minRows={4} autosize />
          <Group className="stats-model-catalog-vendor-form-actions" justify="flex-end" gap={8}>
            <Button className="stats-model-catalog-vendor-form-cancel" variant="subtle" onClick={() => setVendorEditOpen(false)}>取消</Button>
            <Button className="stats-model-catalog-vendor-form-save" onClick={() => void submitVendor()} loading={vendorEditSubmitting}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal className="stats-model-catalog-model-modal" opened={modelEditOpen} onClose={() => setModelEditOpen(false)} title={modelEditIsNew ? '新增模型' : '编辑模型'} size="md" radius="lg" centered>
        <Stack className="stats-model-catalog-model-form" gap="sm">
          <Select className="stats-model-catalog-model-form-vendor" label="厂商" data={vendorOnlyData} value={modelEditVendorKey} onChange={(v) => setModelEditVendorKey(v || '')} searchable />
          <TextInput className="stats-model-catalog-model-form-key" label="模型 Key（唯一）" placeholder="例如 gpt-4.1 / nano-banana-pro" value={modelEditModelKey} onChange={(e) => setModelEditModelKey(e.currentTarget.value)} disabled={!modelEditIsNew} />
          <TextInput className="stats-model-catalog-model-form-label" label="中文名称" placeholder="例如 GPT-4.1" value={modelEditLabelZh} onChange={(e) => setModelEditLabelZh(e.currentTarget.value)} />
          <Select className="stats-model-catalog-model-form-kind" label="类型" data={KIND_OPTIONS} value={modelEditKind} onChange={(v) => setModelEditKind((v as any) || 'text')} />
          <Switch className="stats-model-catalog-model-form-enabled" checked={modelEditEnabled} onChange={(e) => setModelEditEnabled(e.currentTarget.checked)} label="启用" />
          <Textarea className="stats-model-catalog-model-form-meta" label="meta（JSON，可选）" value={modelEditMeta} onChange={(e) => setModelEditMeta(e.currentTarget.value)} minRows={4} autosize />
          <Group className="stats-model-catalog-model-form-actions" justify="flex-end" gap={8}>
            <Button className="stats-model-catalog-model-form-cancel" variant="subtle" onClick={() => setModelEditOpen(false)}>取消</Button>
            <Button className="stats-model-catalog-model-form-save" onClick={() => void submitModel()} loading={modelEditSubmitting}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal className="stats-model-catalog-mapping-modal" opened={mappingEditOpen} onClose={() => setMappingEditOpen(false)} title={mappingEditId ? '编辑映射' : '新增映射'} size="lg" radius="lg" centered>
        <Stack className="stats-model-catalog-mapping-form" gap="sm">
          <Group className="stats-model-catalog-mapping-form-top" gap="sm" wrap="wrap" align="flex-end">
            <Select className="stats-model-catalog-mapping-form-vendor" label="厂商" data={vendorOnlyData} value={mappingEditVendorKey} onChange={(v) => setMappingEditVendorKey(v || '')} searchable w={260} />
            <Select className="stats-model-catalog-mapping-form-taskkind" label="任务类型" data={TASK_KIND_OPTIONS} value={mappingEditTaskKind} onChange={(v) => setMappingEditTaskKind((v as any) || 'text_to_image')} w={260} />
          </Group>
          <TextInput className="stats-model-catalog-mapping-form-name" label="映射名称" placeholder="例如 默认映射 / v2 / 自定义" value={mappingEditName} onChange={(e) => setMappingEditName(e.currentTarget.value)} />
          <Switch className="stats-model-catalog-mapping-form-enabled" checked={mappingEditEnabled} onChange={(e) => setMappingEditEnabled(e.currentTarget.checked)} label="启用" />
          <Textarea className="stats-model-catalog-mapping-form-request" label="requestMapping（JSON，可选）" value={mappingEditRequest} onChange={(e) => setMappingEditRequest(e.currentTarget.value)} minRows={6} autosize placeholder="把 TaskRequestDto 映射到三方请求体的规则（后续你给接口文档我再补齐）" />
          <Textarea className="stats-model-catalog-mapping-form-response" label="responseMapping（JSON，可选）" value={mappingEditResponse} onChange={(e) => setMappingEditResponse(e.currentTarget.value)} minRows={6} autosize placeholder="把三方响应映射回 TaskResultDto 的规则" />
          <Group className="stats-model-catalog-mapping-form-actions" justify="flex-end" gap={8}>
            <Button className="stats-model-catalog-mapping-form-cancel" variant="subtle" onClick={() => setMappingEditOpen(false)}>取消</Button>
            <Button className="stats-model-catalog-mapping-form-save" onClick={() => void submitMapping()} loading={mappingEditSubmitting}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
