import React from 'react'
import { ActionIcon, Badge, Button, Checkbox, Collapse, FileInput, Group, Modal, Select, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core'
import { IconPencil, IconPlus, IconRefresh, IconTrash, IconX } from '@tabler/icons-react'
import {
  agentsChat,
  deleteAdminAgentSkill,
  deleteAdminLlmNodePreset,
  listAdminAgentSkills,
  listAdminLlmNodePresets,
  runTaskByVendor,
  upsertAdminAgentSkill,
  upsertAdminLlmNodePreset,
  type AgentSkillDto,
  type LlmNodePresetDto,
  type LlmNodePresetType,
  type TaskRequestDto,
} from '../../../../api/server'
import { captureFramesAtTimes } from '../../../../utils/videoFrameExtractor'
import { extractTextFromTaskResult, tryParseJsonLike } from '../../../../canvas/nodes/taskNodeHelpers'
import { toast } from '../../../toast'

const SKILL_JSON_TAG = 'tapcanvas_skill_json'
const DEFAULT_GENERATOR_MAX_IMAGE_SIZE = 1280

function looksLikeVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(?:$|[?#])/i.test(url)
}

function extractTaggedText(raw: string, tag: string): string | null {
  const text = String(raw || '')
  const startTag = `<${tag}>`
  const endTag = `</${tag}>`
  const start = text.indexOf(startTag)
  const end = text.indexOf(endTag)
  if (start < 0 || end < 0 || end <= start) return null
  const inner = text.slice(start + startTag.length, end).trim()
  return inner ? inner : null
}

function extractSimpleFrontmatter(raw: string): Record<string, string> | null {
  const text = String(raw || '').replace(/\r\n/g, '\n')
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 4)
  if (end < 0) return null
  const block = text.slice(4, end).trim()
  const out: Record<string, string> = {}
  if (!block) return out
  for (const line of block.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf(':')
    if (sep <= 0) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    if (key && value) out[key] = value
  }
  return out
}

function inferSkillMetaFromContent(content: string): { name?: string; description?: string } {
  const raw = String(content || '')
  if (!raw.trim()) return {}

  const frontmatter = extractSimpleFrontmatter(raw.trimStart())
  const frontmatterName = frontmatter?.name?.trim()
  const frontmatterDescription = frontmatter?.description?.trim()
  if (frontmatterName || frontmatterDescription) {
    return {
      ...(frontmatterName ? { name: frontmatterName } : {}),
      ...(frontmatterDescription ? { description: frontmatterDescription } : {}),
    }
  }

  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^#{1,2}\s+(.+?)\s*$/.exec(trimmed)
    if (match?.[1]) return { name: match[1].trim() }
    break
  }
  return {}
}

function buildAutoSkillKeyFromName(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return ''
  const withPrefix = cleaned.startsWith('skill_') ? cleaned : `skill_${cleaned}`
  return withPrefix.length > 120 ? withPrefix.slice(0, 120) : withPrefix
}

function ensureUniqueSkillKey(key: string, skills: AgentSkillDto[], ignoreId?: string): string {
  const existing = new Set(skills.filter((s) => (ignoreId ? s.id !== ignoreId : true)).map((s) => s.key))
  if (!existing.has(key)) return key
  for (let i = 2; i <= 50; i += 1) {
    const candidate = `${key}_${i}`
    if (!existing.has(candidate)) return candidate
  }
  try {
    return `${key}_${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${key}_${Math.random().toString(36).slice(2, 10)}`
  }
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

async function downscaleImageBlob(
  blob: Blob,
  options?: { maxSize?: number; mimeType?: string; quality?: number },
): Promise<Blob> {
  const maxSize = typeof options?.maxSize === 'number' && Number.isFinite(options.maxSize) ? Math.max(256, Math.trunc(options.maxSize)) : DEFAULT_GENERATOR_MAX_IMAGE_SIZE
  const mimeType = typeof options?.mimeType === 'string' && options.mimeType.trim() ? options.mimeType.trim() : 'image/jpeg'
  const quality = typeof options?.quality === 'number' && Number.isFinite(options.quality) ? Math.max(0.5, Math.min(0.95, options.quality)) : 0.85

  const bitmap = await createImageBitmap(blob)
  try {
    const srcW = bitmap.width
    const srcH = bitmap.height
    if (!srcW || !srcH) return blob
    const scale = Math.min(1, maxSize / Math.max(srcW, srcH))
    const dstW = Math.max(1, Math.round(srcW * scale))
    const dstH = Math.max(1, Math.round(srcH * scale))
    if (dstW === srcW && dstH === srcH && blob.type === mimeType) return blob

    const canvas = document.createElement('canvas')
    canvas.width = dstW
    canvas.height = dstH
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0, dstW, dstH)
    const out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片编码失败'))), mimeType, quality)
    })
    return out
  } finally {
    try {
      bitmap.close()
    } catch {
      // ignore
    }
  }
}

