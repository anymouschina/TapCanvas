import { CORE_WORKFLOW_EXECUTOR_SEMANTICS } from "./execution.core-semantics";
import { parseWorkflowNodes, resolveWorkflowNodeExecutorRef } from "./execution.node-runtime";

export type MediaDeliveryPolicy = Readonly<{
  version: 1;
  maxRetries: 1;
  exhausted: "deliver_successes";
}>;

export const MEDIA_DELIVERY_POLICY: MediaDeliveryPolicy = {
  version: 1, maxRetries: 1, exhausted: "deliver_successes",
};

/**
 * Every executor declared as a paid generation issues one supplier request per item, so its
 * only honest outcome is partial delivery: an item the supplier refuses on its own boundary
 * (content safety, per-request quota) is denied by that item's evidence and must not discard
 * the siblings that already returned real assets. Assembly keeps delivering whatever the
 * accepted items produced. Deriving the set from the shared executor semantics means a new
 * media executor inherits the contract instead of failing a whole node on one rejected item.
 */
const MEDIA_DELIVERY_EXECUTOR_REFS: ReadonlySet<string> = new Set<string>([
  ...Object.entries(CORE_WORKFLOW_EXECUTOR_SEMANTICS)
    .filter(([, semantics]) => semantics.sideEffect === "paid_generation")
    .map(([executorRef]) => executorRef),
  "video.concat/v1",
]);

/** Freeze the execution contract at admission, never reinterpret historical runs. */
export function freezeMediaDeliveryPolicy(flow: Record<string, unknown>): Record<string, unknown> {
  const targets = new Set(parseWorkflowNodes(flow).flatMap(node => {
    const executorRef = resolveWorkflowNodeExecutorRef(node);
    return executorRef !== null && MEDIA_DELIVERY_EXECUTOR_REFS.has(executorRef) ? [node.id] : [];
  }));
  if (!Array.isArray(flow.nodes)) return flow;
  return { ...flow, nodes: flow.nodes.map(node => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    const value = node as Record<string, unknown>;
    if (!targets.has(String(value.id))) return node;
    const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
      ? value.data as Record<string, unknown> : {};
    return { ...value, data: { ...data, workflowMediaDeliveryPolicy: MEDIA_DELIVERY_POLICY } };
  }) };
}

export function readMediaDeliveryPolicy(data: Record<string, unknown>): MediaDeliveryPolicy | null {
  const value = data.workflowMediaDeliveryPolicy;
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid media delivery policy");
  const policy = value as Record<string, unknown>;
  if (policy.version !== 1 || policy.maxRetries !== 1 || policy.exhausted !== "deliver_successes") {
    throw new Error("Invalid media delivery policy");
  }
  return MEDIA_DELIVERY_POLICY;
}
