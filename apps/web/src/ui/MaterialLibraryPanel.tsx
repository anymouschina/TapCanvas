import React from 'react'
import { Text, Menu, ActionIcon, TextInput, SegmentedControl, Modal, Button, Portal } from '@mantine/core'
import {
  IconPlus, IconUpload, IconFolderPlus, IconChevronRight, IconFolderFilled,
  IconSearch, IconStar, IconX, IconDots, IconPencil, IconFolder, IconCopy, IconTrash,
  IconArrowsDiagonal,
} from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { useActiveTeamId } from './team/TeamManagementModal'
import { PanelCard } from './PanelCard'
import {
  listMaterialAssets, createMaterialAsset, updateMaterialAsset, deleteMaterialAsset,
  listTeamMaterialAssets, createTeamMaterialAsset,
  listMaterialFolders, createMaterialFolder, deleteMaterialFolder,
  uploadServerAssetFile,
  type MaterialAssetDto, type MaterialKindDto, type MaterialFolderDto,
} from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { bottomBarPanelStyle } from './utils/panelPosition'
import { toast } from './toast'
import MaterialLibraryModal from './MaterialLibraryModal'
import { getMaterialAssetImageUrl, getMaterialAssetPresentation } from './materialAssetPresentation'
import { buildMaterialAssetCanvasNodeData } from './materialAssetCanvasNode'

export const FOLDER_DEFS: { kind: MaterialKindDto; label: string }[] = [
  { kind: 'character', label: '角色' },
  { kind: 'scene', label: '场景' },
  { kind: 'prop', label: '道具' },
  { kind: 'style', label: '风格' },
  { kind: 'ensemble', label: '群像关系' },
  { kind: 'pose', label: '姿态 / 表情' },
  { kind: 'voice', label: '声音' },
  { kind: 'text', label: 'Others' },
]

