import { describe, expect, it } from 'vitest'
import {
  collectDurableActionRecoveryFacts,
  collectDurableTaskReferences,
  buildAgentsBridgeTurnIdentity,
  hasMaterializedPublicDeliveryEvidence,
  normalizeAgentsRuntimeTraceSummary,
  type BridgeToolCall,
} from './task.agents-bridge'
import type { PublicChatDeliveryEvidence } from './public-chat-delivery-verifier'

function runtimeTrace(executionProvenance: unknown): Record<string, unknown> {
  return {
    profile: 'code',
    registeredToolNames: ['Skill'],
    registeredTeamToolNames: [],
    requiredSkills: ['tapcanvas-video-workflow'],
    loadedSkills: ['tapcanvas-video-workflow'],
    allowedSubagentTypes: [],
    requireAgentsTeamExecution: false,
    executionProvenance,
  }
}

describe('agents bridge runtime provenance normalization', () => {
	it('uses one stable public-turn identity for the Retrieval Sandbox logical task', () => {
		expect(buildAgentsBridgeTurnIdentity(' public-chat-turn:clip-1 ', 'request-1')).toEqual({
			publicTurnId: 'public-chat-turn:clip-1',
			logicalTaskId: 'public-chat-turn:clip-1',
		})
		expect(buildAgentsBridgeTurnIdentity('', 'request-1')).toEqual({
			publicTurnId: 'request-1',
			logicalTaskId: 'request-1',
		})
	})
	it('preserves the explicit durable terminal authority without inventing one', () => {
		const workflowSummary = normalizeAgentsRuntimeTraceSummary({
			...runtimeTrace(null),
			terminalAuthority: 'workflow_action',
		})
		expect(workflowSummary?.terminalAuthority).toBe('workflow_action')
		expect(normalizeAgentsRuntimeTraceSummary(runtimeTrace(null))?.terminalAuthority).toBeUndefined()
	})

  it('does not expose an empty delivery evidence envelope', () => {
    const emptyEvidence: PublicChatDeliveryEvidence = {
      version: 2,
      items: [],
      artifacts: [],
      assetCount: 0,
      imageAssetCount: 0,
      videoAssetCount: 0,
      wroteCanvas: false,
      generatedAssets: false,
      imageLikeNodeCount: 0,
      preproductionImageLikeNodeCount: 0,
      reusablePreproductionImageLikeNodeCount: 0,
      materializedStoryboardStillCount: 0,
      hasVideoNodes: false,
      hasMaterializedVisualOutputs: false,
      hasPlannedAuthorityBaseFrame: false,
      hasConfirmedAuthorityBaseFrame: false,
      storyboardPlanPersistenceCount: 0,
    }

    expect(hasMaterializedPublicDeliveryEvidence(emptyEvidence)).toBe(false)
    expect(hasMaterializedPublicDeliveryEvidence({
      ...emptyEvidence,
      wroteCanvas: true,
    })).toBe(true)
  })

  it('retains valid execution provenance for chat trace consumers', () => {
    const provenance = {
      version: 1,
      executionId: 'exec-1',
      agentId: 'root-agent',
      depth: 0,
      model: 'gpt-5.6',
      apiStyle: 'responses',
      requiredSkills: ['tapcanvas-video-workflow'],
      loadedSkills: ['tapcanvas-video-workflow'],
      startedAt: '2026-07-23T08:00:00.000Z',
    }

    expect(normalizeAgentsRuntimeTraceSummary(runtimeTrace(provenance))?.executionProvenance).toEqual(provenance)
  })

  it('drops malformed provenance instead of exposing partial evidence', () => {
    const summary = normalizeAgentsRuntimeTraceSummary(runtimeTrace({ version: 1, executionId: 'partial' }))
    expect(summary?.executionProvenance).toBeUndefined()
  })

  it('preserves bounded prompt-example candidate search evidence separately from provenance', () => {
    const summary = normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      promptExampleCandidateSearch: {
        version: 1,
        status: 'retrieval_failed',
        mediaType: 'video',
        attempted: true,
        remoteAttempted: true,
        candidateCount: 0,
        blocking: false,
        rationale: '检索依赖失败，继续原创。',
        toolCallId: 'search-1',
      },
    })

    expect(summary?.promptExampleCandidateSearch).toEqual({
      version: 1,
      status: 'retrieval_failed',
      mediaType: 'video',
      attempted: true,
      remoteAttempted: true,
      candidateCount: 0,
      blocking: false,
      rationale: '检索依赖失败，继续原创。',
      toolCallId: 'search-1',
    })
  })

  it('retains only a complete fixed-model input progression gate receipt', () => {
    const summary = normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      inputProgressionGate: {
        status: 'completed',
        model: 'deepseek-v4-flash',
        decision: 'allow',
        reasonCode: 'safe_request',
        reason: '可继续处理',
      },
    })

    expect(summary?.inputProgressionGate).toEqual({
      status: 'completed',
      model: 'deepseek-v4-flash',
      decision: 'allow',
      reasonCode: 'safe_request',
      reason: '可继续处理',
    })
    expect(normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      inputProgressionGate: {
        status: 'completed',
        model: 'doubao-seed-2-0-lite-260428',
        decision: 'allow',
        reasonCode: 'safe_request',
        reason: '可继续处理',
      },
    })?.inputProgressionGate).toBeUndefined()
  })

  it('retains only a complete root physical-budget suspension receipt', () => {
    const summary = normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      suspension: {
        reasonCode: 'root_physical_execution_budget_exhausted',
        physicalRunId: 'run-physical-1',
        progressRevision: 7,
      },
    })

    expect(summary?.suspension).toEqual({
      reasonCode: 'root_physical_execution_budget_exhausted',
      physicalRunId: 'run-physical-1',
      progressRevision: 7,
    })
    expect(normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      suspension: {
        reasonCode: 'root_physical_execution_budget_exhausted',
        physicalRunId: '',
        progressRevision: 7,
      },
    })?.suspension).toBeUndefined()
  })

  it('retains a complete direct Agent repair suspension receipt without reason-code routing', () => {
    const summary = normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      suspension: {
        reasonCode: 'max_turns',
        physicalRunId: 'workflow-physical-run-1',
        progressRevision: 0,
      },
    })

    expect(summary?.suspension).toEqual({
      reasonCode: 'max_turns',
      physicalRunId: 'workflow-physical-run-1',
      progressRevision: 0,
    })
  })

  it('retains bounded retrieval candidate receipts for the next physical window', () => {
    const receipt = {
      candidateSetId: 'skill_current_task',
      candidateKind: 'skill',
      logicalTaskId: 'public-chat-turn:current',
      rawUserRequestHash: 'a'.repeat(64),
      entries: [{ candidateId: 'tapcanvas-video-workflow', rank: 1, score: 1 }],
    }
    const summary = normalizeAgentsRuntimeTraceSummary({
      ...runtimeTrace(null),
      retrievalCandidateSets: [receipt],
    })

    expect(summary?.retrievalCandidateSets).toEqual([receipt])
  })

  it('unwraps the invocation envelope when collecting durable video receipts', () => {
    const call: BridgeToolCall = {
      toolCallId: 'call-nested',
      seq: 1,
      atMs: 1,
      logicalToolName: 'tapcanvas_video_orchestrate',
      name: 'tapcanvas_call_tool',
      status: 'succeeded',
      severity: '',
      pathHint: '',
      errorMessage: '',
      outputPreview: '',
      outputChars: 0,
      outputHead: '',
      outputTail: '',
      outputJson: { ok: true, runId: 'run-2', draftRevision: 'draft-2' },
      inputJson: {
        args: {
          name: 'tapcanvas_video_orchestrate',
          args: { mode: 'preflight_begin', runId: 'run-2' },
        },
      },
      requestedAgentType: '',
      startedAt: '',
      finishedAt: '',
      durationMs: 1,
    }

    expect(collectDurableTaskReferences([call])).toEqual([expect.objectContaining({
      toolName: 'tapcanvas_video_orchestrate',
      runId: 'run-2',
      draftRevision: 'draft-2',
    })])
  })
})

