import React from 'react'
import { Modal, SegmentedControl, TextInput, Text, Button, Group, ActionIcon } from '@mantine/core'
import { IconSearch, IconChevronRight, IconFolderFilled, IconCheck, IconPhoto, IconX } from '@tabler/icons-react'
import {
  listMaterialAssets,
  listTeamMaterialAssets,
  listMaterialFolders,
  type MaterialAssetDto,
  type MaterialKindDto,
  type MaterialFolderDto,
} from '../../../../api/server'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import { useActiveTeamId } from '../../../../ui/team/TeamManagementModal'

const FOLDER_DEFS: { kind: MaterialKindDto; label: string }[] = [
  { kind: 'character', label: '角色' },
  { kind: 'scene', label: '场景' },
  { kind: 'prop', label: '道具' },
  { kind: 'style', label: '风格' },
  { kind: 'text', label: 'Others' },
]

function getAssetImageUrl(asset: MaterialAssetDto): string {
  const data = asset.latestVersion?.data as Record<string, unknown> | null
  if (!data) return ''
  return (
    (typeof data.imageUrl === 'string' && data.imageUrl.trim()) ||
    (typeof data.url === 'string' && data.url.trim()) ||
    (typeof data.thumbnailUrl === 'string' && data.thumbnailUrl.trim()) ||
    ''
  )
}

function AssetThumb({
  asset,
  selected,
  anchored,
  onSelect,
}: {
  asset: MaterialAssetDto
  selected: boolean
  /** 该素材当前已是项目画风锚定图。 */
  anchored?: boolean
  onSelect: () => void
}) {
  const url = getAssetImageUrl(asset)
  return (
    <div
      onClick={onSelect}
      title={anchored ? `${asset.name}（当前画风锚定）` : asset.name}
      style={{
        position: 'relative', aspectRatio: '1/1', borderRadius: 8, overflow: 'hidden',
        cursor: 'pointer',
        border: `2px solid ${selected ? 'var(--mantine-color-blue-5)' : anchored ? 'var(--mantine-color-teal-6)' : 'transparent'}`,
        background: 'rgba(255,255,255,0.06)', flexShrink: 0,
      }}
    >
      {url ? (
        <ManagedImage
          className="style-picker__asset-thumb"
          src={url} alt={asset.name} priority="visible"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text size="xs" c="dimmed">无图</Text>
        </div>
      )}
      {anchored && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(13,148,136,0.85)', textAlign: 'center', fontSize: 10, lineHeight: '15px', color: '#fff' }}>
          锚定中
        </div>
      )}
      {selected && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(122,129,140,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconCheck size={18} color="white" />
        </div>
      )}
    </div>
  )
}

