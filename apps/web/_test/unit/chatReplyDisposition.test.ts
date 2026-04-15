import { describe, expect, it } from 'vitest'
import {
  formatChatTurnVerdictSummary,
  isFailedChatTurn,
  readChatTurnVerdict,
  shouldAutoAddAssistantAssetsToCanvas,
  shouldShowMissingCanvasPlanError,
} from '../../src/ui/chat/replyDisposition'

describe('chat reply disposition', () => {
  it('does not treat plain identity answers as missing canvas plans', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: false,
        response: {
          agentDecision: {
            executionKind: 'answer',
            canvasAction: 'none',
            assetCount: 0,
            projectStateRead: false,
            requiresConfirmation: false,
            reason: 'mode=text_only',
          },
          trace: {
            outputMode: 'text_only',
          },
        },
      }),
    ).toBe(false)
  })

  it('does not force canvas-plan errors for plain answers in plan-only mode', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: false,
        response: {
          agentDecision: {
            executionKind: 'answer',
            canvasAction: 'none',
            assetCount: 0,
            projectStateRead: false,
            requiresConfirmation: true,
            reason: 'identity_answer',
          },
          trace: {
            outputMode: 'text_only',
          },
        },
      }),
    ).toBe(false)
  })

  it('still reports missing plans when planning mode returns no plan payload', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: false,
        response: {
          agentDecision: {
            executionKind: 'plan',
            canvasAction: 'create_canvas_workflow',
            assetCount: 0,
            projectStateRead: true,
            requiresConfirmation: true,
            reason: 'mode=plan_only',
          },
          trace: {
            outputMode: 'plan_only',
          },
        },
      }),
    ).toBe(true)
  })

  it('reports malformed canvas plan tags', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: true,
        response: {
          agentDecision: {
            executionKind: 'plan',
            canvasAction: 'create_canvas_workflow',
            assetCount: 0,
            projectStateRead: true,
            requiresConfirmation: true,
            reason: 'malformed-tag',
          },
          trace: {
            outputMode: 'text_only',
          },
        },
      }),
    ).toBe(true)
  })

  it('does not treat direct canvas writes as missing canvas plans', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: false,
        response: {
          agentDecision: {
            executionKind: 'execute',
            canvasAction: 'write_canvas',
            assetCount: 0,
            projectStateRead: true,
            requiresConfirmation: false,
            reason: 'mode=text_only; canvas_write_done',
          },
          trace: {
            outputMode: 'text_only',
          },
        },
      }),
    ).toBe(false)
  })

  it('does not auto-add assistant assets when backend already wrote to canvas', () => {
    expect(
      shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted: false,
        aiChatWatchAssetsEnabled: true,
        assistantAssetCount: 1,
        response: {
          agentDecision: {
            executionKind: 'execute',
            canvasAction: 'write_canvas',
            assetCount: 1,
            projectStateRead: true,
            requiresConfirmation: false,
            reason: 'mode=direct_assets; canvas_write_done',
          },
          trace: {
            outputMode: 'direct_assets',
            toolEvidence: {
              toolNames: ['tapcanvas_run_task', 'tapcanvas_flow_patch'],
              readProjectState: true,
              readBookList: false,
              readBookIndex: false,
              readChapter: false,
              readStoryboardHistory: false,
              readMaterialAssets: false,
              generatedAssets: true,
              wroteCanvas: true,
            },
          },
        },
      }),
    ).toBe(false)
  })

  it('still auto-adds assistant assets when backend only returned assets', () => {
    expect(
      shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted: false,
        aiChatWatchAssetsEnabled: true,
        assistantAssetCount: 1,
        response: {
          agentDecision: {
            executionKind: 'generate',
            canvasAction: 'none',
            assetCount: 1,
            projectStateRead: true,
            requiresConfirmation: false,
            reason: 'mode=direct_assets',
          },
          trace: {
            outputMode: 'direct_assets',
            toolEvidence: {
              toolNames: ['tapcanvas_run_task'],
              readProjectState: true,
              readBookList: false,
              readBookIndex: false,
              readChapter: false,
              readStoryboardHistory: false,
              readMaterialAssets: false,
              generatedAssets: true,
              wroteCanvas: false,
            },
          },
        },
      }),
    ).toBe(true)
  })

  it('detects backend verdict failure for invalid canvas plans', () => {
    expect(
      shouldShowMissingCanvasPlanError({
        hasCanvasPlan: false,
        hasWrongCanvasPlanTag: false,
        response: {
          agentDecision: {
            executionKind: 'plan',
            canvasAction: 'create_canvas_workflow',
            assetCount: 0,
            projectStateRead: true,
            requiresConfirmation: true,
            reason: 'mode=plan_only',
          },
          trace: {
            outputMode: 'text_only',
            turnVerdict: {
              status: 'failed',
              reasons: ['invalid_canvas_plan'],
            },
          },
        },
      }),
    ).toBe(true)
  })

  it('does not auto-add assistant assets when backend marked the turn as failed', () => {
    expect(
      shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted: false,
        aiChatWatchAssetsEnabled: true,
        assistantAssetCount: 1,
        response: {
          agentDecision: {
            executionKind: 'generate',
            canvasAction: 'none',
            assetCount: 1,
            projectStateRead: true,
            requiresConfirmation: false,
            reason: 'mode=direct_assets',
          },
          trace: {
            outputMode: 'direct_assets',
            turnVerdict: {
              status: 'failed',
              reasons: ['invalid_canvas_plan'],
            },
            toolEvidence: {
              toolNames: ['tapcanvas_run_task'],
              readProjectState: true,
              readBookList: false,
              readBookIndex: false,
              readChapter: false,
              readStoryboardHistory: false,
              readMaterialAssets: false,
              generatedAssets: true,
              wroteCanvas: false,
            },
          },
        },
      }),
    ).toBe(false)
  })

  it('reads structured turn verdicts from backend trace', () => {
    expect(
      readChatTurnVerdict({
        trace: {
          outputMode: 'text_only',
          turnVerdict: {
            status: 'partial',
            reasons: ['tool_execution_issues', 'diagnostic_flags_present'],
          },
        },
      }),
    ).toEqual({
      status: 'partial',
      reasons: ['tool_execution_issues', 'diagnostic_flags_present'],
    })
  })

  it('formats readable verdict summaries', () => {
    expect(
      formatChatTurnVerdictSummary({
        trace: {
          outputMode: 'text_only',
          turnVerdict: {
            status: 'failed',
            reasons: ['force_asset_generation_unmet', 'empty_response_without_execution'],
          },
        },
      }),
    ).toBe('结构失败：后端判定本轮未满足强制产资产约束；后端判定本轮没有可用结果，也没有执行落点')
  })

  it('formats video governance verdict reasons into readable labels', () => {
    expect(
      formatChatTurnVerdictSummary({
        trace: {
          outputMode: 'text_only',
          turnVerdict: {
            status: 'partial',
            reasons: [
              'video_prompt_contract_missing',
              'video_prompt_physics_constraints_missing',
              'video_prompt_preproduction_decision_missing',
            ],
          },
        },
      }),
    ).toBe('部分完成：视频提示词缺少结构化合同；视频提示词缺少物理/空间约束；未声明是否需要预生产资产')
  })

  it('treats failed verdict as first-class failed chat turn', () => {
    expect(
      isFailedChatTurn({
        trace: {
          turnVerdict: {
            status: 'failed',
            reasons: ['invalid_canvas_plan'],
          },
        },
      }),
    ).toBe(true)
    expect(
      isFailedChatTurn({
        trace: {
          turnVerdict: {
            status: 'partial',
            reasons: ['tool_execution_issues'],
          },
        },
      }),
    ).toBe(false)
  })
})
