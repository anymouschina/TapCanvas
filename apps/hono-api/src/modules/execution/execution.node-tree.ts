type NodeRecord = Record<string, unknown>;
const record = (value: unknown): value is NodeRecord => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Traverse explicit frozen inline nodes for admission/configuration; does not flatten execution dependencies. */
export function mapWorkflowNodeTree(nodes: readonly unknown[], mapNode: (node: NodeRecord) => NodeRecord): unknown[] {
  return nodes.map(value => {
    if (!record(value)) return value;
    let node = value;
    if (record(value.data) && value.data.workflowPipeline !== undefined) {
      const pipeline = value.data.workflowPipeline;
      if (!record(pipeline) || pipeline.protocolVersion !== 'workflow.pipeline.run/v1' || !Array.isArray(pipeline.steps)) {
        throw new Error('Inline workflow node has an invalid frozen pipeline');
      }
      const steps = pipeline.steps.map(step => {
        if (!record(step) || !record(step.node)) throw new Error('Inline workflow step requires a frozen node snapshot');
        return { ...step, node: mapWorkflowNodeTree([step.node], mapNode)[0] };
      });
      node = { ...value, data: { ...value.data, workflowPipeline: { ...pipeline, steps } } };
    }
    return mapNode(node);
  });
}

export function flattenWorkflowNodeTree(nodes: readonly unknown[]): NodeRecord[] {
  const result: NodeRecord[] = [];
  mapWorkflowNodeTree(nodes, node => { result.push(node); return node; });
  return result;
}

/** Apply a list-level transform at every inline pipeline scope while retaining the authored tree. */
export function mapWorkflowNodeTreeScopes(
  nodes: readonly unknown[],
  mapScope: (scopeNodes: readonly unknown[]) => readonly unknown[],
): unknown[] {
  const nested = nodes.map(value => {
    if (!record(value) || !record(value.data) || value.data.workflowPipeline === undefined) return value;
    const pipeline = value.data.workflowPipeline;
    if (!record(pipeline) || pipeline.protocolVersion !== 'workflow.pipeline.run/v1' || !Array.isArray(pipeline.steps)) {
      throw new Error('Inline workflow node has an invalid frozen pipeline');
    }
    const stepNodes = pipeline.steps.map(step => {
      if (!record(step) || !record(step.node)) throw new Error('Inline workflow step requires a frozen node snapshot');
      return step.node;
    });
    const mappedStepNodes = mapWorkflowNodeTreeScopes(stepNodes, mapScope);
    const steps = pipeline.steps.map((step, index) => {
      if (!record(step)) throw new Error('Inline workflow step requires a frozen node snapshot');
      const mappedNode = mappedStepNodes[index];
      if (!record(mappedNode)) throw new Error('Inline workflow step mapping must preserve its node snapshot');
      return { ...step, node: mappedNode };
    });
    return { ...value, data: { ...value.data, workflowPipeline: { ...pipeline, steps } } };
  });
  const mapped = mapScope(nested);
  if (mapped.length !== nodes.length) throw new Error('Workflow node-scope mapping must preserve node count');
  return [...mapped];
}