function FolderSection({
  folder,
  assets,
  selectedUrl,
  anchoredUrls,
  onSelect,
}: {
  folder: { label: string }
  assets: MaterialAssetDto[]
  selectedUrl: string | null
  anchoredUrls?: Set<string>
  onSelect: (url: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const cover = assets.find((a) => getAssetImageUrl(a))
  const coverUrl = cover ? getAssetImageUrl(cover) : ''

  return (
    <>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', borderRadius: 6 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
      >
        <IconChevronRight
          size={14}
          style={{ flexShrink: 0, opacity: 0.4, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
        />
        {coverUrl ? (
          <ManagedImage
            className="style-picker__folder-thumb"
            src={coverUrl} alt={folder.label} priority="visible"
            style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <IconFolderFilled size={20} style={{ opacity: 0.45, flexShrink: 0 }} />
        )}
        <Text size="sm" style={{ flex: 1 }}>{folder.label}</Text>
        {assets.length > 0 && <Text size="xs" c="dimmed">{assets.length}</Text>}
      </div>

      {open && (
        <div style={{ padding: '4px 12px 8px 40px' }}>
          {assets.length === 0 ? (
            <Text size="xs" c="dimmed" style={{ padding: '6px 0' }}>该文件夹暂无素材</Text>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {assets.map((asset) => {
                const url = getAssetImageUrl(asset)
                return (
                  <AssetThumb
                    key={asset.id}
                    asset={asset}
                    selected={!!url && selectedUrl === url}
                    anchored={!!url && !!anchoredUrls?.has(url)}
                    onSelect={() => url && onSelect(selectedUrl === url ? '' : url)}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export interface StyleImagePickerModalProps {
  opened: boolean
  onClose: () => void
  onConfirm: (url: string) => void
  projectId: string | null
  teamId?: string | null
  /** 当前已锚定的画风参考（项目「风格」槽 styleImages），用于弹窗内回显。 */
  currentStyleImages?: string[]
  /** 移除某张当前锚定图；移除到空时由调用方整体取消画风锚定（单轨约定）。 */
  onRemoveCurrent?: (url: string) => void
}

export function StyleImagePickerModal({
  opened,
  onClose,
  onConfirm,
  projectId,
  teamId: projectTeamId,
  currentStyleImages,
  onRemoveCurrent,
}: StyleImagePickerModalProps) {
  const activeTeamId = useActiveTeamId()
  const teamId = activeTeamId ?? projectTeamId ?? null
  const [tab, setTab] = React.useState<'personal' | 'team'>('personal')
  const [query, setQuery] = React.useState('')
  const [assets, setAssets] = React.useState<MaterialAssetDto[]>([])
  const [teamAssets, setTeamAssets] = React.useState<MaterialAssetDto[]>([])
  const [teamFolders, setTeamFolders] = React.useState<MaterialFolderDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [teamLoading, setTeamLoading] = React.useState(false)
  const [selectedUrl, setSelectedUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!opened) { setSelectedUrl(null); setQuery(''); return }
    setLoading(true)
    listMaterialAssets()
      .then(setAssets)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [opened])

  React.useEffect(() => {
    if (!opened || tab !== 'team' || !teamId) return
    setTeamLoading(true)
    Promise.all([
      listTeamMaterialAssets({ teamId }),
      listMaterialFolders({ teamId }),
    ])
      .then(([a, f]) => { setTeamAssets(a); setTeamFolders(f) })
      .catch(() => {})
      .finally(() => setTeamLoading(false))
  }, [opened, tab, teamId])

  const q = query.trim().toLowerCase()

  const currentAssets = tab === 'team' ? teamAssets : assets
  const filtered = q ? currentAssets.filter((a) => a.name.toLowerCase().includes(q)) : currentAssets
  const currentLoading = tab === 'team' ? teamLoading : loading

  const showTeamTab = !!teamId

  const currentAnchors = React.useMemo(
    () =>
      (Array.isArray(currentStyleImages) ? currentStyleImages : [])
        .map((u) => String(u || '').trim())
        .filter(Boolean),
    [currentStyleImages],
  )
  const anchoredUrls = React.useMemo(() => new Set(currentAnchors), [currentAnchors])
  const assetNameByUrl = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const asset of [...assets, ...teamAssets]) {
      const url = getAssetImageUrl(asset)
      if (url && !map.has(url)) map.set(url, asset.name)
    }
    return map
  }, [assets, teamAssets])

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <IconPhoto size={16} style={{ opacity: 0.7 }} />
          <Text fw={600} size="sm">选择风格图片</Text>
        </Group>
      }
      size="md"
      centered
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '55vh' }}>
        {currentAnchors.length > 0 && (
          <div
            style={{
              display: 'flex', flexDirection: 'column', gap: 6, padding: 8,
              borderRadius: 8, background: 'rgba(13,148,136,0.08)',
              border: '1px solid rgba(13,148,136,0.35)',
            }}
          >
            <Text size="xs" c="teal.4" fw={600}>当前画风锚定（出图时固定作为最后一张参考图）</Text>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {currentAnchors.map((url) => (
                <div
                  key={url}
                  title={assetNameByUrl.get(url) || '画风锚定图'}
                  style={{
                    position: 'relative', width: 56, height: 56, borderRadius: 8,
                    overflow: 'hidden', border: '2px solid var(--mantine-color-teal-6)', flexShrink: 0,
                  }}
                >
                  <ManagedImage
                    className="style-picker__current-anchor-thumb"
                    src={url}
                    alt={assetNameByUrl.get(url) || '画风锚定图'}
                    priority="visible"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  {onRemoveCurrent && (
                    <ActionIcon
                      size={16}
                      variant="filled"
                      color="dark"
                      title="移除该画风锚定"
                      onClick={() => onRemoveCurrent(url)}
                      style={{ position: 'absolute', top: 2, right: 2 }}
                    >
                      <IconX size={10} />
                    </ActionIcon>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {showTeamTab && (
          <SegmentedControl
            fullWidth size="xs"
            data={[{ value: 'personal', label: '个人' }, { value: 'team', label: '团队' }]}
            value={tab}
            onChange={(v) => { setTab(v as 'personal' | 'team'); setSelectedUrl(null) }}
          />
        )}

        <>
          <TextInput
            size="xs"
            placeholder="搜索"
            leftSection={<IconSearch size={13} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {currentLoading ? (
              <Text size="xs" c="dimmed" style={{ padding: '16px 0' }}>加载中...</Text>
            ) : tab === 'personal' && !projectId ? (
              <Text size="xs" c="dimmed" style={{ padding: '16px 0' }}>请先关联项目</Text>
            ) : q ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, padding: '4px 0' }}>
                {filtered.length === 0 ? (
                  <Text size="xs" c="dimmed" style={{ gridColumn: '1/-1' }}>无匹配</Text>
                ) : (
                  filtered.map((asset) => {
                    const url = getAssetImageUrl(asset)
                    return (
                      <AssetThumb
                        key={asset.id} asset={asset}
                        selected={!!url && selectedUrl === url}
                        onSelect={() => url && setSelectedUrl(selectedUrl === url ? null : url)}
                      />
                    )
                  })
                )}
              </div>
            ) : tab === 'team' ? (
              <>
                {FOLDER_DEFS.map((f) => (
                  <FolderSection
                    key={f.kind}
                    folder={f}
                    assets={filtered.filter((a) => a.kind === f.kind && !a.folderId)}
                    selectedUrl={selectedUrl}
                    onSelect={(url) => setSelectedUrl(url || null)}
                  />
                ))}
                {teamFolders.map((folder) => (
                  <FolderSection
                    key={folder.id}
                    folder={{ label: folder.name }}
                    assets={filtered.filter((a) => a.folderId === folder.id)}
                    selectedUrl={selectedUrl}
                    onSelect={(url) => setSelectedUrl(url || null)}
                  />
                ))}
              </>
            ) : (
              FOLDER_DEFS.map((f) => (
                <FolderSection
                  key={f.kind}
                  folder={f}
                  assets={filtered.filter((a) => a.kind === f.kind)}
                  selectedUrl={selectedUrl}
                  onSelect={(url) => setSelectedUrl(url || null)}
                />
              ))
            )}
          </div>
        </>

        <Group justify="flex-end" gap={8}>
          <Button variant="default" size="xs" onClick={onClose}>取消</Button>
          <Button
            size="xs"
            disabled={!selectedUrl}
            onClick={() => { if (selectedUrl) { onConfirm(selectedUrl); onClose() } }}
          >
            确认
          </Button>
        </Group>
      </div>
    </Modal>
  )
}