function buildVisionExtractPrompt(): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    '你是资深视觉/平面设计总监。',
    '用户会提供一张参考作品图片（可能是视频抽帧）。',
    '请输出严格 JSON（不要 Markdown、不要代码块、不要多余解释文本）。',
    'JSON 字段：',
    '- elements: string[]（画面要素/主体/道具/背景/文字元素）',
    '- mainVisual: string（主视觉一句话）',
    '- composition: string（构图/视角/层级）',
    '- colorPalette: string（主色/辅色/点缀色/对比关系）',
    '- lighting: string（光线类型/方向/阴影/氛围）',
    '- typography: string（字体/字重/排版/文字风格；没有则空字符串）',
    '- materials: string（材质/质感/工艺；没有则空字符串）',
    '- strengths: string[]（为什么好看/为什么有效）',
    '- styleTags: string[]（风格标签，5-12 个）',
    '- recreatePromptEn: string（可复刻该风格的英文提示词，单段）',
    '- notes: string（任何注意事项；可为空字符串）',
  ].join('\n')
  const userPrompt = '请按上述字段输出严格 JSON。'
  return { systemPrompt, userPrompt }
}

function buildSkillFromVisionSystemPrompt(): string {
  return [
    '你是 TapCanvas 后台运营的「Skill 构建助手」。',
    '- 全程用中文输出，不要询问用户选择语言。',
    '- 输入会包含参考作品的视觉拆解（JSON 或文字）。',
    '- 你的目标：生成一段可复用的 Skill 文本（会拼接进 system prompt），用于稳定复刻该作品的视觉风格与优点。',
    '- 必须输出严格 JSON，并用 <tapcanvas_skill_json>...</tapcanvas_skill_json> 包裹；除此之外不要输出任何文字。',
    'JSON 字段：',
    '- skillName: string（给用户看的名称，2-12 字，尽量具体）',
    '- elements: string[]',
    '- mainVisual: string',
    '- strengths: string[]',
    '- skillDescription: string（给运营看的 1-2 句）',
    '- skillContent: string（可直接粘贴到 Skill 内容；包含：风格目标/构图/色彩/光线/材质/字体排版(如有)/可复用规则/禁忌/提示词模板/负面提示词）',
    '约束：skillContent 不要提“如图/参考图”；要写成可执行指令。',
  ].join('\n')
}

function buildSkillFromVisionUserPrompt(input: { visionText: string; workUrl?: string; notes?: string }): string {
  const vision = String(input.visionText || '').trim()
  const url = typeof input.workUrl === 'string' ? input.workUrl.trim() : ''
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  return [
    url ? `参考作品链接：${url}` : null,
    notes ? `补充说明：${notes}` : null,
    '视觉拆解：',
    vision,
    '',
    '请基于以上信息输出 <tapcanvas_skill_json> 严格 JSON。',
  ].filter(Boolean).join('\n\n')
}

type SkillEditorState = {
  id?: string
  key: string
  name: string
  description?: string | null
  content: string
  visible: boolean
}

function buildSkillEditor(skill?: AgentSkillDto | null): SkillEditorState {
  return {
    ...(skill?.id ? { id: skill.id } : {}),
    key: skill?.key || '',
    name: skill?.name || '',
    description: typeof skill?.description === 'string' ? skill.description : skill?.description ?? null,
    content: skill?.content || '',
    visible: typeof skill?.visible === 'boolean' ? skill.visible : true,
  }
}

type NodePresetEditorState = {
  id?: string
  title: string
  type: LlmNodePresetType
  prompt: string
  description?: string | null
  enabled: boolean
  sortOrder?: number | null
}

function buildNodePresetEditor(preset?: LlmNodePresetDto | null): NodePresetEditorState {
  return {
    ...(preset?.id ? { id: preset.id } : {}),
    title: preset?.title || '',
    type: preset?.type || 'text',
    prompt: preset?.prompt || '',
    description: typeof preset?.description === 'string' ? preset.description : null,
    enabled: typeof preset?.enabled === 'boolean' ? preset.enabled : true,
    sortOrder: typeof preset?.sortOrder === 'number' ? preset.sortOrder : null,
  }
}

