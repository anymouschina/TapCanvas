import React from 'react'
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { IconMovie, IconPalette, IconPlus, IconSearch, IconX } from '@tabler/icons-react'
import {
  getProjectDirectorPersona,
  listDirectorPersonas,
  updateChapter,
  type ChapterCreativeOverride,
  type DirectorPersonaSummary,
  type ProjectDirectorPersona,
} from '../../api/server'
import {
  buildChapterOverrideWithDirector,
  buildChapterOverrideWithStyle,
  chapterOverrideToLockedStyle,
  parseChapterCreativeOverride,
} from '../../projects/chapterCreative'
import {
  deriveStyleBibleFromLockedStyle,
  mergeChapterCreativeOverrideIntoProjectImageSettings,
  useProjectImageSettings,
  useProjectImageSettingsStore,
  type LockedStyle,
} from '../../canvas/projectImageSettingsStore'
import { StyleLibraryPanel } from '../styleLibrary/StyleLibraryPanel'
import { useUIStore } from '../uiStore'
import { toast } from '../toast'

export type ChapterCreativeSettingsPopoverProps = {
  projectId: string
  chapterId: string
  override: ChapterCreativeOverride | null
  onOverrideChange: (override: ChapterCreativeOverride | null) => void
}

function matchesDirectorQuery(persona: DirectorPersonaSummary, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return [persona.name, persona.description, ...persona.keywords]
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function ChapterCreativeSettingsPopover({
  projectId,
  chapterId,
  override,
  onOverrideChange,
}: ChapterCreativeSettingsPopoverProps): JSX.Element {
  const [opened, setOpened] = React.useState(false)
  const [pool, setPool] = React.useState<DirectorPersonaSummary[]>([])
  const [projectDirector, setProjectDirector] = React.useState<ProjectDirectorPersona | null>(null)
  const [query, setQuery] = React.useState('')
  const [customDirectorOpened, setCustomDirectorOpened] = React.useState(false)
  const [customDirectorName, setCustomDirectorName] = React.useState('自定义导演')
  const [customDirectorPrompt, setCustomDirectorPrompt] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const projectSettings = useProjectImageSettings(projectId)
  const ensureHydrated = useProjectImageSettingsStore((state) => state.ensureHydratedStyleImages)
  const setActiveStyleBible = useUIStore((state) => state.setActiveStyleBible)
  const chapterStyle = chapterOverrideToLockedStyle(override)
  const effectiveSettings = mergeChapterCreativeOverrideIntoProjectImageSettings(projectSettings, override)

  React.useEffect(() => {
    ensureHydrated(projectId)
  }, [ensureHydrated, projectId])

  React.useEffect(() => {
    setActiveStyleBible(deriveStyleBibleFromLockedStyle(effectiveSettings.lockedStyle))
  }, [effectiveSettings.lockedStyle, setActiveStyleBible])

  React.useEffect(() => {
    if (!opened) return
    let cancelled = false
    void Promise.all([listDirectorPersonas(), getProjectDirectorPersona(projectId)])
      .then(([nextPool, nextProjectDirector]) => {
        if (cancelled) return
        setPool(nextPool)
        setProjectDirector(nextProjectDirector)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [opened, projectId])

  const persistOverride = React.useCallback(async (nextOverride: ChapterCreativeOverride | null) => {
    setSaving(true)
    setError('')
    try {
      const updatedChapter = await updateChapter(chapterId, { styleProfileOverride: nextOverride })
      const confirmed = parseChapterCreativeOverride(updatedChapter.styleProfileOverride)
      onOverrideChange(confirmed)
      toast('本章导演 / 影调配置已保存', 'success')
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : String(saveError)
      setError(message)
      toast(`本章导演 / 影调保存失败：${message}`, 'error')
    } finally {
      setSaving(false)
    }
  }, [chapterId, onOverrideChange])

  const handlePickDirector = React.useCallback((persona: ChapterCreativeOverride['directorPersona']) => {
    void persistOverride(buildChapterOverrideWithDirector(override, persona))
  }, [override, persistOverride])

  const handleSaveCustomDirector = React.useCallback(() => {
    const prompt = customDirectorPrompt.trim()
    const personaName = customDirectorName.trim() || '自定义导演'
    if (!prompt) {
      setError('请填写自定义导演提示词')
      return
    }
    void persistOverride(buildChapterOverrideWithDirector(override, {
      personaId: 'chapter-custom-director',
      personaName,
      source: 'custom',
      prompt,
    }))
  }, [customDirectorName, customDirectorPrompt, override, persistOverride])

  const handlePickStyle = React.useCallback((style: LockedStyle) => {
    void persistOverride(buildChapterOverrideWithStyle(override, style))
  }, [override, persistOverride])

  const handlePickCustomStyle = React.useCallback((stylePrompt: string) => {
    void persistOverride(buildChapterOverrideWithStyle(override, {
      styleId: 'custom',
      styleName: '本章自定义风格',
      referenceImageUrl: null,
      stylePrompt,
    }))
  }, [override, persistOverride])

  const handleClearStyle = React.useCallback(() => {
    void persistOverride(buildChapterOverrideWithStyle(override, null))
  }, [override, persistOverride])

  const filteredPool = pool.filter((persona) => matchesDirectorQuery(persona, query))
  const activeDirector = override?.directorPersona ?? null
  const inheritedDirectorLabel = projectDirector?.personaName || '小T自主选择'
  const inheritedStyleLabel = projectSettings.lockedStyle?.styleName || '项目未锁定风格'
  const statusLabel = activeDirector || chapterStyle
    ? '本章已覆盖'
    : '继承项目配置'

  return (
    <Popover
      className="chapter-creative-settings-popover"
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      withinPortal
      trapFocus={false}
      closeOnClickOutside={!saving}
    >
      <Popover.Target>
        <Tooltip className="chapter-creative-settings-tooltip" label="本章导演 / 影调" withArrow>
          <ActionIcon
            className="chapter-creative-settings-trigger"
            variant="subtle"
            aria-label="本章导演 / 影调"
            onClick={() => setOpened((current) => !current)}
          >
            <IconMovie className="chapter-creative-settings-trigger-icon" size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="chapter-creative-settings-dropdown" p="md">
        <Stack className="chapter-creative-settings-panel" gap="md">
          <Group className="chapter-creative-settings-head" justify="space-between" align="flex-start" wrap="nowrap">
            <div className="chapter-creative-settings-title-block">
              <Group className="chapter-creative-settings-title-row" gap={6} wrap="nowrap">
                <IconPalette className="chapter-creative-settings-title-icon" size={16} />
                <Text className="chapter-creative-settings-title" fw={700}>本章导演 / 影调</Text>
              </Group>
              <Text className="chapter-creative-settings-subtitle" size="xs" c="dimmed">
                只作用于当前章节；未覆盖的部分继承项目默认配置。
              </Text>
            </div>
            <Group className="chapter-creative-settings-status" gap={6} wrap="nowrap">
              {saving ? <Text className="chapter-creative-settings-saving" size="xs" c="dimmed">保存中…</Text> : null}
              <Text className="chapter-creative-settings-status-label" size="xs" c={activeDirector || chapterStyle ? 'cyan' : 'dimmed'}>{statusLabel}</Text>
            </Group>
          </Group>

          <section className="chapter-creative-settings-section chapter-creative-settings-director-section">
            <Group className="chapter-creative-settings-section-head" justify="space-between" align="center">
              <div className="chapter-creative-settings-section-title-block">
                <Text className="chapter-creative-settings-section-title" size="sm" fw={600}>导演人格</Text>
                <Text className="chapter-creative-settings-section-caption" size="xs" c="dimmed">
                  当前：{activeDirector?.personaName || `继承项目 · ${inheritedDirectorLabel}`}
                </Text>
              </div>
              {activeDirector ? (
                <Button
                  className="chapter-creative-settings-clear-director"
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconX className="chapter-creative-settings-clear-icon" size={13} />}
                  onClick={() => handlePickDirector(null)}
                  disabled={saving}
                >
                  继承项目
                </Button>
              ) : null}
            </Group>
            <TextInput
              className="chapter-creative-settings-director-search"
              size="xs"
              placeholder="搜索导演 / 关键词"
              leftSection={<IconSearch className="chapter-creative-settings-search-icon" size={14} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <ScrollArea className="chapter-creative-settings-director-list" h={230} type="auto" scrollbarSize={5}>
              <Stack className="chapter-creative-settings-director-stack" gap={2}>
                {filteredPool.length === 0 ? (
                  <Text className="chapter-creative-settings-empty" size="xs" c="dimmed">
                    {pool.length === 0 ? '导演人格加载中…' : '没有匹配的导演'}
                  </Text>
                ) : filteredPool.map((persona) => {
                  const selected = activeDirector?.personaId === persona.id
                  return (
                    <UnstyledButton
                      className={`chapter-creative-settings-director-option${selected ? ' chapter-creative-settings-director-option--selected' : ''}`}
                      key={persona.id}
                      onClick={() => handlePickDirector({ personaId: persona.id, personaName: persona.name, source: 'catalog' })}
                    >
                      <Text className="chapter-creative-settings-director-name" size="sm" fw={selected ? 700 : 500}>{persona.name}</Text>
                      {persona.description ? <Text className="chapter-creative-settings-director-description" size="xs" c="dimmed" lineClamp={1}>{persona.description}</Text> : null}
                    </UnstyledButton>
                  )
                })}
              </Stack>
            </ScrollArea>
            <Button
              className="chapter-creative-settings-custom-director-toggle"
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconPlus className="chapter-creative-settings-custom-director-icon" size={13} />}
              onClick={() => setCustomDirectorOpened((current) => !current)}
              disabled={saving}
            >
              自定义导演人格
            </Button>
            {customDirectorOpened ? (
              <Stack className="chapter-creative-settings-custom-director" gap="xs">
                <TextInput
                  className="chapter-creative-settings-custom-director-name"
                  size="xs"
                  label="名称"
                  value={customDirectorName}
                  onChange={(event) => setCustomDirectorName(event.currentTarget.value)}
                />
                <Textarea
                  className="chapter-creative-settings-custom-director-prompt"
                  label="导演提示词"
                  size="xs"
                  minRows={4}
                  maxRows={8}
                  autosize
                  value={customDirectorPrompt}
                  onChange={(event) => setCustomDirectorPrompt(event.currentTarget.value)}
                  placeholder="描述本章的调度、表演、镜头与节奏取向…"
                />
                <Group className="chapter-creative-settings-custom-director-actions" justify="flex-end">
                  <Button
                    className="chapter-creative-settings-custom-director-save"
                    size="compact-sm"
                    onClick={handleSaveCustomDirector}
                    disabled={saving || !customDirectorPrompt.trim()}
                  >
                    应用于本章
                  </Button>
                </Group>
              </Stack>
            ) : null}
          </section>

          <Divider className="chapter-creative-settings-divider" />

          <section className="chapter-creative-settings-section chapter-creative-settings-style-section">
            <Group className="chapter-creative-settings-section-head" justify="space-between" align="center">
              <div className="chapter-creative-settings-section-title-block">
                <Text className="chapter-creative-settings-section-title" size="sm" fw={600}>影调 / 风格</Text>
                <Text className="chapter-creative-settings-section-caption" size="xs" c="dimmed">
                  当前：{chapterStyle?.styleName || `继承项目 · ${inheritedStyleLabel}`}
                </Text>
              </div>
            </Group>
            <StyleLibraryPanel
              selectedStyleId={chapterStyle?.styleId ?? null}
              initialCustomText={chapterStyle?.stylePrompt ?? ''}
              scopeLabel="本章"
              onPickPreset={handlePickStyle}
              onPickCustom={handlePickCustomStyle}
              onClear={handleClearStyle}
            />
          </section>

          {error ? <Box className="chapter-creative-settings-error"><Text className="chapter-creative-settings-error-text" size="xs" c="red">{error}</Text></Box> : null}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
