import React from 'react'
import { ActionIcon, Paper, Stack, Avatar, Badge, useMantineColorScheme, Tooltip } from '@mantine/core'
import { IconPlus, IconTopologyStar3, IconListDetails, IconHistory, IconFolders, IconSettings, IconMovie, IconChartBar, IconTerminal2, IconKey } from '@tabler/icons-react'
import { useAuth } from '../auth/store'
import { useIsAdmin } from '../auth/isAdmin'
import { useUIStore } from './uiStore'
import { $ } from '../canvas/i18n'

const WriteImage = '/writer.png'

function ImmersiveCreateIcon({ size = 22 }: { size?: number }) {
  const stroke = 'rgba(245,247,255,0.95)'
  const glow = 'rgba(122,226,255,0.9)'
  return (
    <svg className="floating-nav-immersive-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        className="floating-nav-immersive-icon-path"
        d="M5.5 7.2c0-1.05.85-1.9 1.9-1.9h7.2c1.05 0 1.9.85 1.9 1.9v6.6c0 1.05-.85 1.9-1.9 1.9H7.4c-1.05 0-1.9-.85-1.9-1.9V7.2Z"
        stroke={stroke}
        strokeWidth="1.6"
        opacity="0.95"
      />
      <path
        className="floating-nav-immersive-icon-path"
        d="M8.2 12.9c1.25-1.65 2.5-2.25 3.7-1.2 1.25 1.1 2.2.55 3.9-1.25"
        stroke={glow}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        className="floating-nav-immersive-icon-path"
        d="M6.1 18.6c-1.25 0-2.1.95-2.1 2.1 0 .35.28.63.63.63H9.4c.35 0 .63-.28.63-.63 0-1.15-.95-2.1-2.1-2.1H6.1Z"
        fill={stroke}
        opacity="0.9"
      />
      <path
        className="floating-nav-immersive-icon-path"
        d="M17.7 3.8l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55.55-1.25Z"
        fill={glow}
        opacity="0.9"
      />
    </svg>
  )
}

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

export default function FloatingNav({ className }: { className?: string }): JSX.Element {
  const { setActivePanel, setPanelAnchorY, openLangGraphChat } = useUIStore()
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

  const isAdmin = useIsAdmin()
  // Removed presence ping heartbeat: Cloudflare Workers does not need keep-alive and this endpoint isn't used elsewhere.

  const Item = ({ label, icon, onHover, badge }: { label: string; icon: React.ReactNode; onHover: (y: number) => void; badge?: string }) => (
    <div className="floating-nav-item-wrap" style={{ position: 'relative' }} data-ux-floating>
      <ActionIcon
        className="floating-nav-item"
        variant="subtle"
        size={36}
        radius="xl"
        aria-label={label}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onHover(r.top + r.height/2)
        }}
      >
        {icon}
      </ActionIcon>
      {badge && (
        <Badge className="floating-nav-item-badge" color="gray" size="xs" variant="light" style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}>{badge}</Badge>
      )}
    </div>
  )

  const navClassName = ['floating-nav', className].filter(Boolean).join(' ')

  return (
    <div className={navClassName} style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)', zIndex: 300 }} data-ux-floating data-tour="floating-nav">
      <Paper className="floating-nav-card glass" withBorder shadow="sm" radius="xl" p={6} data-ux-floating>
        <Stack className="floating-nav-stack" align="center" gap={6}>
          <ActionIcon
              className="floating-nav-add"
              size={40}
              radius={999}
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
              data-ux-floating
              data-tour="add-button">
              <IconPlus className="floating-nav-add-icon" size={18} />
            </ActionIcon>
          <div className="floating-nav-spacer" style={{ height: 6 }} />
          <Item label={$('项目')} icon={<IconFolders className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('project') }} />
                    <Tooltip className="floating-nav-immersive-tooltip" label="沉浸式创作" position="right" withArrow>
            <ActionIcon
              className="floating-nav-immersive"
              variant="light"
              size={36}
              radius="xl"
              aria-label="沉浸式创作（小T）"
              style={{
                background: 'linear-gradient(135deg, rgba(92,122,255,0.22), rgba(122,226,255,0.16))',
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: '0 10px 22px rgba(0,0,0,0.22)',
              }}
              onClick={() => {
                setActivePanel(null)
                openLangGraphChat()
              }}
              data-tour="immersive-create"
            >
              <img className="floating-nav-immersive-img" src={WriteImage} style={{width:'36px',height:'36px'}} alt="" />
            </ActionIcon>
          </Tooltip>
          <Item label={$('工作流')} icon={<IconTopologyStar3 className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('template') }} />
          <Item label={$('我的资产')} icon={<IconListDetails className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('assets') }} />
          <Item label={$('TapShow')} icon={<IconMovie className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('tapshow') }} />
          <Item label={$('运行记录')} icon={<IconTerminal2 className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('runs') }} />
          {isAdmin && (
            <Tooltip className="floating-nav-admin-tooltip" label={$('看板（仅管理员）')} position="right" withArrow>
              <ActionIcon
                className="floating-nav-item"
                variant="subtle"
                size={36}
                radius="xl"
                aria-label="看板"
                onClick={() => {
                  try {
                    const url = new URL(window.location.href)
                    url.search = ''
                    url.hash = ''
                    url.pathname = '/stats'
                    window.open(url.toString(), '_blank', 'noopener,noreferrer')
                  } catch {
                    window.open('/stats', '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                <IconChartBar className="floating-nav-item-icon" size={18} />
              </ActionIcon>
            </Tooltip>
          )}
          <Item label={$('模型配置')} icon={<IconSettings className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('models') }} />
          <Item label={$('三方 API')} icon={<IconKey className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('thirdPartyApi') }} />
          <Item label={$('历史记录')} icon={<IconHistory className="floating-nav-item-icon" size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('history') }} />

          {/* <Item label="图片编辑" icon={<IconPhotoEdit size={18} />}  badge="Beta" /> */}
          {/* <Item label="标尺" icon={<IconRuler size={18} />}  /> */}
          {/* <Item label="帮助" icon={<IconHelpCircle size={18} />}  /> */}
          <div className="floating-nav-spacer" style={{ height: 8 }} />
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
