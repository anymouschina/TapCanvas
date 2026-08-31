import assert from "node:assert/strict";
import test from "node:test";

import {
	createAcceptanceLifecycleObservation,
	createSseEventDecoder,
	isTransientAcceptanceStatusFailure,
	observeAcceptanceLifecycle,
	parseSseJsonEvent,
	SIMPLE_IMAGE_ACCEPTANCE_PROMPT,
	verifyAcceptanceDelivery,
	verifyAcceptanceLifecycle,
} from "./lib/ai-delivery-acceptance-contract.mjs";
import {
	observeMaterializedEvidence,
	readFlowNodeIds,
	readMediaDeliveryCandidates,
} from "./lib/ai-delivery-materialization.mjs";

test("image integration case keeps the production regression prompt exact", () => {
	assert.equal(SIMPLE_IMAGE_ACCEPTANCE_PROMPT, "生成一张小猫图片");
});

test("durable status observation retries only transport, throttling, and server failures", () => {
	assert.equal(isTransientAcceptanceStatusFailure(Object.assign(new Error("busy"), { status: 503 })), true);
	assert.equal(isTransientAcceptanceStatusFailure(Object.assign(new Error("throttled"), { status: 429 })), true);
	assert.equal(isTransientAcceptanceStatusFailure(new TypeError("fetch failed")), true);
	assert.equal(isTransientAcceptanceStatusFailure(Object.assign(new Error("bad request"), { status: 400 })), false);
	assert.equal(isTransientAcceptanceStatusFailure(Object.assign(new Error("conflict"), { status: 409 })), false);
	assert.equal(isTransientAcceptanceStatusFailure(new SyntaxError("invalid payload")), false);
});

function buildStatus(kind, options = {}) {
	const mediaType = kind === "text" ? null : kind;
	const mode = kind === "text" ? "response" : "async_artifact";
	const requirementId = `${kind}-delivered`;
	const evidence = kind === "text"
		? {
			evidenceId: "final-response",
			kind: "final_response",
			sourceRef: "final_response",
			requirementIds: [requirementId],
			attributes: { sha256: "sha256:text" },
		}
		: {
			evidenceId: `${kind}-artifact`,
			kind: "artifact",
			mediaType,
			sourceRef: `https://cdn.example.test/result.${kind === "image" ? "png" : "mp4"}`,
			requirementIds: [requirementId],
			attributes: {
				materialized: true,
				url: `https://cdn.example.test/result.${kind === "image" ? "png" : "mp4"}`,
			},
		};
	return {
		sessionId: "session-1",
		durable: true,
		activeTurn: false,
		turn: {
			turnId: "turn-1",
			state: "succeeded",
			phase: "succeeded",
			terminalAuthority: "user_delivery",
			finalResponse: kind === "text" ? "雨落下。故人重逢。天亮后并肩离开。" : "已完成。",
			terminalDelivery: {
				version: 1,
				requestTerminal: {
					version: 1,
					terminal: true,
					status: "succeeded",
					reason: "delivery_satisfied",
				},
				expectedDelivery: {
					version: 2,
					contractHash: "sha256:contract",
					delivery: {
						mode,
						mediaType,
						kind: `${kind}_delivery`,
						output: `${kind} result`,
						...(kind === "text" ? {} : { artifactCount: 1 }),
					},
				},
				deliveryEvidence: [evidence],
				deliveryVerification: {
					version: 2,
					contractHash: "sha256:contract",
					status: "satisfied",
					verifiedAt: "2026-08-23T00:00:00.000Z",
					criteria: [{
						requirementId,
						status: "satisfied",
						evidenceIds: [evidence.evidenceId],
						reason: "verified",
					}],
				},
			},
			...options,
		},
	};
}

test("SSE decoder preserves fragmented event data and journal identity", () => {
	const decoder = createSseEventDecoder();
	assert.deepEqual(decoder.push("id: turn-1#1\nevent: res"), []);
	const frames = decoder.push("ult\ndata: {\"response\":{\"text\":\"ok\"}}\n\n");
	assert.equal(frames.length, 1);
	assert.deepEqual(parseSseJsonEvent(frames[0]), {
		event: "result",
		id: "turn-1#1",
		data: { response: { text: "ok" } },
	});
});

test("text acceptance requires durable final response evidence", () => {
	const result = verifyAcceptanceDelivery({
		kind: "text",
		sessionKey: "session-1",
		turnId: "turn-1",
		status: buildStatus("text"),
	});
	assert.equal(result.finalResponse, "雨落下。故人重逢。天亮后并肩离开。");
	assert.deepEqual(result.assetUrls, []);
});

