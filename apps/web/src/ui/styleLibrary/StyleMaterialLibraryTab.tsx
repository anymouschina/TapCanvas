import React from 'react'
import { Center, SegmentedControl, Text, TextInput } from '@mantine/core'
import { IconCheck, IconChevronRight, IconFolderFilled, IconSearch } from '@tabler/icons-react'
import {
  listMaterialAssets,
  listTeamMaterialAssets,
  listMaterialFolders,
  type MaterialAssetDto,
  type MaterialFolderDto,
} from '../../api/server'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { FOLDER_DEFS, getAssetImageUrl } from '../MaterialLibraryPanel'
import { useActiveTeamId } from '../team/TeamManagementModal'
import type { LockedStyle } from '../../canvas/projectImageSettingsStore'

// 风格库弹窗的「素材库」来源页：浏览个人/团队素材（文件夹分组+搜索），
// 点选素材图即锁定为全局风格（styleId = material:<assetId>，走既有单轨 setLockedStyle）。
export const MATERIAL_STYLE_ID_PREFIX = 'material:'

function assetToLockedStyle(asset: MaterialAssetDto, url: string): LockedStyle {
  return {
    styleId: `${MATERIAL_STYLE_ID_PREFIX}${asset.id}`,
    styleName: asset.name || '素材风格',
    referenceImageUrl: url,
    stylePrompt: '',
  }
}

function AssetThumb({
  asset,
  selected,
  onSelect,
}: {
  asset: MaterialAssetDto
  selected: boolean
  onSelect: () => void
}) {
  const url = getAssetImageUrl(asset)
  if (!url) return null
  return (
    <div
      onClick={onSelect}
      title={asset.name}
      style={{
        position: 'relative', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden',
        cursor: 'pointer',
        border: `2px solid ${selected ? 'var(--mantine-color-violet-5)' : 'transparent'}`,
        background: 'rgba(128,128,128,0.08)', flexShrink: 0,
      }}
    >
      <ManagedImage
        className="style-material-tab__asset-thumb"
        src={url} alt={asset.name} priority="visible"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      <div
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '2px 4px', fontSize: 10, lineHeight: '14px', color: '#fff',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {asset.name}
      </div>
      {selected && (
        <div style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 999, background: 'var(--mantine-color-violet-6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconCheck size={12} color="white" />
        </div>
      )}
    </div>
  )
}

