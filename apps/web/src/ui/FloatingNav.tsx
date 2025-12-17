import React from 'react'
import { ActionIcon, Paper, Stack, Avatar, Badge, useMantineColorScheme, Tooltip } from '@mantine/core'
import { IconPlus, IconTopologyStar3, IconListDetails, IconHistory, IconFolders, IconSettings, IconMovie, IconChartBar } from '@tabler/icons-react'
import WriteImage from '../../public/writer.png'
import { useAuth } from '../auth/store'
import { useUIStore } from './uiStore'
import { $ } from '../canvas/i18n'
import { pingPresence } from '../api/server'

function ImmersiveCreateIcon({ size = 22 }: { size?: number }) {
  const stroke = 'rgba(245,247,255,0.95)'
  const glow = 'rgba(122,226,255,0.9)'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 7.2c0-1.05.85-1.9 1.9-1.9h7.2c1.05 0 1.9.85 1.9 1.9v6.6c0 1.05-.85 1.9-1.9 1.9H7.4c-1.05 0-1.9-.85-1.9-1.9V7.2Z"
        stroke={stroke}
        strokeWidth="1.6"
        opacity="0.95"
      />
      <path
        d="M8.2 12.9c1.25-1.65 2.5-2.25 3.7-1.2 1.25 1.1 2.2.55 3.9-1.25"
        stroke={glow}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.1 18.6c-1.25 0-2.1.95-2.1 2.1 0 .35.28.63.63.63H9.4c.35 0 .63-.28.63-.63 0-1.15-.95-2.1-2.1-2.1H6.1Z"
        fill={stroke}
        opacity="0.9"
      />
      <path
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

export default function FloatingNav(): JSX.Element {
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

  const token = useAuth((s) => s.token)
  const role = useAuth((s) => s.user?.role || null)
  const isAdmin = role === 'admin'
  React.useEffect(() => {
    if (!token) return
    let cancelled = false
    const run = async () => {
      try {
        await pingPresence()
      } catch {
        // ignore presence failures
      }
      if (cancelled) return
      // keep user "online" while the app is open
      const id = window.setInterval(() => {
        void pingPresence().catch(() => {})
      }, 30_000)
      return () => window.clearInterval(id)
    }
    let cleanup: undefined | (() => void)
    void run().then((c) => {
      cleanup = typeof c === 'function' ? c : undefined
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [token])

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
                    <Tooltip label="沉浸式创作" position="right" withArrow>
            <ActionIcon
              variant="light"
              size={36}
              radius="xl"
              aria-label="沉浸式创作（小T）"
              className="floating-nav-item"
              style={{
                background: 'linear-gradient(135deg, rgba(92,122,255,0.22), rgba(122,226,255,0.16))',
                border: '1px solid rgba(255,255,255,0.10)',
                boxShadow: '0 10px 22px rgba(0,0,0,0.22)',
              }}
              onClick={() => {
                setActivePanel(null)
                openLangGraphChat()
              }}
            >
              <img src={WriteImage} style={{width:'36px',height:'36px'}} alt="" />
            </ActionIcon>
          </Tooltip>
          <Item label={$('工作流')} icon={<IconTopologyStar3 size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('template') }} />
          <Item label={$('我的资产')} icon={<IconListDetails size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('assets') }} />
          <Item label={$('TapShow')} icon={<IconMovie size={18} />} onHover={(y) => { setPanelAnchorY(y); setActivePanel('tapshow') }} />
          {isAdmin && (
            <Tooltip label={$('看板（仅管理员）')} position="right" withArrow>
              <ActionIcon
                variant="subtle"
                size={36}
                radius="xl"
                aria-label="看板"
                className="floating-nav-item"
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
                <IconChartBar size={18} />
              </ActionIcon>
            </Tooltip>
          )}
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