test("image and video acceptance require typed materialized HTTP assets", () => {
	for (const kind of ["image", "video"]) {
		const result = verifyAcceptanceDelivery({
			kind,
			sessionKey: "session-1",
			turnId: "turn-1",
			status: buildStatus(kind),
		});
		assert.equal(result.assetUrls.length, 1);
		assert.match(result.assetUrls[0], /^https:\/\//);
	}
});

test("simple image acceptance rejects physical budget exhaustion before async submission", () => {
	let observation = createAcceptanceLifecycleObservation();
	observation = observeAcceptanceLifecycle(observation, {
		turn: {
			reasonCode: "root_physical_execution_budget_exhausted",
			suspension: { physicalRunId: "physical-1", progressRevision: 0 },
			recoveryCheckpoint: {
				physicalRunId: "physical-1",
				progressRevision: 0,
				durableTaskReferences: [],
			},
		},
	});
	assert.throws(
		() => verifyAcceptanceLifecycle("image", observation),
		/physical budget window\(s\) before accepted async submission/,
	);
});

test("simple image acceptance rejects repeated intent-contract failures before submission", () => {
	let observation = createAcceptanceLifecycleObservation();
	const failedIntentStatus = {
		turn: {
			recentEvents: [{
				type: "tool_completed",
				at: "2026-08-24T00:00:01.000Z",
				toolName: "record_user_intent",
				toolStatus: "failed",
			}],
		},
	};
	observation = observeAcceptanceLifecycle(observation, failedIntentStatus);
	observation = observeAcceptanceLifecycle(observation, failedIntentStatus);
	assert.throws(
		() => verifyAcceptanceLifecycle("image", observation),
		/failed record_user_intent 1 time\(s\) before accepted async submission/,
	);
});

test("simple image acceptance allows post-submission continuation without double-counting polls", () => {
	let observation = createAcceptanceLifecycleObservation();
	const acceptedStatus = {
		turn: {
			reasonCode: null,
			suspension: null,
			recentEvents: [{
				type: "tool_completed",
				toolName: "tapcanvas_image_generate_to_canvas",
				toolStatus: "succeeded",
			}],
		},
	};
	observation = observeAcceptanceLifecycle(observation, acceptedStatus);
	observation = observeAcceptanceLifecycle(observation, acceptedStatus);
	assert.deepEqual(verifyAcceptanceLifecycle("image", observation), {
		acceptedAsyncObserved: true,
		preSubmissionPhysicalBudgetSuspensionCount: 0,
		preSubmissionIntentFailureCount: 0,
	});
});

test("workflow action authority cannot impersonate user delivery", () => {
	const status = buildStatus("image", { terminalAuthority: "workflow_action" });
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "image",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
	}), /terminal authority is not user_delivery/);
});

test("accepted async task identity without a URL is not a delivered media asset", () => {
	const status = buildStatus("video");
	status.turn.terminalDelivery.deliveryEvidence[0].sourceRef = "task-video-1";
	status.turn.terminalDelivery.deliveryEvidence[0].attributes = {
		taskId: "task-video-1",
		status: "running",
	};
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "video",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
	}), /0 materialized HTTP asset/);
});

test("isolated-flow materialization can complete a correlated accepted image receipt", () => {
	const status = buildStatus("image");
	const submission = status.turn.terminalDelivery.deliveryEvidence[0];
	submission.sourceRef = "node-image-1";
	submission.attributes = {
		nodeId: "node-image-1",
		taskId: "task-image-1",
		status: "running",
	};
	const result = verifyAcceptanceDelivery({
		kind: "image",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
		materializedEvidence: [{
			evidenceId: "image-artifact:materialized:node-image-1",
			kind: "artifact",
			mediaType: "image",
			sourceRef: "node-image-1",
			requirementIds: ["image-delivered"],
			attributes: {
				materialized: true,
				url: "https://cdn.example.test/result.png",
				nodeId: "node-image-1",
				taskId: "task-image-1",
				observationSource: "isolated_flow",
			},
		}],
	});
	assert.deepEqual(result.assetUrls, ["https://cdn.example.test/result.png"]);
	assert.equal(result.deliveryEvidence.length, 2);
});

