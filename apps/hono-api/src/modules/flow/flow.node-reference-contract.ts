import { AppError } from "../../middleware/error";

/** sourceNodeIds is an ordered list of node identities in the same graph. */
export function assertLocalSourceNodeReferences(input: {
  nodeId: string;
  data: Record<string, unknown>;
  availableNodeIds: ReadonlySet<string>;
}): void {
  if (!Object.prototype.hasOwnProperty.call(input.data, "sourceNodeIds")) return;
  const references = input.data.sourceNodeIds;
  if (!Array.isArray(references) || references.some((id: unknown) => typeof id !== "string" || !id.trim())) {
    throw new AppError("sourceNodeIds must be an ordered array of non-empty node IDs", {
      status: 400, code: "flow_node_reference_invalid", details: { nodeId: input.nodeId, field: "sourceNodeIds" },
    });
  }
  const missing = references.filter((id: string) => !input.availableNodeIds.has(id));
  if (missing.length) {
    throw new AppError("sourceNodeIds references nodes absent from this canvas", {
      status: 409, code: "flow_node_reference_missing",
      details: { nodeId: input.nodeId, field: "sourceNodeIds", missingNodeIds: missing },
    });
  }
}
