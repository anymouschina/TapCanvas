import React from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Checkbox,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Transition,
} from '@mantine/core'
import { IconRefresh, IconSearch, IconUsersGroup, IconX } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { PanelCard } from '../PanelCard'
import { useUIStore } from '../uiStore'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarCenteredPanelStyle,
  bottomBarPanelMetrics,
} from '../utils/panelPosition'
import {
  getCharacterLibraryDisplayName,
  getCharacterLibraryPrimaryImage,
  getCharacterLibrarySummary,
  normalizeCharacterLibraryText,
} from './characterLibraryPanelModel'
import { useCanvasCharacterLibraryPanel } from './useCanvasCharacterLibraryPanel'
import styles from './CanvasCharacterLibraryPanel.module.css'

export default function CanvasCharacterLibraryPanel(): JSX.Element | null {
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const projectId = useUIStore((state) => normalizeCharacterLibraryText(state.currentProject?.id))
  const mounted = activePanel === 'character-library'
  const library = useCanvasCharacterLibraryPanel(mounted)

  if (!projectId) return null

  const metrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.wide)

  return (
    <div
      className={styles.anchor}
      style={bottomBarCenteredPanelStyle({
        zIndex: 245,
        halfWidth: BOTTOM_BAR_PANEL_WIDTH.wide / 2,
      })}
      data-ux-panel
    >
      <Transition
        className={styles.transition}
        mounted={mounted}
        transition="pop"
        duration={140}
        timingFunction="ease"
      >
        {(transitionStyle) => (
          <div className={styles.transitionInner} style={transitionStyle}>
            <PanelCard
              className={styles.panel}
              padding="compact"
              style={{ width: metrics.width, height: metrics.height }}
              data-ux-panel
            >
              <div className={styles.header}>
                <Group className={styles.heading} gap={8} wrap="nowrap">
                  <IconUsersGroup className={styles.headingIcon} size={18} />
                  <div className={styles.headingCopy}>
                    <Text className={styles.title} size="sm" fw={700}>角色库</Text>
                    <Text className={styles.subtitle} size="xs" c="dimmed">
                      可复用角色素材 · {library.characters.length} 个角色
                    </Text>
                  </div>
                </Group>
                <Group className={styles.headerActions} gap={2} wrap="nowrap">
                  <Tooltip className={styles.tooltip} label="刷新角色库" withArrow>
                    <ActionIcon
                      className={styles.iconButton}
                      size="sm"
                      variant="subtle"
                      loading={library.refreshing}
                      onClick={() => { void library.loadCharacters('refresh') }}
                      aria-label="刷新角色库"
                    >
                      <IconRefresh className={styles.actionIcon} size={15} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip className={styles.tooltip} label="关闭" withArrow>
                    <ActionIcon
                      className={styles.iconButton}
                      size="sm"
                      variant="subtle"
                      onClick={() => setActivePanel(null)}
                      aria-label="关闭角色库"
                    >
                      <IconX className={styles.actionIcon} size={15} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </div>

              <div className={styles.toolbar}>
                <TextInput
                  className={styles.search}
                  size="xs"
                  leftSection={<IconSearch className={styles.searchIcon} size={14} />}
                  placeholder="搜索角色、时代、服装或特征"
                  value={library.query}
                  onChange={(event) => library.setQuery(event.currentTarget.value)}
                />
                <Checkbox
                  className={styles.recentToggle}
                  size="xs"
                  label="最近使用"
                  checked={library.recentOnly}
                  onChange={(event) => library.setRecentOnly(event.currentTarget.checked)}
                />
              </div>

              <div className={styles.worldviewScroller}>
                <div className={styles.worldviewRow}>
                  {['all', ...library.worldviewOptions].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={styles.worldviewButton}
                      data-active={library.worldview === option}
                      onClick={() => library.setWorldview(option)}
                    >
                      {option === 'all' ? '全部' : option}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.content}>
                <div className={styles.results}>
                  {library.loading ? (
                    <Center className={styles.state}>
                      <Stack className={styles.stateStack} gap={6} align="center">
                        <Loader className={styles.loader} size="sm" />
                        <Text className={styles.stateText} size="xs" c="dimmed">正在加载角色库…</Text>
                      </Stack>
                    </Center>
                  ) : library.error ? (
                    <Center className={styles.state}>
                      <Stack className={styles.stateStack} gap={8} align="center">
                        <Text className={styles.stateText} size="xs" c="red">{library.error}</Text>
                        <Button
                          className={styles.retryButton}
                          size="compact-xs"
                          variant="subtle"
                          onClick={() => { void library.loadCharacters('refresh') }}
                        >
                          重新加载
                        </Button>
                      </Stack>
                    </Center>
                  ) : library.visibleCharacters.length === 0 ? (
                    <Center className={styles.state}>
                      <Text className={styles.stateText} size="xs" c="dimmed">
                        {library.recentOnly ? '还没有最近使用的角色' : '没有符合当前筛选的角色'}
                      </Text>
                    </Center>
                  ) : (
                    <div className={styles.grid}>
                      {library.visibleCharacters.map((character) => {
                        const characterId = normalizeCharacterLibraryText(character.id)
                        const displayName = getCharacterLibraryDisplayName(character)
                        const imageUrl = getCharacterLibraryPrimaryImage(character)
                        const isSelected = characterId === library.selectedCharacterId
                        return (
                          <button
                            key={characterId}
                            type="button"
                            className={styles.card}
                            data-selected={isSelected}
                            aria-pressed={isSelected}
                            onClick={() => library.setSelectedCharacterId(characterId)}
                          >
                            <div className={styles.cardMedia}>
                              {imageUrl ? (
                                <ManagedImage
                                  className={styles.cardImage}
                                  src={imageUrl}
                                  alt={displayName}
                                  ownerSurface="asset-library"
                                  ownerRequestKey={`canvas-character-library:${characterId}`}
                                  priority="visible"
                                />
                              ) : (
                                <Center className={styles.cardImageEmpty}>
                                  <Text className={styles.cardImageEmptyText} size="xs" c="dimmed">暂无图片</Text>
                                </Center>
                              )}
                            </div>
                            <div className={styles.cardCopy}>
                              <Text className={styles.cardTitle} size="xs" fw={700} lineClamp={1}>{displayName}</Text>
                              <Text className={styles.cardMeta} size="xs" c="dimmed" lineClamp={1}>
                                {getCharacterLibrarySummary(character) || character.filter_worldview || '角色素材'}
                              </Text>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <aside className={styles.selection}>
                  {library.selectedCharacter ? (
                    <div className={styles.selectionBody}>
                      <div className={styles.selectionMedia}>
                        {getCharacterLibraryPrimaryImage(library.selectedCharacter) ? (
                          <ManagedImage
                            className={styles.selectionImage}
                            src={getCharacterLibraryPrimaryImage(library.selectedCharacter)}
                            alt={getCharacterLibraryDisplayName(library.selectedCharacter)}
                            ownerSurface="asset-library"
                            ownerRequestKey={`canvas-character-library-detail:${library.selectedCharacter.id}`}
                            priority="visible"
                          />
                        ) : (
                          <Center className={styles.selectionImage}>
                            <Text className={styles.cardImageEmptyText} size="xs" c="dimmed">暂无图片</Text>
                          </Center>
                        )}
                      </div>
                      <div className={styles.selectionCopy}>
                        <Text className={styles.selectionTitle} size="sm" fw={700} lineClamp={1}>
                          {getCharacterLibraryDisplayName(library.selectedCharacter)}
                        </Text>
                        <Text className={styles.selectionSummary} size="xs" c="dimmed" lineClamp={3}>
                          {getCharacterLibrarySummary(library.selectedCharacter)
                            || normalizeCharacterLibraryText(library.selectedCharacter.distinctive_features)
                            || '可复用角色素材'}
                        </Text>
                        <div className={styles.badges}>
                          {[
                            library.selectedCharacter.filter_worldview,
                            library.selectedCharacter.filter_theme,
                            `${library.selectedReferences.length} 张参考图`,
                          ]
                            .map(normalizeCharacterLibraryText)
                            .filter(Boolean)
                            .map((label) => (
                              <Badge key={label} className={styles.badge} size="xs" variant="light" color="gray">
                                {label}
                              </Badge>
                            ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Center className={styles.selectionEmpty}>
                      <Stack className={styles.selectionEmptyStack} gap={6} align="center">
                        <IconUsersGroup className={styles.selectionEmptyIcon} size={24} />
                        <Text className={styles.selectionEmptyText} size="xs" c="dimmed" ta="center">
                          选择一个角色查看并应用
                        </Text>
                      </Stack>
                    </Center>
                  )}
                  <Button
                    className={styles.applyButton}
                    size="sm"
                    fullWidth
                    loading={library.applying}
                    disabled={!library.selectedCharacter || library.selectedReferences.length === 0}
                    onClick={() => { void library.applySelectedCharacter() }}
                  >
                    应用至画布
                  </Button>
                </aside>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
