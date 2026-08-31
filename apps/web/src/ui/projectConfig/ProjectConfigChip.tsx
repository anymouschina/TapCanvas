import React from 'react'
import { ActionIcon, Box, Group, Popover, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconMovie,
  IconPalette,
  IconSettings,
  IconUsersGroup,
  type TablerIcon,
} from '@tabler/icons-react'
import { useUIStore } from '../uiStore'
import { DirectorPersonaChip } from '../DirectorPersonaChip'
import { RoleSkillConfigModal } from '../chat/RoleSkillConfigModal'
import { ProjectLookBibleChip } from '../projectLookBible/ProjectLookBibleChip'
import { GlobalStyleChip } from '../styleLibrary/GlobalStyleChip'

type ProjectConfigSection = 'overview' | 'style' | 'lookBible' | 'director'

type ProjectConfigSectionDefinition = {
  id: Exclude<ProjectConfigSection, 'overview'> | 'roleSkills'
  title: string
  description: string
  icon: TablerIcon
}

const PROJECT_CONFIG_SECTIONS: readonly ProjectConfigSectionDefinition[] = [
  {
    id: 'style',
    title: '视觉风格',
    description: '参考图、画风预设与项目画风锚点',
    icon: IconPalette,
  },
  {
    id: 'lookBible',
    title: '项目视觉',
    description: '影调、灯光、时代与跨章节视觉规则',
    icon: IconFileText,
  },
  {
    id: 'director',
    title: '导演设置',
    description: '项目级导演人格与整片拍摄基调',
    icon: IconMovie,
  },
  {
    id: 'roleSkills',
    title: '角色技能配置',
    description: '为智能团角色指定系统或自定义 Skill',
    icon: IconUsersGroup,
  },
] as const

function getSectionDefinition(section: ProjectConfigSection): ProjectConfigSectionDefinition | null {
  return PROJECT_CONFIG_SECTIONS.find((candidate) => candidate.id === section) ?? null
}

export type ProjectConfigChipProps = {
  showRoleSkillConfig?: boolean
}

export function ProjectConfigChip({
  showRoleSkillConfig = true,
}: ProjectConfigChipProps = {}): JSX.Element | null {
  const projectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const [opened, setOpened] = React.useState(false)
  const [section, setSection] = React.useState<ProjectConfigSection>('overview')
  const [roleSkillOpened, setRoleSkillOpened] = React.useState(false)

  const close = React.useCallback(() => {
    setOpened(false)
    setSection('overview')
  }, [])

  const handleOpenChange = React.useCallback((nextOpened: boolean) => {
    setOpened(nextOpened)
    if (nextOpened) return
    setSection('overview')
  }, [])

  if (!projectId) return null

  const selectedDefinition = getSectionDefinition(section)

  const chip = (
    <Popover
      className="project-config-popover"
      opened={opened}
      onChange={handleOpenChange}
      position="bottom-end"
      offset={12}
      shadow="md"
      radius="sm"
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        <Box className="project-config-trigger-target">
          <Tooltip className="project-config-tooltip" label="项目配置" withArrow>
            <ActionIcon
              className="project-config-chip"
              variant="subtle"
              size="sm"
              aria-label="打开项目配置"
              aria-expanded={opened}
              onClick={() => handleOpenChange(!opened)}
            >
              <IconSettings className="project-config-chip__icon" size={18} />
            </ActionIcon>
          </Tooltip>
        </Box>
      </Popover.Target>
      <Popover.Dropdown
        className="project-config-dropdown"
        data-section={section}
        p={0}
      >
        {section === 'overview' ? (
          <Stack className="project-config-overview" gap={0}>
            <div className="project-config-overview__heading">
              <Text className="project-config-overview__title" size="sm" fw={650}>项目配置</Text>
              <Text className="project-config-overview__caption" size="xs" c="dimmed">
                统一管理项目视觉、导演基调与角色技能
              </Text>
            </div>
            <div className="project-config-overview__sections">
              {PROJECT_CONFIG_SECTIONS.filter((item) => item.id !== 'roleSkills' || showRoleSkillConfig).map((item) => {
                const SectionIcon = item.icon
                return (
                  <UnstyledButton
                    className="project-config-section-row"
                    key={item.id}
                    onClick={() => {
                      if (item.id === 'roleSkills') {
                        handleOpenChange(false)
                        setRoleSkillOpened(true)
                        return
                      }
                      setSection(item.id)
                    }}
                  >
                    <Box className="project-config-section-row__icon-shell">
                      <SectionIcon className="project-config-section-row__icon" size={17} />
                    </Box>
                    <div className="project-config-section-row__copy">
                      <Text className="project-config-section-row__title" size="sm" fw={600}>{item.title}</Text>
                      <Text className="project-config-section-row__description" size="xs" c="dimmed">{item.description}</Text>
                    </div>
                    <IconChevronRight className="project-config-section-row__chevron" size={15} />
                  </UnstyledButton>
                )
              })}
            </div>
          </Stack>
        ) : (
          <div className="project-config-detail">
            <Group className="project-config-detail__heading" gap="xs" wrap="nowrap">
              <UnstyledButton
                className="project-config-detail__back"
                aria-label="返回项目配置"
                onClick={() => setSection('overview')}
              >
                <IconChevronLeft className="project-config-detail__back-icon" size={17} />
              </UnstyledButton>
              <div className="project-config-detail__copy">
                <Text className="project-config-detail__title" size="sm" fw={650}>{selectedDefinition?.title}</Text>
                <Text className="project-config-detail__description" size="xs" c="dimmed">{selectedDefinition?.description}</Text>
              </div>
            </Group>
            <div className="project-config-detail__content">
              {section === 'style' ? <GlobalStyleChip embedded onSelected={close} /> : null}
              {section === 'lookBible' ? <ProjectLookBibleChip embedded onApplied={close} /> : null}
              {section === 'director' ? <DirectorPersonaChip embedded onSelected={close} /> : null}
            </div>
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  )

  return (
    <>
      {chip}
      {showRoleSkillConfig ? (
        <RoleSkillConfigModal
          projectId={projectId}
          opened={roleSkillOpened}
          onClose={() => setRoleSkillOpened(false)}
        />
      ) : null}
    </>
  )
}
