import React from 'react'
import { Menu } from '@mantine/core'
import { IconDots, IconEdit, IconShare3, IconTrash } from '@tabler/icons-react'
import type { ProjectDto } from '../api/server'

type ProjectCardActionsMenuProps = {
  project: ProjectDto
  managing: boolean
  sharing: boolean
  shareAvailable: boolean
  onRename: (project: ProjectDto) => void
  onDelete: (project: ProjectDto) => void
  onToggleShare: (project: ProjectDto) => Promise<void>
}

export function ProjectCardActionsMenu({
  project,
  managing,
  sharing,
  shareAvailable,
  onRename,
  onDelete,
  onToggleShare,
}: ProjectCardActionsMenuProps): JSX.Element | null {
  if (project.access === 'team_edit') return null

  return (
    <Menu
      className="project-card-actions"
      withinPortal
      position="bottom-end"
      shadow="md"
      classNames={{ dropdown: 'project-card-actions__dropdown', item: 'project-card-actions__item' }}
    >
      <Menu.Target>
        <button
          className="project-card-actions__trigger"
          type="button"
          aria-label={`管理画布：${project.name}`}
          title="画布操作"
          disabled={managing}
          draggable={false}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconDots className="project-card-actions__trigger-icon" size={16} />
        </button>
      </Menu.Target>
      <Menu.Dropdown className="project-card-actions__content">
        <Menu.Item
          className="project-card-actions__command"
          leftSection={<IconEdit className="project-card-actions__command-icon" size={14} />}
          onClick={() => onRename(project)}
        >
          重命名
        </Menu.Item>
        <Menu.Item
          className="project-card-actions__command"
          leftSection={<IconShare3 className="project-card-actions__command-icon" size={14} />}
          disabled={!shareAvailable || sharing}
          title={shareAvailable ? undefined : '请先切换到真实团队'}
          onClick={() => void onToggleShare(project)}
        >
          {project.teamShared ? '取消团队共享' : '共享到团队'}
        </Menu.Item>
        <Menu.Divider className="project-card-actions__divider" />
        <Menu.Item
          className="project-card-actions__command project-card-actions__command--danger"
          color="red"
          leftSection={<IconTrash className="project-card-actions__command-icon" size={14} />}
          onClick={() => onDelete(project)}
        >
          删除
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
