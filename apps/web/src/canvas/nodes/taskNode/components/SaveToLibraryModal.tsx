import React from 'react'
import { Modal, Button, Group, Text, Stack, UnstyledButton, SegmentedControl, Tooltip } from '@mantine/core'
import { IconFolder, IconFolderFilled, IconCheck } from '@tabler/icons-react'
import { createMaterialAsset, createTeamMaterialAsset, type MaterialKindDto } from '../../../../api/server'
import { toast } from '../../../../ui/toast'
import { useActiveTeamId } from '../../../../ui/team/TeamManagementModal'

const FOLDER_OPTIONS: { kind: MaterialKindDto; label: string }[] = [
  { kind: 'character', label: '角色' },
  { kind: 'scene', label: '场景' },
  { kind: 'prop', label: '道具' },
  { kind: 'style', label: '风格' },
  { kind: 'text', label: 'Others' },
]

type SaveToLibraryModalProps = {
  open: boolean
  onClose: () => void
  projectId: string
  imageUrl: string
  nodeName: string
  teamId?: string | null
}

export function SaveToLibraryModal({ open, onClose, projectId, imageUrl, nodeName, teamId: projectTeamId }: SaveToLibraryModalProps) {
  const activeTeamId = useActiveTeamId()
  const teamId = activeTeamId ?? projectTeamId ?? null
  const [tab, setTab] = React.useState<'personal' | 'team'>('personal')
  const [selectedKind, setSelectedKind] = React.useState<MaterialKindDto | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setSelectedKind(null)
      setTab('personal')
    }
  }, [open])

  const handleSave = async () => {
    if (!selectedKind || !imageUrl) return
    setSaving(true)
    try {
      if (tab === 'team' && teamId) {
        await createTeamMaterialAsset({
          teamId,
          kind: selectedKind,
          name: nodeName || '未命名',
          initialData: { imageUrl },
        })
      } else {
        if (!projectId) return
        await createMaterialAsset({
          projectId,
          kind: selectedKind,
          name: nodeName || '未命名',
          initialData: { imageUrl },
        })
      }
      toast('已保存到素材库', 'success')
      onClose()
    } catch {
      toast('保存失败，请重试', 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasTeam = !!teamId

  return (
    <Modal
      opened={open}
      onClose={onClose}
      title={
        <Group gap={8}>
          <IconFolder size={16} />
          <Text fw={600} size="sm">保存到素材库</Text>
        </Group>
      }
      size="sm"
      radius="md"
      centered
    >
      {hasTeam ? (
        <SegmentedControl
          fullWidth
          size="xs"
          mb={12}
          data={[
            { value: 'personal', label: '个人' },
            { value: 'team', label: '团队' },
          ]}
          value={tab}
          onChange={(v) => { setTab(v as 'personal' | 'team'); setSelectedKind(null) }}
        />
      ) : (
        <Text className="tc-save-to-library__scope" size="xs" c="dimmed" mb={12}>
          保存到个人素材库
        </Text>
      )}

      <Stack gap={4} mb={16}>
        {FOLDER_OPTIONS.map((opt) => (
          <UnstyledButton
            key={opt.kind}
            onClick={() => setSelectedKind(opt.kind)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 8,
              background: selectedKind === opt.kind ? 'rgba(122,129,140,0.1)' : 'transparent',
              border: `1px solid ${selectedKind === opt.kind ? 'rgba(122,129,140,0.35)' : 'rgba(255,255,255,0.06)'}`,
              transition: 'background 0.15s',
            }}
          >
            <IconFolderFilled
              size={18}
              style={{ opacity: 0.75, color: selectedKind === opt.kind ? 'var(--mantine-color-blue-5)' : undefined, flexShrink: 0 }}
            />
            <Text size="sm" style={{ flex: 1 }}>{opt.label}</Text>
            {selectedKind === opt.kind && <IconCheck size={14} style={{ color: 'var(--mantine-color-blue-5)' }} />}
          </UnstyledButton>
        ))}
      </Stack>

      <Group justify="flex-end" gap={8}>
        <Button variant="default" size="xs" onClick={onClose} disabled={saving}>取消</Button>
        {!hasTeam && tab === 'team' ? (
          <Tooltip label="需要团队项目才能使用团队素材库">
            <Button size="xs" disabled>保存</Button>
          </Tooltip>
        ) : (
          <Button
            size="xs"
            disabled={!selectedKind || saving}
            loading={saving}
            onClick={handleSave}
          >
            保存
          </Button>
        )}
      </Group>
    </Modal>
  )
}
