import { describe, expect, it } from 'vitest'
import { buildPendingSkillLaunchPrompt, parsePendingSkillLaunch } from './PendingSkillLaunchConsumer'

describe('pending Skill launch contract', () => {
  it('parses and trims the required structured fields', () => {
    expect(parsePendingSkillLaunch(JSON.stringify({
      projectId: ' project-1 ',
      skillKey: ' public-skill ',
      skillName: ' 故事板做视频 ',
      skillDescription: ' 从故事板生成视频 ',
    }))).toEqual({
      projectId: 'project-1',
      skillKey: 'public-skill',
      skillName: '故事板做视频',
      skillDescription: '从故事板生成视频',
    })
  })

  it('rejects malformed or incomplete launch context', () => {
    expect(() => parsePendingSkillLaunch('{')).toThrow('不是有效 JSON')
    expect(() => parsePendingSkillLaunch(JSON.stringify({ projectId: 'project-1' }))).toThrow('缺少')
  })

  it('builds factual context without claiming the public key is an installed Skill', () => {
    const prompt = buildPendingSkillLaunchPrompt({
      projectId: 'project-1',
      skillKey: 'oiioii-public-1',
      skillName: '故事板做视频',
      skillDescription: '从故事板生成视频',
    })
    expect(prompt).toContain('故事板做视频')
    expect(prompt).toContain('从故事板生成视频')
    expect(prompt).toContain('读取当前真实项目和画布状态')
    expect(prompt).toContain('空画布是正常的创作冷启动状态')
    expect(prompt).toContain('request_user_input')
    expect(prompt).toContain('同一项目、同一会话中继续本次创作')
    expect(prompt).toContain('总视频时长')
    expect(prompt).toContain('最终真实媒体的时长满足合同后报告完成')
    expect(prompt).not.toContain('oiioii-public-1')
  })
})
