import React from 'react'
import { ActionIcon, Badge, Button, CopyButton, Divider, Group, Loader, Menu, Modal, NumberInput, Paper, Select, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip, Title, UnstyledButton } from '@mantine/core'
import { IconCheck, IconChevronRight, IconCopy, IconEye, IconPencil, IconPlayerPlay, IconPlus, IconRefresh, IconRestore, IconTrash, IconUpload } from '@tabler/icons-react'
import { API_BASE, createApiKey, deleteApiKey, fetchPublicTaskResultWithAuth, getPromptEvolutionRuntime, listApiKeys, listPromptEvolutionRuns, listTaskLogs, publishPromptEvolutionRun, rollbackPromptEvolution, runPromptEvolution, updateApiKey, type ApiKeyDto, type PromptEvolutionRunHistoryDto, type PromptEvolutionRunResponseDto, type PromptEvolutionRuntimeDto, type TaskAssetDto, type TaskKind, type VendorCallLogDto, type VendorCallLogStatus } from '../../../api/server'
import { toast } from '../../toast'
import { useUIStore } from '../../uiStore'
import StatsPublicApiDebugger from './StatsPublicApiDebugger'
import StatsModelCatalogManagement from './modelCatalog/StatsModelCatalogManagement'
import StatsRuntimeDiagnostics from './StatsRuntimeDiagnostics'
import AiCharacterLibraryManagementPanel from '../../AiCharacterLibraryManagementPanel'
import { PanelCard } from '../../PanelCard'
import { InlinePanel } from '../../InlinePanel'

