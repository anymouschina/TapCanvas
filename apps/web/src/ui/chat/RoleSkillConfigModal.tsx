import React from 'react'
import { createPortal } from 'react-dom'
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconCheck, IconCode, IconUpload, IconUsersGroup } from '@tabler/icons-react'
import { useUIStore } from '../uiStore'
import { toast } from '../toast'
import { useSkillLibraryData } from '../skills/useSkillLibraryData'
import { ALL_TEAM_ROLES, type TeamRole } from './teamRoster'
import {
  createEmptyProjectRoleSkillConfig,
  useProjectRoleSkillConfigStore,
} from './roleSkillConfigStore'
import type { AgentRoleSkillAssignment, AgentSkillDto } from '../../api/server'

type RoleSkillDraft = {
  source: 'system' | 'custom'
  systemSkillId: string
  customName: string
  fileName: string
  content: string
}

function buildDraft(assignment: AgentRoleSkillAssignment | undefined): RoleSkillDraft {
  return {
    source: assignment?.source ?? 'system',
    systemSkillId: assignment?.source === 'system' ? assignment.skillId || '' : '',
    customName: assignment?.source === 'custom' ? assignment.skillName || '' : '',
    fileName: assignment?.source === 'custom' ? assignment.fileName || 'role-skill.md' : 'role-skill.md',
    content: assignment?.source === 'custom' ? assignment.content || '' : '',
  }
}

function findSystemSkill(skills: AgentSkillDto[], skillId: string): AgentSkillDto | null {
  const normalizedId = skillId.trim()
  if (!normalizedId) return null
  return skills.find((skill) => skill.id === normalizedId) ?? null
}

export type RoleSkillConfigModalProps = {
  projectId: string
  opened: boolean
  onClose: () => void
}

