import React from 'react'
import {
  Modal, Text, TextInput, SegmentedControl, ActionIcon, Menu, Button,
  Group, SimpleGrid, Tooltip, Center, Loader,
} from '@mantine/core'
import {
  IconSearch, IconStar, IconUpload, IconFolderPlus, IconDots, IconPencil,
  IconFolder, IconCopy, IconTrash, IconChevronLeft, IconChevronRight,
  IconPhoto, IconRefresh, IconFolderFilled, IconPhotoStar,
} from '@tabler/icons-react'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import type { MaterialAssetDto, MaterialFolderDto, MaterialKindDto } from '../api/server'
import { FOLDER_DEFS, getAssetImageUrl } from './MaterialLibraryPanel'
import { useUIStore } from './uiStore'
import { getMaterialAssetPresentation } from './materialAssetPresentation'

const PAGE_SIZE = 24

type NavItem = {
  id: string
  label: string
  count: number
  match: (a: MaterialAssetDto) => boolean
  folder?: MaterialFolderDto
}

export type MaterialLibraryModalProps = {
  opened: boolean
  onClose: () => void
  assets: MaterialAssetDto[]
  folders: MaterialFolderDto[]
  loading: boolean
  tab: 'project' | 'personal' | 'team'
  onTabChange: (t: 'project' | 'personal' | 'team') => void
  showTeamTab: boolean
  uploading?: boolean
  onApplyToCanvas: (asset: MaterialAssetDto) => void
  onRename: (asset: MaterialAssetDto, newName: string) => void
  onDelete: (asset: MaterialAssetDto) => void
  onCopy: (asset: MaterialAssetDto) => void
  onMove: (asset: MaterialAssetDto) => void
  onToggleFavorite: (asset: MaterialAssetDto) => void
  onDeleteFolder: (folder: MaterialFolderDto) => void
  onUploadClick: () => void
  onNewFolderClick: () => void
  onRefresh: () => void
}

// ── Single grid card ────────────────────────────────────────────────────────

function ModalAssetCard({
  asset,
  onApplyToCanvas,
  onStartRename,
  onDelete,
  onCopy,
  onMove,
  onToggleFavorite,
}: {
  asset: MaterialAssetDto
  onApplyToCanvas: (asset: MaterialAssetDto) => void
  onStartRename: (asset: MaterialAssetDto) => void
  onDelete: (asset: MaterialAssetDto) => void
  onCopy: (asset: MaterialAssetDto) => void
  onMove: (asset: MaterialAssetDto) => void
  onToggleFavorite: (asset: MaterialAssetDto) => void
}) {
  const [hovered, setHovered] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const imageUrl = getAssetImageUrl(asset)
  const presentation = getMaterialAssetPresentation(asset)
  const showOverlay = hovered || menuOpen
  const isOfficial = asset.scope === 'official'
  const isReadOnly = isOfficial || asset.origin?.type === 'project_node'

  // 点击卡片（非按钮区域）放大看原图，复用全站全屏 lightbox。
  const openLightbox = React.useCallback(() => {
    if (!imageUrl) return
    useUIStore.getState().openPreview({ url: imageUrl, kind: 'image', name: asset.name })
  }, [imageUrl, asset.name])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={openLightbox}
      style={{
        position: 'relative',
        borderRadius: 10,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        aspectRatio: '1 / 1',
        cursor: imageUrl ? 'zoom-in' : 'default',
      }}
    >
      {imageUrl ? (
        <ManagedImage
          className="material-library-modal__thumb"
          src={imageUrl}
          alt={asset.name}
          priority="visible"
          ownerSurface="asset-library"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <Center style={{ width: '100%', height: '100%' }}>
          <IconPhoto size={26} style={{ opacity: 0.4 }} />
        </Center>
      )}

      {/* Favorite star (top-left) */}
      {asset.favorite && (
        <div style={{ position: 'absolute', top: 6, left: 6 }}>
          <IconStar size={16} fill="#fbbf24" style={{ color: '#fbbf24' }} />
        </div>
      )}

      {/* Bottom label gradient */}
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '14px 8px 6px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.78), transparent)',
        }}
      >
        <Text size="xs" lineClamp={1} style={{ color: '#fff' }}>{asset.name}</Text>
        <Text size="xs" lineClamp={1} style={{ color: 'rgba(255,255,255,0.68)', fontSize: 10 }}>
          {isOfficial ? '官方' : (presentation.roleLabel ?? presentation.kindLabel)}{presentation.approvalLabel ? ` · ${presentation.approvalLabel}` : ''}
        </Text>
      </div>

      {/* Hover overlay: apply + menu */}
      {showOverlay && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: 6,
            background: 'rgba(0,0,0,0.32)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {!isReadOnly && <Menu shadow="md" position="bottom-end" withinPortal zIndex={1200} opened={menuOpen} onChange={setMenuOpen}>
              <Menu.Target>
                <ActionIcon size={26} variant="filled" color="dark" radius="sm" onClick={(e) => e.stopPropagation()}>
                  <IconDots size={15} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconStar size={13} style={asset.favorite ? { color: '#fbbf24' } : undefined} />}
                  onClick={() => onToggleFavorite(asset)}
                >
                  {asset.favorite ? '取消收藏' : '收藏'}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconPencil size={13} />} onClick={() => onStartRename(asset)}>重命名</Menu.Item>
                <Menu.Item leftSection={<IconFolder size={13} />} onClick={() => onMove(asset)}>移动到...</Menu.Item>
                <Menu.Item leftSection={<IconCopy size={13} />} onClick={() => onCopy(asset)}>创建副本</Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconTrash size={13} />} color="red" onClick={() => onDelete(asset)}>删除</Menu.Item>
              </Menu.Dropdown>
            </Menu>}
          </div>
          <Button
            size="xs"
            variant="white"
            color="dark"
            fullWidth
            leftSection={<IconPhotoStar size={14} />}
            onClick={(e) => { e.stopPropagation(); onApplyToCanvas(asset) }}
          >
            添加到当前项目
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Main modal ──────────────────────────────────────────────────────────────

