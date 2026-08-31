import React from 'react'
import { Group, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { IconActivity, IconListDetails } from '@tabler/icons-react'
import StatsRuntimeDiagnostics from './StatsRuntimeDiagnostics'
import StatsTaskLogs from './StatsTaskLogs'

type DiagnosticsSection = 'runtime' | 'taskLogs'

export default function StatsSystemManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-system', className].filter(Boolean).join(' ')
  const [section, setSection] = React.useState<DiagnosticsSection>('taskLogs')

  return (
    <Stack className={rootClassName} gap="md">
      <Group className="stats-system__header" justify="space-between" align="flex-end" wrap="wrap">
        <div className="stats-system__heading">
          <Title className="stats-system__title" order={3}>诊断与日志</Title>
          <Text className="stats-system__subtitle" size="sm" c="dimmed">检查当前浏览器运行时状态，并按条件检索服务端生成任务记录。</Text>
        </div>
        <SegmentedControl
          className="stats-system__section-control"
          value={section}
          onChange={(value) => setSection(value as DiagnosticsSection)}
          data={[
            { value: 'taskLogs', label: '生成任务日志' },
            { value: 'runtime', label: '运行时诊断' },
          ]}
        />
      </Group>

      <div className="stats-system__content">
        {section === 'taskLogs' ? (
          <Stack className="stats-system__task-logs-section" gap="sm">
            <Group className="stats-system__section-heading" gap="xs">
              <IconListDetails className="stats-system__section-icon" size={17} />
              <Text className="stats-system__section-title" fw={700}>生成任务日志</Text>
            </Group>
            <StatsTaskLogs className="stats-system__task-logs" />
          </Stack>
        ) : (
          <Stack className="stats-system__runtime-section" gap="sm">
            <Group className="stats-system__section-heading" gap="xs">
              <IconActivity className="stats-system__section-icon" size={17} />
              <Text className="stats-system__section-title" fw={700}>运行时诊断</Text>
            </Group>
            <StatsRuntimeDiagnostics className="stats-system__runtime" />
          </Stack>
        )}
      </div>
    </Stack>
  )
}