describe('agents bridge durable task receipt projection', () => {
	it('persists a generic story-preview cursor even without video-specific revisions', () => {
		const call: BridgeToolCall = {
			toolCallId: 'call-story-preview',
			seq: 1,
			atMs: 1,
			logicalToolName: 'tapcanvas_story_preview_orchestrate',
			name: 'tapcanvas_story_preview_orchestrate',
			status: 'succeeded',
			severity: '',
			pathHint: '',
			errorMessage: '',
			outputPreview: '',
			outputChars: 0,
			outputHead: '',
			outputTail: '',
			outputJson: {
				ok: true,
				runId: 'story-preview:chapter-1:r7:hash:0-60',
				progressCursor: {
					version: 1,
					graph: 'story_preview',
					phase: 'authoring',
					revision: 'r7:hash',
					completedUnitIds: ['board:0'],
					pendingUnitIds: ['board:1'],
					allowedNextActions: ['put_board_1'],
					requiredReadActions: [],
				},
			},
			inputJson: { mode: 'put_board_0' },
			requestedAgentType: '',
			startedAt: '',
			finishedAt: '',
			durationMs: 1,
		}

		expect(collectDurableTaskReferences([call])).toEqual([
			expect.objectContaining({
				toolName: 'tapcanvas_story_preview_orchestrate',
				mode: 'put_board_0',
				runId: 'story-preview:chapter-1:r7:hash:0-60',
				progressCursor: expect.objectContaining({
					graph: 'story_preview',
					allowedNextActions: ['put_board_1'],
				}),
			}),
		])
	})

  it('keeps only stable identity and fencing facts from successful tool results', () => {
    const call: BridgeToolCall = {
      toolCallId: 'call-1',
      seq: 1,
      atMs: 1,
      logicalToolName: 'tapcanvas_video_orchestrate',
      name: 'tapcanvas_call_tool',
      status: 'succeeded',
      severity: '',
      pathHint: '',
      errorMessage: '',
      outputPreview: '',
      outputChars: 0,
      outputHead: '',
      outputTail: '',
      outputJson: {
        ok: true,
        runId: 'run-1',
        draftRevision: 'draft-1',
        beatRevision: 'beat-1',
        progressCursor: {
          version: 1,
          graph: 'video_authoring',
          scopeId: 'run-1:preflight',
          phase: 'preflight_draft',
          revision: 'draft-1',
          completedUnitIds: ['beat:0'],
          pendingUnitIds: ['beat:1'],
          allowedNextActions: ['preflight_put_beat'],
          requiredReadActions: ['preflight_get_header'],
          allowedSupportingTools: ['tapcanvas_book_chapter_get', 'tapcanvas_book_chapter_get'],
        },
        beat: { prompt: 'must not enter continuation identity state' },
      },
      inputJson: {
        name: 'tapcanvas_video_orchestrate',
        args: { mode: 'preflight_put_beat', runId: 'run-1' },
      },
      requestedAgentType: '',
      startedAt: '',
      finishedAt: '',
      durationMs: 1,
    }

    expect(collectDurableTaskReferences([call])).toEqual([{
      version: 1,
      toolName: 'tapcanvas_video_orchestrate',
      mode: 'preflight_put_beat',
      runId: 'run-1',
      taskId: null,
      draftRevision: 'draft-1',
      beatRevision: 'beat-1',
      preflightRevision: null,
      preflightFingerprint: null,
      clipIndex: null,
      progressCursor: {
        version: 1,
        graph: 'video_authoring',
        scopeId: 'run-1:preflight',
        phase: 'preflight_draft',
        revision: 'draft-1',
        completedUnitIds: ['beat:0'],
        pendingUnitIds: ['beat:1'],
        allowedNextActions: ['preflight_put_beat'],
        requiredReadActions: ['preflight_get_header'],
        allowedSupportingTools: ['tapcanvas_book_chapter_get'],
        executionGeneration: null,
      },
      acceptedAsync: false,
    }])
  })

	it('preserves valid repair cursors from rejected tool receipts', () => {
		const base: BridgeToolCall = {
			toolCallId: 'call-rejected',
			seq: 1,
			atMs: 1,
			logicalToolName: 'tapcanvas_video_orchestrate',
			name: 'tapcanvas_call_tool',
			status: 'succeeded',
			severity: 'warning',
			pathHint: '',
			errorMessage: '',
			outputPreview: '',
			outputChars: 0,
			outputHead: '',
			outputTail: '',
			outputJson: null,
			inputJson: {
				name: 'tapcanvas_video_orchestrate',
				args: { mode: 'repair_assets' },
			},
			requestedAgentType: '',
			startedAt: '',
			finishedAt: '',
			durationMs: 1,
		}
		const cursor = (scopeId: string, revision: string) => ({
			version: 1,
			graph: 'video_asset_repair',
			scopeId,
			phase: 'repair_required',
			revision,
			completedUnitIds: ['asset:0'],
			pendingUnitIds: ['asset:1'],
			allowedNextActions: ['repair_assets'],
			requiredReadActions: ['read_asset_declaration'],
			allowedSupportingTools: ['tapcanvas_image_reconcile'],
		})
		const rejectedByOk: BridgeToolCall = {
			...base,
			toolCallId: 'call-ok-false',
			outputJson: {
				ok: false,
				data: {
					progressCursor: cursor('run-1:asset-repair', 'asset-revision-1'),
				},
			},
		}
		const rejectedBySuccess: BridgeToolCall = {
			...base,
			toolCallId: 'call-success-false',
			outputJson: {
				ok: true,
				data: {
					success: false,
					progressCursor: cursor('run-2:asset-repair', 'asset-revision-2'),
				},
			},
		}
		const failedStatusWithCursor: BridgeToolCall = {
			...base,
			toolCallId: 'call-failed-status',
			status: 'failed',
			outputJson: {
				progressCursor: cursor('run-3:asset-repair', 'asset-revision-3'),
			},
		}

		expect(collectDurableTaskReferences([
			rejectedByOk,
			rejectedBySuccess,
			failedStatusWithCursor,
		])).toEqual([
			expect.objectContaining({
				runId: null,
				taskId: null,
				progressCursor: expect.objectContaining({
					scopeId: 'run-1:asset-repair',
					allowedSupportingTools: ['tapcanvas_image_reconcile'],
				}),
			}),
			expect.objectContaining({
				progressCursor: expect.objectContaining({ scopeId: 'run-2:asset-repair' }),
			}),
			expect.objectContaining({
				progressCursor: expect.objectContaining({ scopeId: 'run-3:asset-repair' }),
			}),
		])
	})

	it('excludes failed receipts that do not contain a valid progress cursor', () => {
		const base: BridgeToolCall = {
			toolCallId: 'call-failed-without-cursor',
			seq: 1,
			atMs: 1,
			logicalToolName: 'tapcanvas_video_orchestrate',
			name: 'tapcanvas_call_tool',
			status: 'failed',
			severity: 'error',
			pathHint: '',
			errorMessage: 'failed',
			outputPreview: '',
			outputChars: 0,
			outputHead: '',
			outputTail: '',
			outputJson: {
				ok: false,
				runId: 'run-failed',
				draftRevision: 'draft-failed',
				progressCursor: {
					version: 2,
					graph: 'invalid',
					phase: 'invalid',
				},
			},
			inputJson: { mode: 'repair_assets' },
			requestedAgentType: '',
			startedAt: '',
			finishedAt: '',
			durationMs: 1,
		}
		const rejectedBySuccess: BridgeToolCall = {
			...base,
			toolCallId: 'call-success-false-without-cursor',
			status: 'succeeded',
			outputJson: {
				success: false,
				runId: 'run-rejected',
				draftRevision: 'draft-rejected',
			},
		}

		expect(collectDurableTaskReferences([base, rejectedBySuccess])).toEqual([])
	})

	it('keeps only the latest unresolved structured action failure per operation', () => {
		const base: BridgeToolCall = {
			toolCallId: 'call-0',
			seq: 1,
			atMs: 1,
			logicalToolName: 'tapcanvas_video_orchestrate',
			name: 'tapcanvas_call_tool',
			status: 'succeeded',
			severity: 'warning',
			pathHint: '',
			errorMessage: '',
			outputPreview: '',
			outputChars: 0,
			outputHead: '',
			outputTail: '',
			outputJson: null,
			inputJson: {
				name: 'tapcanvas_video_orchestrate',
				args: { mode: 'preflight_begin' },
			},
			requestedAgentType: '',
			startedAt: '',
			finishedAt: '',
			durationMs: 1,
		}
		const warning: BridgeToolCall = {
			...base,
			toolCallId: 'call-warning',
			outputJson: {
				ok: false,
				code: 'contract_invalid',
				message: 'sourceCoveragePlan.spans is required',
				runId: 'run-uncommitted',
			},
		}
		const resolved: BridgeToolCall = {
			...base,
			toolCallId: 'call-resolved',
			severity: '',
			outputJson: { ok: true, runId: 'run-1', draftRevision: 'draft-1' },
		}

		expect(collectDurableActionRecoveryFacts([warning])).toEqual([{
			version: 1,
			toolName: 'tapcanvas_video_orchestrate',
			mode: 'preflight_begin',
			status: 'warning',
			code: 'contract_invalid',
			message: 'sourceCoveragePlan.spans is required',
			runId: 'run-uncommitted',
			draftRevision: null,
		}])
		expect(collectDurableActionRecoveryFacts([warning, resolved])).toEqual([])
	})

	it('preserves exact failed action input only for server-declared same-chain repair', () => {
		const retryInput = {
			attachmentId: 'attachment-1',
			triggerPayload: {
				structuredPayload: { items: [{ itemId: 'item-1' }] },
			},
		}
		const retryable: BridgeToolCall = {
			toolCallId: 'call-retryable',
			seq: 1,
			atMs: 1,
			logicalToolName: 'tapcanvas_equipped_workflow_run',
			name: 'tapcanvas_call_tool',
			status: 'failed',
			severity: '',
			pathHint: '',
			errorMessage: '',
			outputPreview: '',
			outputChars: 0,
			outputHead: '',
			outputTail: '',
			outputJson: {
				ok: false,
				code: 'workflow_prepared_beat_sheet_invalid',
				message: 'beats[0].exitState is invalid',
				details: { retryableInCurrentAgentChain: true },
			},
			inputJson: { name: 'tapcanvas_equipped_workflow_run', args: retryInput },
			requestedAgentType: '',
			startedAt: '',
			finishedAt: '',
			durationMs: 1,
		}

		expect(collectDurableActionRecoveryFacts([retryable])).toEqual([{
			version: 1,
			toolName: 'tapcanvas_equipped_workflow_run',
			mode: null,
			status: 'failed',
			code: 'workflow_prepared_beat_sheet_invalid',
			message: 'beats[0].exitState is invalid',
			runId: null,
			draftRevision: null,
			retryInput,
		}])
	})
})
