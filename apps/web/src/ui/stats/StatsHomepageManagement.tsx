import React from 'react'
import {
  ActionIcon, Button, Group, Loader, NumberInput, Switch,
  Stack, Text, TextInput, Textarea, Title, Tooltip, Center,
} from '@mantine/core'
import {
  IconArrowDown, IconArrowUp, IconBan, IconPlus, IconRefresh, IconTrash, IconDeviceFloppy, IconStar,
} from '@tabler/icons-react'
import {
  type CarouselSlide,
  type PublicAssetDto,
  type AdminProjectDto,
  listPublishedVideos,
  listHomepageCarouselSlides,
  saveHomepageCarousel,
  uploadServerAssetFile,
  listAdminProjects,
  updateAdminProject,
  fetchHomepageDecoration,
  saveHomepageDecoration,
  EMPTY_HOMEPAGE_DECORATION,
  type HomepageDecoration,
  type HomepageSkillCard,
  type LoginVideoItem,
  getAdminHomepageVideoRanking,
  getAdminHomepageVideoModeration,
  saveAdminHomepageVideoRanking,
  saveAdminHomepageVideoModeration,
  type HomepageVideoModerationConfigDto,
  type HomepageVideoRankingConfigDto,
  type RankingItemControlDto,
} from '../../api/server'
import { toast } from '../toast'
import { PanelCard } from '../PanelCard'
import { ManagedImage } from '../../domain/resource-runtime'
import { StatsHomepagePreview } from './StatsHomepagePreview'
import {
  runHomepageSave,
  type HomepageSaveTask,
} from './homepage-save/homepageSaveCoordinator'

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

// ── Carousel slide row ────────────────────────────────────────────────────────

type SlideRowProps = {
  slide: CarouselSlide
  index: number
  total: number
  onUp: () => void
  onDown: () => void
  onDelete: () => void
  onChange: (next: CarouselSlide) => void
}

