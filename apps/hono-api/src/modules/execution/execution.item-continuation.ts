import type { WorkflowAtomicNodeSpecV1 } from '@tapcanvas/workflow-kernel-protocol';
import type { WorkflowNodeItemRunV1, WorkflowNodeSnapshot } from './execution.node-runtime';

type Continuation = NonNullable<WorkflowAtomicNodeSpecV1['itemContinuation']>;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Explicit graph dependency, not inferred from task names, content or model choice. */
export function readItemContinuation(node: WorkflowNodeSnapshot, concurrency: number): Continuation | null {
  const spec = node.data.workflowAtomicSpec;
  if (!record(spec) || spec.itemContinuation === undefined) return null;
  const value = spec.itemContinuation;
  if (!record(value) || typeof value.inputPort !== 'string' || !value.inputPort.trim()
    || typeof value.outputPort !== 'string' || !value.outputPort.trim()
    || spec.executionMode !== 'each' || concurrency !== 1
    || !Array.isArray(spec.inputPorts) || !spec.inputPorts.includes(value.inputPort)
    || !Array.isArray(spec.optionalInputPorts) || !spec.optionalInputPorts.includes(value.inputPort)
    || !Array.isArray(spec.outputPorts) || !spec.outputPorts.includes(value.outputPort)) {
    throw new Error(`Workflow node ${node.id} itemContinuation requires each, itemConcurrency=1, a declared optional input port and an existing output port`);
  }
  return { inputPort: value.inputPort, outputPort: value.outputPort };
}

export function previousItemContinuation(input: {
  spec: Continuation; index: number; previousItemId: string | null;
  previousRuntimeNodeId: string | null; runs: readonly WorkflowNodeItemRunV1[];
}): unknown {
  if (input.index === 0) return null;
  const previous = input.runs.find(run => run.index === input.index - 1
    && run.itemId === input.previousItemId && run.runtimeNodeId === input.previousRuntimeNodeId);
  if (!previous || previous.status !== 'success'
    || !Object.prototype.hasOwnProperty.call(previous.ports, input.spec.outputPort)) {
    throw new Error(`Previous item ${input.previousItemId} has no committed output on ${input.spec.outputPort}`);
  }
  return {
    protocolVersion: 'workflow.item-continuation/v1',
    source: { itemId: previous.itemId, index: previous.index, runtimeNodeId: previous.runtimeNodeId, portId: input.spec.outputPort },
    lineage: previous.lineage,
    value: previous.ports[input.spec.outputPort],
  };
}
