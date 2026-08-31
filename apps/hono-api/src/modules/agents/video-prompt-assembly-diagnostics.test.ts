import { describe, expect, it } from 'vitest'

import { buildVideoPromptAssemblyDiagnostic } from './video-prompt-assembly-diagnostics'

function beatSheetJson(): string {
  return JSON.stringify({
    version: 2,
    meta: {
      videoModel: 'seedance-2.0',
      generationContract: {
        videoModel: 'seedance-2.0',
        durationOptions: [5, 10],
      },
      userIntentContract: { contractHash: 'sha256:intent' },
    },
    filmBible: {
      directorTone: '克制',
      visualBible: '中性低饱和',
      emotionalArc: '压低后抬升',
      characterArcs: '角色因选择改变',
      continuityBible: '轴线稳定',
      atmosphereStrategy: '只在换场使用空镜',
    },
    adaptationStrategy: { hook: '门后传来脚步声' },
    beats: [{
      clipIndex: 0,
      durationBudget: 10,
      sourceSpanText: '阿青听见门后脚步声，转身看向门口。',
      dialogueScript: [],
      characterRoleNames: ['阿青'],
      temporalContext: {
        timelineId: 'present',
        stateScope: 'present',
        presentation: 'current',
        relationToPrevious: 'opening',
      },
      sceneState: {
        subscene: '门厅',
        interiorExterior: 'interior',
        timeOfDay: '夜晚',
        lighting: '门缝冷光',
        spatialAnchor: '阿青站在门内一步',
        stateIn: '门关闭',
        stateOut: '阿青面向门',
      },
      characterStateVersions: {
        阿青: {
          stateId: 'present-rain-wet',
          visualState: '衣襟沾雨',
          stateIn: '背对门',
          stateOut: '面向门',
        },
      },
      assetObjectContracts: [{ referenceImageNodeIds: ['character-1'] }],
      arcContract: { arcRole: 'opening' },
    }],
  })
}

function writerProvenance(loadedSkillResources: Array<{ skill: string; resource: string }>): Record<string, unknown> {
  return {
    version: 1,
    executionId: 'execution-writer-1',
    agentId: 'writer-1',
    depth: 1,
    model: 'gpt-5.2',
    apiStyle: 'responses',
    requiredSkills: ['tapcanvas-video-prompt-writer'],
    loadedSkills: ['tapcanvas-video-prompt-writer'],
    loadedSkillResources,
    startedAt: '2026-08-10T00:00:00.000Z',
  }
}

describe('buildVideoPromptAssemblyDiagnostic', () => {
  it('projects the real writer reference and deterministic prompt compiler sources', () => {
    const receipt = buildVideoPromptAssemblyDiagnostic({
      artifactKey: 'clip:0',
      artifactStatus: 'ready',
      beatSheetJson: beatSheetJson(),
      artifactPayloadJson: JSON.stringify({
        clipIndex: 0,
        outputHash: 'sha256:prompt',
        writerExecutionProvenance: writerProvenance([{
          skill: 'tapcanvas-video-prompt-writer',
          resource: 'references/dramatic-direction-contract.md',
        }]),
        clip: {
          durationSeconds: 10,
          shots: [{ shotNo: 1, action: '阿青转身看向门口', durationSeconds: 10 }],
          clipPrompt: '【静默视觉控制表·全部禁止朗读】\n镜1｜阿青转身看向门口',
        },
      }),
    })

    expect(receipt?.state).toBe('complete')
    expect(receipt?.steps.map((step) => step.title)).toEqual([
      '锁定用户要求与视频生成边界',
      '收集全片与当前 Clip 的真实事实',
      'Writer 自主设计结构化 Shots',
      '冻结 Writer 的结构化产物',
      '确定性渲染视频执行提示词',
      '在提交边界绑定真实参考资产',
    ])
    expect(receipt?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'skill_reference',
        status: 'applied',
        ref: 'apps/agents-cli/skills/tapcanvas-video-prompt-writer/references/dramatic-direction-contract.md',
      }),
      expect.objectContaining({
        kind: 'compiler',
        ref: 'apps/hono-api/src/modules/task/video-orchestrator.clip-shots.ts#compileStructuredClipForExecution',
      }),
    ]))
    expect(receipt?.finalPrompt).toEqual(expect.objectContaining({
      characterCount: 28,
      hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }))
    expect(receipt?.version).toBe(2)
    expect(receipt?.contractSnapshot).toMatchObject({
      sourceSpanText: '阿青听见门后脚步声，转身看向门口。',
      dialogueScriptJson: '[]',
    })
    expect(receipt?.finalPrompt?.text).toContain('阿青转身看向门口')
  })

  it('states that no optional reference was used instead of guessing one', () => {
    const receipt = buildVideoPromptAssemblyDiagnostic({
      artifactKey: 'clip:0',
      artifactStatus: 'running',
      beatSheetJson: beatSheetJson(),
      artifactPayloadJson: JSON.stringify({
        clipIndex: 0,
        writerExecutionProvenance: writerProvenance([]),
      }),
    })

    expect(receipt?.state).toBe('pending')
    expect(receipt?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'writer-reference-none',
        status: 'not_used',
      }),
    ]))
    expect(receipt?.finalPrompt).toBeNull()
  })

  it('marks historical provenance without resource evidence as unavailable', () => {
    const historicalProvenance = writerProvenance([])
    delete historicalProvenance.loadedSkillResources
    const receipt = buildVideoPromptAssemblyDiagnostic({
      artifactKey: 'clip:0',
      artifactStatus: 'ready',
      beatSheetJson: beatSheetJson(),
      artifactPayloadJson: JSON.stringify({
        clipIndex: 0,
        writerExecutionProvenance: historicalProvenance,
        clip: {
          shots: [{ shotNo: 1 }],
          clipPrompt: '镜1｜阿青转身看向门口',
        },
      }),
    })

    expect(receipt?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'writer-reference-none',
        status: 'unavailable',
      }),
    ]))
    expect(receipt?.state).toBe('partial')
  })
})