function parseOriginsInput(input: string): string[] {
  return String(input || '')
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatLastUsedAt(lastUsedAt?: string | null): string {
  if (!lastUsedAt) return '未使用'
  const t = Date.parse(lastUsedAt)
  if (!Number.isFinite(t)) return '未使用'
  return new Date(t).toLocaleString()
}

const TASK_KIND_LABELS: Record<string, string> = {
  chat: '文本',
  prompt_refine: '指令优化',
  text_to_image: '图片',
  image_to_prompt: '图像理解',
  image_to_video: '图像转视频',
  text_to_video: '视频',
  image_edit: '图像编辑',
}

function formatTaskKind(kind?: string | null): string {
  const key = typeof kind === 'string' ? kind.trim() : ''
  if (!key) return '—'
  return TASK_KIND_LABELS[key] || key
}

function statusColor(status: VendorCallLogStatus): string {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  return 'blue'
}

function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return '—'
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`
}

function formatJsonPreview(input?: string | null): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

type AssetMediaKind = 'image' | 'video'

type AssetPreviewItem = {
  url: string
  kind: AssetMediaKind
}

type InlineInputSummary = {
  mimeType: string | null
  dataLabel: string
}

const IMAGE_GENERATION_TASK_KINDS = new Set<TaskKind>(['text_to_image', 'image_edit'])

function normalizeTaskKindForFetch(kind?: string | null): TaskKind | null {
  const v = String(kind || '').trim()
  if (!v) return null
  if (v === 'text_to_image' || v === 'image_edit') return v
  if (v === 'chat' || v === 'prompt_refine' || v === 'image_to_prompt' || v === 'image_to_video' || v === 'text_to_video') return v
  return null
}

function normalizeDispatchVendor(vendor?: string | null): string {
  const raw = String(vendor || '').trim().toLowerCase()
  if (!raw) return ''
  const parts = raw.split(':').map((part) => part.trim()).filter(Boolean)
  const last = parts.length ? parts[parts.length - 1] : raw
  return last === 'google' ? 'gemini' : last
}

function isImageTaskPollingSupported(vendor?: string | null): boolean {
  const raw = String(vendor || '').trim().toLowerCase()
  if (!raw) return false
  const dispatchVendor = normalizeDispatchVendor(raw)
  if (dispatchVendor === 'apimart') return true
  if (raw === 'gemini' || raw === 'google') return true
  if (raw === 'grsai' || raw.startsWith('grsai-') || raw.startsWith('grsai:')) return true
  if (raw === 'comfly' || raw.startsWith('comfly-') || raw.startsWith('comfly:')) return true
  if (raw.startsWith('apimart-') || raw.startsWith('apimart:')) return true
  return false
}

function makeLogPreviewKey(input: Pick<VendorCallLogDto, 'vendor' | 'taskId'>): string {
  return `${String(input.vendor || '').trim().toLowerCase()}:${String(input.taskId || '').trim()}`
}

function formatLogCaller(log: VendorCallLogDto): string {
  const login = typeof log.userLogin === 'string' ? log.userLogin.trim() : ''
  const name = typeof log.userName === 'string' ? log.userName.trim() : ''
  const userId = typeof log.userId === 'string' ? log.userId.trim() : ''
  if (login && name) return `${name} (@${login})`
  if (login) return `@${login}`
  if (name) return name
  return userId || '—'
}

function extractPromptFromRequestPayload(payload?: string | null): string | undefined {
  const parsed = parseJsonLoose(payload)
  if (!parsed || typeof parsed !== 'object') return undefined
  const directPrompt = typeof (parsed as { prompt?: unknown }).prompt === 'string'
    ? String((parsed as { prompt?: unknown }).prompt).trim()
    : ''
  if (directPrompt) return directPrompt
  const nestedRequest = (parsed as { request?: unknown }).request
  if (!nestedRequest || typeof nestedRequest !== 'object') return undefined
  const nestedPrompt = typeof (nestedRequest as { prompt?: unknown }).prompt === 'string'
    ? String((nestedRequest as { prompt?: unknown }).prompt).trim()
    : ''
  return nestedPrompt || undefined
}

function normalizeTaskAssetsToPreviewItems(assets: TaskAssetDto[] | undefined): AssetPreviewItem[] {
  const list = Array.isArray(assets) ? assets : []
  const deduped = new Map<string, AssetPreviewItem>()
  list.forEach((asset) => {
    const url = typeof asset?.url === 'string' ? asset.url.trim() : ''
    if (!url || !/^https?:\/\//i.test(url)) return
    const kind: AssetMediaKind = asset?.type === 'video' ? 'video' : 'image'
    if (!deduped.has(url)) deduped.set(url, { url, kind })
  })
  return Array.from(deduped.values())
}

function parseJsonLoose(input?: string | null): unknown {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function normalizeMediaKindFromKey(key: string): AssetMediaKind | null {
  const normalized = key.trim().toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('video') ||
    normalized.includes('movie') ||
    normalized.includes('clip')
  ) {
    return 'video'
  }
  if (
    normalized.includes('image') ||
    normalized.includes('img') ||
    normalized.includes('photo') ||
    normalized.includes('frame') ||
    normalized.includes('poster') ||
    normalized.includes('thumb')
  ) {
    return 'image'
  }
  return null
}

function normalizeMediaKindFromUrl(url: string): AssetMediaKind | null {
  const normalized = url.toLowerCase()
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) return 'image'
  if (/^data:video\/[a-z0-9.+-]+;base64,/i.test(normalized)) return 'video'
  if (/\.(mp4|webm|mov|m4v|avi|mkv|m3u8)(\?|#|$)/i.test(normalized)) return 'video'
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg|heic|heif|avif)(\?|#|$)/i.test(normalized)) return 'image'
  return null
}

function collectMediaFromUnknown(
  input: unknown,
  currentKey: string,
  out: AssetPreviewItem[],
): void {
  if (typeof input === 'string') {
    const raw = input.trim()
    const keyKind = normalizeMediaKindFromKey(currentKey)
    const urlKind = normalizeMediaKindFromUrl(raw)
    const kind = keyKind || urlKind
    if (!kind) return
    if (!/^https?:\/\//i.test(raw) && !/^data:(image|video)\//i.test(raw)) return
    out.push({ url: raw, kind })
    return
  }
  if (!input || typeof input !== 'object') return
  if (Array.isArray(input)) {
    input.forEach((item) => collectMediaFromUnknown(item, currentKey, out))
    return
  }
  Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
    collectMediaFromUnknown(value, key, out)
  })
}

function extractPreviewAssets(input?: string | null): AssetPreviewItem[] {
  const parsed = parseJsonLoose(input)
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const directReferenceSheet = extractReferenceSheetPreviewAsset(record)
    if (directReferenceSheet.length) return directReferenceSheet
    const nestedRequest =
      record.request && typeof record.request === 'object' && !Array.isArray(record.request)
        ? extractReferenceSheetPreviewAsset(record.request as Record<string, unknown>)
        : []
    if (nestedRequest.length) return nestedRequest
  }
  const found: AssetPreviewItem[] = []
  collectMediaFromUnknown(parsed, '', found)
  const deduped = new Map<string, AssetPreviewItem>()
  found.forEach((item) => {
    if (!deduped.has(item.url)) deduped.set(item.url, item)
  })
  return Array.from(deduped.values())
}

function extractReferenceSheetPreviewAsset(record: Record<string, unknown>): AssetPreviewItem[] {
  const extras =
    record.extras && typeof record.extras === 'object' && !Array.isArray(record.extras)
      ? record.extras as Record<string, unknown>
      : record
  const referenceSheet =
    extras.referenceSheet && typeof extras.referenceSheet === 'object' && !Array.isArray(extras.referenceSheet)
      ? extras.referenceSheet as Record<string, unknown>
      : null
  const url = referenceSheet && typeof referenceSheet.url === 'string' ? referenceSheet.url.trim() : ''
  if (!url || !/^https?:\/\//i.test(url)) return []
  return [{ url, kind: 'image' }]
}

function collectInlineInputsFromUnknown(input: unknown, out: InlineInputSummary[]): void {
  if (!input || typeof input !== 'object') return
  if (Array.isArray(input)) {
    input.forEach((item) => collectInlineInputsFromUnknown(item, out))
    return
  }
  const record = input as Record<string, unknown>
  const rawInline = record.inlineData ?? record.inline_data
  if (rawInline && typeof rawInline === 'object' && !Array.isArray(rawInline)) {
    const inlineRecord = rawInline as Record<string, unknown>
    const rawMimeType = inlineRecord.mimeType ?? inlineRecord.mime_type
    const rawData = inlineRecord.data
    const mimeType = typeof rawMimeType === 'string' && rawMimeType.trim() ? rawMimeType.trim() : null
    const dataLabel = typeof rawData === 'string' && rawData.trim() ? rawData.trim() : '[omitted]'
    out.push({ mimeType, dataLabel })
  }
  Object.values(record).forEach((value) => {
    collectInlineInputsFromUnknown(value, out)
  })
}

function extractInlineInputSummaries(input?: string | null): InlineInputSummary[] {
  const parsed = parseJsonLoose(input)
  const found: InlineInputSummary[] = []
  collectInlineInputsFromUnknown(parsed, found)
  return found
}

type OpenPreviewPayload = {
  url: string
  kind: 'image' | 'video' | 'audio'
  name?: string
}

type OpenPreviewHandler = (payload: OpenPreviewPayload) => void

function renderAssetPreviewList(
  items: AssetPreviewItem[],
  classNamePrefix: string,
  openPreview: OpenPreviewHandler,
): JSX.Element {
  if (!items.length) {
    return (
      <Text className={`${classNamePrefix}-empty`} size="xs" c="dimmed">
        —
      </Text>
    )
  }
  const display = items.slice(0, 2)
  const rest = items.length - display.length
  return (
    <Group className={`${classNamePrefix}-group`} gap={6} wrap="nowrap">
      {display.map((asset) => (
        <button
          className={`${classNamePrefix}-trigger`}
          key={`${classNamePrefix}-${asset.url}`}
          type="button"
          title={asset.url}
          onClick={() => openPreview({ url: asset.url, kind: asset.kind, name: '任务预览' })}
          style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          {asset.kind === 'video' ? (
            <video
              className={`${classNamePrefix}-video`}
              src={asset.url}
              muted
              playsInline
              preload="metadata"
              style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }}
            />
          ) : (
            <img
              className={`${classNamePrefix}-image`}
              src={asset.url}
              alt="asset-preview"
              loading="lazy"
              style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }}
            />
          )}
        </button>
      ))}
      {rest > 0 && (
        <Badge className={`${classNamePrefix}-more`} size="xs" variant="light">
          +{rest}
        </Badge>
      )}
    </Group>
  )
}

type StatsSystemSection = 'modelCatalog' | 'promptEvolution' | 'apiAccess' | 'taskLogs' | 'runtimeDiagnostics' | 'characterLibrary'

type StatsSystemGroupKey = 'models' | 'diagnostics' | 'access' | 'assets'

type StatsSystemNavGroup = {
  key: StatsSystemGroupKey
  label: string
  description: string
  children: Array<{
    value: StatsSystemSection
    label: string
    description: string
  }>
}

const STATS_SYSTEM_NAV_GROUPS: StatsSystemNavGroup[] = [
  {
    key: 'models',
    label: '模型与优化',
    description: '模型目录与提示词优化任务。',
    children: [
      { value: 'modelCatalog', label: '模型管理', description: '系统级模型目录、能力与可选项管理。' },
      { value: 'promptEvolution', label: '提示词优化', description: '查看、触发与发布提示词优化任务。' },
    ],
  },
  {
    key: 'diagnostics',
    label: '诊断与日志',
    description: '查看生成任务日志与运行时资源快照。',
    children: [
      { value: 'runtimeDiagnostics', label: '运行时资源', description: '查看资源句柄、对象 URL 与上传 owner 绑定。' },
      { value: 'taskLogs', label: '生成任务日志', description: '查看任务状态、请求体与上游回显。' },
    ],
  },
  {
    key: 'access',
    label: '接入与密钥',
    description: '外站调用地址、在线调试与 API Key。',
    children: [
      { value: 'apiAccess', label: 'API 接入', description: '查看公开调用地址、在线调试以及 Key 管理。' },
    ],
  },
  {
    key: 'assets',
    label: '资产与素材',
    description: '管理系统级角色库与共享素材能力。',
    children: [
      { value: 'characterLibrary', label: '角色库管理', description: '角色库后台 CRUD、分页查询与 JSON 批量导入。' },
    ],
  },
]

const STATS_SYSTEM_SECTION_META: Record<StatsSystemSection, { label: string; description: string; groupKey: StatsSystemGroupKey }> = {
  modelCatalog: { label: '模型管理', description: '系统级模型目录、能力与可选项管理。', groupKey: 'models' },
  promptEvolution: { label: '提示词优化', description: '查看、触发与发布提示词优化任务。', groupKey: 'models' },
  runtimeDiagnostics: { label: '运行时资源', description: '查看资源句柄、对象 URL、trim 计数与上传 owner 绑定。', groupKey: 'diagnostics' },
  taskLogs: { label: '生成任务日志', description: '查看任务状态、请求体与上游回显。', groupKey: 'diagnostics' },
  apiAccess: { label: 'API 接入', description: '查看公开调用地址、在线调试以及 API Key 管理。', groupKey: 'access' },
  characterLibrary: { label: '角色库管理', description: '角色库后台 CRUD、分页查询与 JSON 批量导入。', groupKey: 'assets' },
}

export default function StatsSystemManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-system', className].filter(Boolean).join(' ')
  const openPreview = useUIStore((state) => state.openPreview)
  const [section, setSection] = React.useState<StatsSystemSection>('apiAccess')

  const [keys, setKeys] = React.useState<ApiKeyDto[]>([])
  const [keysLoading, setKeysLoading] = React.useState(false)

  const [createLabel, setCreateLabel] = React.useState('外部调用')
  const [createOrigins, setCreateOrigins] = React.useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  })
  const [createEnabled, setCreateEnabled] = React.useState(true)
  const [createSubmitting, setCreateSubmitting] = React.useState(false)

  const [createdKey, setCreatedKey] = React.useState<string | null>(null)
  const [createdOpen, setCreatedOpen] = React.useState(false)

  const [editOpen, setEditOpen] = React.useState(false)
  const [editSubmitting, setEditSubmitting] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [editLabel, setEditLabel] = React.useState('')
  const [editEnabled, setEditEnabled] = React.useState(true)
  const [editOrigins, setEditOrigins] = React.useState('')

  const reloadKeys = React.useCallback(async () => {
    setKeysLoading(true)
    try {
      const data = await listApiKeys()
      setKeys(Array.isArray(data) ? data : [])
    } catch (err: any) {
      console.error('list api keys failed', err)
      setKeys([])
      toast(err?.message || '加载 API Key 列表失败', 'error')
    } finally {
      setKeysLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reloadKeys()
  }, [reloadKeys])

  const publicChatUrl = `${API_BASE || ''}/public/agents/chat`
  const publicDrawUrl = `${API_BASE || ''}/public/draw`
  const publicVisionUrl = `${API_BASE || ''}/public/vision`
  const publicVideoUrl = `${API_BASE || ''}/public/video`
  const publicTaskResultUrl = `${API_BASE || ''}/public/tasks/result`

  const fetchSnippet = `// 1) 绘图（POST ${publicDrawUrl}）
fetch('${publicDrawUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    vendor: 'auto',
    prompt: '一个赛博风格的透明玻璃徽章，中文“TapCanvas”，高细节，干净背景',
    extras: { modelAlias: 'nano-banana-pro', aspectRatio: '1:1' }
  }),
}).then(r => r.json())

