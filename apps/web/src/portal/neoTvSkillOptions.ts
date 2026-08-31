import type { AgentSkillDto } from '../api/server'

const SKILLS_PER_ROW = 4
const MARKETPLACE_SLOT_COUNT = 1

export function hasSkillImage(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.trim().length > 0
}

export function buildNeoTvSkillRows(
  skills: AgentSkillDto[],
  rowBudget: 1 | 2,
): AgentSkillDto[][] {
  const capacity = rowBudget * SKILLS_PER_ROW - MARKETPLACE_SLOT_COUNT
  const visibleSkills = skills.filter((skill) => hasSkillImage(skill.logoUrl)).slice(0, capacity)

  if (rowBudget === 1 || visibleSkills.length <= SKILLS_PER_ROW - MARKETPLACE_SLOT_COUNT) {
    return [visibleSkills]
  }

  return [
    visibleSkills.slice(0, SKILLS_PER_ROW),
    visibleSkills.slice(SKILLS_PER_ROW),
  ]
}

