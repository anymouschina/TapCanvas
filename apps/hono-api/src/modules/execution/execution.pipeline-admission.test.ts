import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scopeWorkflowFlowData } from './execution.flow-scope';
import { compileWorkflowGraph } from './execution.recovery';
import { inspectWorkflowExecutionSupport } from './execution.node-runtime';
import { freezeWorkflowExecutionSemanticsSnapshot, readWorkflowExecutionSemanticsSnapshot } from './execution.semantics-snapshot';
import { materializeWorkflowConfigurationInheritance } from './execution.workflow-configuration';

const candidatePath = process.env.TAPCANVAS_PIPELINE_CANDIDATE;
describe.skipIf(!candidatePath)('saved inline workflow admission (explicit opt-in)', () => {
  it('admits the actual candidate with server port contracts and frozen nested semantics', () => {
    const raw = JSON.parse(readFileSync(candidatePath!, 'utf8')) as Record<string, unknown>;
    const nodes = raw.nodes as Array<{id:string; data?:Record<string,unknown>}>;
    const trigger = nodes.find(node => node.id.endsWith(':manual-trigger'));
    expect(trigger).toBeDefined();
    const scoped = scopeWorkflowFlowData(raw, trigger!.id);
    scoped.nodes = materializeWorkflowConfigurationInheritance(scoped.nodes as unknown[]);
    const support = inspectWorkflowExecutionSupport(scoped);
    expect(support.unsupportedNodes).toEqual([]);
    expect(support.hasWorkflowOutput).toBe(true);
    const compiled = compileWorkflowGraph(scoped);
    expect(compiled.nodeIds.length).toBeGreaterThan(0);
    const snapshot = readWorkflowExecutionSemanticsSnapshot(freezeWorkflowExecutionSemanticsSnapshot(scoped));
    const pipelines = Object.values(snapshot.nodes).filter(node => node.executorRef === 'workflow.pipeline.run/v1');
    expect(pipelines).toHaveLength(2);
    expect(pipelines.map(node => node.semantics)).toEqual(expect.arrayContaining([
      expect.objectContaining({sideEffect:'external_mutation', recoveryMode:'reconcile'}),
      expect.objectContaining({sideEffect:'paid_generation', recoveryMode:'reconcile'}),
    ]));
    expect(Object.values(snapshot.nodes).some(node => node.executorRef === 'tapcanvas.video.generate/v1')).toBe(true);
  });
});
