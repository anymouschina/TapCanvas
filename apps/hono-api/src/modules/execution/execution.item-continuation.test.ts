import { describe, expect, it, vi } from 'vitest';
import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { executeWorkflowNodeByMode } from './execution.collection-runtime';
import { workflowExternalPollAfter } from './execution.external-check';
import { workflowNodeWaiting, type WorkflowNodeOutputV1 } from './execution.node-runtime';
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from './execution.node-executors';

const dependencies: WorkflowNodeExecutorDependencies = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn() };
function context(concurrency = 1): WorkflowNodeExecutionContext {
  return { executionId: 'execution', executionFamilyId: 'family', ownerId: 'owner', flowId: 'flow', projectId: 'project', workflowKey: 'workflow',
    node: { id: 'author', type: 'taskNode', kind: 'workflowStage', data: { workflowAtomicSpec: {
      version: 1, category: 'agent', operation: 'write', executorRef: 'agents.logical-task/v2', executionMode: 'each',
      itemConcurrency: concurrency, itemContinuation: { inputPort: 'previous', outputPort: 'result' },
      inputPorts: ['input', 'previous'], optionalInputPorts: ['previous'], outputPorts: ['result'],
    } } },
    inputs: { input: [createWorkflowCollection({ collectionId: 'inputs', producerNodeId: 'split', producerPortId: 'input', values: ['a', 'b', 'c'], itemIds: ['one', 'two', 'three'] })] },
  };
}
function output(item: WorkflowNodeExecutionContext, value: unknown): WorkflowNodeOutputV1 {
  return { protocolVersion: '1', executorRef: 'agents.logical-task/v2', nodeId: item.node.id, executionMode: 'once', ports: { result: value }, artifacts: [], itemRuns: [], evidence: {} };
}
describe('explicit ordered item output handoff', () => {
  it('feeds actual preceding output with identity and never substitutes the preceding input', async () => {
    const received: unknown[] = [];
    const result = await executeWorkflowNodeByMode(context(), dependencies, async item => {
      received.push(item.inputs.previous[0]);
      return { ok: true, outputRefs: output(item, { actual: `written-${item.runtimeItemIndex}` }) };
    });
    expect(result.ok).toBe(true);
    expect(received).toEqual([null,
      expect.objectContaining({ source: expect.objectContaining({ itemId: 'one', index: 0 }), value: { actual: 'written-0' } }),
      expect.objectContaining({ source: expect.objectContaining({ itemId: 'two', index: 1 }), value: { actual: 'written-1' } }),
    ]);
  });
  it('resumes a waiting item with the committed predecessor and does not rerun successful work', async () => {
    const first = await executeWorkflowNodeByMode(context(), dependencies, async item => item.runtimeItemIndex === 1
      ? workflowNodeWaiting(output(item, 'pending'), workflowExternalPollAfter(1_000))
      : { ok: true, outputRefs: output(item, 'committed-first') });
    expect(first.ok).toBe(false);
    if (!('outputRefs' in first) || !first.outputRefs) throw new Error('missing checkpoint');
    expect(first.outputRefs.itemRuns.map(run => run.index)).toEqual([0, 1]);
    const indices: number[] = [];
    const resumed = await executeWorkflowNodeByMode({ ...context(), resumeOnly: true, resumeOutputRefs: first.outputRefs }, dependencies, async item => {
      indices.push(item.runtimeItemIndex!);
      expect(item.inputs.previous[0]).toMatchObject({ value: item.runtimeItemIndex === 1 ? 'committed-first' : 'committed-second' });
      return { ok: true, outputRefs: output(item, 'committed-second') };
    });
    expect(resumed.ok).toBe(true);
    expect(indices).toEqual([1, 2]);
  });
  it('does not admit dependent work after a failed predecessor', async () => {
    const execute = vi.fn(async () => ({ ok: false as const, errorCode: 'workflow_node_runtime_failed' as const, errorMessage: 'Evidence unavailable' }));
    const result = await executeWorkflowNodeByMode(context(), dependencies, execute);
    expect(result.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects a concurrent declaration before executing instead of silently serializing', async () => {
    const execute = vi.fn();
    const result = await executeWorkflowNodeByMode(context(2), dependencies, execute);
    expect(result).toMatchObject({ ok: false, errorMessage: expect.stringContaining('itemConcurrency=1') });
    expect(execute).not.toHaveBeenCalled();
  });
});
