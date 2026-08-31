import { describe, expect, it } from 'vitest'
import type { AgentSkillDto } from '../api/server'
import { buildNeoTvSkillRows, hasSkillImage } from './neoTvSkillOptions'

function createSkill(index: number, logoUrl: string | null): AgentSkillDto {
  return {
    id: `skill-${index}`,
    key: `skill-${index}`,
    name: `Skill ${index}`,
    description: null,
    logoUrl,
    category: 'creative',
    enabled: true,
    visible: true,
    sortOrder: index,
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

describe('TcTv skill options', () => {
  it('recognizes only non-empty logo URLs as displayable images', () => {
    expect(hasSkillImage('https://assets.example.com/skill.png')).toBe(true)
    expect(hasSkillImage('')).toBe(false)
    expect(hasSkillImage('   ')).toBe(false)
    expect(hasSkillImage(null)).toBe(false)
  })

  it('uses at most two rows and reserves the last slot for the marketplace', () => {
    const skills = Array.from({ length: 10 }, (_, index) => createSkill(index, `https://assets.example.com/${index}.png`))
    const rows = buildNeoTvSkillRows(skills, 2)

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.length)).toEqual([4, 3])
    expect(rows.flat().map((skill) => skill.id)).toEqual(skills.slice(0, 7).map((skill) => skill.id))
  })

  it('filters missing logos before applying the one-row capacity', () => {
    const skills = [
      createSkill(0, null),
      createSkill(1, 'https://assets.example.com/1.png'),
      createSkill(2, ''),
      createSkill(3, 'https://assets.example.com/3.png'),
      createSkill(4, 'https://assets.example.com/4.png'),
      createSkill(5, 'https://assets.example.com/5.png'),
    ]

    expect(buildNeoTvSkillRows(skills, 1).flat().map((skill) => skill.id)).toEqual([
      'skill-1',
      'skill-3',
      'skill-4',
    ])
  })
})

