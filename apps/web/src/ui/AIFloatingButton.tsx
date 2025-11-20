import React from 'react'
import { ActionIcon } from '@mantine/core'
import { IconMessage } from '@tabler/icons-react'
import { useUIStore } from '../ui/uiStore'

const animationStyles = `
  @keyframes pulse-glow {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
    70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
  }

  .ai-assistant-fab {
    transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    border: 2px solid rgba(255, 255, 255, 0.2) !important;
    color: white !important;
  }

  .ai-assistant-fab:hover {
    transform: scale(1.1) rotate(15deg) !important;
    background: linear-gradient(135deg, #764ba2 0%, #667eea 100%) !important;
  }

  .ai-assistant-fab.active {
    animation: pulse-glow 2s infinite;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%) !important;
  }
`

export default function AIFloatingButton(): JSX.Element {
  const { activePanel, setActivePanel } = useUIStore()

  const isActive = activePanel === 'ai-chat'

  const handleClick = () => {
    setActivePanel(isActive ? null : 'ai-chat')
  }

  React.useEffect(() => {
    const styleElement = document.createElement('style')
    styleElement.textContent = animationStyles
    document.head.appendChild(styleElement)

    return () => {
      document.head.removeChild(styleElement)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 5999 }}>
      <ActionIcon
        size={56}
        radius={999}
        className={`ai-assistant-fab ${isActive ? 'active' : ''}`}
        onClick={handleClick}
        variant="filled"
      >
        <IconMessage size={28} />
      </ActionIcon>
    </div>
  )
}