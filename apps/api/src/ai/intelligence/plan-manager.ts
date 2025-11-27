import { Injectable, Logger } from '@nestjs/common'
import {
  ExecutionPlan,
  ExecutionStep
} from '../core/types/canvas-intelligence.types'
import { ToolEventsService } from '../tool-events.service'

interface PlanState {
  userId: string
  sessionId: string
  plan: ExecutionPlan
  updatedAt: number
}

type StepStatus = ExecutionStep['status']

@Injectable()
export class PlanManager {
  private readonly logger = new Logger(PlanManager.name)
  private readonly plans = new Map<string, PlanState>()

  constructor(private readonly toolEvents: ToolEventsService) {}

  startPlan(userId: string, sessionId: string, plan: ExecutionPlan, explanation?: string) {
    if (!plan?.steps?.length) {
      return
    }

    const clonedPlan: ExecutionPlan = {
      ...plan,
      steps: plan.steps.map(step => ({ ...step })),
      dependencies: plan.dependencies,
      parallelGroups: plan.parallelGroups,
      risks: plan.risks,
      rollbackPlan: plan.rollbackPlan
    }

    this.plans.set(plan.id, {
      plan: clonedPlan,
      sessionId,
      userId,
      updatedAt: Date.now()
    })

    this.emitPlanUpdate(plan.id, explanation ?? '计划已生成')
  }

  markStepInProgress(userId: string, planId?: string, stepId?: string, explanation?: string) {
    this.updateStepStatus(userId, planId, stepId, 'in_progress', explanation ?? '步骤执行中')
  }

  markStepCompleted(userId: string, planId?: string, stepId?: string, explanation?: string) {
    this.updateStepStatus(userId, planId, stepId, 'completed', explanation ?? '步骤完成')
  }

  markStepFailed(userId: string, planId?: string, stepId?: string, explanation?: string) {
    this.updateStepStatus(userId, planId, stepId, 'failed', explanation ?? '步骤失败')
  }

  completePlan(userId: string, planId?: string, explanation?: string) {
    const state = this.getPlanState(userId, planId)
    if (!state) return

    this.emitPlanUpdate(state.plan.id, explanation ?? '计划执行完成')
    this.plans.delete(state.plan.id)
  }

  abortPlan(userId: string, planId?: string, explanation?: string) {
    const state = this.getPlanState(userId, planId)
    if (!state) return

    this.emitPlanUpdate(state.plan.id, explanation ?? '计划已中止')
    this.plans.delete(state.plan.id)
  }

  clear(sessionId?: string) {
    if (!sessionId) {
      this.plans.clear()
      return
    }

    for (const [planId, state] of this.plans.entries()) {
      if (state.sessionId === sessionId) {
        this.plans.delete(planId)
      }
    }
  }

  getActivePlanCount() {
    return this.plans.size
  }

  private updateStepStatus(
    userId: string,
    planId: string | undefined,
    stepId: string | undefined,
    status: StepStatus,
    explanation?: string
  ) {
    if (!planId || !stepId) return

    const state = this.getPlanState(userId, planId)
    if (!state) return

    const targetStep = state.plan.steps.find(step => step.id === stepId)
    if (!targetStep) return

    targetStep.status = status
    state.updatedAt = Date.now()

    this.emitPlanUpdate(state.plan.id, explanation)
  }

  private getPlanState(userId: string, planId?: string): PlanState | null {
    if (!planId) return null
    const state = this.plans.get(planId)
    if (!state || state.userId !== userId) {
      return null
    }
    return state
  }

  private emitPlanUpdate(planId: string, explanation?: string) {
    const state = this.plans.get(planId)
    if (!state) return

    const payload = {
      planId: state.plan.id,
      sessionId: state.sessionId,
      explanation,
      summary: {
        strategy: state.plan.strategy.name,
        estimatedTime: state.plan.estimatedTime,
        estimatedCost: state.plan.estimatedCost
      },
      steps: state.plan.steps.map(step => ({
        id: step.id,
        name: step.name,
        description: step.description,
        status: step.status,
        reasoning: step.reasoning,
        acceptance: step.acceptanceCriteria
      })),
      updatedAt: new Date(state.updatedAt).toISOString()
    }

    this.logger.debug('Plan update emitted', {
      planId,
      explanation,
      stepStatuses: payload.steps.map(step => `${step.id}:${step.status}`)
    })

    this.toolEvents.emit(state.userId, {
      type: 'tool-result',
      toolCallId: `plan_${planId}`,
      toolName: 'ai.plan.update',
      output: payload
    })
  }
}
