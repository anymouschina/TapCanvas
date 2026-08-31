import React from 'react'
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSkillDto } from '../../api/server'
import { SkillPickerPopover, type SkillPickerOption } from './SkillPickerPopover'

const SKILL: AgentSkillDto = {
  id: 'skill-storyboard',
  key: 'storyboard',
  name: '分镜专家',
  description: '生成可执行分镜',
  category: '创作',
  logoUrl: null,
  enabled: true,
  visible: true,
  sortOrder: 1,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const PURCHASED_SKILL: SkillPickerOption = {
  id: 'asset-wanwusheng',
  key: 'user-skill:asset-wanwusheng',
  name: '万物生3prompt skill',
  description: 'Seedance prompt 写作',
  category: '已购技能',
  logoUrl: null,
  source: 'marketplace',
}

describe('SkillPickerPopover', () => {
  it('opens the picker first and invokes management only from the manage command', async () => {
    const onManage = vi.fn()

    render(
      <MantineProvider>
        <SkillPickerPopover
          selectionMode="single"
          activeSkill={null}
          disabled={false}
          error=""
          loading={false}
          skills={[SKILL, PURCHASED_SKILL]}
          onManage={onManage}
          onRefresh={async () => undefined}
          onSelect={() => undefined}
        />
      </MantineProvider>,
    )

    expect(screen.queryByRole('button', { name: '管理技能' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择技能' }))

    const manageButton = await screen.findByRole('button', { name: '管理技能' })
    expect(onManage).not.toHaveBeenCalled()
    expect(screen.getByText('分镜专家')).toBeInTheDocument()
    expect(screen.getByText('已购 · Seedance prompt 写作')).toBeInTheDocument()

    fireEvent.click(manageButton)
    expect(onManage).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('button', { name: '管理技能' })).not.toBeInTheDocument())
  })

  it('keeps the bubble open while toggling multiple explicit skills', async () => {
    const onManage = vi.fn()
    const onSelect = vi.fn()

    render(
      <MantineProvider>
        <SkillPickerPopover
          selectionMode="multiple"
          selectedSkillIds={[]}
          disabled={false}
          error=""
          loading={false}
          skills={[SKILL]}
          onManage={onManage}
          onRefresh={async () => undefined}
          onSelect={onSelect}
          triggerClassName="neo-tv-launcher__tool"
          triggerIconClassName="neo-tv-launcher__tool-icon"
        />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '选择技能' }))
    fireEvent.click(await screen.findByRole('button', { name: /分镜专家/ }))

    expect(onSelect).toHaveBeenCalledWith(SKILL.id)
    expect(onManage).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '管理技能' })).toBeInTheDocument()
  })
})