export function getAssetImageUrl(asset: MaterialAssetDto): string {
  return getMaterialAssetImageUrl(asset)
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Hover preview card ──────────────────────────────────────────────────────

function AssetPreviewCard({
  asset,
  anchorY,
  onClose,
  onCancelHide,
  onApplyToCanvas,
}: {
  asset: MaterialAssetDto
  anchorY: number
  onClose: () => void
  onCancelHide: () => void
  onApplyToCanvas: (asset: MaterialAssetDto) => void
}) {
  const imageUrl = getAssetImageUrl(asset)
  const presentation = getMaterialAssetPresentation(asset)
  return (
    <Portal>
      <div
        onMouseEnter={onCancelHide}
        onMouseLeave={onClose}
        style={{
          position: 'fixed',
          left: 356,
          top: anchorY,
          transform: 'translateY(-50%)',
          width: 260,
          background: 'rgba(18,18,22,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          zIndex: 400,
          pointerEvents: 'auto',
        }}
      >
        {imageUrl ? (
          <ManagedImage
            className="material-library-panel__preview-img"
            src={imageUrl}
            alt={asset.name}
            priority="visible"
            onClick={() => useUIStore.getState().openPreview({ url: imageUrl, kind: 'image', name: asset.name })}
            style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
          />
        ) : (
          <div style={{
            width: '100%', height: 180,
            background: 'rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Text size="xs" c="dimmed">无预览图</Text>
          </div>
        )}
        <div style={{ padding: '10px 12px 12px' }}>
          <Text size="sm" fw={600} lineClamp={1} style={{ color: '#fff', marginBottom: 2 }}>{asset.name}</Text>
          <Text size="xs" c="dimmed" style={{ marginBottom: 4 }}>
            {presentation.roleLabel ?? presentation.kindLabel}{presentation.approvalLabel ? ` · ${presentation.approvalLabel}` : ''}
          </Text>
          {presentation.identityAnchors.length > 0 && (
            <Text size="xs" c="dimmed" lineClamp={2} style={{ marginBottom: 4 }}>
              身份锚：{presentation.identityAnchors.join(' / ')}
            </Text>
          )}
          <Text size="xs" c="dimmed" style={{ marginBottom: 10 }}>创建于 {formatDate(asset.createdAt)}</Text>
          <Button
            fullWidth
            size="sm"
            onClick={() => { onApplyToCanvas(asset); onClose() }}
          >
            添加到当前项目
          </Button>
        </div>
      </div>
    </Portal>
  )
}

// ── Single-active hover coordination ───────────────────────────────────────
// hover preview cards share one slot — opening a new one closes the others.
const HOVER_COORD = {
  activeId: null as string | null,
  listeners: new Set<(id: string | null) => void>(),
  setActive(id: string | null) {
    HOVER_COORD.activeId = id
    HOVER_COORD.listeners.forEach((fn) => fn(id))
  },
}

function useExclusiveHover(rowId: string): [boolean, (next: boolean) => void] {
  const [hovered, setLocalHovered] = React.useState(false)
  React.useEffect(() => {
    const handler = (id: string | null) => {
      if (id !== rowId) setLocalHovered(false)
    }
    HOVER_COORD.listeners.add(handler)
    return () => { HOVER_COORD.listeners.delete(handler) }
  }, [rowId])
  const setHovered = React.useCallback((next: boolean) => {
    if (next) {
      HOVER_COORD.setActive(rowId)
      setLocalHovered(true)
    } else {
      if (HOVER_COORD.activeId === rowId) HOVER_COORD.activeId = null
      setLocalHovered(false)
    }
  }, [rowId])
  return [hovered, setHovered]
}

// ── Asset row in accordion ──────────────────────────────────────────────────

function AssetRow({
  asset,
  onApplyToCanvas,
  onRename,
  onDelete,
  onCopy,
  onMove,
  onToggleFavorite,
}: {
  asset: MaterialAssetDto
  onApplyToCanvas: (asset: MaterialAssetDto) => void
  onRename: (asset: MaterialAssetDto, newName: string) => void
  onDelete: (asset: MaterialAssetDto) => void
  onCopy: (asset: MaterialAssetDto) => void
  onMove: (asset: MaterialAssetDto) => void
  onToggleFavorite: (asset: MaterialAssetDto) => void
}) {
  const [hovered, setHovered] = useExclusiveHover(asset.id)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [previewY, setPreviewY] = React.useState(0)
  const [renaming, setRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(asset.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const imageUrl = getAssetImageUrl(asset)
  const isReadOnly = asset.scope === 'official' || asset.origin?.type === 'project_node'

  const scheduleHide = () => {
    hideTimerRef.current = setTimeout(() => setHovered(false), 400)
  }
  const cancelHide = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }

  React.useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (renaming) {
      setRenameValue(asset.name)
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 30)
    }
  }, [renaming, asset.name])

  const commitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== asset.name) {
      onRename(asset, trimmed)
    }
    setRenaming(false)
  }

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px 6px 38px', cursor: 'pointer',
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          cancelHide()
          const rect = e.currentTarget.getBoundingClientRect()
          setPreviewY(rect.top + rect.height / 2)
          setHovered(true)
        }}
        onMouseLeave={() => scheduleHide()}
      >
        {imageUrl ? (
          <ManagedImage
            className="material-library-panel__asset-thumb"
            src={imageUrl}
            alt={asset.name}
            priority="visible"
            style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />
        )}

        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4, padding: '2px 6px', fontSize: 12, color: '#fff', outline: 'none',
            }}
          />
        ) : (
          <Text size="xs" lineClamp={1} style={{ flex: 1 }}>{asset.name}</Text>
        )}

        {/* "..." context menu – only when hovered and not renaming */}
        {hovered && !renaming && !isReadOnly && (
          <Menu shadow="md" position="right-start" withinPortal zIndex={1000} opened={menuOpen} onChange={setMenuOpen}>
            <Menu.Target>
              <ActionIcon
                size={20}
                variant="subtle"
                radius="sm"
                style={{ flexShrink: 0 }}
                onMouseEnter={cancelHide}
                onClick={(e) => e.stopPropagation()}
              >
                <IconDots size={13} />
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
              <Menu.Item
                leftSection={<IconPencil size={13} />}
                onClick={() => setRenaming(true)}
              >
                重命名
              </Menu.Item>
              <Menu.Item leftSection={<IconFolder size={13} />} onClick={() => onMove(asset)}>
                移动到...
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCopy size={13} />}
                onClick={() => onCopy(asset)}
              >
                创建副本
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconTrash size={13} />}
                color="red"
                onClick={() => onDelete(asset)}
              >
                删除
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </div>

      {hovered && !renaming && !menuOpen && (
        <AssetPreviewCard
          asset={asset}
          anchorY={previewY}
          onClose={() => setHovered(false)}
          onCancelHide={cancelHide}
          onApplyToCanvas={onApplyToCanvas}
        />
      )}
    </>
  )
}

