import { describe, expect, it } from 'vitest'
import {
  buildEffectiveChatSessionKey,
  buildProjectScopedChatSessionBaseKey,
  resolveChatSessionLane,
} from '../../src/ui/chat/chatSessionKey'

describe('chat session key helpers', () => {
  it('builds deterministic project-scoped session keys', () => {
    expect(buildProjectScopedChatSessionBaseKey({
      projectId: 'project-1',
      flowId: 'flow-2',
    })).toBe('project:project-1:flow:flow-2')

    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-random-seed',
      projectId: 'project-1',
      flowId: 'flow-2',
      lane: 'scene',
      skillId: 'storyboard',
    })).toBe('project:project-1:flow:flow-2:conversation:canvas-random-seed:lane:scene:skill:storyboard')
  })

  it('falls back to persisted local session base when project scope is absent', () => {
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-local-seed',
      projectId: '',
      flowId: '',
      lane: 'general',
      skillId: '',
    })).toBe('canvas-local-seed:lane:general:skill:default')
  })

  it('still produces a project-scoped key when no persisted conversation seed is available', () => {
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: '',
      projectId: 'project-1',
      flowId: 'flow-2',
      lane: 'general',
      skillId: 'default',
    })).toBe('project:project-1:flow:flow-2:lane:general:skill:default')
  })

  it('keeps non-creation turns on the general lane', () => {
    expect(resolveChatSessionLane({
      requireProjectTextEvidence: true,
      hasReplicateTarget: false,
    })).toBe('general')

    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-random-seed',
      projectId: 'project-1',
      flowId: 'flow-2',
      lane: 'general',
      skillId: 'default',
    })).toBe('project:project-1:flow:flow-2:conversation:canvas-random-seed:lane:general:skill:default')
  })
})