function SlideRow({ slide, index, total, onUp, onDown, onDelete, onChange }: SlideRowProps): JSX.Element {
  const [uploading, setUploading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const asset = await uploadServerAssetFile(file, file.name)
      onChange({ ...slide, imageUrl: asset.data?.url || '' })
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '上传失败'), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <PanelCard padding="compact" style={{ borderRadius: 8 }}>
      <Group gap={10} align="flex-start" wrap="nowrap">
        <div style={{ width: 120, flexShrink: 0 }}>
          <div
            style={{
              width: 120,
              height: 68,
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--mantine-color-dark-6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
            }}
            title="点击上传图片"
            onClick={() => inputRef.current?.click()}
          >
            {slide.imageUrl ? (
              <ManagedImage
                className="stats-homepage-carousel-thumb"
                src={slide.imageUrl}
                alt={`slide-${index}`}
                priority="visible"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Text size="xs" c="dimmed">{uploading ? '上传中…' : '点击上传'}</Text>
            )}
            {uploading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
                <Loader size="xs" color="white" />
              </div>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void handleFileChange(e)} />
        </div>

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <TextInput
            size="xs"
            placeholder="图片 URL（必填）"
            value={slide.imageUrl}
            onChange={(e) => onChange({ ...slide, imageUrl: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            placeholder="标题（可选）"
            value={slide.title ?? ''}
            onChange={(e) => onChange({ ...slide, title: e.currentTarget.value || null })}
          />
          <TextInput
            size="xs"
            placeholder="跳转链接（可选）"
            value={slide.linkUrl ?? ''}
            onChange={(e) => onChange({ ...slide, linkUrl: e.currentTarget.value || null })}
          />
        </Stack>

        <Stack gap={4} style={{ flexShrink: 0 }}>
          <Tooltip label="上移" withinPortal>
            <ActionIcon size="sm" variant="subtle" disabled={index === 0} onClick={onUp}>
              <IconArrowUp size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="下移" withinPortal>
            <ActionIcon size="sm" variant="subtle" disabled={index === total - 1} onClick={onDown}>
              <IconArrowDown size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="删除" withinPortal>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete}>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Stack>
      </Group>
    </PanelCard>
  )
}

// ── Login video row（登录页背景视频条目）──────────────────────────────────────

function LoginVideoRow({ video, index, total, onUp, onDown, onDelete, onChange }: {
  video: LoginVideoItem
  index: number
  total: number
  onUp: () => void
  onDown: () => void
  onDelete: () => void
  onChange: (next: LoginVideoItem) => void
}): JSX.Element {
  const [uploading, setUploading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const asset = await uploadServerAssetFile(file, file.name)
      onChange({ ...video, url: asset.data?.url || '' })
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '上传失败'), 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <PanelCard padding="compact" style={{ borderRadius: 8 }}>
      <Group gap={10} align="flex-start" wrap="nowrap">
        <div
          style={{ width: 120, height: 68, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: 'var(--mantine-color-dark-6)', cursor: 'pointer', position: 'relative' }}
          title="点击上传视频"
          onClick={() => inputRef.current?.click()}
        >
          {video.url ? (
            <video src={video.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          ) : (
            <Center style={{ height: '100%' }}>
              <Text size="xs" c="dimmed">{uploading ? '上传中…' : '点击上传视频'}</Text>
            </Center>
          )}
          {uploading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
              <Loader size="xs" color="white" />
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => void handleFileChange(e)} />

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <TextInput size="xs" placeholder="视频 URL（必填）" value={video.url}
            onChange={(e) => onChange({ ...video, url: e.currentTarget.value })} />
          <TextInput size="xs" placeholder="封面图 URL（可选）" value={video.posterUrl ?? ''}
            onChange={(e) => onChange({ ...video, posterUrl: e.currentTarget.value || null })} />
          <TextInput size="xs" placeholder="底部字幕文案（可选）" value={video.caption ?? ''}
            onChange={(e) => onChange({ ...video, caption: e.currentTarget.value || null })} />
        </Stack>

        <Stack gap={4} style={{ flexShrink: 0 }}>
          <ActionIcon size="sm" variant="subtle" disabled={index === 0} onClick={onUp}><IconArrowUp size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" disabled={index === total - 1} onClick={onDown}><IconArrowDown size={14} /></ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="red" onClick={onDelete}><IconTrash size={14} /></ActionIcon>
        </Stack>
      </Group>
    </PanelCard>
  )
}

// ── Published video row ───────────────────────────────────────────────────────

const EMPTY_RANKING_CONTROL: RankingItemControlDto = {
  manualBoost: 0,
  recommended: false,
  pinned: false,
  displayOrder: 0,
}

function VideoRow({ video, control, blocked, onChange, onBlockedChange }: {
  video: PublicAssetDto
  control: RankingItemControlDto
  blocked: boolean
  onChange: (patch: Partial<RankingItemControlDto>) => void
  onBlockedChange: (blocked: boolean) => void
}): JSX.Element {
  return (
    <Group className={`stats-homepage-video-row${blocked ? ' is-blocked' : ''}`} gap={10} wrap="nowrap" align="center" py={6}>
      <div style={{ width: 80, height: 45, flexShrink: 0, borderRadius: 5, overflow: 'hidden', background: 'var(--mantine-color-dark-6)' }}>
        {video.thumbnailUrl ? (
          <ManagedImage
            className="stats-homepage-video-thumb"
            src={video.thumbnailUrl}
            alt={video.name}
            priority="visible"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Center style={{ height: '100%' }}>
            <Text size="xs" c="dimmed">无图</Text>
          </Center>
        )}
      </div>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500} lineClamp={1}>{video.name}</Text>
        <Text size="xs" c="dimmed" lineClamp={1}>{video.ownerName || video.ownerLogin || '—'} · {video.projectName || '—'}</Text>
        <Text className="stats-homepage-video-ranking-facts" size="xs" c="dimmed">
          点赞 {video.likeCount ?? 0} · 收藏 {video.favoriteCount ?? 0} · 算法分 {(video.algorithmScore ?? 0).toFixed(2)} · 最终分 {(video.effectiveScore ?? 0).toFixed(2)}
        </Text>
      </Stack>
      <NumberInput
        className="stats-homepage-video-boost-input"
        aria-label={`${video.name} 热度加成`}
        size="xs"
        min={-10000}
        max={10000}
        value={control.manualBoost}
        onChange={(value) => onChange({ manualBoost: typeof value === 'number' ? value : 0 })}
      />
      <NumberInput
        className="stats-homepage-video-order-input"
        aria-label={`${video.name} 人工顺序`}
        size="xs"
        min={-10000}
        max={10000}
        value={control.displayOrder}
        onChange={(value) => onChange({ displayOrder: typeof value === 'number' ? value : 0 })}
      />
      <Tooltip label={control.recommended ? '取消推荐' : '设为推荐'} withinPortal>
        <ActionIcon
          className="stats-homepage-video-recommend-action"
          aria-label={`${video.name} 推荐`}
          size="sm"
          variant={control.recommended ? 'filled' : 'subtle'}
          color={control.recommended ? 'blue' : 'gray'}
          onClick={() => onChange({ recommended: !control.recommended })}
        >
          <IconStar className="stats-homepage-video-recommend-icon" size={14} />
        </ActionIcon>
      </Tooltip>
      <Switch
        className="stats-homepage-video-pin-switch"
        aria-label={`${video.name} 置顶`}
        size="xs"
        checked={control.pinned}
        onChange={(event) => onChange({ pinned: event.currentTarget.checked })}
      />
      <Tooltip label={blocked ? '解除首页拉黑' : '从首页拉黑'} withinPortal>
        <ActionIcon
          className="stats-homepage-video-block-action"
          aria-label={`${video.name} ${blocked ? '解除首页拉黑' : '从首页拉黑'}`}
          size="sm"
          variant={blocked ? 'filled' : 'subtle'}
          color={blocked ? 'red' : 'gray'}
          onClick={() => onBlockedChange(!blocked)}
        >
          <IconBan className="stats-homepage-video-block-icon" size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatsHomepageManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-homepage-management', className].filter(Boolean).join(' ')

  // Carousel state
  const [slides, setSlides] = React.useState<CarouselSlide[]>([])
  const [carouselLoading, setCarouselLoading] = React.useState(false)

  // 首页视频推荐算法
  const [videos, setVideos] = React.useState<PublicAssetDto[]>([])
  const [videoRankingConfig, setVideoRankingConfig] = React.useState<HomepageVideoRankingConfigDto | null>(null)
  const [videoModerationConfig, setVideoModerationConfig] = React.useState<HomepageVideoModerationConfigDto | null>(null)
  const [videosLoading, setVideosLoading] = React.useState(false)
  const [videoRankingError, setVideoRankingError] = React.useState('')

  // Public template sort weight state
  const [publicTemplates, setPublicTemplates] = React.useState<AdminProjectDto[]>([])
  const [templateWeights, setTemplateWeights] = React.useState<Record<string, number>>({})
  const [templatesLoading, setTemplatesLoading] = React.useState(false)

  // 首页装修（问候文案 / skill 卡 / 登录页视频）
  const [decoration, setDecoration] = React.useState<HomepageDecoration>(EMPTY_HOMEPAGE_DECORATION)
  const [decorationLoading, setDecorationLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const loadDecoration = React.useCallback(async () => {
    setDecorationLoading(true)
    try {
      setDecoration(await fetchHomepageDecoration())
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '首页装修加载失败'), 'error')
    } finally {
      setDecorationLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadDecoration() }, [loadDecoration])

  const patchSkillCard = (i: number, patch: Partial<HomepageSkillCard>) =>
    setDecoration((d) => ({ ...d, skillCards: d.skillCards.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const patchLoginVideo = (i: number, patch: Partial<LoginVideoItem>) =>
    setDecoration((d) => ({ ...d, loginVideos: d.loginVideos.map((v, j) => (j === i ? { ...v, ...patch } : v)) }))
  const moveLoginVideo = (i: number, dir: -1 | 1) =>
    setDecoration((d) => {
      const j = i + dir
      if (j < 0 || j >= d.loginVideos.length) return d
      const next = [...d.loginVideos]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...d, loginVideos: next }
    })

  const loadCarousel = React.useCallback(async () => {
    setCarouselLoading(true)
    try {
      const s = await listHomepageCarouselSlides()
      setSlides(s.length ? s : [])
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '首页轮播图加载失败'), 'error')
    } finally {
      setCarouselLoading(false)
    }
  }, [])

  const loadVideos = React.useCallback(async () => {
    setVideosLoading(true)
    setVideoRankingError('')
    try {
      const [vids, ranking, moderation] = await Promise.all([
        listPublishedVideos(48),
        getAdminHomepageVideoRanking(),
        getAdminHomepageVideoModeration(),
      ])
      setVideos(vids)
      setVideoRankingConfig(ranking.config)
      setVideoModerationConfig(moderation.config)
    } catch (loadError: unknown) {
      setVideoRankingError(loadError instanceof Error ? loadError.message : '首页推荐配置加载失败')
    } finally {
      setVideosLoading(false)
    }
  }, [])

  const loadPublicTemplates = React.useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const items = await listAdminProjects({ isPublic: true, limit: 200 })
      setPublicTemplates(items)
      const weights: Record<string, number> = {}
      for (const t of items) weights[t.id] = t.sortWeight
      setTemplateWeights(weights)
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '公开模板加载失败'), 'error')
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  React.useEffect(() => { void loadCarousel() }, [loadCarousel])
  React.useEffect(() => { void loadVideos() }, [loadVideos])
  React.useEffect(() => { void loadPublicTemplates() }, [loadPublicTemplates])

  // Carousel actions
  const moveSlide = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= slides.length) return
    const next = [...slides]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSlides(next)
  }

  const patchVideoRankingControl = (id: string, patch: Partial<RankingItemControlDto>) => {
    setVideoRankingConfig((current) => current ? {
      ...current,
      items: {
        ...current.items,
        [id]: { ...(current.items[id] ?? EMPTY_RANKING_CONTROL), ...patch },
      },
    } : current)
  }

  const setVideoBlocked = React.useCallback((assetId: string, blocked: boolean): void => {
    setVideoModerationConfig((current) => {
      if (!current) return current
      const blockedAssetIds = new Set(current.blockedAssetIds)
      if (blocked) blockedAssetIds.add(assetId)
      else blockedAssetIds.delete(assetId)
      return { ...current, blockedAssetIds: [...blockedAssetIds] }
    })
  }, [])

  const handleSaveAll = React.useCallback(async (): Promise<void> => {
    if (!videoRankingConfig || !videoModerationConfig) {
      toast('首页推荐配置尚未加载完成，无法保存', 'error')
      return
    }

    const carouselSnapshot = slides
    const decorationSnapshot = decoration
    const changedTemplates = publicTemplates.filter((template) => (
      templateWeights[template.id] !== template.sortWeight
    ))
    const moderationSnapshot: HomepageVideoModerationConfigDto = {
      ...videoModerationConfig,
      blockedAssetIds: [...new Set(videoModerationConfig.blockedAssetIds)],
    }
    const rankingSnapshot = videoRankingConfig

    const tasks: HomepageSaveTask[] = [
      { key: 'carousel', label: '首页轮播图', run: () => saveHomepageCarousel(carouselSnapshot) },
      { key: 'decoration', label: '首页装修', run: () => saveHomepageDecoration(decorationSnapshot) },
      {
        key: 'ranking',
        label: '首页推荐算法',
        run: async () => { await saveAdminHomepageVideoRanking(rankingSnapshot) },
      },
      {
        key: 'moderation',
        label: '首页作品拉黑',
        run: async () => { await saveAdminHomepageVideoModeration(moderationSnapshot) },
      },
      ...changedTemplates.map<HomepageSaveTask>((template) => ({
        key: 'template',
        label: `模板「${template.templateTitle}」权重`,
        templateId: template.id,
        run: async () => { await updateAdminProject(template.id, { sortWeight: templateWeights[template.id] ?? 0 }) },
      })),
    ]

    setSaving(true)
    setVideoRankingError('')
    try {
      const result = await runHomepageSave({ slides: carouselSnapshot, decoration: decorationSnapshot }, tasks)
      if (result.validationError) {
        toast(result.validationError, 'error')
        return
      }

      const successful = result.outcomes.filter((outcome) => outcome.error === null)
      const failed = result.outcomes.filter((outcome) => outcome.error !== null)
      const successfulKeys = new Set(successful.map((outcome) => outcome.task.key))
      const savedTemplateIds = new Set(successful
        .map((outcome) => outcome.task.templateId)
        .filter((templateId): templateId is string => Boolean(templateId)))

      if (savedTemplateIds.size > 0) {
        setPublicTemplates((current) => current.map((template) => (
          savedTemplateIds.has(template.id)
            ? { ...template, sortWeight: templateWeights[template.id] ?? template.sortWeight }
            : template
        )))
      }

      let refreshError = ''
      if (successfulKeys.has('ranking') || successfulKeys.has('moderation')) {
        try {
          setVideos(await listPublishedVideos(48))
        } catch (error: unknown) {
          refreshError = `配置已保存，但作品列表刷新失败：${resolveErrorMessage(error, '未知错误')}`
          setVideoRankingError(refreshError)
        }
      }

      if (failed.length > 0) {
        const details = failed.map((outcome) => `${outcome.task.label}：${outcome.error}`).join('；')
        toast(`部分配置保存失败。${details}`, 'error')
      } else if (refreshError) {
        toast(refreshError, 'error')
      } else {
        toast('首页配置已全部保存', 'success')
      }
    } finally {
      setSaving(false)
    }
  }, [decoration, publicTemplates, slides, templateWeights, videoModerationConfig, videoRankingConfig])

  const blockedVideoIds = videoModerationConfig?.blockedAssetIds ?? []
  const blockedVideoIdSet = React.useMemo(() => new Set(blockedVideoIds), [blockedVideoIds])
  const configurationLoading = carouselLoading || decorationLoading || templatesLoading || videosLoading

  return (
    <div className={rootClassName}>
      <Stack className="stats-homepage-management__editor" gap="lg">
      <div className="stats-homepage-management__save-bar">
        <div className="stats-homepage-management__save-copy">
          <Title className="stats-homepage-management__save-title" order={4}>首页管理</Title>
          <Text className="stats-homepage-management__save-status" size="xs" c="dimmed">临时预览</Text>
        </div>
        <Button
          className="stats-homepage-management__save-all"
          size="sm"
          leftSection={<IconDeviceFloppy className="stats-homepage-management__save-icon" size={15} />}
          loading={saving}
          disabled={configurationLoading || !videoRankingConfig || !videoModerationConfig}
          onClick={() => void handleSaveAll()}
        >
          保存全部
        </Button>
      </div>
      {/* ── 轮播图配置 ── */}
      <PanelCard>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Title order={5}>首页轮播图</Title>
              <Text size="xs" c="dimmed">配置首页 Banner 区的轮播内容，每张图片可设置标题和跳转链接</Text>
            </Stack>
            <Group gap={6}>
              <Tooltip label="刷新" withinPortal>
                <ActionIcon variant="subtle" size="sm" loading={carouselLoading} onClick={() => void loadCarousel()}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {carouselLoading ? (
            <Center h={80}><Loader size="sm" /></Center>
          ) : (
            <Stack gap={8}>
              {slides.map((slide, i) => (
                <SlideRow
                  key={i}
                  slide={slide}
                  index={i}
                  total={slides.length}
                  onUp={() => moveSlide(i, -1)}
                  onDown={() => moveSlide(i, 1)}
                  onDelete={() => setSlides(slides.filter((_, j) => j !== i))}
                  onChange={(next) => setSlides(slides.map((s, j) => j === i ? next : s))}
                />
              ))}
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                onClick={() => setSlides([...slides, { imageUrl: '', title: null, linkUrl: null }])}
              >
                添加轮播图
              </Button>
            </Stack>
          )}
        </Stack>
      </PanelCard>

      {/* ── 首页装修 ── */}
      <PanelCard>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Title order={5}>首页装修</Title>
              <Text size="xs" c="dimmed">门户首页问候副文案、输入框占位、Skill 快捷卡；登录页背景视频轮播</Text>
            </Stack>
            <Group gap={6}>
              <Tooltip label="刷新" withinPortal>
                <ActionIcon variant="subtle" size="sm" loading={decorationLoading} onClick={() => void loadDecoration()}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {decorationLoading ? (
            <Center h={80}><Loader size="sm" /></Center>
          ) : (
            <Stack gap="md">
              <TextInput
                label="问候副文案"
                placeholder="一句话开始，小T 帮你把想法变成画布"
                value={decoration.greetingSubtitle ?? ''}
                onChange={(e) => setDecoration((d) => ({ ...d, greetingSubtitle: e.currentTarget.value || null }))}
              />
              <Textarea
                label="创意输入框占位文案"
                placeholder="说说你的创意，TapCanvas 帮你在画布上实现 …"
                autosize
                minRows={1}
                value={decoration.heroPlaceholder ?? ''}
                onChange={(e) => setDecoration((d) => ({ ...d, heroPlaceholder: e.currentTarget.value || null }))}
              />

              <Stack gap={8}>
                <Text size="sm" fw={600}>Skill 快捷卡</Text>
                {decoration.skillCards.map((card, i) => (
                  <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                    <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} grow>
                        <TextInput size="xs" placeholder="标题（必填）" value={card.title}
                          onChange={(e) => patchSkillCard(i, { title: e.currentTarget.value })} />
                        <TextInput size="xs" placeholder="副标题" value={card.subtitle ?? ''}
                          onChange={(e) => patchSkillCard(i, { subtitle: e.currentTarget.value || null })} />
                      </Group>
                      <Group gap={6} grow>
                        <TextInput size="xs" placeholder="配图 URL" value={card.imageUrl ?? ''}
                          onChange={(e) => patchSkillCard(i, { imageUrl: e.currentTarget.value || null })} />
                        <TextInput size="xs" placeholder="跳转链接" value={card.link ?? ''}
                          onChange={(e) => patchSkillCard(i, { link: e.currentTarget.value || null })} />
                      </Group>
                    </Stack>
                    <ActionIcon size="sm" variant="subtle" color="red"
                      onClick={() => setDecoration((d) => ({ ...d, skillCards: d.skillCards.filter((_, j) => j !== i) }))}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />}
                  onClick={() => setDecoration((d) => ({ ...d, skillCards: [...d.skillCards, { title: '', subtitle: null, imageUrl: null, link: null }] }))}>
                  添加 Skill 卡
                </Button>
              </Stack>

              <Stack gap={8}>
                <Text size="sm" fw={600}>登录页背景视频</Text>
                {decoration.loginVideos.map((video, i) => (
                  <LoginVideoRow
                    key={i}
                    video={video}
                    index={i}
                    total={decoration.loginVideos.length}
                    onUp={() => moveLoginVideo(i, -1)}
                    onDown={() => moveLoginVideo(i, 1)}
                    onDelete={() => setDecoration((d) => ({ ...d, loginVideos: d.loginVideos.filter((_, j) => j !== i) }))}
                    onChange={(next) => patchLoginVideo(i, next)}
                  />
                ))}
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />}
                  onClick={() => setDecoration((d) => ({ ...d, loginVideos: [...d.loginVideos, { url: '', posterUrl: null, caption: null }] }))}>
                  添加登录页视频
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </PanelCard>

      {/* ── 公开模板排序 ── */}
      <PanelCard>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Title order={5}>公开模板排序权重</Title>
              <Text size="xs" c="dimmed">权重越大排列越靠前，同权重时按复制次数降序，默认 0</Text>
            </Stack>
            <Group gap={6}>
              <Text size="xs" c="dimmed">{publicTemplates.length} 个模板</Text>
              <Tooltip label="刷新" withinPortal>
                <ActionIcon variant="subtle" size="sm" loading={templatesLoading} onClick={() => void loadPublicTemplates()}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {templatesLoading ? (
            <Center h={120}><Loader size="sm" /></Center>
          ) : publicTemplates.length === 0 ? (
            <Center h={60}><Text size="sm" c="dimmed">暂无公开模板</Text></Center>
          ) : (
            <Stack gap={0}>
              {[...publicTemplates].sort((a, b) => (templateWeights[b.id] ?? 0) - (templateWeights[a.id] ?? 0) || b.cloneCount - a.cloneCount).map(t => (
                <Group key={t.id} gap={10} wrap="nowrap" align="center" py={6} style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}>
                  <div style={{ width: 64, height: 36, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: 'var(--mantine-color-dark-6)' }}>
                    {t.templateCoverUrl ? (
                      <ManagedImage
                        className="stats-homepage-template-thumb"
                        src={t.templateCoverUrl}
                        alt={t.templateTitle}
                        priority="visible"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <Center style={{ height: '100%' }}>
                        <Text size="xs" c="dimmed">无图</Text>
                      </Center>
                    )}
                  </div>
                  <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} lineClamp={1}>{t.templateTitle}</Text>
                    <Text size="xs" c="dimmed">复制 {t.cloneCount} 次</Text>
                  </Stack>
                  <NumberInput
                    size="xs"
                    value={templateWeights[t.id] ?? 0}
                    onChange={(v) => setTemplateWeights(prev => ({ ...prev, [t.id]: typeof v === 'number' ? v : 0 }))}
                    min={-9999}
                    max={9999}
                    step={1}
                    allowDecimal={false}
                    style={{ width: 90 }}
                    styles={{ input: { textAlign: 'center' } }}
                  />
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </PanelCard>

      {/* ── 首页视频推荐算法 ── */}
      <PanelCard>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Title order={5}>首页视频推荐算法</Title>
              <Text size="xs" c="dimmed">算法读取真实点赞、收藏与发布时间；可人工加热、推荐、置顶或指定同分顺序。</Text>
            </Stack>
            <Group gap={6}>
              <Tooltip label="刷新" withinPortal>
                <ActionIcon variant="subtle" size="sm" loading={videosLoading} onClick={() => void loadVideos()}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {videoRankingError ? <Text className="stats-homepage-video-ranking-error" size="xs" c="red" role="alert">{videoRankingError}</Text> : null}

          {videoRankingConfig ? (
            <Group className="stats-homepage-video-ranking-weights" gap="md" align="flex-end">
              <NumberInput
                className="stats-homepage-video-ranking-weight"
                label="互动权重"
                description="点赞 + 收藏×2"
                min={0}
                max={100}
                value={videoRankingConfig.engagementWeight}
                onChange={(value) => setVideoRankingConfig((current) => current ? { ...current, engagementWeight: typeof value === 'number' ? value : 0 } : current)}
              />
              <NumberInput
                className="stats-homepage-video-ranking-weight"
                label="新鲜度权重"
                min={0}
                max={100}
                value={videoRankingConfig.freshnessWeight}
                onChange={(value) => setVideoRankingConfig((current) => current ? { ...current, freshnessWeight: typeof value === 'number' ? value : 0 } : current)}
              />
              <NumberInput
                className="stats-homepage-video-ranking-weight"
                label="新鲜度半衰期（天）"
                min={1}
                max={3650}
                value={videoRankingConfig.freshnessHalfLifeDays}
                onChange={(value) => setVideoRankingConfig((current) => current ? { ...current, freshnessHalfLifeDays: typeof value === 'number' ? value : 1 } : current)}
              />
            </Group>
          ) : null}

          {videosLoading ? (
            <Center h={120}><Loader size="sm" /></Center>
          ) : videos.length === 0 ? (
            <Center h={80}><Text size="sm" c="dimmed">暂无已发布视频</Text></Center>
          ) : (
            <Stack gap={0}>
              {videos.map(v => (
                <VideoRow
                  key={v.id}
                  video={v}
                  control={videoRankingConfig?.items[v.id] ?? EMPTY_RANKING_CONTROL}
                  blocked={blockedVideoIdSet.has(v.id)}
                  onChange={(patch) => patchVideoRankingControl(v.id, patch)}
                  onBlockedChange={(blocked) => setVideoBlocked(v.id, blocked)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </PanelCard>
      </Stack>

      <div className="stats-homepage-management__preview-column">
        <StatsHomepagePreview
          decoration={decoration}
          videos={videos}
          videosLoading={videosLoading}
          videoRankingError={videoRankingError}
          videoRankingConfig={videoRankingConfig}
          blockedVideoIds={blockedVideoIds}
          slides={slides}
          templateWeights={templateWeights}
        />
      </div>
    </div>
  )
}