export default function MaterialLibraryModal({
  opened,
  onClose,
  assets,
  folders,
  loading,
  tab,
  onTabChange,
  showTeamTab,
  uploading,
  onApplyToCanvas,
  onRename,
  onDelete,
  onCopy,
  onMove,
  onToggleFavorite,
  onDeleteFolder,
  onUploadClick,
  onNewFolderClick,
  onRefresh,
}: MaterialLibraryModalProps): JSX.Element {
  const [selectedNav, setSelectedNav] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [renamingAsset, setRenamingAsset] = React.useState<MaterialAssetDto | null>(null)
  const [renameValue, setRenameValue] = React.useState('')

  const navItems = React.useMemo<NavItem[]>(() => {
    const items: NavItem[] = [
      { id: 'all', label: '全部素材', count: assets.length, match: () => true },
      { id: 'fav', label: '收藏', count: assets.filter((a) => a.favorite).length, match: (a) => !!a.favorite },
    ]
    for (const def of FOLDER_DEFS) {
      items.push({
        id: `kind:${def.kind}`,
        label: def.label,
        count: assets.filter((a) => a.kind === def.kind && !a.folderId).length,
        match: (a) => a.kind === def.kind && !a.folderId,
      })
    }
    for (const folder of folders) {
      items.push({
        id: `folder:${folder.id}`,
        label: folder.name,
        count: assets.filter((a) => a.folderId === folder.id).length,
        match: (a) => a.folderId === folder.id,
        folder,
      })
    }
    return items
  }, [assets, folders])

  const activeNav = navItems.find((n) => n.id === selectedNav) ?? navItems[0]

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets
      .filter((a) => activeNav.match(a))
      .filter((asset) => q
        ? asset.name.toLowerCase().includes(q)
          || asset.origin?.ownerId.toLowerCase().includes(q)
        : true)
  }, [assets, activeNav, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)

  // Reset paging when the view changes
  React.useEffect(() => { setPage(0) }, [selectedNav, query, tab])
  // Keep selection valid if the active folder gets deleted
  React.useEffect(() => {
    if (!navItems.some((n) => n.id === selectedNav)) setSelectedNav('all')
  }, [navItems, selectedNav])

  const startRename = React.useCallback((asset: MaterialAssetDto) => {
    setRenamingAsset(asset)
    setRenameValue(asset.name)
  }, [])

  const commitRename = React.useCallback(() => {
    if (!renamingAsset) return
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== renamingAsset.name) onRename(renamingAsset, trimmed)
    setRenamingAsset(null)
  }, [renamingAsset, renameValue, onRename])

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        centered
        zIndex={500}
        radius="md"
        size="min(1180px, 94vw)"
        title={
          <Group gap={8}>
            <IconPhoto size={18} style={{ opacity: 0.7 }} />
            <Text fw={600}>素材库</Text>
          </Group>
        }
        styles={{
          content: { height: 'min(800px, 90vh)', display: 'flex', flexDirection: 'column' },
          body: { flex: 1, minHeight: 0, padding: 0, display: 'flex' },
        }}
      >
        {/* Left nav */}
        <div
          style={{
            width: 208, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderRight: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div style={{ padding: '10px 12px 6px' }}>
            <SegmentedControl
              fullWidth size="xs"
              data={[
                { value: 'project', label: '当前项目' },
                { value: 'personal', label: '个人' },
                ...(showTeamTab ? [{ value: 'team', label: '团队' }] : []),
              ]}
              value={tab}
              onChange={(v) => onTabChange(v as 'project' | 'personal' | 'team')}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '6px 8px' }}>
            {navItems.map((item) => {
              const active = item.id === activeNav.id
              const isFav = item.id === 'fav'
              const isFolder = !!item.folder
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedNav(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.045)' }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  {isFav ? (
                    <IconStar size={16} style={{ flexShrink: 0, color: '#fbbf24' }} fill={active ? '#fbbf24' : 'none'} />
                  ) : (
                    <IconFolderFilled size={16} style={{ flexShrink: 0, opacity: 0.55 }} />
                  )}
                  <Text size="sm" fw={active ? 600 : 400} lineClamp={1} style={{ flex: 1 }}>{item.label}</Text>
                  <Text size="xs" c="dimmed">{item.count}</Text>
                  {isFolder && item.folder?.scope !== 'official' && (
                    <Menu shadow="md" position="bottom-end" withinPortal zIndex={1200}>
                      <Menu.Target>
                        <ActionIcon size={18} variant="subtle" radius="sm" onClick={(e) => e.stopPropagation()}>
                          <IconDots size={13} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconTrash size={13} />}
                          color="red"
                          onClick={(e) => { e.stopPropagation(); if (item.folder) onDeleteFolder(item.folder) }}
                        >
                          删除文件夹
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </div>
              )
            })}
          </div>
          {tab !== 'project' && <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <Button
              size="xs" variant="subtle" fullWidth justify="flex-start"
              leftSection={<IconFolderPlus size={14} />}
              onClick={onNewFolderClick}
            >
              新建文件夹
            </Button>
          </div>}
        </div>

        {/* Right content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar */}
          <Group justify="space-between" wrap="nowrap" gap="sm" style={{ padding: '10px 14px', flexShrink: 0 }}>
            <TextInput
              size="xs"
              placeholder="搜索素材名称"
              leftSection={<IconSearch size={13} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              style={{ width: 280 }}
            />
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {rangeStart}-{rangeEnd} / {filtered.length}
              </Text>
              <ActionIcon size={28} variant="subtle" radius="md" disabled={safePage <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="上一页">
                <IconChevronLeft size={16} />
              </ActionIcon>
              <ActionIcon size={28} variant="subtle" radius="md" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} aria-label="下一页">
                <IconChevronRight size={16} />
              </ActionIcon>
              {tab !== 'project' && <Tooltip label="上传素材" withArrow>
                <ActionIcon size={28} variant="subtle" radius="md" loading={uploading} onClick={onUploadClick} aria-label="上传素材">
                  <IconUpload size={16} />
                </ActionIcon>
              </Tooltip>}
              <Tooltip label="刷新" withArrow>
                <ActionIcon size={28} variant="subtle" radius="md" loading={loading} onClick={onRefresh} aria-label="刷新">
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {/* Grid */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 14px 14px' }}>
            {loading && filtered.length === 0 ? (
              <Center style={{ height: '100%' }}>
                <Group gap="xs"><Loader size="sm" /><Text size="sm" c="dimmed">加载中…</Text></Group>
              </Center>
            ) : pageItems.length === 0 ? (
              <Center style={{ height: '100%' }}>
                <Text size="sm" c="dimmed">{query.trim() ? '无匹配素材' : '该文件夹暂无素材'}</Text>
              </Center>
            ) : (
              <SimpleGrid cols={{ base: 3, sm: 4, md: 5, lg: 6 }} spacing="sm">
                {pageItems.map((asset) => (
                  <ModalAssetCard
                    key={asset.id}
                    asset={asset}
                    onApplyToCanvas={onApplyToCanvas}
                    onStartRename={startRename}
                    onDelete={onDelete}
                    onCopy={onCopy}
                    onMove={onMove}
                    onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </SimpleGrid>
            )}
          </div>
        </div>
      </Modal>

      {/* Rename modal */}
      <Modal
        opened={renamingAsset !== null}
        onClose={() => setRenamingAsset(null)}
        zIndex={1200}
        centered
        size="sm"
        radius="md"
        title={<Group gap={8}><IconPencil size={16} style={{ opacity: 0.6 }} /><span>重命名素材</span></Group>}
      >
        <TextInput
          autoFocus
          placeholder="素材名称"
          value={renameValue}
          onChange={(e) => setRenameValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenamingAsset(null)
          }}
          mb={16}
        />
        <Group justify="flex-end" gap={8}>
          <Button variant="default" size="sm" onClick={() => setRenamingAsset(null)}>取消</Button>
          <Button size="sm" disabled={!renameValue.trim()} onClick={commitRename}>确认</Button>
        </Group>
      </Modal>
    </>
  )
}
