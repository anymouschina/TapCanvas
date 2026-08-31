import React from 'react'
import { Button, Group, Modal, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import {
  deleteAdminAgentSkill,
  deleteAdminLlmNodePreset,
  listAdminBuiltInCapabilities,
  listAdminAgentSkills,
  listAdminLlmNodePresets,
  upsertAdminAgentSkill,
  upsertAdminLlmNodePreset,
  updateAdminBuiltInCapabilityState,
  type AdminBuiltInCapabilityDto,
  type AdminAgentSkillDto,
  type AdminAgentSkillUpsertInput,
  type AdminLlmNodePresetDto,
  type AdminLlmNodePresetUpsertInput,
} from '../../../../api/server'
import { IconActionButton } from '../../../IconActionButton'
import { StatePanel } from '../../../StatePanel'
import { toast } from '../../../toast'
import AgentDiagnosticsContent from '../../../AgentDiagnosticsContent'
import { AdminAgentSkillsPanel } from './AdminAgentSkillsPanel'
import { AdminBuiltInCapabilitiesPanel } from './AdminBuiltInCapabilitiesPanel'
import { AdminNodePresetsPanel } from './AdminNodePresetsPanel'
import { replaceById } from './adminAgentManagement.models'

type DeleteTarget =
  | { kind: 'skill'; id: string; name: string }
  | { kind: 'preset'; id: string; name: string }

function getErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

export default function StatsAgentsManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-agents-management', className].filter(Boolean).join(' ')
  const [skills, setSkills] = React.useState<AdminAgentSkillDto[]>([])
  const [builtInCapabilities, setBuiltInCapabilities] = React.useState<AdminBuiltInCapabilityDto[]>([])
  const [presets, setPresets] = React.useState<AdminLlmNodePresetDto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [activeSection, setActiveSection] = React.useState<'capabilities' | 'remote-calls'>('capabilities')
  const loadRequestRef = React.useRef(0)

  const reload = React.useCallback(async () => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const [loadedSkills, loadedPresets, loadedBuiltInCapabilities] = await Promise.all([
        listAdminAgentSkills(),
        listAdminLlmNodePresets(),
        listAdminBuiltInCapabilities(),
      ])
      if (loadRequestRef.current !== requestId) return
      setSkills(loadedSkills)
      setPresets(loadedPresets)
      setBuiltInCapabilities(loadedBuiltInCapabilities)
      setHasLoaded(true)
    } catch (reason: unknown) {
      if (loadRequestRef.current !== requestId) return
      setLoadError(getErrorMessage(reason, '加载 Agent 能力配置失败'))
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
    return () => {
      loadRequestRef.current += 1
    }
  }, [reload])

  const saveSkill = React.useCallback(async (payload: AdminAgentSkillUpsertInput) => {
    const saved = await upsertAdminAgentSkill(payload)
    setSkills((current) => replaceById(current, saved))
    toast('官方 Agent Skill 已保存', 'success')
  }, [])

  const savePreset = React.useCallback(async (payload: AdminLlmNodePresetUpsertInput) => {
    const saved = await upsertAdminLlmNodePreset(payload)
    setPresets((current) => replaceById(current, saved))
    toast('基础节点预设已保存', 'success')
  }, [])

  const toggleBuiltInCapability = React.useCallback(async (capabilityKey: string, enabled: boolean) => {
    const saved = await updateAdminBuiltInCapabilityState(capabilityKey, enabled)
    setBuiltInCapabilities((current) => replaceById(current, saved))
    toast(`${saved.name}已${saved.enabled ? '全局启用' : '全局停用'}`, 'success')
  }, [])

  const closeDeleteDialog = React.useCallback(() => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }, [deleting])

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      if (deleteTarget.kind === 'skill') {
        await deleteAdminAgentSkill(deleteTarget.id)
        setSkills((current) => current.filter((skill) => skill.id !== deleteTarget.id))
        toast('官方 Agent Skill 已删除', 'success')
      } else {
        await deleteAdminLlmNodePreset(deleteTarget.id)
        setPresets((current) => current.filter((preset) => preset.id !== deleteTarget.id))
        toast('基础节点预设已删除', 'success')
      }
      setDeleteTarget(null)
    } catch (reason: unknown) {
      setDeleteError(getErrorMessage(reason, '删除失败'))
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleting])

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-agents-management__header" justify="space-between" align="flex-start" wrap="wrap">
        <Stack className="stats-agents-management__heading" gap={2}>
          <Text className="stats-agents-management__title" fw={700}>Agent 管理</Text>
          <Text className="stats-agents-management__description" size="xs" c="dimmed">
            统一管理官方能力配置，并查看已经持久化的 Agent API 远程工具调用记录。
          </Text>
        </Stack>
        {activeSection === 'capabilities' ? (
          <Tooltip className="stats-agents-management__refresh-tooltip" label="重新读取全部配置" withinPortal>
            <IconActionButton
              className="stats-agents-management__refresh"
              aria-label="刷新 Agent 能力配置"
              loading={loading}
              icon={<IconRefresh className="stats-agents-management__refresh-icon" size={16} />}
              onClick={() => void reload()}
            />
          </Tooltip>
        ) : null}
      </Group>

      <Tabs
        className="stats-agents-management__tabs"
        value={activeSection}
        onChange={(value) => setActiveSection(value === 'remote-calls' ? 'remote-calls' : 'capabilities')}
      >
        <Tabs.List className="stats-agents-management__tab-list">
          <Tabs.Tab className="stats-agents-management__tab" value="capabilities">能力配置</Tabs.Tab>
          <Tabs.Tab className="stats-agents-management__tab" value="remote-calls">Agent API / 远程调用日志</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel className="stats-agents-management__tab-panel" value="capabilities" pt="md">
          {loadError ? (
            <StatePanel
              className="stats-agents-management__load-error"
              title={hasLoaded ? '刷新失败，以下仍是上次成功读取的数据' : 'Agent 能力配置加载失败'}
              description={loadError}
              tone="error"
            />
          ) : null}

          {loading && !hasLoaded ? (
            <StatePanel className="stats-agents-management__loading" title="正在读取 Agent 能力配置…" tone="loading" />
          ) : hasLoaded ? (
            <Stack className="stats-agents-management__content" gap="md">
              <AdminBuiltInCapabilitiesPanel
                className="stats-agents-management__built-ins"
                capabilities={builtInCapabilities}
                onToggle={toggleBuiltInCapability}
              />
              <AdminAgentSkillsPanel
                className="stats-agents-management__skills"
                skills={skills}
                onSave={saveSkill}
                onRequestDelete={(skill) => {
                  setDeleteTarget({ kind: 'skill', id: skill.id, name: skill.name })
                  setDeleteError(null)
                }}
              />
              <AdminNodePresetsPanel
                className="stats-agents-management__presets"
                presets={presets}
                onSave={savePreset}
                onRequestDelete={(preset) => {
                  setDeleteTarget({ kind: 'preset', id: preset.id, name: preset.title })
                  setDeleteError(null)
                }}
              />
            </Stack>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel className="stats-agents-management__tab-panel" value="remote-calls" pt="md">
          <Stack className="stats-agents-management__remote-calls" gap="sm">
            <div className="stats-agents-management__remote-calls-heading">
              <Text className="stats-agents-management__remote-calls-title" size="sm" fw={650}>持久化执行日志</Text>
              <Text className="stats-agents-management__remote-calls-description" size="xs" c="dimmed">
                输入 Agent API Job ID 可精确定位同 ID 的 trace；展开记录即可查看工具名、状态、耗时、入参与返回摘要。
              </Text>
            </div>
            <AgentDiagnosticsContent
              className="stats-agents-management__remote-calls-content"
              opened={activeSection === 'remote-calls'}
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal
        className="stats-agents-management__delete-modal"
        opened={deleteTarget !== null}
        onClose={closeDeleteDialog}
        title={deleteTarget?.kind === 'skill' ? '删除官方 Agent Skill' : '删除基础节点预设'}
        centered
        size="sm"
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
      >
        <Stack className="stats-agents-management__delete-content" gap="sm">
          {deleteTarget ? (
            <Text className="stats-agents-management__delete-message" size="sm">
              确认删除“{deleteTarget.name}”？删除成功后不会自动恢复。
            </Text>
          ) : null}
          {deleteError ? (
            <StatePanel className="stats-agents-management__delete-error" title="删除失败" description={deleteError} tone="error" />
          ) : null}
          <Group className="stats-agents-management__delete-actions" justify="flex-end" gap="xs">
            <Button className="stats-agents-management__delete-cancel" variant="subtle" onClick={closeDeleteDialog} disabled={deleting}>
              取消
            </Button>
            <Button className="stats-agents-management__delete-confirm" color="red" onClick={() => void confirmDelete()} loading={deleting}>
              删除
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