function FolderSection({
  label,
  assets,
  selectedStyleId,
  defaultOpen,
  onPick,
}: {
  label: string
  assets: MaterialAssetDto[]
  selectedStyleId: string | null
  defaultOpen?: boolean
  onPick: (asset: MaterialAssetDto, url: string) => void
}) {
  const [open, setOpen] = React.useState(!!defaultOpen)
  const withImage = assets.filter((a) => getAssetImageUrl(a))
  const coverUrl = withImage.length ? getAssetImageUrl(withImage[0]) : ''

  return (
    <>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderRadius: 6 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(128,128,128,0.08)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <IconChevronRight
          size={14}
          style={{ flexShrink: 0, opacity: 0.4, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        />
        {coverUrl ? (
          <ManagedImage
            className="style-material-tab__folder-thumb"
            src={coverUrl} alt={label} priority="visible"
            style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <IconFolderFilled size={20} style={{ opacity: 0.45, flexShrink: 0 }} />
        )}
        <Text size="sm" style={{ flex: 1 }}>{label}</Text>
        {withImage.length > 0 && <Text size="xs" c="dimmed">{withImage.length}</Text>}
      </div>

      {open && (
        <div style={{ padding: '4px 12px 8px 40px' }}>
          {withImage.length === 0 ? (
            <Text size="xs" c="dimmed" style={{ padding: '6px 0' }}>该文件夹暂无素材</Text>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {withImage.map((asset) => (
                <AssetThumb
                  key={asset.id}
                  asset={asset}
                  selected={selectedStyleId === `${MATERIAL_STYLE_ID_PREFIX}${asset.id}`}
                  onSelect={() => onPick(asset, getAssetImageUrl(asset))}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export function StyleMaterialLibraryTab({
  selectedStyleId,
  onPick,
}: {
  selectedStyleId: string | null
  onPick: (lock: LockedStyle) => void
}) {
  const activeTeamId = useActiveTeamId()
  const [scope, setScope] = React.useState<'personal' | 'team'>('personal')
  const [query, setQuery] = React.useState('')
  const [assets, setAssets] = React.useState<MaterialAssetDto[]>([])
  const [teamAssets, setTeamAssets] = React.useState<MaterialAssetDto[]>([])
  const [personalFolders, setPersonalFolders] = React.useState<MaterialFolderDto[]>([])
  const [teamFolders, setTeamFolders] = React.useState<MaterialFolderDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [teamLoading, setTeamLoading] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    Promise.all([listMaterialAssets(), listMaterialFolders()])
      .then(([nextAssets, nextFolders]) => { setAssets(nextAssets); setPersonalFolders(nextFolders) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    if (scope !== 'team' || !activeTeamId) return
    setTeamLoading(true)
    Promise.all([
      listTeamMaterialAssets({ teamId: activeTeamId }),
      listMaterialFolders({ teamId: activeTeamId }),
    ])
      .then(([a, f]) => { setTeamAssets(a); setTeamFolders(f) })
      .catch(() => {})
      .finally(() => setTeamLoading(false))
  }, [scope, activeTeamId])

  const q = query.trim().toLowerCase()
  const currentAssets = scope === 'team' ? teamAssets : assets
  const filtered = q ? currentAssets.filter((a) => a.name.toLowerCase().includes(q)) : currentAssets
  const currentLoading = scope === 'team' ? teamLoading : loading

  const handlePick = React.useCallback(
    (asset: MaterialAssetDto, url: string) => {
      if (!url) return
      onPick(assetToLockedStyle(asset, url))
    },
    [onPick],
  )

  return (
    <div className="style-material-tab" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {activeTeamId && (
        <SegmentedControl
          fullWidth size="xs"
          data={[{ value: 'personal', label: '个人素材' }, { value: 'team', label: '团队素材' }]}
          value={scope}
          onChange={(v) => setScope(v as 'personal' | 'team')}
        />
      )}
      <TextInput
        size="xs"
        placeholder="搜索素材"
        leftSection={<IconSearch size={13} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <div style={{ height: 380, overflowY: 'auto' }}>
        {currentLoading ? (
          <Center h={120}><Text size="xs" c="dimmed">加载素材库…</Text></Center>
        ) : q ? (
          filtered.filter((a) => getAssetImageUrl(a)).length === 0 ? (
            <Center h={120}><Text size="xs" c="dimmed">无匹配素材</Text></Center>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, padding: '4px 0' }}>
              {filtered.map((asset) => {
                const url = getAssetImageUrl(asset)
                if (!url) return null
                return (
                  <AssetThumb
                    key={asset.id} asset={asset}
                    selected={selectedStyleId === `${MATERIAL_STYLE_ID_PREFIX}${asset.id}`}
                    onSelect={() => handlePick(asset, url)}
                  />
                )
              })}
            </div>
          )
        ) : scope === 'team' ? (
          <>
            {FOLDER_DEFS.map((f) => (
              <FolderSection
                key={f.kind}
                label={f.label}
                assets={filtered.filter((a) => a.kind === f.kind && !a.folderId)}
                selectedStyleId={selectedStyleId}
                defaultOpen={f.kind === 'style'}
                onPick={handlePick}
              />
            ))}
            {teamFolders.map((folder) => (
              <FolderSection
                key={folder.id}
                label={folder.name}
                assets={filtered.filter((a) => a.folderId === folder.id)}
                selectedStyleId={selectedStyleId}
                onPick={handlePick}
              />
            ))}
          </>
        ) : (
          <>
            {FOLDER_DEFS.map((f) => (
              <FolderSection
                key={f.kind}
                label={f.label}
                assets={filtered.filter((a) => a.kind === f.kind && !a.folderId)}
                selectedStyleId={selectedStyleId}
                defaultOpen={f.kind === 'style'}
                onPick={handlePick}
              />
            ))}
            {personalFolders.map((folder) => (
              <FolderSection
                key={folder.id}
                label={folder.name}
                assets={filtered.filter((a) => a.folderId === folder.id)}
                selectedStyleId={selectedStyleId}
                defaultOpen={folder.scope === 'official'}
                onPick={handlePick}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
