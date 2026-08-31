import { describe, expect, it } from 'vitest'
import { resolveWorkflowIconUrl, resolveWorkflowNodePresentation } from './workflowNodePresentation'

describe('workflow node presentation', () => {
  it.each([
    ['source', 'source'],
    ['agent', 'agent'],
    ['media', 'media'],
    ['skill', 'skill'],
    ['tool', 'tool'],
    ['control', 'control'],
    ['artifact', 'artifact'],
    ['delivery', 'delivery'],
  ] as const)('uses the explicit %s contract as the visual variant', (category, variant) => {
    const presentation = resolveWorkflowNodePresentation({
      kind: 'workflowStage',
      workflowAtomicSpec: {
        category,
        operation: 'test_operation',
        executorRef: 'test.executor/v1',
        executionMode: 'once',
      },
      workflowInputPorts: ['input'],
      workflowOutputPorts: ['output'],
      workflowOperationDescription: '测试节点说明',
    })

    expect(presentation).toMatchObject({
      variant,
      category,
      executorRef: 'test.executor/v1',
      executionModeLabel: '单次',
      inputPorts: ['input'],
      outputPorts: ['output'],
      summary: '测试节点说明',
    })
  })

  it('keeps an unknown stage visibly unclassified instead of guessing from its label', () => {
    const presentation = resolveWorkflowNodePresentation({
      kind: 'workflowStage',
      label: '看起来像 Agent 的节点',
      workflowAtomicSpec: {
        category: 'not-registered',
        operation: '',
      },
    })

    expect(presentation.variant).toBe('stage')
    expect(presentation.category).toBeNull()
    expect(presentation.operationLabel).toBe('未声明操作')
    expect(presentation.executionModeLabel).toBe('执行方式未声明')
  })

  it('distinguishes manual and scheduled triggers from their persisted trigger spec', () => {
    const manual = resolveWorkflowNodePresentation({
      kind: 'workflowTrigger',
      workflowTriggerSpec: { version: 1, kind: 'manual' },
    })
    const schedule = resolveWorkflowNodePresentation({
      kind: 'workflowTrigger',
      workflowTriggerSpec: {
        version: 1,
        kind: 'schedule',
        scheduleId: 'schedule-1',
        cron: '0 9 * * *',
        timezone: 'Asia/Taipei',
        enabled: false,
        misfirePolicy: 'skip',
        maxCatchUpRuns: 0,
      },
    })

    expect(manual).toMatchObject({ variant: 'trigger', triggerKind: 'manual', operationLabel: '手动触发' })
    expect(schedule).toMatchObject({ variant: 'trigger', triggerKind: 'schedule', operationLabel: '定时触发' })
    expect(manual.outputPorts).toEqual(['trigger'])
  })

  it('exposes only complete HTTP(S) custom icon URLs', () => {
    expect(resolveWorkflowIconUrl(' https://cdn.example.com/workflow/icon.png ')).toBe(
      'https://cdn.example.com/workflow/icon.png',
    )
    expect(resolveWorkflowIconUrl('http://cdn.example.com/icon.webp')).toBe('http://cdn.example.com/icon.webp')
    expect(resolveWorkflowIconUrl('data:image/png;base64,abc')).toBeNull()
    expect(resolveWorkflowIconUrl('/relative/icon.png')).toBeNull()

    expect(resolveWorkflowNodePresentation({
      kind: 'workflowStage',
      workflowIconUrl: 'https://cdn.example.com/custom.png',
      workflowAtomicSpec: { category: 'tool', operation: 'estimate' },
    }).iconUrl).toBe('https://cdn.example.com/custom.png')
  })

  it.each([
    ['delivery_contract', '成片交付合同'],
    ['beat_sheet', 'BeatSheet 规划'],
    ['asset_coverage', '视觉资产规划'],
    ['clip_writer', '逐镜提示词'],
    ['prompt_package', '提示词包汇总'],
    ['video_submission', '视频生成提交'],
    ['concat', '成片合成'],
    ['skill_reference', '实际 Skill 引用'],
    ['knowledge_reference', '实际知识引用'],
  ])('uses a specific label for video workflow operation %s', (operation, label) => {
    expect(resolveWorkflowNodePresentation({
      kind: 'workflowStage',
      workflowAtomicSpec: { category: 'tool', operation },
    }).operationLabel).toBe(label)
  })
})
