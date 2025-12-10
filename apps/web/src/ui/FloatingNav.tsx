import React from 'react'
import { ActionIcon, Paper, Stack, Avatar, Badge, useMantineColorScheme } from '@mantine/core'
import { IconPlus, IconTopologyStar3, IconListDetails, IconHistory, IconPhotoEdit, IconRuler, IconHelpCircle, IconFolders, IconSettings, IconMovie } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useAuth } from '../auth/store'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { listServerFlows, saveServerFlow, getServerFlow } from '../api/server'
import { $ } from '../canvas/i18n'

// 添加CSS动画样式
const animationStyles = `
  @keyframes bounce-in {
    0% { transform: scale(1) rotate(0deg); }
    50% { transform: scale(1.2) rotate(8deg); }
    100% { transform: scale(1.15) rotate(5deg); }
  }

  .floating-nav-item {
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  .floating-nav-item:hover {
    animation: bounce-in 0.3s ease-out;
    transform: scale(1.15) rotate(5deg) !important;
  }

  .floating-nav-add {
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  .floating-nav-add:hover {
    animation: bounce-in 0.3s ease-out;
    transform: scale(1.1) rotate(90deg) !important;
  }

  .floating-nav-avatar {
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  .floating-nav-avatar:hover {
    animation: bounce-in 0.3s ease-out;
    transform: scale(1.15) rotate(-5deg) !important;
  }
`

export default function FloatingNav(): JSX.Element {
  const { setActivePanel, setPanelAnchorY } = useUIStore()
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const addButtonBackground = isDark ? 'rgba(15,23,42,0.85)' : '#ffffff'
  const addButtonColor = isDark ? '#f8fafc' : '#0b0b0d'
  const addButtonShadow = isDark ? '0 6px 16px rgba(0,0,0,0.45)' : '0 10px 20px rgba(15,23,42,0.12)'

  // 注入CSS样式
  React.useEffect(() => {
    const styleElement = document.createElement('style')
    styleElement.textContent = animationStyles
    document.head.appendChild(styleElement)

    return () => {
      document.head.removeChild(styleElement)
    }
  }, [])

  const Item = ({ label, icon, onHover, badge }: { label: string; icon: React.ReactNode; onHover: (y: number) => void; badge?: string }) => (
    <div style={{ position: 'relative' }} data-ux-floating>
      <ActionIcon
        variant="subtle"
        size={36}
        radius="xl"
        aria-label={label}
        className="floating-nav-item"
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onHover(r.top + r.height/2)
        }}
      >
        {icon}
      </ActionIcon>
      {badge && (
        <Badge color="gray" size="xs" variant="light" style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}>{badge}</Badge>
      )}
    </div>
  )

  return (
    <div style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 300 }} data-ux-floating>
      <Paper withBorder shadow="sm" radius="xl" className="glass" p={6} data-ux-floating>
        <Stack align="center" gap={6}>
          <ActionIcon
              size={40}
              radius={999}
              className="floating-nav-add"
              style={{
                background: addButtonBackground,
                color: addButtonColor,
                boxShadow: addButtonShadow,
              }}
              onMouseEnter={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPanelAnchorY(r.top + r.height/2);
                setActivePanel('add')
              }}
              data-ux-floating>
              <IconPlus size={18} />
            </ActionIcon>
          <div style={{ height: 6 }} />
          <Item label={$('项目')} icon={<IconFolders size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('project') }} />
          <Item label={$('工作流')} icon={<IconTopologyStar3 size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('template') }} />
          <Item label={$('我的资产')} icon={<IconListDetails size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('assets') }} />
          <Item label={$('TapShow')} icon={<IconMovie size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('tapshow') }} />
          <Item label={$('模型配置')} icon={<IconSettings size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('models') }} />
          <Item label={$('历史记录')} icon={<IconHistory size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('history') }} />
          {/* <Item label="图片编辑" icon={<IconPhotoEdit size={18} />}  badge="Beta" /> */}
          {/* <Item label="标尺" icon={<IconRuler size={18} />}  /> */}
          {/* <Item label="帮助" icon={<IconHelpCircle size={18} />}  /> */}
          <div style={{ height: 8 }} />
          {(() => {
            const user = useAuth.getState().user
            return (
              <Avatar
                size={30}
                radius={999}
                src={user?.avatarUrl}
                alt={user?.login || 'user'}
                className="floating-nav-avatar"
                style={{
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  useUIStore.getState().setPanelAnchorY(r.top + r.height/2);
                  useUIStore.getState().setActivePanel('account')
                }}
                data-ux-floating>
                {user?.login?.[0]?.toUpperCase() || 'U'}
              </Avatar>
            )
          })()}
        </Stack>
      </Paper>
    </div>
  )
}
