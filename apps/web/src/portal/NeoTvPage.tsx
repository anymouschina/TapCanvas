import React from 'react'
import { Loader } from '@mantine/core'
import {
  IconArrowUp,
  IconBuildingStore,
  IconMicrophone,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSend,
  IconX,
} from '@tabler/icons-react'
import { setCommunityFavorite, type AgentSkillDto, type HomepageSkillCard, type PublicAssetDto } from '../api/server'
import { LoginModal } from '../auth/LoginModal'
import { useAuth } from '../auth/store'
import DirectorPetLauncher from '../ui/DirectorPetLauncher'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { SkillPickerPopover } from '../ui/chat/SkillPickerPopover'
import { useVoiceInput } from '../ui/chat/useVoiceInput'
import { SkillLibraryDialog } from '../ui/skills/SkillLibraryDialog'
import { SkillLogo } from '../ui/skills/SkillLogo'
import { useSkillLibraryData } from '../ui/skills/useSkillLibraryData'
import { toast } from '../ui/toast'
import { buildStudioUrl } from '../utils/appRoutes'
import { writeHomePendingPrompt } from '../utils/homePendingPrompt'
import { spaNavigate } from '../utils/spaNavigate'
import { useRouteNavigationLease } from '../utils/useRouteNavigationLease'
import { NeoTvCarousel } from './NeoTvCarousel'
import { NeoTvProjectShelf, type ProjectScope } from './NeoTvProjectShelf'
import { NeoTvWorkCard } from './NeoTvWorkCard'
import { NeoTvViewer } from './NeoTvViewer'
import { buildNeoTvSkillRows, hasSkillImage } from './neoTvSkillOptions'
import { PortalHeader } from './PortalHeader'
import { PortalFooter } from './PortalFooter'
import { VideoPublishFlow } from './VideoPublishFlow'
import { useNeoTvData } from './useNeoTvData'
import { useProjectDirectory } from './useProjectDirectory'
import { useProjectManagementActions } from './useProjectManagementActions'
import { ProjectRenameModal } from './ProjectRenameModal'
import { useHomepagePreviewSnapshot } from './homepagePreviewSnapshot'
import './portal.css'
import './NeoTvPage.css'

type VideoScope = 'all' | 'canvas' | 'film'
type ConfiguredSkillCardWithImage = HomepageSkillCard & { imageUrl: string }
type NeoTvSkillRenderRow = {
  skills: AgentSkillDto[]
  skeletonKeys: readonly string[]
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback
}

function readViewerAssetId(): string | null {
  const value = new URLSearchParams(window.location.search).get('watch')?.trim() || ''
  return value || null
}

