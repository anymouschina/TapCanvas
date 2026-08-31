import { AppError } from "../../middleware/error";
import type { FlowDto } from "./flow.schemas";

export type RequestedFlowOwnerScope = {
	ownerType?: "project" | "chapter" | "shot";
	ownerId?: string;
};

function hasRequestedScope(scope: RequestedFlowOwnerScope | undefined): boolean {
	return Boolean(scope?.ownerType || scope?.ownerId);
}

function hasCompleteOwnerMeta(flow: FlowDto): boolean {
	return Boolean(flow.ownerType && typeof flow.ownerId === "string" && flow.ownerId.trim());
}

export function filterFlowsByOwnerScope(
	flows: FlowDto[],
	scope?: RequestedFlowOwnerScope,
): FlowDto[] {
	if (!hasRequestedScope(scope)) return flows;

	const missingOwnerFlowIds = flows
		.filter((flow) => !hasCompleteOwnerMeta(flow))
		.map((flow) => flow.id);
	if (missingOwnerFlowIds.length > 0) {
		throw new AppError("Flow scope metadata is missing; repair is required before scoped loading", {
			status: 409,
			code: "flow_scope_metadata_missing",
			details: {
				requestedOwnerType: scope?.ownerType ?? null,
				requestedOwnerId: scope?.ownerId ?? null,
				affectedFlowIds: missingOwnerFlowIds,
			},
		});
	}

	return flows.filter((flow) => {
		if (scope?.ownerType && flow.ownerType !== scope.ownerType) return false;
		if (scope?.ownerId && flow.ownerId !== scope.ownerId) return false;
		return true;
	});
}
