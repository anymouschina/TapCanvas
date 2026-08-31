import React from 'react'
import {
  Modal, Text, Center, Loader, SimpleGrid, Box,
} from '@mantine/core'
import {
  IconClockHour4,
  IconChevronRight,
  IconFolder,
  IconPhoto,
  IconUpload,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import {
  createServerAsset,
  updateServerAssetData,
  uploadServerAssetFile,
  listServerAssets,
  publishProjectToChannel,
} from '../api/server'
import { toast } from './toast'
import { ManagedImage } from '../domain/resource-runtime'
import {
  buildGenerationHistoryItems,
  type GenerationHistoryItem,
} from './generationHistory'
import './PublishModal.css'

function readUploadedAssetUrl(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const url = (data as Record<string, unknown>).url
  return typeof url === 'string' ? url.trim() : ''
}

// ── Pure payload builder (also exported for tests) ───────────────────────────
export function buildPublishRecordPayload(opts: {
  title: string
  description: string
  coverImageUrl: string | null
  videoUrl: string | null
  ownerType: PublishAssociationType | null
  ownerId: string | null
  sourceProjectId?: string | null
  sourceProjectName?: string | null
  sourceChapterTitle?: string | null
}): {
  kind: 'publishRecord'
  title: string
  description: string
  coverImageUrl: string
  videoUrl: string
  publishedAt: string
  ownerType: PublishAssociationType | null
  ownerId: string | null
  sourceProjectId: string
  sourceProjectName: string
  sourceChapterId: string
  sourceChapterTitle: string
} {
  const normalizedOwnerId = opts.ownerId?.trim() || null
  const isChapter = opts.ownerType === 'chapter'
  return {
    kind: 'publishRecord',
    title: opts.title.trim(),
    description: opts.description.trim(),
    coverImageUrl: opts.coverImageUrl ?? '',
    videoUrl: opts.videoUrl ?? '',
    publishedAt: new Date().toISOString(),
    ownerType: opts.ownerType,
    ownerId: normalizedOwnerId,
    // 快照来源（仅记录，不建立外键级联——发布后与原项目脱钩）
    sourceProjectId: opts.sourceProjectId ?? '',
    sourceProjectName: opts.sourceProjectName ?? '',
    sourceChapterId: isChapter ? normalizedOwnerId ?? '' : '',
    sourceChapterTitle: isChapter ? opts.sourceChapterTitle?.trim() ?? '' : '',
  }
}

// ── Asset history picker (project-scoped generation assets) ──────────────────
function AssetHistoryPickerModal({
  opened,
  onClose,
  onSelect,
  projectId,
  type,
}: {
  opened: boolean
  onClose: () => void
  onSelect: (url: string) => void
  projectId: string | null
  type: 'video' | 'image'
}): JSX.Element {
  const [items, setItems] = React.useState<GenerationHistoryItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!opened || !projectId) return
    setLoading(true)
    setError('')
    listServerAssets({ projectId, kind: 'generation', limit: 20 })
      .then(({ items: all }) => {
        setItems(buildGenerationHistoryItems(all).filter((item) => item.kind === type))
      })
      .catch((loadError: unknown) => {
        setItems([])
        setError(loadError instanceof Error && loadError.message.trim() ? loadError.message : '项目素材加载失败')
      })
      .finally(() => setLoading(false))
  }, [opened, projectId, type])

  const title = type === 'video' ? '选择视频' : '选择封面图'

  return (
    <Modal className="publish-history-modal" opened={opened} onClose={onClose} title={title} size="lg" centered>
      {loading ? (
        <Center className="publish-history-modal__loading" h={200}><Loader className="publish-history-modal__loader" size="sm" /></Center>
      ) : error ? (
        <Center className="publish-history-modal__error" h={200}><Text className="publish-history-modal__error-text" c="red" size="sm">{error}</Text></Center>
      ) : items.length === 0 ? (
        <Center className="publish-history-modal__empty" h={200}><Text className="publish-history-modal__empty-text" c="dimmed" size="sm">暂无可选{type === 'video' ? '视频' : '图片'}</Text></Center>
      ) : (
        <SimpleGrid className="publish-history-modal__grid" cols={3} spacing="sm">
          {items.map((it) => {
            const url = it.url
            const thumb = it.thumbnailUrl
            return (
              <Box
                className="publish-history-modal__item"
                key={it.id}
                style={{
                  cursor: 'pointer',
                  borderRadius: 8,
                  overflow: 'hidden',
                  aspectRatio: '16/9',
                  background: 'var(--mantine-color-dark-6)',
                  position: 'relative',
                }}
                onClick={() => { onSelect(url); onClose() }}
              >
                {thumb ? (
                  <ManagedImage
                    className="publish-asset-thumb"
                    src={thumb}
                    alt={it.title}
                    priority="visible"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <Center className="publish-history-modal__placeholder" style={{ height: '100%' }}>
                    {type === 'video' ? <IconVideo className="publish-history-modal__placeholder-icon" size={24} /> : <IconPhoto className="publish-history-modal__placeholder-icon" size={24} />}
                  </Center>
                )}
              </Box>
            )
          })}
        </SimpleGrid>
      )}
    </Modal>
  )
}