// 2) 图像理解（POST ${publicVisionUrl}）
fetch('${publicVisionUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    vendor: 'auto',
    imageUrl: 'https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png',
    prompt: '请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。',
    modelAlias: 'gemini-1.5-pro-latest',
    temperature: 0.2
  }),
}).then(r => r.json())

// 3) 生成视频（POST ${publicVideoUrl}）
fetch('${publicVideoUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    vendor: 'auto',
    prompt: '一只白猫在雨夜霓虹街头慢慢走过，电影感镜头，稳定光影',
    durationSeconds: 10,
    extras: { modelAlias: '<YOUR_VIDEO_MODEL_ALIAS>' }
  }),
}).then(r => r.json())

// 4) 查任务（POST ${publicTaskResultUrl}）
fetch('${publicTaskResultUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({
    taskId: '<TASK_ID>',
    taskKind: 'text_to_video'
  }),
}).then(r => r.json())

// （可选）文本（POST ${publicChatUrl}）
fetch('${publicChatUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '<YOUR_KEY>',
  },
  body: JSON.stringify({ vendor: 'auto', prompt: '你好，帮我用中文回答…' }),
}).then(r => r.json())`

  const handleCreate = async () => {
    if (createSubmitting) return
    const label = createLabel.trim() || '外部调用'
    const allowedOrigins = parseOriginsInput(createOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin（如 https://example.com），或使用 *', 'error')
      return
    }
    setCreateSubmitting(true)
    try {
      const result = await createApiKey({ label, allowedOrigins, enabled: createEnabled })
      setKeys((prev) => [result.apiKey, ...prev])
      setCreatedKey(result.key)
      setCreatedOpen(true)
      toast('Key 已生成（仅展示一次，请及时保存）', 'success')
    } catch (err: any) {
      console.error('create api key failed', err)
      toast(err?.message || '创建 API Key 失败', 'error')
    } finally {
      setCreateSubmitting(false)
    }
  }

  const openEdit = (item: ApiKeyDto) => {
    setEditId(item.id)
    setEditLabel(item.label || '')
    setEditEnabled(Boolean(item.enabled))
    setEditOrigins((item.allowedOrigins || []).join('\n'))
    setEditOpen(true)
  }

  const handleEditSave = async () => {
    if (!editId || editSubmitting) return
    const label = editLabel.trim() || '外部调用'
    const allowedOrigins = parseOriginsInput(editOrigins)
    if (!allowedOrigins.length) {
      toast('请至少填写一个 Origin（如 https://example.com），或使用 *', 'error')
      return
    }
    setEditSubmitting(true)
    try {
      const updated = await updateApiKey(editId, { label, allowedOrigins, enabled: editEnabled })
      setKeys((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setEditOpen(false)
      toast('已保存', 'success')
    } catch (err: any) {
      console.error('update api key failed', err)
      toast(err?.message || '更新 API Key 失败', 'error')
    } finally {
      setEditSubmitting(false)
    }
  }

  const handleDelete = async (item: ApiKeyDto) => {
    if (!window.confirm(`确定删除 API Key「${item.label || item.keyPrefix}」？删除后外站将无法继续调用。`)) return
    try {
      await deleteApiKey(item.id)
      setKeys((prev) => prev.filter((x) => x.id !== item.id))
      toast('已删除', 'success')
    } catch (err: any) {
      console.error('delete api key failed', err)
      toast(err?.message || '删除 API Key 失败', 'error')
    }
  }

  const [logs, setLogs] = React.useState<VendorCallLogDto[]>([])
  const [logsLoading, setLogsLoading] = React.useState(false)
  const [logsLoadingMore, setLogsLoadingMore] = React.useState(false)
  const [logsHasMore, setLogsHasMore] = React.useState(false)
  const [logsCursor, setLogsCursor] = React.useState<string | null>(null)
  const [logsVendor, setLogsVendor] = React.useState<string>('all')
  const [logsStatus, setLogsStatus] = React.useState<string>('all')
  const [taskOutputPreviewMap, setTaskOutputPreviewMap] = React.useState<Record<string, AssetPreviewItem[]>>({})

  const [inspectOpen, setInspectOpen] = React.useState(false)
  const [inspectItem, setInspectItem] = React.useState<VendorCallLogDto | null>(null)
  const [promptEvolutionRunning, setPromptEvolutionRunning] = React.useState(false)
  const [promptEvolutionActionLoading, setPromptEvolutionActionLoading] = React.useState(false)
  const [promptEvolutionDryRun, setPromptEvolutionDryRun] = React.useState(true)
  const [promptEvolutionResult, setPromptEvolutionResult] = React.useState<PromptEvolutionRunResponseDto | null>(null)
  const [promptEvolutionRuns, setPromptEvolutionRuns] = React.useState<PromptEvolutionRunHistoryDto[]>([])
  const [promptEvolutionRuntime, setPromptEvolutionRuntime] = React.useState<PromptEvolutionRuntimeDto | null>(null)
  const [promptEvolutionCanaryPercent, setPromptEvolutionCanaryPercent] = React.useState<number>(5)
  const [promptEvolutionPublishRunId, setPromptEvolutionPublishRunId] = React.useState<string | null>(null)

  const openInspect = (item: VendorCallLogDto) => {
    setInspectItem(item)
    setInspectOpen(true)
  }

  const closeInspect = () => {
    setInspectOpen(false)
    setInspectItem(null)
  }

  const inspectInputAssets = React.useMemo(
    () => extractPreviewAssets(inspectItem?.requestPayload),
    [inspectItem?.requestPayload],
  )
  const inspectInlineInputs = React.useMemo(
    () => extractInlineInputSummaries(inspectItem?.requestPayload),
    [inspectItem?.requestPayload],
  )
  const inspectOutputAssets = React.useMemo(
    () => {
      const fromLog = extractPreviewAssets(inspectItem?.upstreamResponse)
      if (fromLog.length) return fromLog
      if (!inspectItem) return []
      return taskOutputPreviewMap[makeLogPreviewKey(inspectItem)] || []
    },
    [inspectItem, taskOutputPreviewMap],
  )

  const fetchLogs = React.useCallback(
    async (before: string | null) => {
      const vendor = logsVendor !== 'all' ? logsVendor : null
      const status = (logsStatus !== 'all' ? (logsStatus as VendorCallLogStatus) : null) as VendorCallLogStatus | null
      return listTaskLogs({ limit: 60, before, vendor, status })
    },
    [logsVendor, logsStatus],
  )

  const reloadLogs = React.useCallback(async () => {
    setLogsLoading(true)
    try {
      const resp = await fetchLogs(null)
      setLogs(Array.isArray(resp?.items) ? resp.items : [])
      setLogsHasMore(Boolean(resp?.hasMore))
      setLogsCursor(typeof resp?.nextBefore === 'string' ? resp.nextBefore : null)
    } catch (err: any) {
      console.error('list task logs failed', err)
      setLogs([])
      setLogsHasMore(false)
      setLogsCursor(null)
      toast(err?.message || '加载生成任务列表失败', 'error')
    } finally {
      setLogsLoading(false)
    }
  }, [fetchLogs])

  const loadMoreLogs = React.useCallback(async () => {
    if (!logsHasMore || logsLoadingMore) return
    setLogsLoadingMore(true)
    try {
      const resp = await fetchLogs(logsCursor)
      const nextItems = Array.isArray(resp?.items) ? resp.items : []
      setLogs((prev) => [...prev, ...nextItems])
      setLogsHasMore(Boolean(resp?.hasMore))
      setLogsCursor(typeof resp?.nextBefore === 'string' ? resp.nextBefore : null)
    } catch (err: any) {
      console.error('load more task logs failed', err)
      toast(err?.message || '加载更多失败', 'error')
    } finally {
      setLogsLoadingMore(false)
    }
  }, [logsHasMore, logsLoadingMore, logsCursor, fetchLogs])

  React.useEffect(() => {
    void reloadLogs()
  }, [reloadLogs, logsVendor, logsStatus])

  React.useEffect(() => {
    let cancelled = false
    const candidates = logs.filter((item) => {
      const taskKind = normalizeTaskKindForFetch(item.taskKind)
      if (!taskKind || !IMAGE_GENERATION_TASK_KINDS.has(taskKind)) return false
      if (!isImageTaskPollingSupported(item.vendor)) return false
      if (item.status !== 'succeeded') return false
      if (extractPreviewAssets(item.upstreamResponse).length > 0) return false
      const key = makeLogPreviewKey(item)
      return !taskOutputPreviewMap[key]?.length
    })
    if (!candidates.length) return

    const run = async () => {
      const maxConcurrency = 4
      let cursor = 0
      const updates: Record<string, AssetPreviewItem[]> = {}

      const worker = async () => {
        while (!cancelled) {
          const index = cursor
          cursor += 1
          if (index >= candidates.length) return
          const item = candidates[index]
          if (!item) return
          const taskKind = normalizeTaskKindForFetch(item.taskKind)
          if (!taskKind) continue
          try {
            const resp = await fetchPublicTaskResultWithAuth({
              taskId: item.taskId,
              vendor: item.vendor,
              taskKind,
              prompt: extractPromptFromRequestPayload(item.requestPayload),
            })
            const assets = normalizeTaskAssetsToPreviewItems(resp?.result?.assets)
            if (assets.length) updates[makeLogPreviewKey(item)] = assets
          } catch {
            // ignore preview enrichment failures
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(maxConcurrency, candidates.length) }, () => worker()))
      if (cancelled || !Object.keys(updates).length) return
      setTaskOutputPreviewMap((prev) => ({ ...prev, ...updates }))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [logs, taskOutputPreviewMap])

  const reloadPromptEvolutionCenter = React.useCallback(async () => {
    try {
      const [runs, runtime] = await Promise.all([
        listPromptEvolutionRuns(30),
        getPromptEvolutionRuntime(),
      ])
      setPromptEvolutionRuns(runs)
      setPromptEvolutionRuntime(runtime)
      const firstReady = runs.find((item) => item.action === 'ready_for_optimizer' && !item.dryRun)
      setPromptEvolutionPublishRunId((prev) => prev || firstReady?.id || null)
      if (typeof runtime?.canaryPercent === 'number' && Number.isFinite(runtime.canaryPercent)) {
        setPromptEvolutionCanaryPercent(runtime.canaryPercent)
      }
    } catch (err: any) {
      toast(err?.message || '加载提示词任务中心失败', 'error')
    }
  }, [])

  React.useEffect(() => {
    void reloadPromptEvolutionCenter()
  }, [reloadPromptEvolutionCenter])

  const handleRunPromptEvolution = React.useCallback(async () => {
    if (promptEvolutionRunning) return
    setPromptEvolutionRunning(true)
    try {
      const result = await runPromptEvolution({ dryRun: promptEvolutionDryRun })
      setPromptEvolutionResult(result)
      await reloadPromptEvolutionCenter()
      const outcome = result.action === 'ready_for_optimizer' ? '通过门禁，可进入优化流程' : '样本不足或仅演练，已跳过'
      toast(`提示词优化任务已执行：${outcome}`, 'success')
    } catch (err: any) {
      toast(err?.message || '触发提示词优化任务失败', 'error')
    } finally {
      setPromptEvolutionRunning(false)
    }
  }, [promptEvolutionDryRun, promptEvolutionRunning, reloadPromptEvolutionCenter])

  const handlePublishPromptEvolution = React.useCallback(async () => {
    const runId = String(promptEvolutionPublishRunId || '').trim()
    if (!runId) {
      toast('请选择可发布的运行记录', 'error')
      return
    }
    if (promptEvolutionActionLoading) return
    setPromptEvolutionActionLoading(true)
    try {
      await publishPromptEvolutionRun({
        runId,
        canaryPercent: Math.max(1, Math.min(100, Math.floor(Number(promptEvolutionCanaryPercent) || 0))),
      })
      await reloadPromptEvolutionCenter()
      toast('已发布到运行时策略', 'success')
    } catch (err: any) {
      toast(err?.message || '发布失败', 'error')
    } finally {
      setPromptEvolutionActionLoading(false)
    }
  }, [promptEvolutionActionLoading, promptEvolutionCanaryPercent, promptEvolutionPublishRunId, reloadPromptEvolutionCenter])

  const handleRollbackPromptEvolution = React.useCallback(async () => {
    if (promptEvolutionActionLoading) return
    setPromptEvolutionActionLoading(true)
    try {
      await rollbackPromptEvolution({ toRunId: undefined, reason: 'manual rollback from system management' })
      await reloadPromptEvolutionCenter()
      toast('已回滚当前发布版本', 'success')
    } catch (err: any) {
      toast(err?.message || '回滚失败', 'error')
    } finally {
      setPromptEvolutionActionLoading(false)
    }
  }, [promptEvolutionActionLoading, reloadPromptEvolutionCenter])

  const activeSectionMeta = STATS_SYSTEM_SECTION_META[section]
  const activeGroup = STATS_SYSTEM_NAV_GROUPS.find((group) => group.key === activeSectionMeta.groupKey) || STATS_SYSTEM_NAV_GROUPS[0]

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-system-layout" align="stretch" gap="md" wrap="nowrap">
        <PanelCard className="stats-system-sidebar glass" padding="compact" miw={220} maw={260}>
          <Stack className="stats-system-sidebar-stack" gap="xs">
            <div className="stats-system-sidebar-header">
              <Text className="stats-system-sidebar-title" fw={700} size="sm">系统管理</Text>
              <Text className="stats-system-sidebar-subtitle" size="xs" c="dimmed">悬浮左侧分组，选择二级菜单。</Text>
            </div>
            {STATS_SYSTEM_NAV_GROUPS.map((group) => {
              const groupChildren = group.children
              const currentChild = groupChildren.find((item) => item.value === section) || groupChildren[0]
              const groupActive = groupChildren.some((item) => item.value === section)

              return (
                <Menu className="stats-system-sidebar-menu" key={group.key} trigger="hover" openDelay={80} closeDelay={120} position="right-start" withinPortal>
                  <Menu.Target>
                    <UnstyledButton
                      className="stats-system-sidebar-group"
                      onClick={() => setSection(currentChild.value)}
                      style={{
                        display: 'block',
                        width: '100%',
                        borderRadius: 12,
                        padding: '12px 14px',
                        background: groupActive ? 'rgba(59,130,246,0.12)' : 'transparent',
                        border: groupActive ? '1px solid rgba(59,130,246,0.22)' : '1px solid transparent',
                      }}
                    >
                      <Stack className="stats-system-sidebar-group-stack" gap={4}>
                        <Group className="stats-system-sidebar-group-row" justify="space-between" align="center" wrap="nowrap">
                          <Text className="stats-system-sidebar-group-label" fw={600} size="sm">{group.label}</Text>
                          <IconChevronRight className="stats-system-sidebar-group-icon" size={14} />
                        </Group>
                        <Text className="stats-system-sidebar-group-current" size="xs" fw={500} c={groupActive ? 'blue' : 'dimmed'}>{currentChild.label}</Text>
                        <Text className="stats-system-sidebar-group-description" size="xs" c="dimmed">{group.description}</Text>
                      </Stack>
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown className="stats-system-sidebar-menu-dropdown">
                    {groupChildren.map((item) => (
                      <Menu.Item className="stats-system-sidebar-menu-item" key={item.value} onClick={() => setSection(item.value)}>
                        <div className="stats-system-sidebar-menu-item-body">
                          <Text className="stats-system-sidebar-menu-item-label" size="sm" fw={600}>{item.label}</Text>
                          <Text className="stats-system-sidebar-menu-item-description" size="xs" c="dimmed">{item.description}</Text>
                        </div>
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )
            })}
          </Stack>
        </PanelCard>

        <PanelCard className="stats-system-card glass" style={{ flex: 1, minWidth: 0 }}>
          <Group className="stats-system-card-header" justify="space-between" align="flex-start" gap="md" wrap="wrap">
            <div className="stats-system-card-header-left">
              <Group className="stats-system-card-title-row" gap={8} align="center">
                <Title className="stats-system-title" order={3}>系统管理</Title>
                <Badge className="stats-system-section-badge" variant="light" color="blue">{activeSectionMeta.label}</Badge>
              </Group>
              <Text className="stats-system-subtitle" size="sm" c="dimmed">
                {activeSectionMeta.description}
              </Text>
            </div>
            <Group className="stats-system-card-header-actions" gap={6}>
              {section === 'apiAccess' ? (
            <>
                <Tooltip className="stats-system-reload-keys-tooltip" label="刷新 Key" withArrow>
                  <ActionIcon
                    className="stats-system-reload-keys"
                    size="sm"
                    variant="subtle"
                    aria-label="刷新 Key"
                    onClick={() => void reloadKeys()}
                    loading={keysLoading}
                  >
                    <IconRefresh className="stats-system-reload-keys-icon" size={14} />
                  </ActionIcon>
                </Tooltip>
            </>
              ) : null}
              {section === 'taskLogs' ? (
            <>
                <Tooltip className="stats-system-reload-logs-tooltip" label="刷新任务" withArrow>
                  <ActionIcon
                    className="stats-system-reload-logs"
                    size="sm"
                    variant="subtle"
                    aria-label="刷新任务"
                    onClick={() => void reloadLogs()}
                    loading={logsLoading}
                  >
                    <IconRefresh className="stats-system-reload-logs-icon" size={14} />
                  </ActionIcon>
                </Tooltip>
            </>
              ) : null}
            </Group>
          </Group>

          <Text className="stats-system-current-group-hint" size="xs" c="dimmed" mt="xs">
            当前分组：{activeGroup.label}
          </Text>

          {section === 'modelCatalog' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="模型管理（系统级）" labelPosition="left" />
        <StatsModelCatalogManagement className="stats-system-model-catalog" />
            </>


          ) : null}

          {section === 'promptEvolution' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="提示词优化任务（独立区域）" labelPosition="left" />
        <PanelCard className="stats-system-prompt-evolution" padding="compact">
          <Stack className="stats-system-prompt-evolution-stack" gap="xs">
            <Group className="stats-system-prompt-evolution-row" justify="space-between" align="center" wrap="wrap" gap="xs">
              <Group className="stats-system-prompt-evolution-left" gap="xs" wrap="wrap">
                <Badge className="stats-system-prompt-evolution-badge" variant="light" color="indigo">每天 0 点自动执行（cron）</Badge>
                <Switch
                  className="stats-system-prompt-evolution-dryrun"
                  checked={promptEvolutionDryRun}
                  onChange={(e) => setPromptEvolutionDryRun(e.currentTarget.checked)}
                  label="Dry Run"
                />
              </Group>
              <Button
                className="stats-system-prompt-evolution-run"
                size="sm"
                style={{ whiteSpace: 'nowrap' }}
                leftSection={<IconPlayerPlay className="stats-system-prompt-evolution-run-icon" size={14} />}
                loading={promptEvolutionRunning}
                onClick={() => void handleRunPromptEvolution()}
              >
                手动触发更新
              </Button>
            </Group>
            <Text className="stats-system-prompt-evolution-hint" size="xs" c="dimmed">
              用于手动触发“对话数据评估 + 门禁检查”。后续可在此区域扩展版本发布、回滚、灰度策略。
            </Text>
            <Group className="stats-system-prompt-evolution-runtime" gap="xs" wrap="wrap">
              <Badge className="stats-system-prompt-evolution-runtime-status" variant="light" color={promptEvolutionRuntime?.status === 'active' ? 'teal' : promptEvolutionRuntime?.status === 'rolled_back' ? 'yellow' : 'gray'}>
                runtime: {promptEvolutionRuntime?.status || 'idle'}
              </Badge>
              <Text className="stats-system-prompt-evolution-runtime-active" size="xs" c="dimmed">
                activeRun: {promptEvolutionRuntime?.activeRunId || 'none'}
              </Text>
              <Text className="stats-system-prompt-evolution-runtime-updated" size="xs" c="dimmed">
                updatedAt: {promptEvolutionRuntime?.updatedAt ? new Date(promptEvolutionRuntime.updatedAt).toLocaleString() : '—'}
              </Text>
            </Group>
            {promptEvolutionResult ? (
              <Group className="stats-system-prompt-evolution-result" gap="xs" wrap="wrap">
                <Badge className="stats-system-prompt-evolution-result-action" variant="light" color={promptEvolutionResult.action === 'ready_for_optimizer' ? 'teal' : 'gray'}>
                  {promptEvolutionResult.action === 'ready_for_optimizer' ? 'ready_for_optimizer' : 'skip'}
                </Badge>
                <Text className="stats-system-prompt-evolution-result-metrics" size="xs" c="dimmed">
                  样本 {promptEvolutionResult.metrics.total} | 成功率 {(promptEvolutionResult.metrics.successRate * 100).toFixed(1)}% | 失败 {promptEvolutionResult.metrics.failed}
                </Text>
              </Group>
            ) : null}
            <Group className="stats-system-prompt-evolution-publish" align="flex-end" gap="xs" wrap="wrap">
              <Select
                className="stats-system-prompt-evolution-publish-run"
                label="可发布运行记录"
                placeholder="选择 run"
                value={promptEvolutionPublishRunId}
                onChange={(v) => setPromptEvolutionPublishRunId(v)}
                data={promptEvolutionRuns
                  .filter((item) => item.action === 'ready_for_optimizer' && !item.dryRun)
                  .map((item) => ({
                    value: item.id,
                    label: `${new Date(item.createdAt).toLocaleString()} · success ${(item.metrics.successRate * 100).toFixed(1)}% · samples ${item.metrics.total}`,
                  }))}
                w={440}
                comboboxProps={{ withinPortal: true }}
              />
              <NumberInput
                className="stats-system-prompt-evolution-publish-canary"
                label="灰度比例 %"
                min={1}
                max={100}
                step={1}
                value={promptEvolutionCanaryPercent}
                onChange={(v) => setPromptEvolutionCanaryPercent(Number(v) || 1)}
                w={140}
              />
              <Button
                className="stats-system-prompt-evolution-publish-run-btn"
                size="sm"
                variant="light"
                leftSection={<IconUpload className="stats-system-prompt-evolution-publish-run-btn-icon" size={14} />}
                onClick={() => void handlePublishPromptEvolution()}
                loading={promptEvolutionActionLoading}
              >
                发布
              </Button>
              <Button
                className="stats-system-prompt-evolution-rollback-btn"
                size="sm"
                variant="light"
                color="orange"
                leftSection={<IconRestore className="stats-system-prompt-evolution-rollback-btn-icon" size={14} />}
                onClick={() => void handleRollbackPromptEvolution()}
                loading={promptEvolutionActionLoading}
              >
                回滚
              </Button>
              <ActionIcon
                className="stats-system-prompt-evolution-refresh"
                size="sm"
                variant="subtle"
                aria-label="刷新提示词任务中心"
                onClick={() => void reloadPromptEvolutionCenter()}
              >
                <IconRefresh className="stats-system-prompt-evolution-refresh-icon" size={14} />
              </ActionIcon>
            </Group>
            <div className="stats-system-prompt-evolution-runs-wrap" style={{ overflowX: 'auto' }}>
              <Table className="stats-system-prompt-evolution-runs-table" striped highlightOnHover verticalSpacing="xs">
                <Table.Thead className="stats-system-prompt-evolution-runs-head">
                  <Table.Tr className="stats-system-prompt-evolution-runs-head-row">
                    <Table.Th className="stats-system-prompt-evolution-runs-head-cell" style={{ width: 180 }}>时间</Table.Th>
                    <Table.Th className="stats-system-prompt-evolution-runs-head-cell" style={{ width: 220 }}>runId</Table.Th>
                    <Table.Th className="stats-system-prompt-evolution-runs-head-cell" style={{ width: 90 }}>模式</Table.Th>
                    <Table.Th className="stats-system-prompt-evolution-runs-head-cell" style={{ width: 120 }}>action</Table.Th>
                    <Table.Th className="stats-system-prompt-evolution-runs-head-cell">指标</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody className="stats-system-prompt-evolution-runs-body">
                  {promptEvolutionRuns.length === 0 ? (
                    <Table.Tr className="stats-system-prompt-evolution-runs-empty-row">
                      <Table.Td className="stats-system-prompt-evolution-runs-empty-cell" colSpan={5}>
                        <Text className="stats-system-prompt-evolution-runs-empty-text" size="sm" c="dimmed">暂无运行记录</Text>
                      </Table.Td>
                    </Table.Tr>
                  ) : promptEvolutionRuns.map((item) => (
                    <Table.Tr className="stats-system-prompt-evolution-runs-row" key={item.id}>
                      <Table.Td className="stats-system-prompt-evolution-runs-cell">
                        <Text className="stats-system-prompt-evolution-runs-created" size="sm" c="dimmed">
                          {new Date(item.createdAt).toLocaleString()}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-system-prompt-evolution-runs-cell">
                        <Text className="stats-system-prompt-evolution-runs-id" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                          {item.id}
                        </Text>
                      </Table.Td>
                      <Table.Td className="stats-system-prompt-evolution-runs-cell">
                        <Badge className="stats-system-prompt-evolution-runs-mode" size="xs" variant="light" color={item.dryRun ? 'gray' : 'blue'}>
                          {item.dryRun ? 'dry-run' : 'apply'}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="stats-system-prompt-evolution-runs-cell">
                        <Badge className="stats-system-prompt-evolution-runs-action" size="xs" variant="light" color={item.action === 'ready_for_optimizer' ? 'teal' : 'gray'}>
                          {item.action}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="stats-system-prompt-evolution-runs-cell">
                        <Text className="stats-system-prompt-evolution-runs-metrics" size="sm" c="dimmed">
                          samples {item.metrics.total} | success {(item.metrics.successRate * 100).toFixed(1)}% | failed {item.metrics.failed} | avg {formatDuration(item.metrics.avgDurationMs)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </Stack>
        </PanelCard>
            </>
          ) : null}

          {section === 'runtimeDiagnostics' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="资源与上传诊断" labelPosition="left" />
        <StatsRuntimeDiagnostics className="stats-system-runtime-diagnostics" />
            </>
          ) : null}

          {section === 'characterLibrary' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="AI 角色库后台管理" labelPosition="left" />
        <AiCharacterLibraryManagementPanel
          className="stats-system-character-library"
          opened={section === 'characterLibrary'}
          canEdit
        />
            </>
          ) : null}

          {section === 'apiAccess' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="外站调用地址" labelPosition="left" />
        <Stack className="stats-system-endpoints" gap={6}>
          {[
            { label: '绘图', url: publicDrawUrl },
            { label: '图像理解', url: publicVisionUrl },
            { label: '生成视频', url: publicVideoUrl },
            { label: '查任务', url: publicTaskResultUrl },
            { label: 'Agents 文本', url: publicChatUrl },
          ].map((it) => (
            <Group className="stats-system-endpoint" key={it.label} justify="space-between" align="center" gap="xs" wrap="nowrap">
              <Group className="stats-system-endpoint-left" gap={8} wrap="nowrap">
                <Badge className="stats-system-endpoint-badge" size="xs" variant="light">{it.label}</Badge>
                <Text className="stats-system-endpoint-url" size="sm" style={{ wordBreak: 'break-all' }}>
                  {it.url}
                </Text>
              </Group>
              <CopyButton value={it.url} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-system-endpoint-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                    <ActionIcon className="stats-system-endpoint-copy" variant="light" onClick={copy} aria-label="copy-endpoint">
                      {copied ? <IconCheck className="stats-system-endpoint-copy-icon" size={16} /> : <IconCopy className="stats-system-endpoint-copy-icon" size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          ))}
        </Stack>
        <pre className="stats-system-endpoint-snippet" style={{ margin: 0, marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.18)', overflowX: 'auto' }}>
          <code className="stats-system-endpoint-snippet-code">{fetchSnippet}</code>
        </pre>

        <Divider className="stats-system-divider" my="md" label="在线调试" labelPosition="left" />
        <StatsPublicApiDebugger
          className="stats-system-public-debugger"
          endpoints={{
            chat: publicChatUrl,
            draw: publicDrawUrl,
            vision: publicVisionUrl,
            video: publicVideoUrl,
            taskResult: publicTaskResultUrl,
          }}
        />

        <Divider className="stats-system-divider" my="md" label="创建新 Key" labelPosition="left" />
        <Stack className="stats-system-create" gap="xs">
          <Group className="stats-system-create-row" gap="sm" align="flex-start" wrap="wrap">
            <TextInput
              className="stats-system-create-label"
              label="名称"
              value={createLabel}
              onChange={(e) => setCreateLabel(e.currentTarget.value)}
              placeholder="例如：我的网站"
              w={260}
            />
            <Switch
              className="stats-system-create-enabled"
              checked={createEnabled}
              onChange={(e) => setCreateEnabled(e.currentTarget.checked)}
              label="启用"
              mt={26}
            />
            <Button
              className="stats-system-create-submit"
              size="sm"
              leftSection={<IconPlus className="stats-system-create-submit-icon" size={14} />}
              loading={createSubmitting}
              onClick={() => void handleCreate()}
              mt={22}
            >
              生成 Key
            </Button>
          </Group>
          <Textarea
            className="stats-system-create-origins"
            label="Origin 白名单（每行一个；可用 * 放开所有）"
            value={createOrigins}
            onChange={(e) => setCreateOrigins(e.currentTarget.value)}
            minRows={2}
            autosize
            placeholder={`https://example.com\nhttp://localhost:3000`}
          />
          <Text className="stats-system-create-hint" size="xs" c="dimmed">
            Key 只会在创建成功后展示一次；请复制保存到你的站点环境变量中。
          </Text>
        </Stack>

        <Divider className="stats-system-divider" my="md" label="API Key 列表" labelPosition="left" />
        <div className="stats-system-keys-table-wrap" style={{ overflowX: 'auto' }}>
          <Table className="stats-system-keys-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
            <Table.Thead className="stats-system-keys-table-head">
              <Table.Tr className="stats-system-keys-table-head-row">
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 160 }}>名称</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 130 }}>前缀</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell">Origin 白名单</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 170 }}>最近使用</Table.Th>
                <Table.Th className="stats-system-keys-table-head-cell" style={{ width: 100 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-system-keys-table-body">
              {!keysLoading && keys.length === 0 && (
                <Table.Tr className="stats-system-keys-table-row-empty">
                  <Table.Td className="stats-system-keys-table-cell-empty" colSpan={6}>
                    <Text className="stats-system-keys-empty" size="sm" c="dimmed">
                      暂无 Key
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {keys.map((k) => (
                <Table.Tr className="stats-system-keys-table-row" key={k.id}>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-label" size="sm" fw={600}>
                      {k.label || '未命名'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-prefix" size="sm" c="dimmed">
                      {k.keyPrefix}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-origins" size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {(k.allowedOrigins || []).join(', ') || '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Badge className="stats-system-keys-status" size="xs" variant="light" color={k.enabled ? 'green' : 'gray'}>
                      {k.enabled ? '启用' : '禁用'}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Text className="stats-system-keys-last-used" size="sm" c="dimmed">
                      {formatLastUsedAt(k.lastUsedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-keys-table-cell">
                    <Group className="stats-system-keys-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <Tooltip className="stats-system-keys-edit-tooltip" label="编辑" withArrow>
                        <ActionIcon className="stats-system-keys-edit" size="sm" variant="light" aria-label="edit" onClick={() => openEdit(k)}>
                          <IconPencil className="stats-system-keys-edit-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip className="stats-system-keys-delete-tooltip" label="删除" withArrow>
                        <ActionIcon className="stats-system-keys-delete" size="sm" variant="light" color="red" aria-label="delete" onClick={() => void handleDelete(k)}>
                          <IconTrash className="stats-system-keys-delete-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
            </>


          ) : null}

          {section === 'taskLogs' ? (
            <>
        <Divider className="stats-system-divider" my="md" label="生成任务列表" labelPosition="left" />
        <Group className="stats-system-logs-toolbar" justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group className="stats-system-logs-filters" gap="xs" align="center" wrap="wrap">
            <Select
              className="stats-system-logs-filter-vendor"
              size="sm"
              value={logsVendor}
              onChange={(v) => setLogsVendor(v || 'all')}
              data={[
                { value: 'all', label: '全部厂商' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'gemini', label: 'Gemini' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'qwen', label: 'Qwen' },
                { value: 'veo', label: 'Veo' },
              ]}
              placeholder="厂商"
              w={160}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              className="stats-system-logs-filter-status"
              size="sm"
              value={logsStatus}
              onChange={(v) => setLogsStatus(v || 'all')}
              data={[
                { value: 'all', label: '全部状态' },
                { value: 'running', label: '运行中' },
                { value: 'succeeded', label: '成功' },
                { value: 'failed', label: '失败' },
              ]}
              placeholder="状态"
              w={140}
              comboboxProps={{ withinPortal: true }}
            />
          </Group>
          <Button
            className="stats-system-logs-refresh"
            size="sm"
            variant="light"
            onClick={() => void reloadLogs()}
            disabled={logsLoading}
            leftSection={logsLoading ? <Loader className="stats-system-logs-refresh-loader" size="xs" /> : undefined}
          >
            刷新
          </Button>
        </Group>

        <div className="stats-system-logs-table-wrap" style={{ overflowX: 'auto' }}>
          <Table className="stats-system-logs-table" striped highlightOnHover stickyHeader verticalSpacing="xs">
            <Table.Thead className="stats-system-logs-table-head">
              <Table.Tr className="stats-system-logs-table-head-row">
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 170 }}>时间</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>厂商</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 180 }}>调用者</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>类型</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 80 }}>耗时</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 240 }}>任务</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 140 }}>输入预览</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 140 }}>输出预览</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell" style={{ width: 70 }}>详情</Table.Th>
                <Table.Th className="stats-system-logs-table-head-cell">错误</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody className="stats-system-logs-table-body">
              {!logsLoading && logs.length === 0 && (
                <Table.Tr className="stats-system-logs-table-row-empty">
                  <Table.Td className="stats-system-logs-table-cell-empty" colSpan={11}>
                    <Text className="stats-system-logs-empty" size="sm" c="dimmed">
                      暂无生成记录
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {logs.map((it) => {
                const inputAssets = extractPreviewAssets(it.requestPayload)
                const outputAssetsFromLog = extractPreviewAssets(it.upstreamResponse)
                const outputAssetsFallback = taskOutputPreviewMap[makeLogPreviewKey(it)] || []
                const outputAssets = outputAssetsFromLog.length ? outputAssetsFromLog : outputAssetsFallback
                return (
                <Table.Tr className="stats-system-logs-table-row" key={`${it.vendor}:${it.taskId}`}>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-created-at" size="sm" c="dimmed">
                      {new Date(it.createdAt).toLocaleString()}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-vendor" size="sm">
                      {it.vendor}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text
                      className="stats-system-logs-caller"
                      size="sm"
                      title={`${formatLogCaller(it)}${it.userId ? `\nuserId: ${it.userId}` : ''}`}
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}
                    >
                      {formatLogCaller(it)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-kind" size="sm">
                      {formatTaskKind(it.taskKind)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Badge className="stats-system-logs-status" size="xs" variant="light" color={statusColor(it.status as VendorCallLogStatus) as any}>
                      {it.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-duration" size="sm" c="dimmed">
                      {formatDuration(it.durationMs)}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Group className="stats-system-logs-task" gap={6} justify="space-between" wrap="nowrap">
                      <Text
                        className="stats-system-logs-task-id"
                        size="sm"
                        title={it.taskId}
                        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}
                      >
                        {it.taskId}
                      </Text>
                      <CopyButton value={it.taskId} timeout={1200}>
                        {({ copied, copy }) => (
                          <Tooltip className="stats-system-logs-task-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                            <ActionIcon className="stats-system-logs-task-copy" variant="subtle" onClick={copy} aria-label="copy-task-id">
                              {copied ? <IconCheck className="stats-system-logs-task-copy-icon" size={14} /> : <IconCopy className="stats-system-logs-task-copy-icon" size={14} />}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    {renderAssetPreviewList(inputAssets, 'stats-system-logs-input-preview', openPreview)}
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    {renderAssetPreviewList(outputAssets, 'stats-system-logs-output-preview', openPreview)}
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Group className="stats-system-logs-debug" gap={6} justify="center" wrap="nowrap">
                      <Tooltip
                        className="stats-system-logs-debug-tooltip"
                        label={(it.requestPayload || it.upstreamResponse) ? '查看请求/回显' : '暂无调试内容'}
                        withArrow
                      >
                        <ActionIcon
                          className="stats-system-logs-debug-open"
                          size="sm"
                          variant="subtle"
                          aria-label="inspect-log"
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            openInspect(it)
                          }}
                          disabled={!it.requestPayload && !it.upstreamResponse}
                        >
                          <IconEye className="stats-system-logs-debug-open-icon" size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                  <Table.Td className="stats-system-logs-table-cell">
                    <Text className="stats-system-logs-error" size="sm" c={it.status === 'failed' ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
                      {it.errorMessage || '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </div>

        {logsHasMore && (
          <Button
            className="stats-system-logs-more"
            size="sm"
            variant="light"
            onClick={() => void loadMoreLogs()}
            disabled={logsLoadingMore}
            leftSection={logsLoadingMore ? <Loader className="stats-system-logs-more-loader" size="xs" /> : undefined}
            mt="sm"
          >
            加载更多
          </Button>
        )}
            </>

          ) : null}
        </PanelCard>
      </Group>

      <Modal
        className="stats-system-created-modal"
        opened={createdOpen}
        onClose={() => setCreatedOpen(false)}
        title="你的 Key（仅展示一次）"
        centered
        lockScroll={false}
      >
        <Stack className="stats-system-created-modal-body" gap="xs">
          <Text className="stats-system-created-modal-hint" size="sm">
            请复制保存；之后将无法再次查看明文。
          </Text>
          <InlinePanel className="stats-system-created-modal-key" style={{ background: 'rgba(0,0,0,0.18)' }}>
            <Group className="stats-system-created-modal-key-row" justify="space-between" gap="xs" align="center">
              <Text className="stats-system-created-modal-key-text" size="sm" style={{ wordBreak: 'break-all' }}>
                {createdKey || ''}
              </Text>
              <CopyButton value={createdKey || ''} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-system-created-modal-copy-tooltip" label={copied ? '已复制' : '复制'} position="top" withArrow>
                    <ActionIcon className="stats-system-created-modal-copy" variant="light" onClick={copy} aria-label="copy-key">
                      {copied ? <IconCheck className="stats-system-created-modal-copy-icon" size={16} /> : <IconCopy className="stats-system-created-modal-copy-icon" size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </InlinePanel>
          <Text className="stats-system-created-modal-note" size="xs" c="dimmed">
            默认会按 Origin 白名单校验；若你需要后端/脚本调用，可在白名单中填入 *。
          </Text>
        </Stack>
      </Modal>

      <Modal
        className="stats-system-edit-modal"
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑 Key"
        centered
        lockScroll={false}
      >
        <Stack className="stats-system-edit-modal-body" gap="xs">
          <TextInput
            className="stats-system-edit-label"
            label="名称"
            value={editLabel}
            onChange={(e) => setEditLabel(e.currentTarget.value)}
            placeholder="例如：我的网站"
          />
          <Textarea
            className="stats-system-edit-origins"
            label="Origin 白名单（每行一个；可用 * 放开所有）"
            value={editOrigins}
            onChange={(e) => setEditOrigins(e.currentTarget.value)}
            minRows={3}
            autosize
            placeholder={`https://example.com\nhttp://localhost:3000`}
          />
          <Group className="stats-system-edit-actions" justify="space-between" align="center">
            <Switch
              className="stats-system-edit-enabled"
              checked={editEnabled}
              onChange={(e) => setEditEnabled(e.currentTarget.checked)}
              label="启用"
            />
            <Button
              className="stats-system-edit-save"
              size="sm"
              loading={editSubmitting}
              onClick={() => void handleEditSave()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        className="stats-system-log-inspect-modal"
        opened={inspectOpen}
        onClose={closeInspect}
        title="任务调试详情"
        centered
        size="lg"
        lockScroll={false}
      >
        <Stack className="stats-system-log-inspect-body" gap="sm">
          <Text className="stats-system-log-inspect-meta" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
            {inspectItem ? `vendor=${inspectItem.vendor} taskId=${inspectItem.taskId} kind=${inspectItem.taskKind || '—'} status=${inspectItem.status}` : ''}
          </Text>
          <Group className="stats-system-log-inspect-preview-row" align="flex-start" grow>
            <Stack className="stats-system-log-inspect-preview-block" gap={6}>
              <Text className="stats-system-log-inspect-preview-title" size="sm" fw={600}>输入资产预览</Text>
              <Group className="stats-system-log-inspect-preview-list" gap={8}>
                {inspectInputAssets.slice(0, 6).map((asset) => (
                  <button
                    className="stats-system-log-inspect-preview-trigger"
                    key={`inspect-input-${asset.url}`}
                    type="button"
                    title={asset.url}
                    onClick={() => openPreview({ url: asset.url, kind: asset.kind, name: '任务输入预览' })}
                    style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  >
                    {asset.kind === 'video' ? (
                      <video
                        className="stats-system-log-inspect-preview-video"
                        src={asset.url}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                    ) : (
                      <img
                        className="stats-system-log-inspect-preview-image"
                        src={asset.url}
                        alt="input-asset-preview"
                        loading="lazy"
                        style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                    )}
                  </button>
                ))}
                {inspectInputAssets.length === 0 && (
                  <Text className="stats-system-log-inspect-preview-empty" size="xs" c="dimmed">—</Text>
                )}
              </Group>
            </Stack>
            <Stack className="stats-system-log-inspect-preview-block" gap={6}>
              <Text className="stats-system-log-inspect-preview-title" size="sm" fw={600}>输出资产预览</Text>
              <Group className="stats-system-log-inspect-preview-list" gap={8}>
                {inspectOutputAssets.slice(0, 6).map((asset) => (
                  <button
                    className="stats-system-log-inspect-preview-trigger"
                    key={`inspect-output-${asset.url}`}
                    type="button"
                    title={asset.url}
                    onClick={() => openPreview({ url: asset.url, kind: asset.kind, name: '任务输出预览' })}
                    style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  >
                    {asset.kind === 'video' ? (
                      <video
                        className="stats-system-log-inspect-preview-video"
                        src={asset.url}
                        muted
                        playsInline
                        preload="metadata"
                        style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                    ) : (
                      <img
                        className="stats-system-log-inspect-preview-image"
                        src={asset.url}
                        alt="output-asset-preview"
                        loading="lazy"
                        style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 10, display: 'block' }}
                      />
                    )}
                  </button>
                ))}
                {inspectOutputAssets.length === 0 && (
                  <Text className="stats-system-log-inspect-preview-empty" size="xs" c="dimmed">—</Text>
                )}
              </Group>
            </Stack>
          </Group>

          <Stack className="stats-system-log-inspect-section" gap={6}>
            <Text className="stats-system-log-inspect-section-title" size="sm" fw={600}>内联输入</Text>
            {inspectInlineInputs.length > 0 ? (
              <Stack className="stats-system-log-inspect-inline-list" gap={6}>
                {inspectInlineInputs.map((item, index) => (
                  <InlinePanel
                    className="stats-system-log-inspect-inline-item"
                    key={`inspect-inline-${index}-${item.mimeType || 'unknown'}`}
                    padding="compact"
                  >
                    <Group className="stats-system-log-inspect-inline-item-header" gap={8} wrap="wrap">
                      <Badge className="stats-system-log-inspect-inline-item-badge" size="xs" variant="light" color="blue">
                        {item.mimeType || 'unknown mime'}
                      </Badge>
                      <Text className="stats-system-log-inspect-inline-item-text" size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {item.dataLabel}
                      </Text>
                    </Group>
                  </InlinePanel>
                ))}
              </Stack>
            ) : (
              <Text className="stats-system-log-inspect-inline-empty" size="xs" c="dimmed">—</Text>
            )}
          </Stack>

          <Stack className="stats-system-log-inspect-section" gap={6}>
            <Group className="stats-system-log-inspect-section-header" justify="space-between" align="center" wrap="nowrap">
              <Text className="stats-system-log-inspect-section-title" size="sm" fw={600}>发起请求内容</Text>
              <CopyButton value={inspectItem?.requestPayload || ''} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-system-log-inspect-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                    <ActionIcon className="stats-system-log-inspect-copy" size="sm" variant="light" onClick={copy} aria-label="copy-request-payload">
                      {copied ? <IconCheck className="stats-system-log-inspect-copy-icon" size={14} /> : <IconCopy className="stats-system-log-inspect-copy-icon" size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Textarea
              className="stats-system-log-inspect-request"
              value={formatJsonPreview(inspectItem?.requestPayload)}
              readOnly
              autosize
              minRows={6}
              maxRows={14}
              placeholder="—"
              styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' } }}
            />
          </Stack>

          <Stack className="stats-system-log-inspect-section" gap={6}>
            <Group className="stats-system-log-inspect-section-header" justify="space-between" align="center" wrap="nowrap">
              <Text className="stats-system-log-inspect-section-title" size="sm" fw={600}>上游回显</Text>
              <CopyButton value={inspectItem?.upstreamResponse || ''} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-system-log-inspect-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                    <ActionIcon className="stats-system-log-inspect-copy" size="sm" variant="light" onClick={copy} aria-label="copy-upstream-response">
                      {copied ? <IconCheck className="stats-system-log-inspect-copy-icon" size={14} /> : <IconCopy className="stats-system-log-inspect-copy-icon" size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Textarea
              className="stats-system-log-inspect-response"
              value={formatJsonPreview(inspectItem?.upstreamResponse)}
              readOnly
              autosize
              minRows={6}
              maxRows={14}
              placeholder="—"
              styles={{ input: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' } }}
            />
          </Stack>
        </Stack>
      </Modal>
    </Stack>
  )
}