// ── Folder row (accordion) ──────────────────────────────────────────────────

function FolderRow({
  folder,
  assets,
  loading,
  onApplyToCanvas,
  onRename,
  onDelete,
  onCopy,
  onMove,
  onToggleFavorite,
}: {
  folder: { kind: MaterialKindDto; label: string }
  assets: MaterialAssetDto[]
  loading: boolean
  onApplyToCanvas: (asset: MaterialAssetDto) => void
  onRename: (asset: MaterialAssetDto, newName: string) => void
  onDelete: (asset: MaterialAssetDto) => void
  onCopy: (asset: MaterialAssetDto) => void
  onMove: (asset: MaterialAssetDto) => void
  onToggleFavorite: (asset: MaterialAssetDto) => void
}) {
  const [open, setOpen] = React.useState(false)
  const cover = assets.find((a) => !!getAssetImageUrl(a))
  const coverUrl = cover ? getAssetImageUrl(cover) : ''

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <IconChevronRight
          size={14}
          style={{
            flexShrink: 0, opacity: 0.5,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
        {coverUrl ? (
          <ManagedImage
            className="material-library-panel__folder-thumb"
            src={coverUrl}
            alt={folder.label}
            priority="visible"
            style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <IconFolderFilled size={22} style={{ opacity: 0.5, flexShrink: 0 }} />
        )}
        <Text size="sm" style={{ flex: 1 }}>{folder.label}</Text>
        {assets.length > 0 && <Text size="xs" c="dimmed">{assets.length}</Text>}
      </div>

      {open && (
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', marginLeft: 22 }}>
          {loading ? (
            <Text size="xs" c="dimmed" style={{ padding: '6px 14px' }}>加载中...</Text>
          ) : assets.length === 0 ? (
            <Text size="xs" c="dimmed" style={{ padding: '8px 14px' }}>该文件夹暂无素材</Text>
          ) : (
            assets.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                onApplyToCanvas={onApplyToCanvas}
                onRename={onRename}
                onDelete={onDelete}
                onCopy={onCopy}
                onMove={onMove}
                onToggleFavorite={onToggleFavorite}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

// ── Custom folder row (for material_folders) ───────────────────────────────

function CustomFolderRow({
  folder,
  assets,
  loading,
  onApplyToCanvas,
  onRename,
  onDelete,
  onCopy,
  onMove,
  onToggleFavorite,
  onDeleteFolder,
}: {
  folder: MaterialFolderDto
  assets: MaterialAssetDto[]
  loading: boolean
  onApplyToCanvas: (asset: MaterialAssetDto) => void
  onRename: (asset: MaterialAssetDto, newName: string) => void
  onDelete: (asset: MaterialAssetDto) => void
  onCopy: (asset: MaterialAssetDto) => void
  onMove: (asset: MaterialAssetDto) => void
  onToggleFavorite: (asset: MaterialAssetDto) => void
  onDeleteFolder: (folder: MaterialFolderDto) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const cover = assets.find((a) => !!getAssetImageUrl(a))
  const coverUrl = cover ? getAssetImageUrl(cover) : ''

  return (
    <>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <IconChevronRight
          size={14}
          style={{
            flexShrink: 0, opacity: 0.5,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
        {coverUrl ? (
          <ManagedImage
            className="material-library-panel__folder-thumb"
            src={coverUrl}
            alt={folder.name}
            priority="visible"
            style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <IconFolderFilled size={22} style={{ opacity: 0.5, flexShrink: 0 }} />
        )}
        <Text size="sm" style={{ flex: 1 }}>{folder.name}</Text>
        {assets.length > 0 && <Text size="xs" c="dimmed">{assets.length}</Text>}
        {folder.scope !== 'official' && <Menu shadow="md" position="right-start" withinPortal zIndex={1000} opened={menuOpen} onChange={setMenuOpen}>
          <Menu.Target>
            <ActionIcon
              size={18}
              variant="subtle"
              radius="sm"
              style={{ flexShrink: 0, opacity: 0.6 }}
              onClick={(e) => e.stopPropagation()}
            >
              <IconDots size={12} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconTrash size={13} />}
              color="red"
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder) }}
            >
              删除文件夹
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>}
      </div>

      {open && (
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.07)', marginLeft: 22 }}>
          {loading ? (
            <Text size="xs" c="dimmed" style={{ padding: '6px 14px' }}>加载中...</Text>
          ) : assets.length === 0 ? (
            <Text size="xs" c="dimmed" style={{ padding: '8px 14px' }}>该文件夹暂无素材</Text>
          ) : (
            assets.map((asset) => (
              <AssetRow
                key={asset.id}
                asset={asset}
                onApplyToCanvas={onApplyToCanvas}
                onRename={onRename}
                onDelete={onDelete}
                onCopy={onCopy}
                onMove={onMove}
                onToggleFavorite={onToggleFavorite}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

// ── Select folder modal (upload & move) ────────────────────────────────────

function FolderSelectModal({
  open,
  title = '选择文件夹',
  excludeKind,
  onClose,
  onConfirm,
}: {
  open: boolean
  title?: string
  excludeKind?: MaterialKindDto
  onClose: () => void
  onConfirm: (kind: MaterialKindDto) => void
}) {
  const [selected, setSelected] = React.useState<MaterialKindDto | null>(null)
  const folders = FOLDER_DEFS.filter((f) => f.kind !== excludeKind)

  React.useEffect(() => {
    if (open) setSelected(null)
  }, [open])

  return (
    <Modal
      opened={open}
      onClose={onClose}
      zIndex={1000}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconFolderFilled size={16} style={{ opacity: 0.6 }} />
          <span>{title}</span>
        </div>
      }
      size="sm"
      radius="md"
      centered
    >
      {folders.map((f) => (
        <div
          key={f.kind}
          onClick={() => setSelected(f.kind)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
            background: selected === f.kind ? 'rgba(122,129,140,0.15)' : 'transparent',
            outline: selected === f.kind ? '1px solid rgba(122,129,140,0.4)' : '1px solid transparent',
          }}
          onMouseEnter={(e) => { if (selected !== f.kind)(e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.05)' }}
          onMouseLeave={(e) => { if (selected !== f.kind)(e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
        >
          <IconFolderFilled size={18} style={{ opacity: 0.6, flexShrink: 0 }} />
          <Text size="sm" style={{ flex: 1 }}>{f.label}</Text>
          <IconChevronRight size={12} style={{ opacity: 0.4 }} />
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <div />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="default" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!selected} onClick={() => selected && onConfirm(selected)}>确认</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── New folder modal ────────────────────────────────────────────────────────

function NewFolderModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setName('')
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  const handleConfirm = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    onClose()
  }

  return (
    <Modal
      opened={open}
      onClose={onClose}
      zIndex={1000}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconFolderPlus size={16} style={{ opacity: 0.6 }} />
          <span>新建文件夹</span>
        </div>
      }
      size="sm"
      radius="md"
      centered
    >
      <TextInput
        ref={inputRef}
        placeholder="文件夹名称"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleConfirm()
          if (e.key === 'Escape') onClose()
        }}
        mb={16}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="default" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" disabled={!name.trim()} onClick={handleConfirm}>创建</Button>
      </div>
    </Modal>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function MaterialLibraryPanel({ className, variant = 'floating' }: { className?: string; variant?: 'floating' | 'drawer' }) {
  const isDrawer = variant === 'drawer'
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const panelAnchorX = useUIStore((s) => s.panelAnchorX)
  const assetManagerOpen = useUIStore((s) => s.assetManagerOpen)
  const assetManagerTab = useUIStore((s) => s.assetManagerTab)
  const currentProject = useUIStore((s) => s.currentProject)
  const addNode = useRFStore((s) => s.addNode)
  // 抽屉模式下由抽屉开合 + tab 决定打开；浮动模式沿用 activePanel。
  const panelOpen = isDrawer ? (assetManagerOpen && assetManagerTab === 'assets') : activePanel === 'project-materials'

  const activeTeamId = useActiveTeamId()
  const teamId = activeTeamId ?? currentProject?.teamId ?? null

  const [tab, setTab] = React.useState<'project' | 'personal' | 'team'>('project')
  const [favoritesOnly, setFavoritesOnly] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [assets, setAssets] = React.useState<MaterialAssetDto[]>([])
  const [projectAssets, setProjectAssets] = React.useState<MaterialAssetDto[]>([])
  const [teamAssets, setTeamAssets] = React.useState<MaterialAssetDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [projectLoading, setProjectLoading] = React.useState(false)
  const [teamLoading, setTeamLoading] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [folderSelectOpen, setFolderSelectOpen] = React.useState(false)
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [libraryModalOpen, setLibraryModalOpen] = React.useState(false)
  const [pendingUploadKind, setPendingUploadKind] = React.useState<MaterialKindDto | null>(null)
  const [movingAsset, setMovingAsset] = React.useState<MaterialAssetDto | null>(null)
  const [folders, setFolders] = React.useState<MaterialFolderDto[]>([])
  const [teamFolders, setTeamFolders] = React.useState<MaterialFolderDto[]>([])
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const projectId = currentProject?.id || null

  React.useEffect(() => {
    if (!panelOpen || !projectId) return
    setProjectLoading(true)
    listMaterialAssets({ projectId })
      .then(setProjectAssets)
      .catch(() => setProjectAssets([]))
      .finally(() => setProjectLoading(false))
  }, [panelOpen, projectId])

  // Load personal assets when panel opens (account-scoped, not project-scoped)
  React.useEffect(() => {
    if (!panelOpen) return
    setLoading(true)
    Promise.all([
      listMaterialAssets(),
      listMaterialFolders(),
    ])
      .then(([a, f]) => { setAssets(a); setFolders(f) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [panelOpen])

  // Load team assets when switching to team tab
  React.useEffect(() => {
    if (!panelOpen || tab !== 'team' || !teamId) return
    setTeamLoading(true)
    Promise.all([
      listTeamMaterialAssets({ teamId }),
      listMaterialFolders({ teamId }),
    ])
      .then(([a, f]) => { setTeamAssets(a); setTeamFolders(f) })
      .catch(() => {})
      .finally(() => setTeamLoading(false))
  }, [panelOpen, tab, teamId])

  const reload = React.useCallback(() => {
    if (tab === 'project' && projectId) {
      setProjectLoading(true)
      listMaterialAssets({ projectId })
        .then(setProjectAssets)
        .catch(() => setProjectAssets([]))
        .finally(() => setProjectLoading(false))
    } else if (tab === 'team' && teamId) {
      setTeamLoading(true)
      Promise.all([
        listTeamMaterialAssets({ teamId }),
        listMaterialFolders({ teamId }),
      ])
        .then(([a, f]) => { setTeamAssets(a); setTeamFolders(f) })
        .catch(() => {})
        .finally(() => setTeamLoading(false))
    } else {
      setLoading(true)
      Promise.all([
        listMaterialAssets(),
        listMaterialFolders(),
      ])
        .then(([a, f]) => { setAssets(a); setFolders(f) })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [projectId, tab, teamId])

  const handleApplyToCanvas = React.useCallback((asset: MaterialAssetDto) => {
    if (!projectId) { toast('当前项目缺少有效 ID', 'error'); return }
    try {
      const nodeData = buildMaterialAssetCanvasNodeData({ asset, targetProjectId: projectId })
      addNode('taskNode', nodeData.label, nodeData)
      toast(`已将「${asset.name}」关联到当前项目画布`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '素材无法应用到当前项目', 'error')
    }
  }, [addNode, projectId])

  const handleRename = React.useCallback(async (asset: MaterialAssetDto, newName: string) => {
    try {
      await updateMaterialAsset(asset.id, { name: newName })
      reload()
    } catch {
      toast('重命名失败', 'error')
    }
  }, [reload])

  const handleDelete = React.useCallback(async (asset: MaterialAssetDto) => {
    try {
      await deleteMaterialAsset(asset.id)
      reload()
      toast(`已删除「${asset.name}」`, 'success')
    } catch {
      toast('删除失败', 'error')
    }
  }, [reload])

  const handleMove = React.useCallback(async (asset: MaterialAssetDto, targetKind: MaterialKindDto) => {
    const sourceProjectId = asset.projectId || projectId
    if (!sourceProjectId) return
    const imageUrl = getAssetImageUrl(asset)
    try {
      await createMaterialAsset({ projectId: sourceProjectId, kind: targetKind, name: asset.name, initialData: { imageUrl } })
      await deleteMaterialAsset(asset.id)
      reload()
      const targetLabel = FOLDER_DEFS.find((f) => f.kind === targetKind)?.label || targetKind
      toast(`已移动到「${targetLabel}」`, 'success')
    } catch {
      toast('移动失败，请重试', 'error')
    } finally {
      setMovingAsset(null)
    }
  }, [projectId, reload])

  const handleCopy = React.useCallback(async (asset: MaterialAssetDto) => {
    const sourceProjectId = asset.projectId || projectId
    if (!sourceProjectId) return
    const imageUrl = getAssetImageUrl(asset)
    try {
      await createMaterialAsset({
        projectId: sourceProjectId,
        kind: asset.kind,
        name: `${asset.name} 副本`,
        initialData: { imageUrl },
      })
      reload()
      toast('已创建副本', 'success')
    } catch {
      toast('创建副本失败', 'error')
    }
  }, [projectId, reload])

  const handleToggleFavorite = React.useCallback(async (asset: MaterialAssetDto) => {
    const next = !asset.favorite
    // 乐观更新；失败回滚
    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, favorite: next } : a)))
    try {
      await updateMaterialAsset(asset.id, { favorite: next })
    } catch {
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, favorite: !next } : a)))
      toast('收藏操作失败', 'error')
    }
  }, [])

  const handleUploadFolderConfirm = React.useCallback((kind: MaterialKindDto) => {
    setPendingUploadKind(kind)
    setFolderSelectOpen(false)
    setTimeout(() => fileInputRef.current?.click(), 60)
  }, [])

  const handleFileChange = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pendingUploadKind) return
    e.target.value = ''
    setUploading(true)
    try {
      const uploaded = await uploadServerAssetFile(file, file.name, projectId ? { projectId } : undefined)
      const uploadedData = uploaded.data && typeof uploaded.data === 'object'
        ? uploaded.data as Record<string, unknown>
        : undefined
      const imageUrl = String(uploadedData?.url || uploadedData?.fileUrl || '').trim()
      if (!imageUrl) throw new Error('upload returned no url')
      if (tab === 'team' && teamId) {
        await createTeamMaterialAsset({
          teamId,
          kind: pendingUploadKind,
          name: file.name.replace(/\.[^.]+$/, ''),
          initialData: { imageUrl },
        })
      } else {
        await createMaterialAsset({
          ...(projectId ? { projectId } : {}),
          kind: pendingUploadKind,
          name: file.name.replace(/\.[^.]+$/, ''),
          initialData: { imageUrl },
        })
      }
      toast('上传成功', 'success')
      reload()
    } catch {
      toast('上传失败，请重试', 'error')
    } finally {
      setUploading(false)
      setPendingUploadKind(null)
    }
  }, [pendingUploadKind, projectId, teamId, tab, reload])

  const handleCreateFolder = React.useCallback(async (name: string) => {
    try {
      if (tab === 'team' && teamId) {
        const folder = await createMaterialFolder({ teamId, name })
        setTeamFolders((prev) => [...prev, folder])
      } else {
        const folder = await createMaterialFolder({ name })
        setFolders((prev) => [...prev, folder])
      }
      toast(`已创建文件夹「${name}」`, 'success')
    } catch {
      toast('创建文件夹失败', 'error')
    }
  }, [tab, teamId])

  const handleDeleteFolder = React.useCallback(async (folder: MaterialFolderDto) => {
    try {
      await deleteMaterialFolder(folder.id)
      if (tab === 'team') {
        setTeamFolders((prev) => prev.filter((f) => f.id !== folder.id))
      } else {
        setFolders((prev) => prev.filter((f) => f.id !== folder.id))
      }
      toast(`已删除文件夹「${folder.name}」`, 'success')
    } catch {
      toast('删除文件夹失败', 'error')
    }
  }, [tab])

  const q = query.trim().toLowerCase()

  const currentAssets = tab === 'project' ? projectAssets : tab === 'team' ? teamAssets : assets
  const currentFolders = tab === 'project' ? [] : tab === 'team' ? teamFolders : folders
  const currentLoading = tab === 'project' ? projectLoading : tab === 'team' ? teamLoading : loading

  const filteredAssets = q
    ? currentAssets.filter((asset) =>
        asset.name.toLowerCase().includes(q)
        || asset.origin?.ownerId.toLowerCase().includes(q),
      )
    : currentAssets

  if (!panelOpen) return null

  const showTeamTab = !!teamId

  const floatingStyle: React.CSSProperties = {
    ...bottomBarPanelStyle(panelAnchorX, { zIndex: 200, halfWidth: 140 }),
    width: 280,
    height: 'min(520px, calc(100vh - 80px))',
    overflow: 'hidden',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
  }
  const drawerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    padding: 0,
    background: 'transparent',
    border: 'none',
    boxShadow: 'none',
    borderRadius: 0,
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <PanelCard
        className={['material-library-panel', isDrawer ? 'material-library-panel--drawer' : '', className].filter(Boolean).join(' ')}
        onWheel={stopPanelWheelPropagation}
        style={isDrawer ? drawerStyle : floatingStyle}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 8px', flexShrink: 0 }}>
          <Text size="sm" fw={600} style={{ flex: 1 }}>素材库</Text>
          {isDrawer ? (
            // 抽屉内保留「展开」「上传」入口；新建文件夹/关闭由抽屉自身 chrome 承载。
            <>
              <ActionIcon
                variant="subtle"
                size={26}
                radius="md"
                aria-label="展开素材库"
                title="弹窗查看 / 管理素材库"
                onClick={() => setLibraryModalOpen(true)}
              >
                <IconArrowsDiagonal size={15} />
              </ActionIcon>
              {tab !== 'project' && <ActionIcon
                variant="subtle"
                size={26}
                radius="md"
                loading={uploading}
                aria-label="上传素材"
                title="上传素材"
                onClick={() => setFolderSelectOpen(true)}
              >
                <IconUpload size={15} />
              </ActionIcon>}
            </>
          ) : (
            <>
              <ActionIcon
                variant="subtle"
                size={26}
                radius="md"
                aria-label="展开素材库"
                title="弹窗查看 / 管理素材库"
                onClick={() => setLibraryModalOpen(true)}
              >
                <IconArrowsDiagonal size={15} />
              </ActionIcon>
              {tab !== 'project' && <Menu shadow="md" position="bottom-end" withinPortal zIndex={1000}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size={26} radius="md" loading={uploading} aria-label="新建">
                    <IconPlus size={15} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconUpload size={14} />} onClick={() => setFolderSelectOpen(true)}>
                    上传
                  </Menu.Item>
                  <Menu.Item leftSection={<IconFolderPlus size={14} />} onClick={() => setNewFolderOpen(true)}>
                    新建文件夹
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>}
              <ActionIcon variant="subtle" size={26} radius="md" aria-label="关闭" onClick={() => setActivePanel(null)}>
                <IconX size={14} />
              </ActionIcon>
            </>
          )}
        </div>

        <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
          <SegmentedControl
            fullWidth size="xs"
            data={[
              { value: 'project', label: '当前项目' },
              { value: 'personal', label: '个人' },
              ...(showTeamTab ? [{ value: 'team', label: '团队' }] : []),
            ]}
            value={tab}
            onChange={(v) => setTab(v as 'project' | 'personal' | 'team')}
          />
        </div>

        {/* Search */}
        <div style={{ padding: '0 12px 8px', flexShrink: 0 }}>
          <TextInput
            size="xs"
            placeholder="搜索"
            leftSection={<IconSearch size={13} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        {/* Scroll body */}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <>
            {/* Favorites row — personal only：点击切换「只看收藏」 */}
            {tab === 'personal' && (
              <div
                onClick={() => setFavoritesOnly((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', borderRadius: 8, background: favoritesOnly ? 'rgba(255,255,255,0.08)' : 'transparent' }}
                onMouseEnter={(e) => { if (!favoritesOnly) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
                onMouseLeave={(e) => { if (!favoritesOnly) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                <IconStar size={18} style={{ opacity: 0.85, color: '#fbbf24', flexShrink: 0 }} fill={favoritesOnly ? '#fbbf24' : 'none'} />
                <Text size="sm" fw={favoritesOnly ? 600 : 400} style={{ flex: 1 }}>收藏</Text>
              </div>
            )}

            <div style={{ margin: '2px 14px 6px', borderBottom: '1px solid rgba(255,255,255,0.07)' }} />
            <Text size="xs" c="dimmed" style={{ padding: '0 14px 4px' }}>{tab === 'project' ? '项目与章节节点' : favoritesOnly ? '已收藏' : '文件夹'}</Text>

            {q ? (
              filteredAssets.length === 0 ? (
                <Text size="xs" c="dimmed" style={{ padding: '8px 14px' }}>无匹配素材</Text>
              ) : (
                filteredAssets.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onApplyToCanvas={handleApplyToCanvas}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onMove={(a) => setMovingAsset(a)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))
              )
            ) : tab === 'personal' && favoritesOnly ? (
              currentAssets.filter((a) => a.favorite).length === 0 ? (
                <Text size="xs" c="dimmed" style={{ padding: '8px 14px' }}>暂无收藏素材</Text>
              ) : (
                currentAssets.filter((a) => a.favorite).map((asset) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    onApplyToCanvas={handleApplyToCanvas}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onMove={(a) => setMovingAsset(a)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))
              )
            ) : (
              <>
                {/* Fixed kind-based folders (personal only) or team kind folders */}
                {FOLDER_DEFS.map((f) => (
                  <FolderRow
                    key={f.kind}
                    folder={f}
                    assets={currentAssets.filter((a) => a.kind === f.kind && !a.folderId)}
                    loading={currentLoading}
                    onApplyToCanvas={handleApplyToCanvas}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onMove={(a) => setMovingAsset(a)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}

                {/* Custom folders */}
                {currentFolders.map((folder) => (
                  <CustomFolderRow
                    key={folder.id}
                    folder={folder}
                    assets={currentAssets.filter((a) => a.folderId === folder.id)}
                    loading={currentLoading}
                    onApplyToCanvas={handleApplyToCanvas}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onCopy={handleCopy}
                    onMove={(a) => setMovingAsset(a)}
                    onToggleFavorite={handleToggleFavorite}
                    onDeleteFolder={handleDeleteFolder}
                  />
                ))}
              </>
            )}

            {currentLoading && !q && (
              <Text size="xs" c="dimmed" style={{ padding: '6px 14px' }}>加载中...</Text>
            )}
          </>
        </div>
      </PanelCard>

      {tab !== 'project' && <FolderSelectModal
        open={folderSelectOpen}
        onClose={() => setFolderSelectOpen(false)}
        onConfirm={handleUploadFolderConfirm}
      />}

      <FolderSelectModal
        open={movingAsset !== null}
        title="移动到..."
        excludeKind={movingAsset?.kind}
        onClose={() => setMovingAsset(null)}
        onConfirm={(kind) => { if (movingAsset) handleMove(movingAsset, kind) }}
      />

      {tab !== 'project' && <NewFolderModal
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onConfirm={handleCreateFolder}
      />}

      <MaterialLibraryModal
        opened={libraryModalOpen}
        onClose={() => setLibraryModalOpen(false)}
        assets={currentAssets}
        folders={currentFolders}
        loading={currentLoading}
        tab={tab}
        onTabChange={setTab}
        showTeamTab={showTeamTab}
        uploading={uploading}
        onApplyToCanvas={handleApplyToCanvas}
        onRename={handleRename}
        onDelete={handleDelete}
        onCopy={handleCopy}
        onMove={(a) => setMovingAsset(a)}
        onToggleFavorite={handleToggleFavorite}
        onDeleteFolder={handleDeleteFolder}
        onUploadClick={() => setFolderSelectOpen(true)}
        onNewFolderClick={() => setNewFolderOpen(true)}
        onRefresh={reload}
      />
    </>
  )
}
