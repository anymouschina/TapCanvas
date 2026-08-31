import { describe, expect, it } from 'vitest'
import {
  collectTextExecutionPromptCandidates,
  resolveExecutionPromptSourceCategory,
} from './executionPromptSource'

describe('execution prompt sources', () => {
  it('treats a shot table as a text prompt source through the unified node schema', () => {
    expect(resolveExecutionPromptSourceCategory('shotTable')).toBe('text')
    expect(collectTextExecutionPromptCandidates('shotTable', {
      shotTableRawText: '镜号\t时长\t画面\n01\t5s\t角色推门进入',
    })).toEqual(['镜号\t时长\t画面\n01\t5s\t角色推门进入'])
  })

  it('prefers the applied shot-table serialization before a stale mirrored prompt', () => {
    expect(collectTextExecutionPromptCandidates('shotTable', {
      shotTableRawText: '已应用的分镜表',
      prompt: '旧提示词副本',
    })).toEqual(['已应用的分镜表'])
  })

  it('uses the mirrored prompt only when an older shot table has no applied serialization', () => {
    expect(collectTextExecutionPromptCandidates('shotTable', {
      prompt: '旧画布中的分镜表提示词',
    })).toEqual(['旧画布中的分镜表提示词'])
  })

  it('accepts legacy text aliases without treating unknown kinds as text', () => {
    expect(resolveExecutionPromptSourceCategory('scriptDoc')).toBe('text')
    expect(resolveExecutionPromptSourceCategory('unknown-semantic-node')).toBeNull()
    expect(collectTextExecutionPromptCandidates('unknown-semantic-node', {
      prompt: '不得被隐式接入',
    })).toEqual([])
  })
})