export function RoleSkillConfigModal({ projectId, opened, onClose }: RoleSkillConfigModalProps): JSX.Element {
  const normalizedProjectId = projectId.trim()
  const skillLibrary = useSkillLibraryData()
  const config = useProjectRoleSkillConfigStore((state) => state.byProjectId[normalizedProjectId])
    ?? createEmptyProjectRoleSkillConfig()
  const saving = useProjectRoleSkillConfigStore((state) => Boolean(state.savingProjectIds[normalizedProjectId]))
  const storedError = useProjectRoleSkillConfigStore((state) => state.errorByProjectId[normalizedProjectId] || '')
  const ensureLoaded = useProjectRoleSkillConfigStore((state) => state.ensureLoaded)
  const saveAssignment = useProjectRoleSkillConfigStore((state) => state.saveAssignment)
  const [selectedRoleId, setSelectedRoleId] = React.useState(ALL_TEAM_ROLES[0]?.id ?? '')
  const [drafts, setDrafts] = React.useState<Record<string, RoleSkillDraft>>({})
  const [localError, setLocalError] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!opened || !normalizedProjectId) return
    setDrafts({})
    setLocalError('')
    void ensureLoaded(normalizedProjectId).catch((error: unknown) => {
      setLocalError(error instanceof Error ? error.message : String(error))
    })
  }, [ensureLoaded, normalizedProjectId, opened])

  React.useEffect(() => {
    if (!opened) return
    if (skillLibrary.officialSkills.length > 0 || skillLibrary.loading) return
    void skillLibrary.load()
  }, [opened, skillLibrary.officialSkills.length, skillLibrary.load, skillLibrary.loading])

  React.useEffect(() => {
    if (!opened) return
    const firstRoleId = ALL_TEAM_ROLES[0]?.id ?? ''
    setSelectedRoleId((current) => current || firstRoleId)
  }, [opened])

  const selectedRole = ALL_TEAM_ROLES.find((role) => role.id === selectedRoleId) ?? ALL_TEAM_ROLES[0] ?? null
  const selectedAssignment = selectedRole ? config.assignments[selectedRole.id] : undefined
  const selectedDraft = selectedRole
    ? drafts[selectedRole.id] ?? buildDraft(selectedAssignment)
    : buildDraft(undefined)

  const updateSelectedDraft = React.useCallback((patch: Partial<RoleSkillDraft>) => {
    if (!selectedRole) return
    setDrafts((current) => ({
      ...current,
      [selectedRole.id]: {
        ...(current[selectedRole.id] ?? buildDraft(config.assignments[selectedRole.id])),
        ...patch,
      },
    }))
    setLocalError('')
  }, [config.assignments, selectedRole])

  const selectRole = React.useCallback((role: TeamRole) => {
    setSelectedRoleId(role.id)
    setLocalError('')
  }, [])

  const applySelectedRole = React.useCallback(async () => {
    if (!selectedRole || !normalizedProjectId) return
    const draft = selectedDraft
    const selectedSystemSkill = findSystemSkill(skillLibrary.officialSkills, draft.systemSkillId)
    let assignment: AgentRoleSkillAssignment | null = null
    if (draft.source === 'system') {
      if (selectedSystemSkill) {
        assignment = {
          roleId: selectedRole.id,
          roleName: selectedRole.name,
          source: 'system',
          skillId: selectedSystemSkill.id,
          skillKey: selectedSystemSkill.key,
          skillName: selectedSystemSkill.name,
        }
      } else if (draft.systemSkillId) {
        setLocalError('系统 Skill 尚未加载完成，无法覆盖当前角色配置。请稍后再试。')
        return
      }
    } else {
      const customName = draft.customName.trim()
      const content = draft.content
      if (!customName) {
        setLocalError('请填写自定义 skill 名称。')
        return
      }
      if (!content.trim()) {
        setLocalError('请上传或填写 skill 文本。')
        return
      }
      assignment = {
        roleId: selectedRole.id,
        roleName: selectedRole.name,
        source: 'custom',
        skillName: customName,
        fileName: draft.fileName.trim() || 'role-skill.md',
        content,
      }
    }

    try {
      setLocalError('')
      await saveAssignment(normalizedProjectId, selectedRole.id, assignment)
      setDrafts((current) => ({
        ...current,
        [selectedRole.id]: buildDraft(assignment ?? undefined),
      }))
      toast(
        assignment
          ? `已将「${assignment.skillName || assignment.fileName || '自定义 skill'}」应用到${selectedRole.name}`
          : `已清除${selectedRole.name}的角色 skill配置`,
        'success',
      )
    } catch (error: unknown) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }, [normalizedProjectId, saveAssignment, selectedDraft, selectedRole, skillLibrary.officialSkills])

  const clearSelectedRole = React.useCallback(async () => {
    if (!selectedRole || !normalizedProjectId) return
    try {
      setLocalError('')
      await saveAssignment(normalizedProjectId, selectedRole.id, null)
      setDrafts((current) => {
        const next = { ...current }
        delete next[selectedRole.id]
        return next
      })
      toast(`已清除${selectedRole.name}的角色 skill 配置`, 'success')
    } catch (error: unknown) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }, [normalizedProjectId, saveAssignment, selectedRole])

  const handleFileChange = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const content = await file.text()
      updateSelectedDraft({ fileName: file.name, content, source: 'custom' })
    } catch (error: unknown) {
      setLocalError(error instanceof Error ? error.message : '读取 skill 文件失败')
    }
  }, [updateSelectedDraft])

  const systemSkillOptions = React.useMemo(
    () => skillLibrary.officialSkills.map((skill) => ({
        value: skill.id,
        label: skill.name || skill.key,
      })),
    [skillLibrary.officialSkills],
  )

  return (
    <Modal
      className="role-skill-config-modal"
      opened={opened}
      onClose={onClose}
      title="智能团角色技能配置"
      size={860}
      centered
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
    >
      <div className="role-skill-config-shell">
        <div className="role-skill-config-intro">
          <Text className="role-skill-config-intro-title" size="sm" fw={600}>为每个角色指定执行 skill</Text>
          <Text className="role-skill-config-intro-copy" size="xs" c="dimmed">
            系统 Skill 来自官方技能库；自定义内容会在该角色被委派时作为角色级运行时指令加载。
          </Text>
        </div>
        <div className="role-skill-config-body">
          <ScrollArea className="role-skill-config-role-list" type="auto" scrollbarSize={6}>
            <Stack className="role-skill-config-role-stack" gap={2}>
              {ALL_TEAM_ROLES.map((role) => {
                const assignment = config.assignments[role.id]
                const selected = selectedRole?.id === role.id
                return (
                  <button
                    className={`role-skill-config-role${selected ? ' role-skill-config-role--selected' : ''}`}
                    key={role.id}
                    type="button"
                    onClick={() => selectRole(role)}
                    style={selected ? { borderColor: role.accent } : undefined}
                  >
                    <img className="role-skill-config-role-avatar" src={role.avatar} alt={role.name} />
                    <span className="role-skill-config-role-copy">
                      <span className="role-skill-config-role-name">{role.name}</span>
                      <span className="role-skill-config-role-description">{role.description}</span>
                    </span>
                    {assignment ? (
                      <Badge className="role-skill-config-role-badge" size="xs" variant="light" color={assignment.source === 'custom' ? 'violet' : 'cyan'}>
                        {assignment.source === 'custom' ? '自定义' : '系统'}
                      </Badge>
                    ) : (
                      <Text className="role-skill-config-role-empty" size="xs" c="dimmed">角色默认</Text>
                    )}
                  </button>
                )
              })}
            </Stack>
          </ScrollArea>
          <Divider className="role-skill-config-divider" orientation="vertical" />
          {selectedRole ? (
            <div className="role-skill-config-editor">
              <Group className="role-skill-config-editor-head" justify="space-between" align="flex-start" wrap="nowrap">
                <div className="role-skill-config-editor-title-block">
                  <Text className="role-skill-config-editor-title" fw={700}>{selectedRole.name}</Text>
                  <Text className="role-skill-config-editor-description" size="xs" c="dimmed">{selectedRole.description}</Text>
                </div>
                {selectedAssignment ? (
                  <Badge className="role-skill-config-current-badge" size="sm" variant="dot">
                    当前：{selectedAssignment.skillName || selectedAssignment.fileName || '已配置'}
                  </Badge>
                ) : null}
              </Group>
              <SegmentedControl
                className="role-skill-config-source-switch"
                fullWidth
                value={selectedDraft.source}
                onChange={(value) => updateSelectedDraft({ source: value === 'custom' ? 'custom' : 'system' })}
                data={[
                  { value: 'system', label: '系统 Skill' },
                  { value: 'custom', label: '自定义 Skill' },
                ]}
              />
              {selectedDraft.source === 'system' ? (
                <Stack className="role-skill-config-system-editor" gap="xs">
                  <Select
                    className="role-skill-config-system-select"
                    label="系统技能"
                    description="选择后，角色被委派时会加载该系统 Skill。"
                    data={systemSkillOptions}
                    value={selectedDraft.systemSkillId}
                    onChange={(value) => updateSelectedDraft({ systemSkillId: value || '' })}
                    searchable
                    clearable
                    placeholder={skillLibrary.loading ? '正在加载系统 Skill…' : '选择系统 Skill'}
                    disabled={skillLibrary.loading}
                  />
                  {skillLibrary.error ? (
                    <Text className="role-skill-config-error" size="xs" c="red">{skillLibrary.error}</Text>
                  ) : (
                    <Text className="role-skill-config-hint" size="xs" c="dimmed">
                      不指定时保留角色默认配置，不会覆盖 agents-cli 的角色合同。
                    </Text>
                  )}
                </Stack>
              ) : (
                <Stack className="role-skill-config-custom-editor" gap="xs">
                  <TextInput
                    className="role-skill-config-custom-name"
                    label="Skill 名称"
                    placeholder="例如：克制对白节奏"
                    value={selectedDraft.customName}
                    onChange={(event) => updateSelectedDraft({ customName: event.currentTarget.value })}
                  />
                  <Group className="role-skill-config-file-row" gap="xs" align="end" wrap="nowrap">
                    <TextInput
                      className="role-skill-config-file-name"
                      label="文件名"
                      value={selectedDraft.fileName}
                      onChange={(event) => updateSelectedDraft({ fileName: event.currentTarget.value })}
                    />
                    <Button
                      className="role-skill-config-upload-button"
                      variant="light"
                      leftSection={<IconUpload className="role-skill-config-upload-icon" size={15} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      上传文本
                    </Button>
                    <input
                      ref={fileInputRef}
                      className="role-skill-config-file-input"
                      type="file"
                      accept=".md,.txt,text/markdown,text/plain"
                      onChange={(event) => { void handleFileChange(event) }}
                    />
                  </Group>
                  <Textarea
                    className="role-skill-config-custom-content"
                    label="Skill 文本"
                    description="支持直接粘贴 Markdown 或纯文本；保存后只对当前角色生效。"
                    value={selectedDraft.content}
                    onChange={(event) => updateSelectedDraft({ content: event.currentTarget.value })}
                    minRows={12}
                    maxRows={20}
                    autosize
                    placeholder="填写该角色执行时需要遵循的 skill 文本…"
                  />
                  <Group className="role-skill-config-content-meta" justify="space-between">
                    <Text className="role-skill-config-content-count" size="xs" c="dimmed">{selectedDraft.content.length.toLocaleString()} 字符</Text>
                    <Text className="role-skill-config-content-format" size="xs" c="dimmed"><IconCode className="role-skill-config-format-icon" size={13} /> Markdown / text</Text>
                  </Group>
                </Stack>
              )}
              {(localError || storedError) ? (
                <Text className="role-skill-config-error" size="xs" c="red">{localError || storedError}</Text>
              ) : null}
              <Group className="role-skill-config-editor-actions" justify="flex-end" gap="xs">
                <Button
                  className="role-skill-config-clear-button"
                  variant="subtle"
                  color="gray"
                  onClick={() => { void clearSelectedRole() }}
                  disabled={saving || !selectedAssignment}
                >
                  清除当前配置
                </Button>
                <Button
                  className="role-skill-config-apply-button"
                  leftSection={<IconCheck className="role-skill-config-apply-icon" size={15} />}
                  onClick={() => { void applySelectedRole() }}
                  loading={saving}
                >
                  应用到{selectedRole.name}
                </Button>
              </Group>
            </div>
          ) : (
            <div className="role-skill-config-empty-editor">
              <Text className="role-skill-config-empty-title" fw={600}>选择一个角色</Text>
              <Text className="role-skill-config-empty-copy" size="sm" c="dimmed">从左侧角色列表开始配置。</Text>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export type RoleSkillConfigLauncherProps = {
  projectId?: string | null
  portalTargetId?: string | null
}

export function RoleSkillConfigLauncher({
  projectId: projectIdProp,
  portalTargetId = 'tc-canvas-visibility-slot',
}: RoleSkillConfigLauncherProps): JSX.Element | null {
  const storeProjectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const projectId = String(projectIdProp || storeProjectId).trim()
  const [opened, setOpened] = React.useState(false)
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!portalTargetId) {
      setPortalTarget(null)
      return
    }
    setPortalTarget(document.getElementById(portalTargetId))
  }, [portalTargetId])

  if (!projectId) return null

  const button = (
    <Tooltip className="role-skill-config-launcher-tooltip" label="角色技能配置" withArrow>
      <ActionIcon
        className="role-skill-config-launcher-button"
        variant="subtle"
        aria-label="角色技能配置"
        onClick={() => setOpened(true)}
      >
        <IconUsersGroup className="role-skill-config-launcher-icon" size={18} />
      </ActionIcon>
    </Tooltip>
  )

  return (
    <div className="role-skill-config-launcher">
      {portalTargetId && portalTarget ? createPortal(button, portalTarget) : button}
      <RoleSkillConfigModal
        projectId={projectId}
        opened={opened}
        onClose={() => setOpened(false)}
      />
    </div>
  )
}
