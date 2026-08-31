import React from 'react'
import { ActionIcon, Button, Loader, Popover, ScrollArea, Tooltip } from '@mantine/core'
import {
  IconCheck,
  IconRefresh,
  IconSettings,
  IconSparkles,
} from '@tabler/icons-react'
import { SkillLogo } from '../skills/SkillLogo'
import './SkillPickerPopover.css'

export type SkillPickerOption = {
  id: string
  key: string
  name: string
  description?: string | null
  logoUrl: string | null
  category: string
  source?: 'system' | 'user' | 'marketplace'
}

type SkillPickerCommonProps = {
  disabled: boolean
  error: string
  listMaxHeight?: number
  loading: boolean
  skills: readonly SkillPickerOption[]
  onManage: () => void
  onRefresh: () => Promise<void>
  onSelect: (skillId: string) => void
  position?: 'bottom-start' | 'top-start'
  triggerClassName?: string
  triggerIconClassName?: string
}

type SkillPickerPopoverProps = SkillPickerCommonProps & (
  | {
    selectionMode: 'single'
    activeSkill: SkillPickerOption | null
    selectedSkillIds?: never
  }
  | {
    selectionMode: 'multiple'
    activeSkill?: never
    selectedSkillIds: readonly string[]
  }
)

export function SkillPickerPopover(props: SkillPickerPopoverProps): JSX.Element {
  const {
    disabled,
    error,
    listMaxHeight = 248,
    loading,
    skills,
    onManage,
    onRefresh,
    onSelect,
    position = 'top-start',
    triggerClassName,
    triggerIconClassName,
  } = props
  const [opened, setOpened] = React.useState(false)
  const activeSkill = props.selectionMode === 'single' ? props.activeSkill : null
  const selectedSkillIds = props.selectionMode === 'single'
    ? activeSkill ? [activeSkill.id] : []
    : props.selectedSkillIds
  const selectedSkillIdSet = React.useMemo(() => new Set(selectedSkillIds), [selectedSkillIds])
  const selectionStatus = props.selectionMode === 'single'
    ? activeSkill ? activeSkill.name || activeSkill.key : '由小T自主选择'
    : selectedSkillIds.length > 0 ? `已选 ${selectedSkillIds.length} 个` : '未指定，由小T自主选择'
  const triggerLabel = props.selectionMode === 'single' && activeSkill
    ? `Skill：${activeSkill.name || activeSkill.key}`
    : selectedSkillIds.length > 0 ? `已选择 ${selectedSkillIds.length} 个技能` : '选择技能'
  const resolvedTriggerClassName = `${triggerClassName || 'tc-ai-chat__attach tc-ai-chat__skill-library-trigger'}${selectedSkillIds.length > 0 ? ' is-active' : ''}`

  const selectSkill = React.useCallback((skillId: string): void => {
    onSelect(skillId)
    if (props.selectionMode === 'single') setOpened(false)
  }, [onSelect, props.selectionMode])

  const openManager = React.useCallback((): void => {
    setOpened(false)
    onManage()
  }, [onManage])

  return (
    <Popover
      className="tc-skill-picker"
      opened={opened}
      onChange={setOpened}
      position={position}
      width={320}
      zIndex={10050}
      shadow="md"
    >
      <Popover.Target>
        <span className="tc-skill-picker__target">
          <Tooltip
            className="tc-skill-picker__tooltip"
            label={triggerLabel}
            withArrow
          >
            <ActionIcon
              className={resolvedTriggerClassName}
              variant="subtle"
              aria-label="选择技能"
              aria-expanded={opened}
              aria-pressed={selectedSkillIds.length > 0}
              disabled={disabled}
              onClick={() => setOpened((current) => !current)}
            >
              <IconSparkles className={triggerIconClassName || 'tc-skill-picker__trigger-icon'} size={16} />
            </ActionIcon>
          </Tooltip>
        </span>
      </Popover.Target>

      <Popover.Dropdown className="tc-skill-picker__dropdown">
        <div className="tc-skill-picker__header">
          <div className="tc-skill-picker__heading">
            <strong className="tc-skill-picker__title">本轮技能</strong>
            <span className="tc-skill-picker__status">
              {selectionStatus}
            </span>
          </div>
          <Tooltip className="tc-skill-picker__tooltip" label="刷新技能" withArrow>
            <ActionIcon
              className="tc-skill-picker__refresh"
              variant="subtle"
              size="sm"
              aria-label="刷新技能"
              disabled={loading}
              onClick={() => void onRefresh()}
            >
              <IconRefresh className="tc-skill-picker__refresh-icon" size={15} />
            </ActionIcon>
          </Tooltip>
        </div>

        <ScrollArea className="tc-skill-picker__scroll" h={Math.min(listMaxHeight, Math.max(72, skills.length * 48))} type="auto">
          <div className="tc-skill-picker__list" aria-busy={loading}>
            {loading ? (
              <div className="tc-skill-picker__state">
                <Loader className="tc-skill-picker__loader" size="xs" />
              </div>
            ) : null}
            {!loading && error ? (
              <div className="tc-skill-picker__state tc-skill-picker__state--error" role="alert">{error}</div>
            ) : null}
            {!loading && !error && skills.length === 0 ? (
              <div className="tc-skill-picker__state">暂无可用技能</div>
            ) : null}
            {!loading && !error ? skills.map((skill) => {
              const selected = selectedSkillIdSet.has(skill.id)
              const sourceLabel = skill.source === 'marketplace'
                ? '已购'
                : skill.source === 'user'
                  ? '个人'
                  : skill.source === 'system'
                    ? '系统'
                    : ''
              return (
                <button
                  className={`tc-skill-picker__item${selected ? ' is-selected' : ''}`}
                  type="button"
                  aria-pressed={selected}
                  key={skill.id}
                  onClick={() => selectSkill(skill.id)}
                >
                  <SkillLogo className="tc-skill-picker__item-logo" skill={skill} priority="visible" />
                  <span className="tc-skill-picker__item-copy">
                    <strong className="tc-skill-picker__item-name">{skill.name || skill.key}</strong>
                    <span className="tc-skill-picker__item-description">
                      {sourceLabel ? `${sourceLabel} · ` : ''}{skill.description || skill.category}
                    </span>
                  </span>
                  {selected ? <IconCheck className="tc-skill-picker__item-check" size={15} /> : null}
                </button>
              )
            }) : null}
          </div>
        </ScrollArea>

        <Button
          className="tc-skill-picker__manage"
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<IconSettings className="tc-skill-picker__manage-icon" size={15} />}
          fullWidth
          onClick={openManager}
        >
          管理技能
        </Button>
      </Popover.Dropdown>
    </Popover>
  )
}