// ── Media picker zone ─────────────────────────────────────────────────────────
function MediaPickerZone({
  label,
  hint,
  accept,
  value,
  type,
  onSelect,
  onClear,
  projectId,
}: {
  label: string
  hint?: string
  accept: string
  value: string | null
  type: 'video' | 'image'
  onSelect: (url: string) => void
  onClear: () => void
  projectId: string | null
}): JSX.Element {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const inputId = React.useId()
  const [uploading, setUploading] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const asset = await uploadServerAssetFile(file, file.name, projectId ? { projectId } : undefined)
      const uploadedUrl = readUploadedAssetUrl(asset.data)
      if (!uploadedUrl) throw new Error('上传接口未返回有效资产 URL')
      onSelect(uploadedUrl)
    } catch (err: unknown) {
      toast(err instanceof Error && err.message.trim() ? err.message : '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }, [onSelect, projectId])

  return (
    <section className="tc-publish-upload-item">
      <div className="tc-publish-upload-item__title">
        <span className="tc-publish-upload-item__label">{label}</span>
        {hint ? <span className="tc-publish-upload-item__hint">{hint}</span> : null}
      </div>
      <input className="tc-publish-upload-item__input" id={inputId} ref={fileInputRef} type="file" accept={accept} onChange={(e) => void handleFileChange(e)} />
      <AssetHistoryPickerModal
        opened={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={onSelect}
        projectId={projectId}
        type={type}
      />
      {value ? (
        <div className="tc-publish-upload-box has-file">
          {type === 'video' ? (
            <video className="tc-publish-upload-box__preview" src={value} crossOrigin="anonymous" muted playsInline preload="metadata" />
          ) : (
            <ManagedImage className="tc-publish-upload-box__preview" src={value} alt={label} priority="visible" />
          )}
        </div>
      ) : (
        <label className={`tc-publish-upload-box${uploading ? ' is-uploading' : ''}`} htmlFor={inputId}>
          <span className="tc-publish-upload-box__placeholder">
            <span className="tc-publish-upload-box__icon">
              {uploading ? <Loader className="tc-publish-upload-box__loader" size={18} /> : <IconUpload className="tc-publish-upload-box__upload-icon" size={19} />}
            </span>
            <span className="tc-publish-upload-box__text">{uploading ? '上传中...' : `点击上传${type === 'video' ? '视频' : '封面'}`}</span>
          </span>
        </label>
      )}
      <div className="tc-publish-upload-item__actions">
        {value ? (
          <>
            <label className="tc-publish-upload-item__action" htmlFor={inputId}>重新选择</label>
            <button className="tc-publish-upload-item__action" type="button" onClick={onClear}>清除</button>
          </>
        ) : null}
        {projectId ? (
          <button className="tc-publish-upload-item__action" type="button" onClick={() => setHistoryOpen(true)}>
            <IconClockHour4 className="tc-publish-upload-item__action-icon" size={13} />
            项目素材
          </button>
        ) : null}
      </div>
    </section>
  )
}

// ── PublishModal ──────────────────────────────────────────────────────────────
export type PublishAssociationType = 'project' | 'chapter' | 'shortFilm'

export interface PublishModalProps {
  opened: boolean
  onClose: () => void
  projectId: string | null
  projectName: string
  sourceName?: string | null
  sourceCoverUrl?: string | null
  ownerType: PublishAssociationType | null
  ownerId?: string | null
  sourceChapterTitle?: string | null
  initialVideoUrl?: string | null
  initialCoverUrl?: string | null
  sourceLabel?: string | null
  onChooseSource?: (() => void) | null
}

export function getPublishValidationError(input: {
  title: string
  videoUrl: string | null
  coverUrl: string | null
  requireSource?: boolean
  ownerId?: string | null
}): string | null {
  if (input.requireSource && !input.ownerId?.trim()) return '请选择要关联的项目、章节或短片'
  if (!input.title.trim()) return '请填写作品名称'
  if (!input.videoUrl) return '请上传视频后再发布'
  if (!input.coverUrl) return '请上传封面后再发布'
  return null
}

function readPublishRecordScope(data: unknown): { sourceProjectId: string; ownerId: string } {
  if (!data || typeof data !== 'object') return { sourceProjectId: '', ownerId: '' }
  const record = data as Record<string, unknown>
  return {
    sourceProjectId: typeof record.sourceProjectId === 'string' ? record.sourceProjectId : '',
    ownerId: typeof record.ownerId === 'string' ? record.ownerId : '',
  }
}

export function PublishModal({
  opened,
  onClose,
  projectId,
  projectName,
  sourceName = null,
  sourceCoverUrl = null,
  ownerType,
  ownerId,
  sourceChapterTitle = null,
  initialVideoUrl = null,
  initialCoverUrl = null,
  sourceLabel = null,
  onChooseSource = null,
}: PublishModalProps): JSX.Element {
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [coverUrl, setCoverUrl] = React.useState<string | null>(null)
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [publishing, setPublishing] = React.useState(false)
  const wasOpenedRef = React.useRef(false)
  const previousSourceKeyRef = React.useRef('')

  // 公开创作过程 = 同步把源项目发布进社区（获得点赞/评论/详情页）
  const canPublicizeCanvas = Boolean(projectId)
  const [publicizeCanvas, setPublicizeCanvas] = React.useState(false)
  const sourceKey = `${ownerType ?? 'none'}:${ownerId || projectId || ''}`

  React.useEffect(() => {
    if (opened && !wasOpenedRef.current) {
      setVideoUrl(initialVideoUrl)
      setCoverUrl(initialCoverUrl)
      setTitle('')
      setDescription('')
      setPublicizeCanvas(false)
      previousSourceKeyRef.current = sourceKey
    }
    wasOpenedRef.current = opened
  }, [initialCoverUrl, initialVideoUrl, opened, sourceKey])

  React.useEffect(() => {
    if (!opened || previousSourceKeyRef.current === sourceKey) return
    previousSourceKeyRef.current = sourceKey
    if (initialVideoUrl) setVideoUrl(initialVideoUrl)
    if (initialCoverUrl) setCoverUrl(initialCoverUrl)
  }, [initialCoverUrl, initialVideoUrl, opened, sourceKey])

  React.useEffect(() => {
    if (!canPublicizeCanvas) setPublicizeCanvas(false)
  }, [canPublicizeCanvas])

  const togglePublicProcess = React.useCallback(() => {
    setPublicizeCanvas((value) => !value)
  }, [])

  const handlePublish = React.useCallback(async () => {
    const validationError = getPublishValidationError({
      title,
      videoUrl,
      coverUrl,
      requireSource: Boolean(onChooseSource),
      ownerId,
    })
    if (validationError) {
      toast(validationError, 'error')
      return
    }
    setPublishing(true)
    try {
      // 发布 = 公开快照：媒体已是 TOS 固定 URL，记录不挂 projectId、
      // 原项目后续更新/转私密/删除都不影响已公开作品。
      const data = buildPublishRecordPayload({
        title,
        description,
        coverImageUrl: coverUrl,
        videoUrl,
        ownerType,
        ownerId: ownerId ?? null,
        sourceProjectId: projectId,
        sourceProjectName: projectName,
        sourceChapterTitle,
      })
      // 同一项目/章节只保留一条发布记录，重复发布改为更新快照
      // （全局按 kind 查自己的发布记录，兼容历史上挂 projectId 的旧行）
      const existing = projectId
        ? (await listServerAssets({ kind: 'publishRecord', limit: 96 })).items.find((it) => {
            const scope = readPublishRecordScope(it.data)
            const scopeId = ownerId ?? ''
            const fromThisProject = scope.sourceProjectId === projectId || it.projectId === projectId
            return fromThisProject && scope.ownerId === scopeId
          })
        : null
      if (existing) {
        await updateServerAssetData(existing.id, data)
      } else {
        await createServerAsset({
          name: title.trim(),
          data,
        })
      }
      // 双写第二步：源项目转公开进社区。失败不回滚快照，仅提示部分成功。
      let fullyPublished = true
      if (canPublicizeCanvas && publicizeCanvas && projectId) {
        try {
          await publishProjectToChannel(projectId, {
            isPublic: true,
            description: description.trim() || undefined,
          })
        } catch (err: unknown) {
          console.error('community publish failed', err)
          fullyPublished = false
          toast('作品快照已发布，但画布公开失败，可稍后重新发布重试', 'error')
        }
      }
      if (fullyPublished) toast('发布成功，可在 TcTv 查看', 'success')
      onClose()
    } catch (err: unknown) {
      toast(err instanceof Error && err.message.trim() ? err.message : '发布失败', 'error')
    } finally {
      setPublishing(false)
    }
  }, [title, description, coverUrl, videoUrl, projectId, projectName, ownerType, ownerId, sourceChapterTitle, onChooseSource, onClose, canPublicizeCanvas, publicizeCanvas])

  return (
    <Modal
      className="tc-tv-publish-modal"
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding={0}
      size="min(980px, 92vw)"
      centered
      overlayProps={{ backgroundOpacity: 0.7, blur: 6 }}
      transitionProps={{ transition: 'pop', duration: 200 }}
    >
      <div className="tc-publish-dialog">
        <header className="tc-publish-dialog__hero">
          <div className="tc-publish-dialog__hero-copy">
            <h2 className="tc-publish-dialog__title">发布作品到 TcTv</h2>
            <p className="tc-publish-dialog__subtitle">将您的作品发布到 TcTv，优质内容更容易获得曝光。</p>
          </div>
          <button className="tc-publish-dialog__close" type="button" aria-label="关闭发布窗口" onClick={onClose}>
            <IconX className="tc-publish-dialog__close-icon" size={18} />
          </button>
        </header>

        <div className="tc-publish-dialog__content">
          <div className="tc-publish-dialog__upload-column">
            <MediaPickerZone
              label="上传作品*"
              accept="video/*"
              value={videoUrl}
              type="video"
              onSelect={setVideoUrl}
              onClear={() => setVideoUrl(null)}
              projectId={projectId}
            />
            <MediaPickerZone
              label="上传封面*"
              hint="推荐 16:9"
              accept="image/*"
              value={coverUrl}
              type="image"
              onSelect={setCoverUrl}
              onClear={() => setCoverUrl(null)}
              projectId={projectId}
            />
          </div>

          <div className="tc-publish-dialog__form-column">
            {onChooseSource ? (
              projectId || ownerId ? (
                <section className="tc-publish-source-group">
                  <span className="tc-publish-source-group__label">关联来源</span>
                  <div className="tc-publish-source tc-publish-source--selected">
                    <div className="tc-publish-source__thumbnail" aria-hidden="true">
                      {sourceCoverUrl ? (
                        <ManagedImage
                          className="tc-publish-source__thumbnail-image"
                          src={sourceCoverUrl}
                          alt=""
                          priority="visible"
                        />
                      ) : (
                        <IconFolder className="tc-publish-source__folder" size={22} stroke={1.5} />
                      )}
                    </div>
                    <div className="tc-publish-source__copy">
                      <strong className="tc-publish-source__name">{sourceName || projectName || '未命名来源'}</strong>
                      <span className="tc-publish-source__kind">{sourceLabel || '画布项目'}</span>
                    </div>
                    <button className="tc-publish-source__change" type="button" onClick={onChooseSource}>更换</button>
                  </div>
                </section>
              ) : (
                <section className="tc-publish-source-group">
                  <span className="tc-publish-source-group__label">关联来源</span>
                  <button className="tc-publish-source tc-publish-source--empty" type="button" onClick={onChooseSource}>
                    <span className="tc-publish-source__empty-copy">选择项目、章节或短片</span>
                    <IconChevronRight className="tc-publish-source__chevron" size={18} />
                  </button>
                </section>
              )
            ) : null}

            <label className="tc-publish-form-item">
              <span className="tc-publish-form-item__label">作品名称*</span>
              <input
                className="tc-publish-form-item__input"
                value={title}
                maxLength={80}
                placeholder="请输入作品名称"
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
              <span className="tc-publish-form-item__count">{title.length}/80</span>
            </label>

            <label className="tc-publish-form-item">
              <span className="tc-publish-form-item__label">作品描述</span>
              <textarea
                className="tc-publish-form-item__textarea"
                value={description}
                maxLength={500}
                placeholder="请输入作品描述"
                onChange={(event) => setDescription(event.currentTarget.value)}
              />
              <span className="tc-publish-form-item__count">{description.length}/500</span>
            </label>

            <section className="tc-publish-process">
              <span className="tc-publish-process__label">公开创作过程</span>
              <div className="tc-publish-process__heading">
                <button
                  className={`tc-publish-process__switch${publicizeCanvas ? ' is-on' : ''}`}
                  type="button"
                  role="switch"
                  aria-checked={publicizeCanvas}
                  aria-label="公开创作过程"
                  disabled={!canPublicizeCanvas}
                  onClick={togglePublicProcess}
                >
                  <span className="tc-publish-process__switch-dot" />
                </button>
                <span className="tc-publish-process__status">{publicizeCanvas ? '已开启' : '未开启'}</span>
              </div>
            </section>
            {publicizeCanvas ? (
              <div className="tc-publish-process__mode">
                <span className="tc-publish-process__mode-label">公开方式</span>
                <span className="tc-publish-process__mode-value">完全公开</span>
              </div>
            ) : (
              <p className="tc-publish-dialog__snapshot-note">
                {canPublicizeCanvas
                  ? '开启创作过程后，观众可查看并学习您的真实画布。'
                  : '选择画布或关联画布的短片后，可公开真实创作过程。'}
              </p>
            )}
          </div>
        </div>

        <footer className="tc-publish-dialog__footer">
          <button className="tc-publish-dialog__cancel" type="button" disabled={publishing} onClick={onClose}>取消</button>
          <button
            className="tc-publish-dialog__submit"
            type="button"
            disabled={!title.trim() || !videoUrl || !coverUrl || publishing}
            onClick={() => void handlePublish()}
          >
            {publishing ? '发布中...' : '发布并投稿'}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
