import React from 'react'
import StatsAgentsManagement from '../system/agents/StatsAgentsManagement'
import { PanelCard } from '../../PanelCard'

export default function StatsSkillManagement({ className }: { className?: string }): JSX.Element {
  const rootClassName = ['stats-skill-management', className].filter(Boolean).join(' ')

  return (
    <PanelCard className={rootClassName}>
      <StatsAgentsManagement className="stats-skill-management-agents" />
    </PanelCard>
  )
}