test("isolated flow delta correlates a receipt that lacks node and task identity", () => {
	const status = buildStatus("image");
	const submission = status.turn.terminalDelivery.deliveryEvidence[0];
	submission.sourceRef = "accepted-image-submission";
	submission.attributes = { status: "running" };
	const candidates = readMediaDeliveryCandidates("image", status);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].nodeId, null);
	assert.equal(candidates[0].taskId, null);
	const baseline = {
		data: {
			nodes: [{ id: "eval-input", data: { kind: "text", status: "ready" } }],
		},
	};
	const evidence = observeMaterializedEvidence("image", candidates, {
		data: {
			nodes: [
				...baseline.data.nodes,
				{
					id: "node-image-1",
					data: {
						kind: "image",
						status: "success",
						taskId: "task-image-1",
						imageUrl: "https://cdn.example.test/result.png",
					},
				},
			],
		},
	}, readFlowNodeIds(baseline));
	assert.equal(evidence.length, 1);
	assert.equal(evidence[0].attributes.observationSource, "isolated_flow_delta");
	assert.equal(evidence[0].attributes.nodeId, "node-image-1");
	assert.equal(evidence[0].attributes.taskId, "task-image-1");
});

test("submission-bound persisted state carries the exact media node identity", () => {
	const status = buildStatus("image");
	status.turn.terminalDelivery.deliveryEvidence = [{
		evidenceId: "image-submission",
		kind: "persisted_state",
		sourceRef: "task:task-image-1",
		requirementIds: ["image-delivered"],
		artifactClass: "image",
		attributes: {
			nodeId: "node-image-1",
			taskId: "task-image-1",
			state: "running",
			completionBoundary: "submission",
			materializationOwner: "durable_canvas_task",
		},
	}];
	assert.deepEqual(readMediaDeliveryCandidates("image", status), [{
		evidenceId: "image-submission",
		nodeId: "node-image-1",
		taskId: "task-image-1",
		requirementIds: ["image-delivered"],
		url: null,
	}]);
});

test("isolated flow delta never accepts a pre-existing matching media node", () => {
	const status = buildStatus("image");
	status.turn.terminalDelivery.deliveryEvidence[0].attributes = { status: "running" };
	const candidates = readMediaDeliveryCandidates("image", status);
	const flow = {
		data: {
			nodes: [{
				id: "pre-existing-image",
				data: {
					kind: "image",
					status: "success",
					imageUrl: "https://cdn.example.test/old.png",
				},
			}],
		},
	};
	assert.deepEqual(
		observeMaterializedEvidence("image", candidates, flow, readFlowNodeIds(flow)),
		[],
	);
});

test("isolated-flow materialization must bind a frozen delivery criterion", () => {
	const status = buildStatus("image");
	status.turn.terminalDelivery.deliveryEvidence[0].attributes = {
		nodeId: "node-image-1",
		taskId: "task-image-1",
		status: "running",
	};
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "image",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
		materializedEvidence: [{
			evidenceId: "image-artifact:materialized:node-image-1",
			kind: "artifact",
			mediaType: "image",
			sourceRef: "node-image-1",
			requirementIds: ["unrelated-requirement"],
			attributes: { materialized: true, url: "https://cdn.example.test/result.png" },
		}],
	}), /not bound to a frozen delivery criterion/);
});

test("media cardinality counts independently materialized URLs instead of duplicate evidence", () => {
	const status = buildStatus("image");
	const delivery = status.turn.terminalDelivery.expectedDelivery.delivery;
	delivery.artifactCount = 2;
	const duplicate = structuredClone(status.turn.terminalDelivery.deliveryEvidence[0]);
	duplicate.evidenceId = "image-artifact-duplicate";
	status.turn.terminalDelivery.deliveryEvidence.push(duplicate);
	status.turn.terminalDelivery.deliveryVerification.criteria[0].evidenceIds.push(
		duplicate.evidenceId,
	);
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "image",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
	}), /1 materialized HTTP asset\(s\), expected 2/);
});

test("negative avoided criteria may be structurally satisfied without positive evidence", () => {
	const status = buildStatus("text");
	status.turn.terminalDelivery.deliveryVerification.criteria.push({
		requirementId: "forbid-extra-advice",
		status: "avoided",
		evidenceIds: [],
		reason: "No extra advice was emitted.",
	});
	const result = verifyAcceptanceDelivery({
		kind: "text",
		sessionKey: "session-1",
		turnId: "turn-1",
		status,
	});
	assert.equal(result.kind, "text");
});

test("contract hash mismatch and unbound criterion evidence are rejected", () => {
	const hashMismatch = buildStatus("text");
	const verification = hashMismatch.turn.terminalDelivery.deliveryVerification;
	verification.contractHash = "sha256:different";
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "text",
		sessionKey: "session-1",
		turnId: "turn-1",
		status: hashMismatch,
	}), /frozen contract/);

	const unbound = buildStatus("image");
	unbound.turn.terminalDelivery.deliveryEvidence[0].requirementIds = ["another-requirement"];
	assert.throws(() => verifyAcceptanceDelivery({
		kind: "image",
		sessionKey: "session-1",
		turnId: "turn-1",
		status: unbound,
	}), /does not bind requirement/);
});
