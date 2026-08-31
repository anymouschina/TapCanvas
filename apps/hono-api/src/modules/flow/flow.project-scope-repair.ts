import { AppError } from "../../middleware/error";
import type { FlowRow } from "./flow.repo";
import {
	FlowStorageEnvelopeError,
	parseFlowStorageRecord,
	readFlowOwnerMeta,
} from "./flow.storage-envelope";

export type ProjectFlowScopeRepairInput = {
	projectId: string;
	expectedUpdatedAt: string;
	expectedNodeCount: number;
	expectedEdgeCount: number;
};

export type PreparedProjectFlowScopeRepair = {
	expectedData: string;
	nextData: string;
	nodeCount: number;
	edgeCount: number;
};

function requireGraphArray(record: Record<string, unknown>, key: "nodes" | "edges"): unknown[] {
	const value = record[key];
	if (!Array.isArray(value)) {
		throw new AppError(`Flow ${key} must be an array`, {
			status: 500,
			code: "flow_data_invalid",
			details: { field: key },
		});
	}
	return value;
}

export function prepareProjectFlowScopeRepair(
	row: FlowRow,
	input: ProjectFlowScopeRepairInput,
): PreparedProjectFlowScopeRepair {
	if (row.project_id !== input.projectId) {
		throw new AppError("Flow not found in project", {
			status: 404,
			code: "flow_not_found",
		});
	}
	if (row.updated_at !== input.expectedUpdatedAt) {
		throw new AppError("Flow changed after inspection", {
			status: 409,
			code: "flow_scope_repair_precondition_failed",
			details: {
				expectedUpdatedAt: input.expectedUpdatedAt,
				actualUpdatedAt: row.updated_at,
			},
		});
	}

	let record: Record<string, unknown>;
	try {
		record = parseFlowStorageRecord(row.data, "scope repair data");
	} catch (error) {
		if (error instanceof FlowStorageEnvelopeError) {
			throw new AppError(error.message, {
				status: 500,
				code: "flow_data_invalid",
				details: { source: error.source, reason: error.reason },
			});
		}
		throw error;
	}

	const nodes = requireGraphArray(record, "nodes");
	const edges = requireGraphArray(record, "edges");
	if (nodes.length !== input.expectedNodeCount || edges.length !== input.expectedEdgeCount) {
		throw new AppError("Flow graph shape changed after inspection", {
			status: 409,
			code: "flow_scope_repair_precondition_failed",
			details: {
				expectedNodeCount: input.expectedNodeCount,
				actualNodeCount: nodes.length,
				expectedEdgeCount: input.expectedEdgeCount,
				actualEdgeCount: edges.length,
			},
		});
	}

	const owner = readFlowOwnerMeta(record);
	if (owner.ownerType === "project" && owner.ownerId === input.projectId) {
		throw new AppError("Flow project scope is already set", {
			status: 409,
			code: "flow_scope_already_set",
		});
	}
	if (
		(owner.ownerType !== null && owner.ownerType !== "project")
		|| (owner.ownerId !== null && owner.ownerId !== input.projectId)
	) {
		throw new AppError("Flow has a conflicting owner scope", {
			status: 409,
			code: "flow_scope_conflict",
			details: {
				ownerType: owner.ownerType,
				ownerId: owner.ownerId,
			},
		});
	}

	return {
		expectedData: row.data,
		nextData: JSON.stringify({
			...record,
			__tapcanvasFlowOwner: {
				ownerType: "project",
				ownerId: input.projectId,
			},
		}),
		nodeCount: nodes.length,
		edgeCount: edges.length,
	};
}
