import { expect, it } from 'vitest';
import { flattenWorkflowNodeTree } from './execution.node-tree';
import { materializeWorkflowConfigurationInheritance } from './execution.workflow-configuration';
import { freezeMediaDeliveryPolicy } from './execution.media-delivery-policy';
import { materializeWorkflowExecutionControl, WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF } from './execution.production-start-deadline';

function graph() {
  return { nodes: [
    { id: 'source', data: { kind: 'workflowStage', workflowInstanceId: 'flow', workflowNodeId: 'source',
      workflowVideoModelKey: 'chosen-model', workflowAtomicSpec: { executorRef: 'agents.delivery.contract/v2' } } },
    { id: 'pipeline', data: { kind: 'workflowStage', workflowAtomicSpec: { executorRef: 'workflow.pipeline.run/v1' }, workflowPipeline: {
      protocolVersion: 'workflow.pipeline.run/v1', steps: [{ stepId: 'video', node: { id: 'nested-video',
        data: { kind: 'workflowStage', workflowInstanceId: 'flow', workflowNodeId: 'video', workflowConfigurationSourceNodeId: 'source',
          workflowAtomicSpec: { executorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF } } } }],
    } } },
  ], edges: [{ source: 'source', target: 'pipeline' }] };
}

it('freezes shared media settings and paid recovery policy inside a pipeline while keeping the saved definition immutable', () => {
  const original = graph();
  const inherited = { ...original, nodes: materializeWorkflowConfigurationInheritance(original.nodes) };
  const frozen = freezeMediaDeliveryPolicy(inherited);
  const nested = flattenWorkflowNodeTree(frozen.nodes as unknown[]).find(node => node.id === 'nested-video');
  expect(nested).toMatchObject({ data: { workflowVideoModelKey: 'chosen-model', workflowMediaDeliveryPolicy: { maxRetries: 0 } } });
  expect(JSON.stringify(original)).not.toContain('workflowMediaDeliveryPolicy');
  expect(flattenWorkflowNodeTree(original.nodes).find(node => node.id === 'nested-video')).not.toHaveProperty('data.workflowVideoModelKey');
});

it('includes the enclosing pipeline in the existing first-provider-receipt deadline scope', () => {
  const control = materializeWorkflowExecutionControl(graph(), { version: 2, productionStartDeadline: {
    version: 2, kind: 'video_provider_receipt', source: 'public_chat', publicTurnId: 'turn',
    acceptedAt: '2026-09-23T09:00:00.000Z', targetExecutorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF,
  } });
  expect(control.productionStartDeadline.controlledNodeIds).toEqual(['pipeline', 'source']);
  expect(control.productionStartDeadline.deadlineAt).toBe('2026-09-23T09:10:00.000Z');
});
