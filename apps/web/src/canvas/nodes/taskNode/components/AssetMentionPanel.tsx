import React from 'react'
import { Text, Portal } from '@mantine/core'
import { IconSearch, IconFolderFilled, IconChevronRight } from '@tabler/icons-react'
import { listMaterialAssets, type MaterialAssetDto, type MaterialKindDto } from '../../../../api/server'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import type { MentionSuggestionItem } from './PromptSection'

type PanelPosition = { left: number; top: number; width: number }

const FOLDER_DEFS: { kind: MaterialKindDto; label: string }[] = [
  { kind: 'character', label: '角色' },
  { kind: 'scene', label: '场景' },
  { kind: 'prop', label: '道具' },
  { kind: 'style', label: '风格' },
  { kind: 'text', label: 'Others' },
]

function assetToMentionItem(asset: MaterialAssetDto): MentionSuggestionItem {
  const data = asset.latestVersion?.data || {}
  const imageUrl = [data.imageUrl, data.referenceImageUrl, data.previewUrl, data.thumbnailUrl, data.url]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?.trim() || ''
  const username = asset.name.toLowerCase().replace(/[^a-z0-9一-龥-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `asset-${asset.id.slice(0, 6)}`
  return {
    username,
    display_name: asset.name,
    profile_picture_url: imageUrl || null,
    source: 'asset',
    nodeId: null,
    mentionAliases: [asset.id, asset.latestVersion?.id || '', String(data.assetRefId || '')],
    assetBinding: {
      url: imageUrl,
      assetId: asset.id,
      assetRefId: username,
      assetName: asset.name,
      role: asset.kind === 'style' ? 'style' : 'reference',
    },
  }
}

type AssetMentionPanelProps = {
  open: boolean
  position: PanelPosition | null
  projectId: string
  /** Items from canvas nodes (characters etc.) – still shown in search results */
  baseItems: MentionSuggestionItem[]
  onApply: (item: MentionSuggestionItem) => void
  onClose: () => void
  isDarkUi: boolean
  panelActiveRef: React.MutableRefObject<boolean>
}

export function AssetMentionPanel({
  open,
  position,
  projectId,
  baseItems,
  onApply,
  onClose,
  isDarkUi,
  panelActiveRef,
}: AssetMentionPanelProps) {
  const searchRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [filter, setFilter] = React.useState('')
  const [assets, setAssets] = React.useState<MaterialAssetDto[]>([])
  const [loadingAssets, setLoadingAssets] = React.useState(false)
  const [openFolder, setOpenFolder] = React.useState<MaterialKindDto | null>(null)

  // Load all assets when panel opens (account-scoped personal materials)
  React.useEffect(() => {
    if (!open) return
    setLoadingAssets(true)
    listMaterialAssets()
      .then(setAssets)
      .catch(() => {})
      .finally(() => setLoadingAssets(false))
  }, [open])

  // Auto-focus search on open, set active ref
  React.useEffect(() => {
    if (open) {
      setFilter('')
      setOpenFolder(null)
      panelActiveRef.current = true
      const t = setTimeout(() => searchRef.current?.focus(), 30)
      return () => clearTimeout(t)
    } else {
      panelActiveRef.current = false
    }
  }, [open, panelActiveRef])

  // Close on outside click (capture phase so it fires before inner handlers)
  React.useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      panelActiveRef.current = false
      onClose()
    }
    document.addEventListener('mousedown', handle, true)
    return () => document.removeEventListener('mousedown', handle, true)
  }, [open, onClose, panelActiveRef])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { panelActiveRef.current = false; onClose() }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, onClose, panelActiveRef])

  const bg = isDarkUi ? 'rgba(18,18,22,0.97)' : '#fff'
  const border = isDarkUi ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.1)'
  const hoverBg = isDarkUi ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
  const activeBg = 'rgba(122,129,140,0.15)'
  const dimmed = isDarkUi ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)'
  const textColor = isDarkUi ? '#fff' : '#111'

  const q = filter.trim().toLowerCase()

  // Assets for current folder or search mode
  const folderAssets = React.useMemo(() => {
    if (!q && !openFolder) return []
    return assets.filter((a) => {
      const matchKind = openFolder ? a.kind === openFolder : true
      const matchQ = q ? a.name.toLowerCase().includes(q) : true
      return matchKind && matchQ
    })
  }, [assets, q, openFolder])

  // Base items filtered by search
  const filteredBase = React.useMemo(() => {
    if (!q) return []
    return baseItems.filter((item) => {
      const name = (item.display_name || item.username || '').toLowerCase()
      const uname = (item.username || '').toLowerCase()
      return name.includes(q) || uname.includes(q)
    }).slice(0, 6)
  }, [baseItems, q])

  const showSearch = q.length > 0
  const showFolderContents = !showSearch && openFolder !== null
  const showFolderList = !showSearch && openFolder === null

  const folderKindLabel = FOLDER_DEFS.find((f) => f.kind === openFolder)?.label || ''

  if (!open || !position) return null

  return (
    <Portal>
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          left: position.left,
          top: position.top,
          width: position.width,
          background: bg,
          border,
          borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
          zIndex: 1400,
          overflow: 'hidden',
          maxHeight: 320,
          display: 'flex',
          flexDirection: 'column',
        }}
        onMouseDown={(e) => {
          // Prevent editor blur when clicking inside panel (except native input)
          if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
        }}
      >
        {/* Search input */}
        <div style={{ padding: '8px 10px', borderBottom: border }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconSearch size={13} style={{ color: dimmed, flexShrink: 0 }} />
            <input
              ref={searchRef}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setOpenFolder(null)
              }}
              placeholder="搜索素材..."
              onFocus={() => { panelActiveRef.current = true }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: 13,
                color: textColor,
                padding: 0,
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Folder list view */}
          {showFolderList && (
            <>
              {(() => {
                const connectedItems = baseItems.filter((item) => item.isConnected === true)
                if (connectedItems.length === 0) return null
                return (
                  <>
                    <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>已连接节点</div>
                    {connectedItems.slice(0, 8).map((item) => (
                      <AssetRow
                        key={item.username}
                        item={item}
                        onApply={onApply}
                        activeBg={activeBg}
                        hoverBg={hoverBg}
                        textColor={textColor}
                        dimmed={dimmed}
                      />
                    ))}
                    <div style={{ margin: '6px 10px 0', borderTop: `1px solid ${isDarkUi ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'}` }} />
                  </>
                )
              })()}
              <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>个人素材库</div>
              {FOLDER_DEFS.map((f) => {
                const count = assets.filter((a) => a.kind === f.kind).length
                return (
                  <div
                    key={f.kind}
                    onMouseDown={(e) => { e.preventDefault(); setOpenFolder(f.kind) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 12px', cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = hoverBg }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    <IconFolderFilled size={16} style={{ opacity: 0.65, flexShrink: 0 }} />
                    <Text size="sm" style={{ flex: 1, color: textColor }}>{f.label}</Text>
                    {count > 0 && <Text size="xs" style={{ color: dimmed }}>{count}</Text>}
                    <IconChevronRight size={12} style={{ color: dimmed, flexShrink: 0 }} />
                  </div>
                )
              })}
              {loadingAssets && (
                <Text size="xs" style={{ color: dimmed, padding: '6px 12px' }}>加载中...</Text>
              )}
              {/* Team section */}
              <div style={{ margin: '6px 10px 0', borderTop: `1px solid ${isDarkUi ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'}` }} />
              <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>团队素材库</div>
              <Text size="xs" style={{ color: dimmed, padding: '4px 12px 8px' }}>暂无团队素材</Text>
            </>
          )}

          {/* Folder contents view */}
          {showFolderContents && (
            <>
              <div
                style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                onMouseDown={(e) => { e.preventDefault(); setOpenFolder(null) }}
              >
                <IconChevronRight size={11} style={{ transform: 'rotate(180deg)' }} />
                {folderKindLabel}
              </div>
              {folderAssets.length === 0 && !loadingAssets && (
                <Text size="xs" style={{ color: dimmed, padding: '8px 12px' }}>暂无素材</Text>
              )}
              {folderAssets.map((asset) => {
                const item = assetToMentionItem(asset)
                return <AssetRow key={asset.id} item={item} onApply={onApply} activeBg={activeBg} hoverBg={hoverBg} textColor={textColor} dimmed={dimmed} />
              })}
            </>
          )}

          {/* Search results view */}
          {showSearch && (
            <>
              {(() => {
                const connected = filteredBase.filter((item) => item.isConnected === true)
                const others = filteredBase.filter((item) => item.isConnected !== true)
                return (
                  <>
                    {connected.length > 0 && (
                      <>
                        <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>已连接节点</div>
                        {connected.map((item) => (
                          <AssetRow key={item.username} item={item} onApply={onApply} activeBg={activeBg} hoverBg={hoverBg} textColor={textColor} dimmed={dimmed} />
                        ))}
                      </>
                    )}
                    {others.length > 0 && (
                      <>
                        <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>其它引用</div>
                        {others.map((item) => (
                          <AssetRow key={item.username} item={item} onApply={onApply} activeBg={activeBg} hoverBg={hoverBg} textColor={textColor} dimmed={dimmed} />
                        ))}
                      </>
                    )}
                  </>
                )
              })()}
              {folderAssets.length > 0 && (
                <>
                  <div style={{ padding: '6px 10px 2px', fontSize: 11, color: dimmed }}>个人素材库</div>
                  {folderAssets.map((asset) => {
                    const kindLabel = FOLDER_DEFS.find((f) => f.kind === asset.kind)?.label || ''
                    const item = assetToMentionItem(asset)
                    return (
                      <AssetRow
                        key={asset.id}
                        item={item}
                        subLabel={`/${kindLabel}`}
                        onApply={onApply}
                        activeBg={activeBg}
                        hoverBg={hoverBg}
                        textColor={textColor}
                        dimmed={dimmed}
                      />
                    )
                  })}
                </>
              )}
              {filteredBase.length === 0 && folderAssets.length === 0 && !loadingAssets && (
                <Text size="xs" style={{ color: dimmed, padding: '8px 12px' }}>无匹配素材</Text>
              )}
              {loadingAssets && (
                <Text size="xs" style={{ color: dimmed, padding: '6px 12px' }}>加载中...</Text>
              )}
            </>
          )}
        </div>
      </div>
    </Portal>
  )
}

function AssetRow({
  item, subLabel, onApply, activeBg, hoverBg, textColor, dimmed,
}: {
  item: MentionSuggestionItem
  subLabel?: string
  onApply: (item: MentionSuggestionItem) => void
  activeBg: string
  hoverBg: string
  textColor: string
  dimmed: string
}) {
  const [hovered, setHovered] = React.useState(false)
  const avatar = item.profile_picture_url || null
  return (
    <div
      onMouseDown={(e) => { e.preventDefault(); onApply(item) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', cursor: 'pointer',
        background: hovered ? activeBg : 'transparent',
      }}
    >
      {avatar ? (
        <ManagedImage
          className="asset-mention-panel__thumb"
          src={avatar}
          alt={item.display_name}
          priority="visible"
          style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 28, height: 28, borderRadius: 6, background: hoverBg, flexShrink: 0 }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Text size="sm" lineClamp={1} style={{ color: textColor }}>{item.display_name}</Text>
        {subLabel && <Text size="xs" lineClamp={1} style={{ color: dimmed }}>{subLabel}</Text>}
      </div>
    </div>
  )
}
