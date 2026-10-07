import { describe, expect, it, vi } from 'vitest';
import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { executeWorkflowNodeByMode } from './execution.collection-runtime';
import { workflowExternalPollAfter } from './execution.external-check';
import { workflowNodeWaiting, type WorkflowNodeOutputV1 } from './execution.node-runtime';
import { resolveCoreWorkflowExecutorSemantics } from './execution.core-semantics';
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
	 it('uses frozen idempotent Pipeline semantics to admit independent waiting items concurrently', async () => {
		const original = context();
		const pipelineContext: WorkflowNodeExecutionContext = {
			...original,
			node: { id: 'pipeline', type: 'taskNode', kind: 'workflowStage', data: { workflowAtomicSpec: {
				version: 1, category: 'control', operation: 'run', executorRef: 'workflow.pipeline.run/v1',
				executionMode: 'each', itemConcurrency: 2, inputPorts: ['input'], outputPorts: ['result'],
			} } },
			inputs: { input: [createWorkflowCollection({ collectionId: 'two', producerNodeId: 'source',
				producerPortId: 'input', values: ['one', 'two'], itemIds: ['one', 'two'] })] },
			flowVersionData: { workflowExecutionSemantics: { nodes: { pipeline: {
				executorRef: 'workflow.pipeline.run/v1',
				semantics: resolveCoreWorkflowExecutorSemantics('tapcanvas.video.generate/v1'),
			} } } },
		};
		const attempted: number[] = [];
		const waiting = await executeWorkflowNodeByMode(pipelineContext, dependencies, async item => {
			attempted.push(item.runtimeItemIndex!);
			return workflowNodeWaiting({ protocolVersion: '1', executorRef: 'workflow.pipeline.run/v1',
				nodeId: item.node.id, executionMode: 'once', ports: {}, artifacts: [],
				evidence: { providerReceiptRefs: [`task-${item.runtimeItemIndex}`] }, itemRuns: [],
			}, workflowExternalPollAfter(1_000));
		});
		expect(waiting).toMatchObject({ ok: false, waitingExternal: true });
		expect(attempted.sort()).toEqual([0, 1]);
		if (waiting.ok || !waiting.waitingExternal) throw new Error('Expected durable waiting collection');
		expect(waiting.outputRefs.itemRuns.map(run => run.status)).toEqual(['waiting_external', 'waiting_external']);
		const checkpoint: WorkflowNodeOutputV1 = { ...waiting.outputRefs, itemRuns: waiting.outputRefs.itemRuns.map((run) => ({
			...run, status: run.index === 0 ? 'failed' as const : 'success' as const,
			evidence: { ...run.evidence, pipelineState: { protocolVersion: 'workflow.pipeline.state/v1', steps: {} } },
		})) };
		const replayed: number[] = [];
		const recovered = await executeWorkflowNodeByMode({ ...pipelineContext,
			recoveryOfExecutionId: 'prior-execution', resumeOnly: true, resumeOutputRefs: checkpoint,
		}, dependencies, async item => {
			replayed.push(item.runtimeItemIndex!);
			expect(item.resumeOnly).toBe(false);
			return { ok: true, outputRefs: { protocolVersion: '1', executorRef: 'workflow.pipeline.run/v1',
				nodeId: item.node.id, executionMode: 'once', ports: { result: 'recovered' }, artifacts: [], evidence: {}, itemRuns: [] } };
		});
		expect(recovered.ok).toBe(true);
		expect(replayed).toEqual([0]);
	});
	 it('replays only an unsubmitted failed image item from a partial collection receipt', async () => {
		const original = context();
		const imageNode = { ...original.node, id: 'images', data: { workflowAtomicSpec: {
			version: 1, category: 'image', operation: 'generate', executorRef: 'tapcanvas.image.generate/v1',
			executionMode: 'each', inputPorts: ['input'], outputPorts: ['result'],
		} } };
		const imageContext = { ...original, node: imageNode };
		const checkpoint: WorkflowNodeOutputV1 = {
			protocolVersion: '1', executorRef: 'tapcanvas.image.generate/v1', nodeId: 'images',
			executionMode: 'each', ports: {}, artifacts: [], evidence: { partial: true }, itemRuns: [
				{ itemId: 'one', index: 0, status: 'success', runtimeNodeId: 'images::item::one', lineage: [],
					ports: { result: 'https://assets.example/one.png' }, artifacts: [], evidence: { taskId: 'task-one' } },
				{ itemId: 'two', index: 1, status: 'failed', runtimeNodeId: 'images::item::two', lineage: [],
					ports: {}, artifacts: [], evidence: { canvasNodeId: 'prepared-two', taskId: null } },
		],
		};
		const attempted: number[] = [];
		const result = await executeWorkflowNodeByMode({ ...imageContext, resumeOnly: true,
			recoveryOfExecutionId: 'prior-execution', resumeOutputRefs: checkpoint }, dependencies, async item => {
			attempted.push(item.runtimeItemIndex!);
			return { ok: true, outputRefs: { ...checkpoint, nodeId: item.node.id, executionMode: 'once',
				ports: { result: 'https://assets.example/two.png' }, itemRuns: [], evidence: { taskId: 'task-two' } } };
		});
		expect(result.ok).toBe(true);
		expect(attempted).toEqual([1, 2]);
	});
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
  it('reuses successful items and reauthors a terminally invalid item only after an authorized planning revision', async () => {
    const original = context();
    const checkpoint: WorkflowNodeOutputV1 = {
      ...output(original, null), executionMode: 'each', itemRuns: [
        { itemId: 'one', index: 0, status: 'success', runtimeNodeId: 'author::item::one',
          lineage: [], ports: { result: 'committed-first' }, artifacts: [], evidence: {} },
        { itemId: 'two', index: 1, status: 'failed', runtimeNodeId: 'author::item::two',
          lineage: [], ports: {}, artifacts: [],
          evidence: { outputContractFailure: { code: 'structured_output_invalid' } } },
      ],
    };
    const attempted: number[] = [];
    const revised = await executeWorkflowNodeByMode({ ...original, recoveryOfExecutionId: 'previous-execution',
      resumeOnly: true, resumeOutputRefs: checkpoint,
      flowVersionData: { workflowRecoveryFrontier: {
        mode: 'authorized_planning_revision', failedNodeId: 'author',
      } },
    }, dependencies, async item => {
      attempted.push(item.runtimeItemIndex!);
      return { ok: true, outputRefs: output(item, `revised-${item.runtimeItemIndex}`) };
    });
    expect(revised.ok).toBe(true);
    expect(attempted).toEqual([1, 2]);
    if (!revised.ok) throw new Error('expected successful revision');
    expect(revised.outputRefs.itemRuns[0]?.ports.result).toBe('committed-first');
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