function readHistoryState(): Record<string, unknown> {
  const value: unknown = window.history.state
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function greetingForHour(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 11) return '上午好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const SKILL_SKELETON_KEYS = ['skill-a', 'skill-b', 'skill-c', 'skill-d', 'skill-e', 'skill-f', 'skill-g'] as const
const WORK_SKELETON_KEYS = ['work-a', 'work-b', 'work-c', 'work-d', 'work-e', 'work-f', 'work-g', 'work-h'] as const

export default function NeoTvPage(): JSX.Element {
  const auth = useAuth()
  const acquireRouteNavigationLease = useRouteNavigationLease()
  const previewSnapshot = useHomepagePreviewSnapshot()
  const promptInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null)
  const feedRef = React.useRef<HTMLElement | null>(null)
  const skillLibrary = useSkillLibraryData()
  const [prompt, setPrompt] = React.useState('')
  const [promptBusy, setPromptBusy] = React.useState(false)
  const [selectedSkills, setSelectedSkills] = React.useState<AgentSkillDto[]>([])
  const [skillLibraryOpen, setSkillLibraryOpen] = React.useState(false)
  const [projectScope, setProjectScope] = React.useState<ProjectScope>('all')
  const [projectQuery, setProjectQuery] = React.useState('')
  const [slideIndex, setSlideIndex] = React.useState(0)
  const [videoScope, setVideoScope] = React.useState<VideoScope>('all')
  const [videoQuery, setVideoQuery] = React.useState('')
  const [visibleVideoCount, setVisibleVideoCount] = React.useState(20)
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(readViewerAssetId)
  const [favoriteBusyIds, setFavoriteBusyIds] = React.useState<Set<string>>(() => new Set())
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [publishOpen, setPublishOpen] = React.useState(false)
  const [showBackToTop, setShowBackToTop] = React.useState(false)
  const {
    projects,
    projectCovers,
    projectsLoading,
    projectsError,
    slides,
    slidesLoading,
    slidesError,
    decoration,
    decorationLoading,
    decorationError,
    videos,
    videosLoading,
    videosError,
    updateVideoFavorite,
    shortFilms,
    shortFilmsLoading,
    shortFilmsError,
    createProject: createStoredProject,
    registerProject,
    unregisterProject,
    reloadProjects,
  } = useNeoTvData(auth.token)
  const projectDirectory = useProjectDirectory(auth.token, projects)
  const projectActions = useProjectManagementActions({
    directory: projectDirectory,
    registerProject,
    unregisterProject,
    reloadProjects,
  })
  const effectiveSlides = previewSnapshot?.slides ?? slides
  const effectiveSlidesLoading = previewSnapshot ? false : slidesLoading
  const effectiveSlidesError = previewSnapshot ? '' : slidesError
  const effectiveDecoration = previewSnapshot?.decoration ?? decoration
  const effectiveDecorationLoading = previewSnapshot ? false : decorationLoading
  const effectiveDecorationError = previewSnapshot ? '' : decorationError
  const configuredSkillCards = React.useMemo<ConfiguredSkillCardWithImage[]>(
    () => effectiveDecoration.skillCards.filter(
      (card): card is ConfiguredSkillCardWithImage => hasSkillImage(card.imageUrl),
    ),
    [effectiveDecoration.skillCards],
  )
  const officialSkillRowBudget: 1 | 2 = configuredSkillCards.length > 0 ? 1 : 2
  const officialSkillRows = React.useMemo(
    () => buildNeoTvSkillRows(skillLibrary.officialSkills, officialSkillRowBudget),
    [officialSkillRowBudget, skillLibrary.officialSkills],
  )
  const skillRenderRows: NeoTvSkillRenderRow[] = skillLibrary.loading
    ? Array.from({ length: officialSkillRowBudget }, (_, rowIndex) => ({
      skills: [],
      skeletonKeys: SKILL_SKELETON_KEYS.slice(
        rowIndex * 4,
        rowIndex * 4 + (rowIndex === officialSkillRowBudget - 1 ? 3 : 4),
      ),
    }))
    : officialSkillRows.map((skills) => ({ skills, skeletonKeys: [] }))

  const voiceInput = useVoiceInput({
    getBaseText: () => prompt,
    onText: setPrompt,
    onError: (message) => toast(message, 'error'),
    disabled: promptBusy || !auth.token,
  })

  React.useEffect(() => {
    if (!auth.token) {
      setSelectedSkills([])
      return
    }
    void skillLibrary.load()
  }, [auth.token, skillLibrary.load])

  React.useEffect(() => {
    setSelectedSkills((current) => current
      .map((selected) => skillLibrary.officialSkills.find((skill) => skill.id === selected.id))
      .filter((skill): skill is AgentSkillDto => Boolean(skill)))
  }, [skillLibrary.officialSkills])

  const visibleVideos = React.useMemo(() => {
    const query = videoQuery.trim().toLocaleLowerCase('zh-CN')
    return videos.filter((asset) => {
      const hasCanvas = Boolean(asset.canvasPublic || asset.projectId || asset.sourceProjectId)
      const matchesScope = videoScope === 'all'
        || (videoScope === 'canvas' && hasCanvas)
        || (videoScope === 'film' && !hasCanvas)
      const searchText = `${asset.name} ${asset.ownerName || ''} ${asset.ownerLogin || ''}`.toLocaleLowerCase('zh-CN')
      return matchesScope && (!query || searchText.includes(query))
    })
  }, [videoQuery, videoScope, videos])

  React.useEffect(() => setVisibleVideoCount(20), [videoQuery, videoScope])

  React.useEffect(() => {
    const syncViewerFromLocation = (): void => setPreviewAssetId(readViewerAssetId())
    window.addEventListener('popstate', syncViewerFromLocation)
    return () => window.removeEventListener('popstate', syncViewerFromLocation)
  }, [])

  React.useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    let animationFrame = 0
    const updateVisibility = (): void => {
      animationFrame = 0
      const scrollTop = scrollArea.getBoundingClientRect().top
      const feedTop = feedRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
      const shouldShow = feedTop <= scrollTop
      setShowBackToTop((current) => current === shouldShow ? current : shouldShow)
    }
    const onScroll = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateVisibility)
    }
    updateVisibility()
    scrollArea.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scrollArea.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
    }
  }, [])

  const requireLogin = React.useCallback((action: () => void) => {
    if (!auth.token) {
      setLoginOpen(true)
      return
    }
    action()
  }, [auth.token])

  const openViewer = React.useCallback((asset: PublicAssetDto): void => {
    const url = new URL(window.location.href)
    url.searchParams.set('watch', asset.id)
    window.history.pushState({ ...readHistoryState(), tcTvViewer: true }, '', url)
    setPreviewAssetId(asset.id)
  }, [])

  const closeViewer = React.useCallback((): void => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('watch')) {
      setPreviewAssetId(null)
      return
    }
    if (readHistoryState().tcTvViewer === true) {
      window.history.back()
      return
    }
    url.searchParams.delete('watch')
    window.history.replaceState(readHistoryState(), '', url)
    setPreviewAssetId(null)
  }, [])

  const toggleFavorite = React.useCallback((asset: PublicAssetDto): void => {
    const projectId = asset.sourceProjectId?.trim() || asset.projectId?.trim() || ''
    if (!projectId || favoriteBusyIds.has(asset.id)) return
    requireLogin(() => {
      const nextFavorited = !asset.favorited
      setFavoriteBusyIds((current) => new Set(current).add(asset.id))
      updateVideoFavorite(asset.id, nextFavorited)
      void setCommunityFavorite(projectId, nextFavorited)
        .catch((error: unknown) => {
          updateVideoFavorite(asset.id, !nextFavorited)
          toast(resolveErrorMessage(error, '收藏操作失败'), 'error')
        })
        .finally(() => {
          setFavoriteBusyIds((current) => {
            const next = new Set(current)
            next.delete(asset.id)
            return next
          })
        })
    })
  }, [favoriteBusyIds, requireLogin, updateVideoFavorite])

  const createProject = React.useCallback(async () => {
    if (promptBusy) return
    const navigationLease = acquireRouteNavigationLease()
    setPromptBusy(true)
    try {
      const project = await createStoredProject('未命名项目')
      if (!navigationLease.isCurrent()) return
      spaNavigate(buildStudioUrl({
        projectId: project.id,
        ownerType: 'project',
        ownerId: project.id,
      }))
    } catch (error: unknown) {
      toast(resolveErrorMessage(error, '创建项目失败'), 'error')
    } finally {
      setPromptBusy(false)
    }
  }, [acquireRouteNavigationLease, createStoredProject, promptBusy])

  const submitPrompt = React.useCallback(async () => {
    const content = prompt.trim()
    if (!content || promptBusy) return
    requireLogin(() => {
      const navigationLease = acquireRouteNavigationLease()
      void (async () => {
        setPromptBusy(true)
        try {
          const project = await createStoredProject(content.slice(0, 36))
          const requiredSkills = selectedSkills
            .map((skill) => String(skill.key || skill.name || '').trim())
            .filter(Boolean)
          writeHomePendingPrompt(project.id, content, requiredSkills)
          if (!navigationLease.isCurrent()) return
          spaNavigate(buildStudioUrl({
            projectId: project.id,
            ownerType: 'project',
            ownerId: project.id,
          }))
        } catch (error: unknown) {
          toast(resolveErrorMessage(error, '创意提交失败'), 'error')
        } finally {
          setPromptBusy(false)
        }
      })()
    })
  }, [acquireRouteNavigationLease, createStoredProject, prompt, promptBusy, requireLogin, selectedSkills])

  const toggleSkill = React.useCallback((skill: AgentSkillDto) => {
    setSelectedSkills((current) => {
      if (current.some((item) => item.id === skill.id)) {
        return current.filter((item) => item.id !== skill.id)
      }
      if (current.length >= 5) {
        toast('最多选择 5 个技能', 'error')
        return current
      }
      return [...current, skill]
    })
  }, [])

  const toggleSkillById = React.useCallback((skillId: string): void => {
    const skill = skillLibrary.officialSkills.find((item) => item.id === skillId)
    if (!skill) {
      toast('该技能当前不可用', 'error')
      return
    }
    toggleSkill(skill)
  }, [skillLibrary.officialSkills, toggleSkill])

  const userName = auth.user?.name || auth.user?.login || auth.user?.phone || '创作者'
  const greeting = greetingForHour(new Date().getHours())

  return (
    <div className="neo-tv-page">
      <PortalHeader active="neo-tv" />
      <div ref={scrollAreaRef} className="tc-portal-scroll-area">
        <main className="neo-tv-main">
        <section className="neo-tv-launcher" aria-labelledby="neo-tv-greeting">
          <div className="neo-tv-launcher__heading">
            <h1 className="neo-tv-launcher__title" id="neo-tv-greeting">{greeting}，{userName}~</h1>
            {!effectiveDecorationLoading && effectiveDecoration.greetingSubtitle ? (
              <p className="neo-tv-launcher__subtitle">{effectiveDecoration.greetingSubtitle}</p>
            ) : null}
          </div>
          <div className={`neo-tv-launcher__box${voiceInput.isListening ? ' is-listening' : ''}`}>
            <div
              className="neo-tv-launcher__selected-skills"
              aria-hidden={selectedSkills.length === 0}
              aria-label={selectedSkills.length > 0 ? '已选择技能' : undefined}
            >
              {selectedSkills.map((skill) => (
                <span className="neo-tv-launcher__selected-skill" key={skill.id}>
                  <SkillLogo className="neo-tv-launcher__selected-skill-icon" skill={skill} priority="visible" />
                  <span className="neo-tv-launcher__selected-skill-name">{skill.name || skill.key}</span>
                  <button className="neo-tv-launcher__selected-skill-remove" type="button" aria-label={`移除 ${skill.name || skill.key}`} onClick={() => toggleSkill(skill)}>
                    <IconX className="neo-tv-launcher__selected-skill-remove-icon" size={11} />
                  </button>
                </span>
              ))}
            </div>
            <textarea
              ref={promptInputRef}
              className="neo-tv-launcher__input"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitPrompt()
                }
              }}
              placeholder={effectiveDecoration.heroPlaceholder || '说说你的创意，小T 帮你在画布上实现 …'}
              rows={3}
            />
            <div className="neo-tv-launcher__toolbar">
              <div className="neo-tv-launcher__skill-selector">
                <SkillPickerPopover
                  selectionMode="multiple"
                  selectedSkillIds={selectedSkills.map((skill) => skill.id)}
                  disabled={promptBusy}
                  error={skillLibrary.error}
                  listMaxHeight={176}
                  loading={skillLibrary.loading}
                  skills={skillLibrary.officialSkills}
                  onManage={() => requireLogin(() => setSkillLibraryOpen(true))}
                  onRefresh={skillLibrary.load}
                  onSelect={toggleSkillById}
                  position="bottom-start"
                  triggerClassName="neo-tv-launcher__tool"
                  triggerIconClassName="neo-tv-launcher__tool-icon"
                />
              </div>
              <span className="neo-tv-launcher__spacer" />
              <button
                className={`neo-tv-launcher__voice${voiceInput.isListening ? ' is-active' : ''}`}
                type="button"
                aria-label={voiceInput.isListening ? '停止语音输入' : '语音输入'}
                onClick={() => requireLogin(voiceInput.toggle)}
              >
                <IconMicrophone className="neo-tv-launcher__voice-icon" size={18} />
              </button>
              <button
                className={`neo-tv-launcher__send${prompt.trim() ? ' is-active' : ''}`}
                type="button"
                aria-label="发送"
                disabled={!prompt.trim() || promptBusy}
                onClick={() => void submitPrompt()}
              >
                {promptBusy
                  ? <Loader className="neo-tv-launcher__loader" size={15} />
                  : <IconSend className="neo-tv-launcher__send-icon" size={16} />}
              </button>
            </div>
          </div>
          {!effectiveDecorationLoading && configuredSkillCards.length > 0 ? (
            <div className="neo-tv-configured-skills" aria-label="首页快捷入口">
              {configuredSkillCards.map((card, index) => {
                const content = (
                  <>
                    <ManagedImage
                      className="neo-tv-configured-skill__image"
                      src={card.imageUrl}
                      alt=""
                      priority="visible"
                    />
                    <span className="neo-tv-configured-skill__copy">
                      <strong className="neo-tv-configured-skill__title">{card.title}</strong>
                      {card.subtitle ? <span className="neo-tv-configured-skill__subtitle">{card.subtitle}</span> : null}
                    </span>
                  </>
                )
                return card.link ? (
                  <a className="neo-tv-configured-skill" href={card.link} key={`${card.title}-${index}`}>{content}</a>
                ) : (
                  <div className="neo-tv-configured-skill" key={`${card.title}-${index}`}>{content}</div>
                )
              })}
            </div>
          ) : null}
          {effectiveDecorationError ? <div className="neo-tv-inline-state neo-tv-inline-state--error" role="alert">{effectiveDecorationError}</div> : null}
          <div className="neo-tv-skills" aria-label="创作技能">
            {skillLibrary.error ? <span className="neo-tv-skills__state neo-tv-skills__state--error">{skillLibrary.error}</span> : null}
            {skillRenderRows.map((row, rowIndex, rows) => (
              <div className="neo-tv-skills__row" key={`skill-row-${rowIndex}`}>
                {skillLibrary.loading ? row.skeletonKeys.map((key) => (
                  <span className="neo-tv-skill neo-tv-skill--skeleton tc-portal-skeleton" aria-hidden="true" key={key} />
                )) : !skillLibrary.error ? row.skills.map((skill) => {
                  const selected = selectedSkills.some((item) => item.id === skill.id)
                  return (
                    <button
                      className={`neo-tv-skill${selected ? ' is-selected' : ''}`}
                      type="button"
                      key={skill.id}
                      aria-pressed={selected}
                      onClick={() => toggleSkill(skill)}
                    >
                      <SkillLogo className="neo-tv-skill__icon" skill={skill} priority="prefetch" />
                      <span className="neo-tv-skill__label">{skill.name || skill.key}</span>
                    </button>
                  )
                }) : null}
                {rowIndex === rows.length - 1 ? (
                  <button
                    className="neo-tv-skill neo-tv-skill--marketplace"
                    type="button"
                    onClick={() => requireLogin(() => setSkillLibraryOpen(true))}
                  >
                    <span className="neo-tv-skill__store-logo" aria-hidden="true">
                      <IconBuildingStore className="neo-tv-skill__store-icon" size={17} />
                    </span>
                    <span className="neo-tv-skill__label">技能商城</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <NeoTvProjectShelf
          projects={projects}
          projectCovers={projectCovers}
          loading={projectsLoading}
          error={projectsError}
          signedIn={Boolean(auth.token)}
          scope={projectScope}
          query={projectQuery}
          busy={promptBusy}
          managingProjectId={projectActions.managingProjectId}
          sharingProjectId={projectActions.sharingProjectId}
          shareAvailable={projectActions.shareAvailable}
          onScopeChange={setProjectScope}
          onQueryChange={setProjectQuery}
          onCreate={() => void createProject()}
          onLogin={() => setLoginOpen(true)}
          onRenameProject={projectActions.renameProject}
          onDeleteProject={projectActions.deleteProject}
          onToggleShare={projectActions.toggleShare}
        />
        {projectActions.pendingCleanup ? (
          <div className="neo-tv-project-cleanup" role="alert">
            <span className="neo-tv-project-cleanup__message">
              画布“{projectActions.pendingCleanup.projectName}”已删除，但分组目录记录尚未清理：{projectActions.pendingCleanup.message}
            </span>
            <button
              className="neo-tv-project-cleanup__retry"
              type="button"
              disabled={projectDirectory.saving}
              onClick={() => void projectActions.retryPendingCleanup()}
            >
              重试清理
            </button>
          </div>
        ) : null}

        <NeoTvCarousel slides={effectiveSlides} loading={effectiveSlidesLoading} activeIndex={slideIndex} onActiveIndexChange={setSlideIndex} />
        {effectiveSlidesError ? <div className="neo-tv-inline-state neo-tv-inline-state--error" role="alert">{effectiveSlidesError}</div> : null}

        <section className="neo-tv-feed" aria-label="TcTv" ref={feedRef}>
          <div className="neo-tv-feed__topbar">
            <div className="neo-tv-feed__tabs" role="tablist" aria-label="作品类型">
              {([
                ['all', '全部'],
                ['canvas', '画布'],
                ['film', '短片'],
              ] as const).map(([value, label]) => (
                <button
                  className={`neo-tv-feed__tab${videoScope === value ? ' is-active' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={videoScope === value}
                  key={value}
                  onClick={() => setVideoScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="neo-tv-feed__actions">
              <label className="neo-tv-feed__search">
                <input
                  className="neo-tv-feed__search-input"
                  value={videoQuery}
                  onChange={(event) => setVideoQuery(event.currentTarget.value)}
                  placeholder="搜索 TcTv..."
                />
                <span className="neo-tv-feed__search-button" aria-hidden="true">
                  <IconSearch className="neo-tv-feed__search-icon" size={18} />
                </span>
              </label>
              <button
                className="neo-tv-feed__publish"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={publishOpen}
                onClick={(event) => {
                  event.stopPropagation()
                  requireLogin(() => setPublishOpen(true))
                }}
              >
                <IconPlus className="neo-tv-feed__publish-icon" size={17} />
                发布作品
              </button>
            </div>
          </div>

          {videosError ? <div className="neo-tv-inline-state neo-tv-inline-state--error" role="alert">{videosError}</div> : null}
          {!videosLoading && visibleVideos.length === 0 && !videosError ? (
            <div className="neo-tv-inline-state">当前筛选下没有作品</div>
          ) : null}
          <div className="neo-tv-feed__grid" aria-busy={videosLoading}>
            {videosLoading ? WORK_SKELETON_KEYS.map((key) => (
              <div className="neo-tv-work-card neo-tv-work-card--skeleton tc-portal-skeleton" aria-hidden="true" key={key} />
            )) : null}
            {visibleVideos.slice(0, visibleVideoCount).map((asset) => (
              <NeoTvWorkCard
                asset={asset}
                onPreview={openViewer}
                favoriteBusy={favoriteBusyIds.has(asset.id)}
                onToggleFavorite={toggleFavorite}
                key={asset.id}
              />
            ))}
          </div>
          {visibleVideoCount < visibleVideos.length ? (
            <div className="neo-tv-feed__load-more-wrap">
              <button
                className="neo-tv-feed__load-more"
                type="button"
                onClick={() => setVisibleVideoCount((count) => count + 20)}
              >
                加载更多
              </button>
            </div>
          ) : null}
          </section>
        </main>
        <PortalFooter />
      </div>
      <DirectorPetLauncher onActivate={() => promptInputRef.current?.focus()} />

      {showBackToTop ? (
        <button
          className="neo-tv-back-to-top"
          type="button"
          aria-label="返回顶部"
          onClick={() => scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <IconArrowUp className="neo-tv-back-to-top__icon" size={20} />
        </button>
      ) : null}

      <VideoPublishFlow
        projects={projects}
        projectCovers={projectCovers}
        shortFilms={shortFilms}
        shortFilmsLoading={shortFilmsLoading}
        shortFilmsError={shortFilmsError}
        opened={publishOpen}
        onClose={() => setPublishOpen(false)}
      />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} />
      <ProjectRenameModal
        project={projectActions.renameTarget}
        draft={projectActions.renameDraft}
        busy={projectActions.managingProjectId === projectActions.renameTarget?.id}
        onDraftChange={projectActions.setRenameDraft}
        onClose={projectActions.closeRename}
        onSubmit={projectActions.submitRename}
      />
      <SkillLibraryDialog
        opened={skillLibraryOpen}
        onClose={() => setSkillLibraryOpen(false)}
        data={skillLibrary}
        selectedOfficialIds={selectedSkills.map((skill) => skill.id)}
        onToggleOfficial={toggleSkill}
        selectionMode="multiple"
      />

      <NeoTvViewer
        assetId={previewAssetId}
        assets={videos}
        favoriteBusyIds={favoriteBusyIds}
        onClose={closeViewer}
        onToggleFavorite={toggleFavorite}
      />
    </div>
  )
}
