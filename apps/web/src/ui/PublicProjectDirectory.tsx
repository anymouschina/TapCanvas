import { ActionIcon, ScrollArea, Text, Tooltip } from '@mantine/core'
import { IconChevronLeft, IconFolder, IconLayoutGrid } from '@tabler/icons-react'
import type { PublicProjectFlowDto } from '../api/server'

type PublicProjectDirectoryProps = {
  projectName: string
  flows: PublicProjectFlowDto[]
  selectedFlowId: string | null
  onSelectFlow: (flowId: string) => void
  onBack: () => void
}

export function PublicProjectDirectory({
  projectName,
  flows,
  selectedFlowId,
  onSelectFlow,
  onBack,
}: PublicProjectDirectoryProps): JSX.Element {
  const projectFlows = flows.filter((flow) => flow.ownerType !== 'chapter')
  const chapterFlows = flows.filter((flow) => flow.ownerType === 'chapter')

  const renderFlow = (flow: PublicProjectFlowDto): JSX.Element => {
    const selected = flow.id === selectedFlowId
    return (
      <button
        className={`tc-public-workspace-directory__flow${selected ? ' tc-public-workspace-directory__flow--selected' : ''}`}
        key={flow.id}
        type="button"
        role="treeitem"
        aria-selected={selected}
        onClick={() => onSelectFlow(flow.id)}
      >
        <IconLayoutGrid className="tc-public-workspace-directory__flow-icon" size={15} aria-hidden="true" />
        <span className="tc-public-workspace-directory__flow-name">{flow.name || '未命名画布'}</span>
      </button>
    )
  }

  return (
    <aside className="tc-public-workspace-directory" aria-label="项目目录">
      <header className="tc-public-workspace-directory__header">
        <Tooltip className="tc-public-workspace-directory__tooltip" label="返回作品" withArrow>
          <ActionIcon
            className="tc-public-workspace-directory__back"
            variant="subtle"
            aria-label="返回作品"
            onClick={onBack}
          >
            <IconChevronLeft className="tc-public-workspace-directory__back-icon" size={18} />
          </ActionIcon>
        </Tooltip>
        <div className="tc-public-workspace-directory__heading">
          <Text className="tc-public-workspace-directory__eyebrow" size="xs" c="dimmed">项目目录</Text>
          <Text className="tc-public-workspace-directory__project-name" fw={600} lineClamp={1}>
            {projectName}
          </Text>
        </div>
      </header>

      <ScrollArea className="tc-public-workspace-directory__scroll" type="auto" scrollbarSize={7}>
        <div className="tc-public-workspace-directory__tree" role="tree" aria-label={`${projectName}的画布目录`}>
          <div className="tc-public-workspace-directory__root" role="treeitem" aria-expanded="true">
            <IconFolder className="tc-public-workspace-directory__root-icon" size={16} aria-hidden="true" />
            <Text className="tc-public-workspace-directory__root-label" size="sm" fw={600} lineClamp={1}>
              {projectName}
            </Text>
          </div>
          <div className="tc-public-workspace-directory__flows" role="group">
            {projectFlows.length > 0 ? (
              <div className="tc-public-workspace-directory__section">
                <Text className="tc-public-workspace-directory__section-label" size="xs" c="dimmed">项目画布</Text>
                {projectFlows.map(renderFlow)}
              </div>
            ) : null}
            {chapterFlows.length > 0 ? (
              <div className="tc-public-workspace-directory__section">
                <Text className="tc-public-workspace-directory__section-label" size="xs" c="dimmed">章节</Text>
                {chapterFlows.map(renderFlow)}
              </div>
            ) : null}
          </div>
        </div>
      </ScrollArea>

      <footer className="tc-public-workspace-directory__footer">
        <Text className="tc-public-workspace-directory__readonly" size="xs" c="dimmed">只读制作过程</Text>
      </footer>
    </aside>
  )
}
