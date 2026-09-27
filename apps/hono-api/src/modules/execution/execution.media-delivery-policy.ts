import { mapWorkflowNodeTree } from "./execution.node-tree";
import { CORE_WORKFLOW_EXECUTOR_SEMANTICS } from "./execution.core-semantics";

export type MediaDeliveryPolicy = Readonly<{
  version: 1;
  maxRetries: 0 | 1;
  exhausted: "deliver_successes";
}>;

export const MEDIA_DELIVERY_POLICY: MediaDeliveryPolicy = {
  version: 1, maxRetries: 0, exhausted: "deliver_successes",
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
  if (!Array.isArray(flow.nodes)) return flow;
  return { ...flow, nodes: mapWorkflowNodeTree(flow.nodes, value => {
    const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
      ? value.data as Record<string, unknown> : {};
    const spec = data.workflowAtomicSpec && typeof data.workflowAtomicSpec === "object" && !Array.isArray(data.workflowAtomicSpec)
      ? data.workflowAtomicSpec as Record<string, unknown> : {};
    if (typeof spec.executorRef !== "string" || !MEDIA_DELIVERY_EXECUTOR_REFS.has(spec.executorRef)) return value;
    return { ...value, data: { ...data, workflowMediaDeliveryPolicy: MEDIA_DELIVERY_POLICY } };
  }) };
}

export function readMediaDeliveryPolicy(data: Record<string, unknown>): MediaDeliveryPolicy | null {
  const value = data.workflowMediaDeliveryPolicy;
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid media delivery policy");
  const policy = value as Record<string, unknown>;
  if (policy.version !== 1 || (policy.maxRetries !== 0 && policy.maxRetries !== 1) || policy.exhausted !== "deliver_successes") {
    throw new Error("Invalid media delivery policy");
  }
  return { version: 1, maxRetries: policy.maxRetries, exhausted: "deliver_successes" };
}
