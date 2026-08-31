const ACCEPTANCE_CASE_KINDS = new Set(["text", "image", "video"]);
export const SIMPLE_IMAGE_ACCEPTANCE_PROMPT = "生成一张小猫图片";

function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readNonEmptyString(value) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireRecord(value, path) {
	const record = asRecord(value);
	if (!record) throw new Error(`${path} must be an object`);
	return record;
}

function requireString(value, path) {
	const text = readNonEmptyString(value);
	if (!text) throw new Error(`${path} must be a non-empty string`);
	return text;
}

function readHttpUrl(value) {
	const text = readNonEmptyString(value);
	if (!text) return null;
	try {
		const url = new URL(text);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

function readArtifactUrl(evidence) {
	const attributes = asRecord(evidence.attributes);
	// Match the agents-cli verifier's deterministic media boundary exactly:
	// correlation ids and sourceRef are useful for tracing, but only the
	// canonical attributes.url proves a materialized media delivery.
	return readHttpUrl(attributes?.url);
}

function assertEvidenceReferences(evidence, verification) {
	const evidenceById = new Map();
	for (const item of evidence) {
		const record = requireRecord(item, "terminalDelivery.deliveryEvidence[]");
		const evidenceId = requireString(record.evidenceId, "deliveryEvidence.evidenceId");
		if (evidenceById.has(evidenceId)) {
			throw new Error(`duplicate delivery evidence id: ${evidenceId}`);
		}
		if (!Array.isArray(record.requirementIds)) {
			throw new Error(`delivery evidence ${evidenceId} is missing requirementIds`);
		}
		evidenceById.set(evidenceId, record);
	}

	if (!Array.isArray(verification.criteria)) {
		throw new Error("deliveryVerification.criteria must be an array");
	}
	for (const rawCriterion of verification.criteria) {
		const criterion = requireRecord(rawCriterion, "deliveryVerification.criteria[]");
		const requirementId = requireString(
			criterion.requirementId,
			"deliveryVerification.criteria[].requirementId",
		);
		if (criterion.status === "conflict" || criterion.status === "unresolved") {
			throw new Error(`delivery criterion ${requirementId} is ${criterion.status}`);
		}
		if (!Array.isArray(criterion.evidenceIds)) {
			throw new Error(`delivery criterion ${requirementId} has invalid evidenceIds`);
		}
		for (const evidenceIdValue of criterion.evidenceIds) {
			const evidenceId = requireString(
				evidenceIdValue,
				`delivery criterion ${requirementId} evidenceId`,
			);
			const item = evidenceById.get(evidenceId);
			if (!item) throw new Error(`delivery criterion references missing evidence: ${evidenceId}`);
			if (!item.requirementIds.includes(requirementId)) {
				throw new Error(
					`delivery evidence ${evidenceId} does not bind requirement ${requirementId}`,
				);
			}
		}
	}
}

export function assertAcceptanceCaseKind(value) {
	const kind = readNonEmptyString(value);
	if (!kind || !ACCEPTANCE_CASE_KINDS.has(kind)) {
		throw new Error(`unknown acceptance case: ${String(value)}`);
	}
	return kind;
}

export function createSseEventDecoder() {
	let buffer = "";
	let eventName = "message";
	let eventId = "";
	let dataLines = [];

	const flushFrame = (events) => {
		if (dataLines.length === 0) {
			eventName = "message";
			eventId = "";
			return;
		}
		events.push({ event: eventName, id: eventId, data: dataLines.join("\n") });
		eventName = "message";
		eventId = "";
		dataLines = [];
	};

	const consume = (final) => {
		const events = [];
		while (true) {
			const newline = buffer.indexOf("\n");
			if (newline < 0) break;
			let line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line) {
				flushFrame(events);
				continue;
			}
			if (line.startsWith(":")) continue;
			const separator = line.indexOf(":");
			const field = separator < 0 ? line : line.slice(0, separator);
			let value = separator < 0 ? "" : line.slice(separator + 1);
			if (value.startsWith(" ")) value = value.slice(1);
			if (field === "event") eventName = value || "message";
			else if (field === "id") eventId = value;
			else if (field === "data") dataLines.push(value);
		}
		if (final && buffer) {
			buffer += "\n";
			return events.concat(consume(true));
		}
		if (final) flushFrame(events);
		return events;
	};

	return {
		push(chunk) {
			buffer += String(chunk || "");
			return consume(false);
		},
		finish() {
			return consume(true);
		},
	};
}

export function parseSseJsonEvent(frame) {
	const record = requireRecord(frame, "SSE frame");
	const event = requireString(record.event, "SSE event name");
	const rawData = requireString(record.data, `SSE ${event} data`);
	let data;
	try {
		data = JSON.parse(rawData);
	} catch (error) {
		throw new Error(`SSE ${event} data is not valid JSON`, { cause: error });
	}
	return {
		event,
		id: readNonEmptyString(record.id),
		data,
	};
}

function readAcceptedAsyncReferences(turn) {
	const checkpoint = asRecord(turn?.recoveryCheckpoint);
	const references = Array.isArray(checkpoint?.durableTaskReferences)
		? checkpoint.durableTaskReferences
		: [];
	const acceptedReferences = references.filter((value) => {
		const reference = asRecord(value);
		if (reference?.acceptedAsync !== true) return false;
		return Boolean(readNonEmptyString(reference.taskId) || readNonEmptyString(reference.runId));
	});
	if (acceptedReferences.length > 0) return acceptedReferences;
	const recentEvents = Array.isArray(turn?.recentEvents) ? turn.recentEvents : [];
	return recentEvents.filter((value) => {
		const event = asRecord(value);
		return event?.type === "tool_completed" &&
			event.toolName === "tapcanvas_image_generate_to_canvas" &&
			event.toolStatus === "succeeded";
	});
}

export function createAcceptanceLifecycleObservation() {
	return {
		acceptedAsyncObserved: false,
		preSubmissionPhysicalBudgetSuspensions: [],
		preSubmissionIntentFailures: [],
	};
}

export function isTransientAcceptanceStatusFailure(value) {
	const error = asRecord(value);
	const status = Number.isInteger(error?.status) ? Number(error.status) : null;
	return error?.name === "TypeError" || status === 429 || (status !== null && status >= 500 && status <= 599);
}

export function observeAcceptanceLifecycle(previous, status) {
	const observation = asRecord(previous) ?? createAcceptanceLifecycleObservation();
	const priorSuspensions = Array.isArray(observation.preSubmissionPhysicalBudgetSuspensions)
		? observation.preSubmissionPhysicalBudgetSuspensions.filter((value) => readNonEmptyString(value))
		: [];
	const priorIntentFailures = Array.isArray(observation.preSubmissionIntentFailures)
		? observation.preSubmissionIntentFailures.filter((value) => readNonEmptyString(value))
		: [];
	const turn = asRecord(asRecord(status)?.turn);
	if (!turn) {
		return {
			acceptedAsyncObserved: observation.acceptedAsyncObserved === true,
			preSubmissionPhysicalBudgetSuspensions: [...new Set(priorSuspensions)],
			preSubmissionIntentFailures: [...new Set(priorIntentFailures)],
		};
	}
	let acceptedBeforeEvent = observation.acceptedAsyncObserved === true;
	const recentEvents = Array.isArray(turn.recentEvents) ? turn.recentEvents : [];
	for (const value of recentEvents) {
		const event = asRecord(value);
		if (!event) continue;
		if (
			event.type === "tool_completed" &&
			event.toolName === "tapcanvas_image_generate_to_canvas" &&
			event.toolStatus === "succeeded"
		) {
			acceptedBeforeEvent = true;
			continue;
		}
		if (
			!acceptedBeforeEvent &&
			event.type === "tool_completed" &&
			event.toolName === "record_user_intent" &&
			event.toolStatus === "failed"
		) {
			priorIntentFailures.push([
				readNonEmptyString(event.at) ?? "unknown-time",
				event.toolName,
				event.toolStatus,
			].join(":"));
		}
	}
	const acceptedAsyncObserved = acceptedBeforeEvent || readAcceptedAsyncReferences(turn).length > 0;
	const suspension = asRecord(turn.suspension);
	const checkpoint = asRecord(turn.recoveryCheckpoint);
	if (
		!acceptedAsyncObserved &&
		turn.reasonCode === "root_physical_execution_budget_exhausted" &&
		suspension
	) {
		const physicalRunId = readNonEmptyString(suspension.physicalRunId) ??
			readNonEmptyString(checkpoint?.physicalRunId);
		const progressRevision = Number.isInteger(suspension.progressRevision)
			? suspension.progressRevision
			: Number.isInteger(checkpoint?.progressRevision)
				? checkpoint.progressRevision
				: null;
		if (physicalRunId && progressRevision !== null) {
			priorSuspensions.push(`${physicalRunId}:${progressRevision}`);
		}
	}
	return {
		acceptedAsyncObserved,
		preSubmissionPhysicalBudgetSuspensions: [...new Set(priorSuspensions)],
		preSubmissionIntentFailures: [...new Set(priorIntentFailures)],
	};
}

export function verifyAcceptanceLifecycle(kindValue, observationValue) {
	const kind = assertAcceptanceCaseKind(kindValue);
	const observation = asRecord(observationValue);
	const suspensions = Array.isArray(observation?.preSubmissionPhysicalBudgetSuspensions)
		? observation.preSubmissionPhysicalBudgetSuspensions.filter((value) => readNonEmptyString(value))
		: [];
	const intentFailures = Array.isArray(observation?.preSubmissionIntentFailures)
		? observation.preSubmissionIntentFailures.filter((value) => readNonEmptyString(value))
		: [];
	if (kind === "image" && suspensions.length > 0) {
		throw new Error(
			`simple image exhausted ${suspensions.length} physical budget window(s) before accepted async submission`,
		);
	}
	if (kind === "image" && intentFailures.length > 0) {
		throw new Error(
			`simple image failed record_user_intent ${new Set(intentFailures).size} time(s) before accepted async submission`,
		);
	}
	return {
		acceptedAsyncObserved: observation?.acceptedAsyncObserved === true,
		preSubmissionPhysicalBudgetSuspensionCount: new Set(suspensions).size,
		preSubmissionIntentFailureCount: new Set(intentFailures).size,
	};
}

export function verifyAcceptanceDelivery(input) {
	const kind = assertAcceptanceCaseKind(input?.kind);
	const expectedSessionKey = requireString(input?.sessionKey, "sessionKey");
	const expectedTurnId = requireString(input?.turnId, "turnId");
	const status = requireRecord(input?.status, "status");
	if (status.durable !== true) throw new Error("status.durable must be true");
	if (status.sessionId !== expectedSessionKey) throw new Error("status session identity mismatch");
	if (status.activeTurn !== false) throw new Error("successful acceptance status must be inactive");

	const turn = requireRecord(status.turn, "status.turn");
	if (turn.turnId !== expectedTurnId) throw new Error("status turn identity mismatch");
	if (turn.state !== "succeeded" || turn.phase !== "succeeded") {
		throw new Error(`turn is not succeeded: ${String(turn.state)}/${String(turn.phase)}`);
	}
	if (turn.terminalAuthority !== "user_delivery") {
		throw new Error(`turn terminal authority is not user_delivery: ${String(turn.terminalAuthority)}`);
	}

	const terminalDelivery = requireRecord(turn.terminalDelivery, "status.turn.terminalDelivery");
	if (terminalDelivery.version !== 1) throw new Error("terminalDelivery.version must be 1");
	const requestTerminal = requireRecord(
		terminalDelivery.requestTerminal,
		"terminalDelivery.requestTerminal",
	);
	if (
		requestTerminal.version !== 1 || requestTerminal.terminal !== true ||
		requestTerminal.status !== "succeeded"
	) {
		throw new Error("requestTerminal is not an authoritative success");
	}

	const expectedDelivery = requireRecord(
		terminalDelivery.expectedDelivery,
		"terminalDelivery.expectedDelivery",
	);
	const verification = requireRecord(
		terminalDelivery.deliveryVerification,
		"terminalDelivery.deliveryVerification",
	);
	const contractHash = requireString(expectedDelivery.contractHash, "expectedDelivery.contractHash");
	if (expectedDelivery.version !== 2) throw new Error("expectedDelivery.version must be 2");
	if (
		verification.version !== 2 || verification.status !== "satisfied" ||
		verification.contractHash !== contractHash
	) {
		throw new Error("delivery verification is not satisfied for the frozen contract");
	}
	const verifiedAt = requireString(verification.verifiedAt, "deliveryVerification.verifiedAt");
	if (Number.isNaN(Date.parse(verifiedAt))) {
		throw new Error("deliveryVerification.verifiedAt is invalid");
	}

	const delivery = requireRecord(expectedDelivery.delivery, "expectedDelivery.delivery");
	const terminalEvidence = terminalDelivery.deliveryEvidence;
	if (!Array.isArray(terminalEvidence) || terminalEvidence.length === 0) {
		throw new Error("terminalDelivery.deliveryEvidence must not be empty");
	}
	const observedMaterializedEvidence = Array.isArray(input?.materializedEvidence)
		? input.materializedEvidence
		: [];
	const evidence = [...terminalEvidence, ...observedMaterializedEvidence];
	assertEvidenceReferences(evidence, verification);

	if (kind === "text") {
		if (delivery.mode !== "response" || delivery.mediaType !== null) {
			throw new Error("text case was not classified as response delivery without media");
		}
		const finalResponse = requireString(turn.finalResponse, "status.turn.finalResponse");
		const hasFinalResponseEvidence = evidence.some((item) => {
			const record = asRecord(item);
			return record?.kind === "final_response" && record.sourceRef === "final_response";
		});
		if (!hasFinalResponseEvidence) throw new Error("text delivery lacks final_response evidence");
		return {
			kind,
			turnId: expectedTurnId,
			contractHash,
			finalResponse,
			assetUrls: [],
			evidenceCount: evidence.length,
			expectedDelivery,
			deliveryEvidence: evidence,
			deliveryVerification: verification,
			startedAt: readNonEmptyString(turn.startedAt),
			finishedAt: readNonEmptyString(turn.updatedAt),
		};
	}

	if (delivery.mediaType !== kind) {
		throw new Error(`${kind} case delivery.mediaType is ${String(delivery.mediaType)}`);
	}
	if (delivery.mode === "response") {
		throw new Error(`${kind} case cannot use text-only response delivery mode`);
	}
	for (const item of observedMaterializedEvidence) {
		const record = requireRecord(item, "materializedEvidence[]");
		if (record.kind !== "artifact" || record.mediaType !== kind) {
			throw new Error(`materialized evidence must be a typed ${kind} artifact`);
		}
		if (!readArtifactUrl(record)) {
			throw new Error("materialized evidence must contain attributes.url as HTTP(S)");
		}
		if (!Array.isArray(record.requirementIds) || record.requirementIds.length === 0) {
			throw new Error("materialized evidence must bind at least one frozen requirement");
		}
		const matchedRequirement = verification.criteria.some((criterionValue) => {
			const criterion = asRecord(criterionValue);
			return readNonEmptyString(criterion?.requirementId) &&
				record.requirementIds.includes(criterion.requirementId);
		});
		if (!matchedRequirement) {
			throw new Error("materialized evidence is not bound to a frozen delivery criterion");
		}
	}
	const assetUrls = [];
	for (const item of evidence) {
		const record = asRecord(item);
		if (record?.kind !== "artifact" || record.mediaType !== kind) continue;
		const url = readArtifactUrl(record);
		if (url && !assetUrls.includes(url)) assetUrls.push(url);
	}
	const minimumAssetCount = Number.isInteger(delivery.artifactCount) && delivery.artifactCount > 0
		? delivery.artifactCount
		: 1;
	if (assetUrls.length < minimumAssetCount) {
		throw new Error(
			`${kind} delivery has ${assetUrls.length} materialized HTTP asset(s), expected ${minimumAssetCount}`,
		);
	}
	return {
		kind,
		turnId: expectedTurnId,
		contractHash,
		finalResponse: readNonEmptyString(turn.finalResponse),
		assetUrls,
		evidenceCount: evidence.length,
		expectedDelivery,
		deliveryEvidence: evidence,
		deliveryVerification: verification,
		startedAt: readNonEmptyString(turn.startedAt),
		finishedAt: readNonEmptyString(turn.updatedAt),
	};
}
