import { describe, expect, it } from "vitest";

import type { HostCapabilityManifest } from "./host-canvas-protocol";
import {
	collectPublicChatHostAsyncDeliveryArtifacts,
	collectPublicChatHostExecutionHandoffEvidence,
	readPublicChatHostExecutionHandoffOwnership,
} from "./public-chat-host-async-evidence";

const manifest: HostCapabilityManifest = {
	protocol_version: "1",
	host: "test-host",
	patchOps: ["addNode", "runNode"],
	nodeSpecs: [{ type: "renderStill", outputs: [{ handle: "out", emits: "image" }] }],
};

describe("collectPublicChatHostAsyncDeliveryArtifacts", () => {
	it("does not turn outbound runNode commands into executor acceptance evidence", () => {
		expect(
			collectPublicChatHostAsyncDeliveryArtifacts({
				manifest,
				canvasContext: {
					nodes: [{ id: "still-existing", type: "renderStill" }],
					edges: [],
				},
				toolCalls: [
					{
						toolCallId: "run-still",
						name: "flow_patch",
						status: "succeeded",
						inputJson: { op: "runNode", id: "still-existing" },
					},
				],
			}),
		).toEqual([]);
	});

	it("binds declared host commands to an exact external-evidence ticket", () => {
		const hostExecutionHandoff = collectPublicChatHostExecutionHandoffEvidence({
			manifest,
			toolCalls: [{
				toolCallId: "add-still",
				name: "flow_patch",
				status: "succeeded",
				inputJson: { op: "addNode", node: { id: "still-1", type: "renderStill" } },
			}, {
				toolCallId: "run-still",
				name: "flow_patch",
				status: "succeeded",
				inputJson: { op: "runNode", id: "still-1" },
			}],
		});
		expect(hostExecutionHandoff).toEqual({
			version: 1,
			owner: "external_host",
			host: "test-host",
			protocolVersion: "1",
			commandCount: 2,
			runNodeCount: 1,
			commandToolCallIds: ["add-still", "run-still"],
		});

		expect(readPublicChatHostExecutionHandoffOwnership({
			hostExecutionHandoff,
			runtime: {
				physicalRunExit: {
					version: 1,
					kind: "waiting_external",
					logicalTaskId: "logical-1",
					taskNodeId: "task-1",
					taskRevision: 4,
					taskStatus: "waiting_for_evidence",
					reasonCode: "host_execution_required",
					continuationTicket: {
						version: 1,
						ticketId: "logical-1:task-1:4",
						logicalTaskId: "logical-1",
						taskNodeId: "task-1",
						taskRevision: 4,
						resumeFromStatus: "waiting_for_evidence",
						nextTrigger: "external_evidence",
						reasonCode: "host_execution_required",
					},
				},
			},
		})).toMatchObject({
			owner: "external_host",
			ticketId: "logical-1:task-1:4",
			logicalTaskId: "logical-1",
			commandCount: 2,
			runNodeCount: 1,
		});
	});

	it("rejects a ticket without a declared successful runNode command", () => {
		expect(collectPublicChatHostExecutionHandoffEvidence({
			manifest,
			toolCalls: [{
				toolCallId: "add-still",
				name: "flow_patch",
				status: "succeeded",
				inputJson: { op: "addNode", node: { id: "still-1", type: "renderStill" } },
			}],
		})).toBeNull();
	});

	it("rejects mismatched external-evidence identities", () => {
		expect(readPublicChatHostExecutionHandoffOwnership({
			hostExecutionHandoff: {
				version: 1,
				owner: "external_host",
				host: "test-host",
				protocolVersion: "1",
				commandCount: 1,
				runNodeCount: 1,
				commandToolCallIds: ["run-still"],
			},
			runtime: {
				physicalRunExit: {
					version: 1,
					kind: "waiting_external",
					logicalTaskId: "logical-1",
					taskNodeId: "task-1",
					taskRevision: 4,
					taskStatus: "waiting_for_evidence",
					reasonCode: "host_execution_required",
					continuationTicket: {
						version: 1,
						ticketId: "logical-1:task-1:5",
						logicalTaskId: "logical-1",
						taskNodeId: "task-1",
						taskRevision: 5,
						resumeFromStatus: "waiting_for_evidence",
						nextTrigger: "external_evidence",
						reasonCode: "host_execution_required",
					},
				},
			},
		})).toBeNull();
	});
});
