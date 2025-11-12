import React from 'react'
import { ActionIcon, Paper, Stack, Tooltip, Avatar, Badge } from '@mantine/core'
import { IconPlus, IconTopologyStar3, IconListDetails, IconHistory, IconPhotoEdit, IconRuler, IconHelpCircle } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { notifications } from '@mantine/notifications'

export default function FloatingNav(): JSX.Element {
  const { setActivePanel, setPanelAnchorY } = useUIStore()

  const Item = ({ label, icon, onHover, badge }: { label: string; icon: React.ReactNode; onHover: (y: number) => void; badge?: string }) => (
    <Tooltip label={label} position="right" withArrow>
      <div style={{ position: 'relative' }} onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onHover(r.top + r.height/2) }} data-ux-floating>
        <ActionIcon variant="subtle" size={36} radius="xl" aria-label={label}>
          {icon}
        </ActionIcon>
        {badge && (
          <Badge color="gray" size="xs" variant="light" style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}>{badge}</Badge>
        )}
      </div>
    </Tooltip>
  )

  return (
    <div style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 70 }} data-ux-floating>
      <Paper withBorder shadow="sm" radius="xl" className="glass" p={6} data-ux-floating>
        <Stack align="center" gap={6}>
          <Tooltip label="添加" position="right" withArrow>
            <ActionIcon size={40} radius={999} style={{ background: '#fff', color: '#0b0b0d' }}
              onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPanelAnchorY(r.top + r.height/2); setActivePanel('add') }} data-ux-floating>
              <IconPlus size={18} />
            </ActionIcon>
          </Tooltip>
          <div style={{ height: 6 }} />
          <Item label="工作流" icon={<IconTopologyStar3 size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('template') }} />
          <Item label="我的资产" icon={<IconListDetails size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('assets') }} />
          <Item label="历史记录" icon={<IconHistory size={18} />} onHover={() => { /* no panel yet */ }} />
          <Item label="图片编辑" icon={<IconPhotoEdit size={18} />} onHover={() => { /* no panel yet */ }} badge="Beta" />
          <Item label="标尺" icon={<IconRuler size={18} />} onHover={() => { /* no panel yet */ }} />
          <Item label="帮助" icon={<IconHelpCircle size={18} />} onHover={() => { /* no panel yet */ }} />
          <div style={{ height: 8 }} />
          <Avatar size={30} radius={999} src={undefined} alt="user" data-ux-floating>
            🐰
          </Avatar>
        </Stack>
      </Paper>
    </div>
  )
}