export default function StatsAgentsManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-agents-management', className].filter(Boolean).join(' ')

  const [loading, setLoading] = React.useState(false)
  const [skills, setSkills] = React.useState<AgentSkillDto[]>([])
  const [nodePresets, setNodePresets] = React.useState<LlmNodePresetDto[]>([])
  const [nodePresetEditor, setNodePresetEditor] = React.useState<NodePresetEditorState | null>(null)
  const [nodePresetTypeFilter, setNodePresetTypeFilter] = React.useState<'all' | LlmNodePresetType>('all')

  const [skillEditor, setSkillEditor] = React.useState<SkillEditorState | null>(null)
  const [skillGeneratorOpen, setSkillGeneratorOpen] = React.useState(false)

  const [generatorUrl, setGeneratorUrl] = React.useState('')
  const [generatorImage, setGeneratorImage] = React.useState<File | null>(null)
  const [generatorVideo, setGeneratorVideo] = React.useState<File | null>(null)
  const [generatorLoading, setGeneratorLoading] = React.useState(false)
  const [generatorVisionPreview, setGeneratorVisionPreview] = React.useState('')
  const [generatorAgentPreview, setGeneratorAgentPreview] = React.useState('')

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const [items, presets] = await Promise.all([
        listAdminAgentSkills(),
        listAdminLlmNodePresets(),
      ])
      const list = Array.isArray(items) ? items : []
      setSkills(list)
      setNodePresets(Array.isArray(presets) ? presets : [])
    } catch (err: any) {
      setSkills([])
      setNodePresets([])
      toast(err?.message || '加载 skill 失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const saveSkill = async () => {
    if (!skillEditor) return
    try {
      const inferred = inferSkillMetaFromContent(skillEditor.content)
      const baseName = skillEditor.name.trim() || inferred.name || ''
      const seedKey = skillEditor.key.trim() || buildAutoSkillKeyFromName(baseName)
      const uniqueKey = ensureUniqueSkillKey(
        seedKey || `skill_${Math.random().toString(36).slice(2, 10)}`,
        skills,
        skillEditor.id,
      )
      const nextName = baseName || '默认 Skill'
      const nextDescription =
        skillEditor.description && skillEditor.description.trim()
          ? skillEditor.description
          : inferred.description ?? null
      const nextContent = skillEditor.content.trim()
      if (!nextContent) {
        toast('请填写 Skill 内容（可手动编写或从作品生成）', 'error')
        return
      }
      const payload = {
        ...(skillEditor.id ? { id: skillEditor.id } : {}),
        key: uniqueKey,
        name: nextName,
        description: nextDescription,
        content: nextContent,
        enabled: true,
        visible: skillEditor.visible,
        sortOrder: 0,
      }
      await upsertAdminAgentSkill(payload)
      toast('已保存 skill', 'success')
      setSkillEditor(null)
      setSkillGeneratorOpen(false)
      await reload()
    } catch (err: any) {
      toast(err?.message || '保存 skill 失败', 'error')
    }
  }

  const removeSkill = React.useCallback(async (id: string) => {
    const targetId = String(id || '').trim()
    if (!targetId) return
    try {
      await deleteAdminAgentSkill(targetId)
      toast('已删除 skill', 'success')
      await reload()
    } catch (err: any) {
      toast(err?.message || '删除 skill 失败', 'error')
    }
  }, [reload])

  const saveNodePreset = React.useCallback(async () => {
    if (!nodePresetEditor) return
    const title = nodePresetEditor.title.trim()
    const prompt = nodePresetEditor.prompt.trim()
    if (!title || !prompt) {
      toast('预设名称和提示词不能为空', 'error')
      return
    }
    try {
      await upsertAdminLlmNodePreset({
        ...(nodePresetEditor.id ? { id: nodePresetEditor.id } : {}),
        title,
        type: nodePresetEditor.type,
        prompt,
        description: nodePresetEditor.description ?? undefined,
        enabled: nodePresetEditor.enabled,
        sortOrder: nodePresetEditor.sortOrder ?? null,
      })
      toast('已保存基础预设', 'success')
      setNodePresetEditor(null)
      await reload()
    } catch (err: any) {
      toast(err?.message || '保存基础预设失败', 'error')
    }
  }, [nodePresetEditor, reload])

  const removeNodePreset = React.useCallback(async (id: string) => {
    const targetId = String(id || '').trim()
    if (!targetId) return
    try {
      await deleteAdminLlmNodePreset(targetId)
      toast('已删除基础预设', 'success')
      await reload()
    } catch (err: any) {
      toast(err?.message || '删除基础预设失败', 'error')
    }
  }, [reload])

  const runGenerator = React.useCallback(async () => {
    if (!skillEditor) return
    if (generatorLoading) return

    const url = String(generatorUrl || '').trim()
    const notes = String(skillEditor.description || '').trim()

    if (!generatorImage && !generatorVideo && !url) {
      toast('请提供图片/视频文件或作品链接', 'error')
      return
    }

    setGeneratorLoading(true)
    setGeneratorVisionPreview('')
    setGeneratorAgentPreview('')
    try {
      const { systemPrompt: visionSystemPrompt, userPrompt: visionUserPrompt } = buildVisionExtractPrompt()

      let imageData: string | null = null
      let imageUrl: string | null = null

      if (generatorImage) {
        const scaled = await downscaleImageBlob(generatorImage, { maxSize: DEFAULT_GENERATOR_MAX_IMAGE_SIZE, mimeType: 'image/jpeg', quality: 0.85 })
        imageData = await readBlobAsDataUrl(scaled)
      } else if (generatorVideo) {
        const { frames } = await captureFramesAtTimes({ type: 'file', file: generatorVideo }, [1], { mimeType: 'image/jpeg', quality: 0.9 })
        const first = frames[0]
        if (!first?.blob) {
          toast('未能从视频抽取关键帧', 'error')
          return
        }
        try {
          const scaled = await downscaleImageBlob(first.blob, { maxSize: DEFAULT_GENERATOR_MAX_IMAGE_SIZE, mimeType: 'image/jpeg', quality: 0.85 })
          imageData = await readBlobAsDataUrl(scaled)
        } finally {
          frames.forEach((f) => {
            try {
              URL.revokeObjectURL(f.objectUrl)
            } catch {
              // ignore
            }
          })
        }
      } else if (url) {
        if (looksLikeVideoUrl(url)) {
          const { frames } = await captureFramesAtTimes({ type: 'url', url }, [1], { mimeType: 'image/jpeg', quality: 0.9 })
          const first = frames[0]
          if (!first?.blob) {
            toast('未能从视频链接抽帧（可能是跨域或格式不支持），建议上传视频文件', 'error')
            return
          }
          try {
            const scaled = await downscaleImageBlob(first.blob, { maxSize: DEFAULT_GENERATOR_MAX_IMAGE_SIZE, mimeType: 'image/jpeg', quality: 0.85 })
            imageData = await readBlobAsDataUrl(scaled)
          } finally {
            frames.forEach((f) => {
              try {
                URL.revokeObjectURL(f.objectUrl)
              } catch {
                // ignore
              }
            })
          }
        } else {
          imageUrl = url
        }
      }

      const visionReq: TaskRequestDto = {
        kind: 'image_to_prompt',
        prompt: visionUserPrompt,
        extras: {
          systemPrompt: visionSystemPrompt,
          ...(imageData ? { imageData } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
      }

      const visionTask = await runTaskByVendor('openai', visionReq)
      const visionText = extractTextFromTaskResult(visionTask).trim()
      if (!visionText) {
        toast('图片理解未返回有效文本', 'error')
        return
      }
      setGeneratorVisionPreview(visionText)

      const systemPrompt = buildSkillFromVisionSystemPrompt()
      const prompt = buildSkillFromVisionUserPrompt({ visionText, workUrl: url || undefined, notes: notes || undefined })

      const agentReply = await (async (): Promise<string> => {
        try {
          const resp = await agentsChat({ vendor: 'agents', prompt, systemPrompt, temperature: 0.2 })
          return typeof resp?.text === 'string' ? resp.text.trim() : ''
        } catch (err: any) {
          console.warn('[stats][agents] generate skill via agents failed', err)
          const fallback = await runTaskByVendor('openai', {
            kind: 'chat',
            prompt,
            extras: { systemPrompt, temperature: 0.2 },
          })
          return extractTextFromTaskResult(fallback).trim()
        }
      })()

      if (!agentReply) {
        toast('Skill 生成未返回内容', 'error')
        return
      }
      setGeneratorAgentPreview(agentReply)

      const tagged = extractTaggedText(agentReply, SKILL_JSON_TAG)
      const parsed = (tagged ? tryParseJsonLike(tagged) : tryParseJsonLike(agentReply)) as any
      if (!parsed || typeof parsed !== 'object') {
        toast('Skill 生成结果解析失败（请查看预览并手动复制）', 'error')
        return
      }

      const parsedDescription =
        typeof parsed.skillDescription === 'string' && parsed.skillDescription.trim()
          ? parsed.skillDescription.trim()
          : null
      const nextContent =
        typeof parsed.skillContent === 'string' && parsed.skillContent.trim()
          ? parsed.skillContent.trim()
          : ''

      if (!nextContent) {
        toast('Skill 生成结果缺少 skillContent（请查看预览并手动复制）', 'error')
        return
      }

      setSkillEditor((s) => {
        if (!s) return s
        const nextName =
          !s.name.trim() && typeof parsed.skillName === 'string' && parsed.skillName.trim()
            ? parsed.skillName.trim()
            : s.name
        const nextDescription =
          s.description && s.description.trim()
            ? s.description
            : parsedDescription ?? null
        return {
          ...s,
          name: nextName,
          description: nextDescription,
          content: nextContent,
        }
      })
      toast('已生成并填充 Skill 内容', 'success')
    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : '生成失败'
      toast(message, 'error')
    } finally {
      setGeneratorLoading(false)
    }
  }, [generatorImage, generatorLoading, generatorUrl, generatorVideo, skillEditor])

  const filteredNodePresets = React.useMemo(() => {
    if (nodePresetTypeFilter === 'all') return nodePresets
    return nodePresets.filter((item) => item.type === nodePresetTypeFilter)
  }, [nodePresetTypeFilter, nodePresets])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-agents-management__header" justify="space-between" align="center" wrap="wrap" gap="sm">
        <Stack className="stats-agents-management__header-left" gap={2}>
          <Text className="stats-agents-management__title" size="sm" fw={700}>Skill（画布 AI 对话框）</Text>
          <Text className="stats-agents-management__subtitle" size="xs" c="dimmed">
            支持多个 Skill：可持续新增并设置别名与可见性；可见时会在画布 AI 对话框展示。
          </Text>
        </Stack>
        <Group className="stats-agents-management__header-actions" gap={6}>
          <Tooltip className="stats-agents-management__reload-tooltip" label="刷新" withArrow>
            <ActionIcon className="stats-agents-management__reload" size="sm" variant="subtle" aria-label="刷新" onClick={() => void reload()} loading={loading}>
              <IconRefresh className="stats-agents-management__reload-icon" size={14} />
            </ActionIcon>
          </Tooltip>
          <Button
            className="stats-agents-management__edit-skill"
            size="xs"
            radius="md"
            variant="light"
            leftSection={<IconPlus className="stats-agents-management__edit-skill-icon" size={14} />}
            onClick={() => {
              setSkillGeneratorOpen(false)
              setGeneratorUrl('')
              setGeneratorImage(null)
              setGeneratorVideo(null)
              setGeneratorLoading(false)
              setGeneratorVisionPreview('')
              setGeneratorAgentPreview('')
              setSkillEditor(buildSkillEditor(null))
            }}
          >
            新建 Skill
          </Button>
        </Group>
      </Group>

      <Stack className="stats-agents-management__node-presets" gap="xs">
        <Group className="stats-agents-management__node-presets-header" justify="space-between" align="center" wrap="wrap" gap="xs">
          <Stack className="stats-agents-management__node-presets-title-wrap" gap={2}>
            <Text className="stats-agents-management__node-presets-title" size="sm" fw={700}>基础预设能力（文本/图片/视频）</Text>
            <Text className="stats-agents-management__node-presets-subtitle" size="xs" c="dimmed">
              供各用户节点下拉直接选择，作为全局基础预设。
            </Text>
          </Stack>
          <Group className="stats-agents-management__node-presets-actions" gap={6}>
            <Select
              className="stats-agents-management__node-presets-filter"
              size="xs"
              w={120}
              value={nodePresetTypeFilter}
              data={[
                { value: 'all', label: '全部类型' },
                { value: 'text', label: '文本' },
                { value: 'image', label: '图片' },
                { value: 'video', label: '视频' },
              ]}
              onChange={(value) => setNodePresetTypeFilter(((value as any) || 'all') as 'all' | LlmNodePresetType)}
            />
            <Button
              className="stats-agents-management__node-presets-create"
              size="xs"
              radius="md"
              variant="light"
              leftSection={<IconPlus className="stats-agents-management__node-presets-create-icon" size={14} />}
              onClick={() => setNodePresetEditor(buildNodePresetEditor(null))}
            >
              新建基础预设
            </Button>
          </Group>
        </Group>
        <Table className="stats-agents-management__node-presets-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-agents-management__node-presets-table-head">
            <Table.Tr className="stats-agents-management__node-presets-table-head-row">
              <Table.Th className="stats-agents-management__node-presets-table-head-cell" style={{ width: 120 }}>类型</Table.Th>
              <Table.Th className="stats-agents-management__node-presets-table-head-cell" style={{ width: 220 }}>名称</Table.Th>
              <Table.Th className="stats-agents-management__node-presets-table-head-cell">提示词</Table.Th>
              <Table.Th className="stats-agents-management__node-presets-table-head-cell" style={{ width: 90 }}>启用</Table.Th>
              <Table.Th className="stats-agents-management__node-presets-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-agents-management__node-presets-table-body">
            {filteredNodePresets.length === 0 ? (
              <Table.Tr className="stats-agents-management__node-presets-empty-row">
                <Table.Td className="stats-agents-management__node-presets-empty-cell" colSpan={5}>
                  <Text className="stats-agents-management__node-presets-empty-text" size="sm" c="dimmed">暂无基础预设</Text>
                </Table.Td>
              </Table.Tr>
            ) : filteredNodePresets.map((preset) => (
              <Table.Tr className="stats-agents-management__node-presets-row" key={preset.id}>
                <Table.Td className="stats-agents-management__node-presets-cell">
                  <Badge className="stats-agents-management__node-presets-type" variant="light" color="blue">
                    {preset.type}
                  </Badge>
                </Table.Td>
                <Table.Td className="stats-agents-management__node-presets-cell">
                  <Text className="stats-agents-management__node-presets-name" size="sm" fw={600}>{preset.title}</Text>
                </Table.Td>
                <Table.Td className="stats-agents-management__node-presets-cell">
                  <Text className="stats-agents-management__node-presets-prompt" size="sm" c="dimmed" lineClamp={2}>{preset.prompt}</Text>
                </Table.Td>
                <Table.Td className="stats-agents-management__node-presets-cell">
                  <Badge className="stats-agents-management__node-presets-enabled" variant="light" color={preset.enabled === false ? 'gray' : 'green'}>
                    {preset.enabled === false ? '否' : '是'}
                  </Badge>
                </Table.Td>
                <Table.Td className="stats-agents-management__node-presets-cell">
                  <Group className="stats-agents-management__node-presets-row-actions" gap={6} wrap="nowrap">
                    <ActionIcon
                      className="stats-agents-management__node-presets-edit"
                      size="sm"
                      variant="subtle"
                      aria-label="编辑基础预设"
                      onClick={() => setNodePresetEditor(buildNodePresetEditor(preset))}
                    >
                      <IconPencil className="stats-agents-management__node-presets-edit-icon" size={14} />
                    </ActionIcon>
                    <ActionIcon
                      className="stats-agents-management__node-presets-delete"
                      size="sm"
                      variant="subtle"
                      color="red"
                      aria-label="删除基础预设"
                      onClick={() => void removeNodePreset(preset.id)}
                    >
                      <IconTrash className="stats-agents-management__node-presets-delete-icon" size={14} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Stack className="stats-agents-management__skills" gap="xs">
        <Table className="stats-agents-management__skills-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-agents-management__skills-table-head">
            <Table.Tr className="stats-agents-management__skills-table-head-row">
              <Table.Th className="stats-agents-management__skills-table-head-cell" style={{ width: 260 }}>别名</Table.Th>
              <Table.Th className="stats-agents-management__skills-table-head-cell" style={{ width: 100 }}>可见</Table.Th>
              <Table.Th className="stats-agents-management__skills-table-head-cell">说明</Table.Th>
              <Table.Th className="stats-agents-management__skills-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-agents-management__skills-table-body">
            {skills.length === 0 ? (
              <Table.Tr className="stats-agents-management__skills-table-row-empty">
                <Table.Td className="stats-agents-management__skills-table-cell" colSpan={4}>
                  <Text className="stats-agents-management__skills-empty" size="sm" c="dimmed">暂无 skill</Text>
                </Table.Td>
              </Table.Tr>
            ) : skills.map((skill) => (
              <Table.Tr className="stats-agents-management__skills-table-row" key={skill.id}>
                <Table.Td className="stats-agents-management__skills-table-cell">
                  <Stack className="stats-agents-management__skills-name-stack" gap={2}>
                    <Text className="stats-agents-management__skills-name" size="sm" fw={600}>
                      {skill.name || 'Skill'}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td className="stats-agents-management__skills-table-cell">
                  <Badge className="stats-agents-management__skills-visible" variant="light" color={skill.visible ? 'blue' : 'gray'}>
                    {skill.visible ? '是' : '否'}
                  </Badge>
                </Table.Td>
                <Table.Td className="stats-agents-management__skills-table-cell">
                  <Text className="stats-agents-management__skills-desc" size="sm" c="dimmed" lineClamp={2}>
                    {skill.description || '—'}
                  </Text>
                </Table.Td>
                <Table.Td className="stats-agents-management__skills-table-cell">
                  <Group className="stats-agents-management__skills-actions" gap={6} wrap="nowrap">
                    <Tooltip className="stats-agents-management__skills-edit-tooltip" label="编辑" withArrow>
                      <ActionIcon
                        className="stats-agents-management__skills-edit"
                        size="sm"
                        variant="subtle"
                        aria-label="编辑"
                        onClick={() => {
                          setSkillGeneratorOpen(false)
                          setGeneratorUrl('')
                          setGeneratorImage(null)
                          setGeneratorVideo(null)
                          setGeneratorLoading(false)
                          setGeneratorVisionPreview('')
                          setGeneratorAgentPreview('')
                          setSkillEditor(buildSkillEditor(skill))
                        }}
                      >
                        <IconPencil className="stats-agents-management__skills-edit-icon" size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="stats-agents-management__skills-delete-tooltip" label="删除" withArrow>
                      <ActionIcon
                        className="stats-agents-management__skills-delete"
                        size="sm"
                        variant="subtle"
                        color="red"
                        aria-label="删除"
                        onClick={() => void removeSkill(skill.id)}
                      >
                        <IconTrash className="stats-agents-management__skills-delete-icon" size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Modal
        className="stats-agents-management__node-preset-modal"
        opened={!!nodePresetEditor}
        onClose={() => setNodePresetEditor(null)}
        title={<Text className="stats-agents-management__node-preset-modal-title" fw={700}>{nodePresetEditor?.id ? '编辑基础预设' : '新建基础预设'}</Text>}
        centered
        size="md"
        lockScroll={false}
      >
        <Stack className="stats-agents-management__node-preset-form" gap="sm">
          <Select
            className="stats-agents-management__node-preset-type"
            label="类型"
            data={[
              { value: 'text', label: '文本' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
            ]}
            value={nodePresetEditor?.type || 'text'}
            onChange={(value) => setNodePresetEditor((s) => (s ? { ...s, type: ((value as LlmNodePresetType) || 'text') } : s))}
            allowDeselect={false}
          />
          <TextInput
            className="stats-agents-management__node-preset-title"
            label="名称"
            value={nodePresetEditor?.title || ''}
            onChange={(e) => setNodePresetEditor((s) => (s ? { ...s, title: e.currentTarget.value } : s))}
            placeholder="例如：剧情对白压缩"
          />
          <Textarea
            className="stats-agents-management__node-preset-prompt"
            label="提示词"
            minRows={6}
            autosize
            value={nodePresetEditor?.prompt || ''}
            onChange={(e) => setNodePresetEditor((s) => (s ? { ...s, prompt: e.currentTarget.value } : s))}
            placeholder="输入预设提示词内容"
          />
          <TextInput
            className="stats-agents-management__node-preset-description"
            label="描述（可选）"
            value={nodePresetEditor?.description || ''}
            onChange={(e) => setNodePresetEditor((s) => (s ? { ...s, description: e.currentTarget.value } : s))}
          />
          <Group className="stats-agents-management__node-preset-meta" grow>
            <Checkbox
              className="stats-agents-management__node-preset-enabled"
              label="启用"
              checked={nodePresetEditor?.enabled !== false}
              onChange={(e) => setNodePresetEditor((s) => (s ? { ...s, enabled: e.currentTarget.checked } : s))}
            />
            <TextInput
              className="stats-agents-management__node-preset-sort-order"
              label="排序（可选）"
              placeholder="数字越小越靠前"
              value={nodePresetEditor?.sortOrder == null ? '' : String(nodePresetEditor.sortOrder)}
              onChange={(e) => {
                const raw = e.currentTarget.value.trim()
                if (!raw) {
                  setNodePresetEditor((s) => (s ? { ...s, sortOrder: null } : s))
                  return
                }
                const nextNumber = Number(raw)
                setNodePresetEditor((s) => (s ? { ...s, sortOrder: Number.isFinite(nextNumber) ? Math.trunc(nextNumber) : null } : s))
              }}
            />
          </Group>
          <Group className="stats-agents-management__node-preset-actions" justify="flex-end" gap={8}>
            <Button
              className="stats-agents-management__node-preset-cancel"
              variant="subtle"
              onClick={() => setNodePresetEditor(null)}
            >
              取消
            </Button>
            <Button
              className="stats-agents-management__node-preset-save"
              onClick={() => void saveNodePreset()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        className="stats-agents-management__skill-modal"
        opened={!!skillEditor}
        onClose={() => {
          setSkillEditor(null)
          setSkillGeneratorOpen(false)
          setGeneratorUrl('')
          setGeneratorImage(null)
          setGeneratorVideo(null)
          setGeneratorLoading(false)
          setGeneratorVisionPreview('')
          setGeneratorAgentPreview('')
        }}
        title={<Text className="stats-agents-management__skill-modal-title" fw={700}>{skillEditor?.id ? '编辑 Skill' : '创建 Skill'}</Text>}
        centered
        size="lg"
        lockScroll={false}
      >
        <Stack className="stats-agents-management__skill-form" gap="sm">
          <Group className="stats-agents-management__skill-form-title-row" gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              className="stats-agents-management__skill-name"
              label="别名（可选）"
              value={skillEditor?.name || ''}
              onChange={(e) => { const nextName = e.currentTarget.value; setSkillEditor((s) => (s ? { ...s, name: nextName } : s)) }}
              placeholder="可留空，从内容/生成结果自动提取"
            />
            <Checkbox
              className="stats-agents-management__skill-visible"
              label="在画布 AI 对话框显示"
              checked={!!skillEditor?.visible}
              onChange={(e) => { const nextVisible = e.currentTarget.checked; setSkillEditor((s) => (s ? { ...s, visible: nextVisible } : s)) }}
            />
          </Group>

          <Group className="stats-agents-management__skill-generator-header" justify="space-between" gap="sm" wrap="wrap">
            <Text className="stats-agents-management__skill-generator-title" size="sm" fw={600}>
              从作品生成（可选）
            </Text>
            <Button
              className="stats-agents-management__skill-generator-toggle"
              size="xs"
              radius="md"
              variant={skillGeneratorOpen ? 'light' : 'subtle'}
              onClick={() => setSkillGeneratorOpen((v) => !v)}
            >
              {skillGeneratorOpen ? '收起生成器' : '打开生成器'}
            </Button>
          </Group>
          <Collapse className="stats-agents-management__skill-generator-collapse" in={skillGeneratorOpen}>
            <Stack className="stats-agents-management__skill-generator" gap="sm" mt="sm">
              <Textarea
                className="stats-agents-management__skill-description"
                label="补充说明（可选）"
                autosize
                minRows={2}
                maxRows={6}
                value={skillEditor?.description || ''}
                onChange={(e) => { const nextDescription = e.currentTarget.value; setSkillEditor((s) => (s ? { ...s, description: nextDescription } : s)) }}
                placeholder="例如：适用类目、品牌调性、必须保留/避免的元素…"
              />
              <TextInput
                className="stats-agents-management__skill-generator-url"
                label="作品链接（可选，图片/视频 URL）"
                value={generatorUrl}
                onChange={(e) => setGeneratorUrl(e.currentTarget.value)}
                placeholder="https://..."
              />
              <Group className="stats-agents-management__skill-generator-files" gap="sm" grow wrap="wrap">
                <FileInput
                  className="stats-agents-management__skill-generator-image"
                  label="上传图片（可选）"
                  placeholder="选择图片文件"
                  value={generatorImage}
                  onChange={(v) => {
                    setGeneratorImage(v || null)
                    if (v) setGeneratorVideo(null)
                  }}
                  accept="image/*"
                  clearable
                />
                <FileInput
                  className="stats-agents-management__skill-generator-video"
                  label="上传视频（可选）"
                  placeholder="选择视频文件"
                  value={generatorVideo}
                  onChange={(v) => {
                    setGeneratorVideo(v || null)
                    if (v) setGeneratorImage(null)
                  }}
                  accept="video/*"
                  clearable
                />
              </Group>
              <Group className="stats-agents-management__skill-generator-actions" justify="space-between" gap="sm" wrap="wrap">
                <Button
                  className="stats-agents-management__skill-generator-run"
                  size="xs"
                  radius="md"
                  variant="light"
                  loading={generatorLoading}
                  onClick={() => void runGenerator()}
                >
                  分析并填充 Skill 内容
                </Button>
                <Button
                  className="stats-agents-management__skill-generator-reset"
                  size="xs"
                  radius="md"
                  variant="subtle"
                  onClick={() => {
                    setGeneratorUrl('')
                    setGeneratorImage(null)
                    setGeneratorVideo(null)
                    setGeneratorVisionPreview('')
                    setGeneratorAgentPreview('')
                  }}
                >
                  清空
                </Button>
              </Group>
              {generatorVisionPreview ? (
                <Textarea
                  className="stats-agents-management__skill-generator-vision-preview"
                  label="中间结果：视觉拆解（来自 OpenAI image_to_prompt）"
                  autosize
                  minRows={4}
                  maxRows={10}
                  value={generatorVisionPreview}
                  readOnly
                />
              ) : null}
              {generatorAgentPreview ? (
                <Textarea
                  className="stats-agents-management__skill-generator-agent-preview"
                  label="中间结果：agents-cli 输出（含 <tapcanvas_skill_json>）"
                  autosize
                  minRows={4}
                  maxRows={10}
                  value={generatorAgentPreview}
                  readOnly
                />
              ) : null}
            </Stack>
          </Collapse>
          <Textarea
            className="stats-agents-management__skill-content"
            label="内容（会拼接进 system prompt）"
            autosize
            minRows={6}
            maxRows={16}
            value={skillEditor?.content || ''}
            onChange={(e) => {
              const nextContent = e.currentTarget.value
              setSkillEditor((s) => {
                if (!s) return s
                const needsName = !s.name.trim()
                const needsDescription = !(s.description && s.description.trim())
                if (!needsName && !needsDescription) return { ...s, content: nextContent }

                const inferred = inferSkillMetaFromContent(nextContent)
                return {
                  ...s,
                  ...(needsName && inferred.name ? { name: inferred.name } : {}),
                  ...(needsDescription && inferred.description ? { description: inferred.description } : {}),
                  content: nextContent,
                }
              })
            }}
            placeholder="写给模型的指令/结构/约束…（也可用生成器自动生成）"
          />
          <Group className="stats-agents-management__skill-form-actions" justify="flex-end" gap={8}>
            <Button
              className="stats-agents-management__skill-cancel"
              variant="subtle"
              leftSection={<IconX className="stats-agents-management__skill-cancel-icon" size={14} />}
              onClick={() => {
                setSkillEditor(null)
                setSkillGeneratorOpen(false)
                setGeneratorUrl('')
                setGeneratorImage(null)
                setGeneratorVideo(null)
                setGeneratorLoading(false)
                setGeneratorVisionPreview('')
                setGeneratorAgentPreview('')
              }}
            >
              取消
            </Button>
            <Button
              className="stats-agents-management__skill-save"
              variant="light"
              onClick={() => void saveSkill()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
