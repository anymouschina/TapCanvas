import type {
	HostCanvasContext,
	HostCapabilityManifest,
} from "./host-canvas-protocol";
import type { PublicChatToolDeliveryArtifact } from "./public-chat-tool-asset-evidence";

type HostAsyncEvidenceToolCall = {
	toolCallId: string;
	name: string;
	status: string;
	inputJson: Record<string, unknown> | null;
};

export type PublicChatHostExecutionHandoffEvidenceV1 = {
	version: 1;
	owner: "external_host";
	host: string;
	protocolVersion: "1";
	commandCount: number;
	runNodeCount: number;
	commandToolCallIds: string[];
};

export type PublicChatHostExecutionHandoffOwnershipV1 = {
	version: 1;
	owner: "external_host";
	ticketId: string;
	logicalTaskId: string;
	taskNodeId: string;
	taskRevision: number;
	reasonCode: string;
	host: string;
	commandCount: number;
	runNodeCount: number;
	commandToolCallIds: string[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readRequiredString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Projects only commands that were structurally accepted for the declared
 * external host. This is execution ownership evidence, not proof that the
 * host has already applied a patch or materialized an asset.
 */
export function collectPublicChatHostExecutionHandoffEvidence(input: {
	manifest: HostCapabilityManifest | null;
	toolCalls: HostAsyncEvidenceToolCall[];
}): PublicChatHostExecutionHandoffEvidenceV1 | null {
	if (!input.manifest) return null;
	const allowedOps = new Set<string>(input.manifest.patchOps);
	const commands = input.toolCalls.filter((toolCall) => {
		if (
			toolCall.name !== "flow_patch" ||
			toolCall.status !== "succeeded" ||
			!toolCall.toolCallId ||
			!toolCall.inputJson
		) return false;
		const op = readRequiredString(toolCall.inputJson.op);
		return Boolean(op && allowedOps.has(op));
	});
	const runNodeCount = commands.filter(
		(toolCall) => toolCall.inputJson?.op === "runNode",
	).length;
	if (commands.length === 0 || runNodeCount === 0) return null;
	return {
		version: 1,
		owner: "external_host",
		host: input.manifest.host,
		protocolVersion: input.manifest.protocol_version,
		commandCount: commands.length,
		runNodeCount,
		commandToolCallIds: [...new Set(commands.map((toolCall) => toolCall.toolCallId))],
	};
}

/**
 * Binds an agents-cli `waiting_external` ticket to the exact host command
 * evidence projected by Hono. A ticket or a command list alone is
 * insufficient; both machine identities must be complete and mutually
 * consistent before the public turn can leave execution to the host.
 */
export function readPublicChatHostExecutionHandoffOwnership(
	meta: Record<string, unknown> | null,
): PublicChatHostExecutionHandoffOwnershipV1 | null {
	const runtime = readRecord(meta?.runtime);
	const exit = readRecord(runtime?.physicalRunExit);
	const ticket = readRecord(exit?.continuationTicket);
	const evidence = readRecord(meta?.hostExecutionHandoff);
	const ticketId = readRequiredString(ticket?.ticketId);
	const logicalTaskId = readRequiredString(exit?.logicalTaskId);
	const taskNodeId = readRequiredString(exit?.taskNodeId);
	const reasonCode = readRequiredString(exit?.reasonCode);
	const host = readRequiredString(evidence?.host);
	const commandToolCallIds = Array.isArray(evidence?.commandToolCallIds)
		? [...new Set(evidence.commandToolCallIds
			.map(readRequiredString)
			.filter((value): value is string => value !== null))]
		: [];
	const taskRevision = typeof exit?.taskRevision === "number" &&
		Number.isInteger(exit.taskRevision) && exit.taskRevision >= 0
		? exit.taskRevision
		: null;
	const commandCount = typeof evidence?.commandCount === "number" &&
		Number.isInteger(evidence.commandCount) && evidence.commandCount > 0
		? evidence.commandCount
		: null;
	const runNodeCount = typeof evidence?.runNodeCount === "number" &&
		Number.isInteger(evidence.runNodeCount) && evidence.runNodeCount > 0
		? evidence.runNodeCount
		: null;
	if (
		exit?.version !== 1 ||
		exit.kind !== "waiting_external" ||
		exit.taskStatus !== "waiting_for_evidence" ||
		ticket?.version !== 1 ||
		ticket.nextTrigger !== "external_evidence" ||
		ticket.resumeFromStatus !== "waiting_for_evidence" ||
		evidence?.version !== 1 ||
		evidence.owner !== "external_host" ||
		evidence.protocolVersion !== "1" ||
		!ticketId ||
		!logicalTaskId ||
		!taskNodeId ||
		!reasonCode ||
		!host ||
		taskRevision === null ||
		commandCount === null ||
		runNodeCount === null ||
		commandToolCallIds.length !== commandCount ||
		ticket.logicalTaskId !== logicalTaskId ||
		ticket.taskNodeId !== taskNodeId ||
		ticket.taskRevision !== taskRevision ||
		ticket.reasonCode !== reasonCode
	) return null;
	return {
		version: 1,
		owner: "external_host",
		ticketId,
		logicalTaskId,
		taskNodeId,
		taskRevision,
		reasonCode,
		host,
		commandCount,
		runNodeCount,
		commandToolCallIds,
	};
}

/**
 * Host flow_patch calls are outbound commands only. Without a host execution
 * receipt containing a durable task identity or final asset URL, they cannot
 * contribute accepted_async/materialized delivery evidence.
 */
export function collectPublicChatHostAsyncDeliveryArtifacts(_input: {
	manifest: HostCapabilityManifest | null;
	canvasContext: HostCanvasContext | null;
	toolCalls: HostAsyncEvidenceToolCall[];
}): PublicChatToolDeliveryArtifact[] {
	return [];
}
