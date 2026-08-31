#!/usr/bin/env node

import crypto from "node:crypto";

import {
	assertAcceptanceCaseKind,
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

const DEFAULT_PROMPTS = Object.freeze({
	text: "请直接用三句话写出一个雨夜重逢的微型故事，给出完整正文，不要只提供写作建议。",
	image: SIMPLE_IMAGE_ACCEPTANCE_PROMPT,
	video: "请直接生成并交付一段真实的5秒视频：雨夜霓虹街头，两位旧友在便利店门口重逢，电影感，16:9。",
});

const RECOVERABLE_RESUME_STATES = new Set(["suspended", "failed", "unknown"]);
const RECOVERABLE_RESUME_REASONS = new Set([
	"root_physical_execution_budget_exhausted",
	"provider_stream_interrupted",
	"llm_response_too_large",
	"workflow_agent_role_timeout",
]);

function printHelp() {
	process.stdout.write(`TapCanvas 一句话交付验收\n\n` +
		`Usage:\n` +
		`  AI_DELIVERY_ACCEPTANCE_API_BASE=http://127.0.0.1:8788 \\\n` +
		`  AI_DELIVERY_ACCEPTANCE_API_KEY=... \\\n` +
		`  node apps/hono-api/scripts/ai-delivery-acceptance.mjs --case text\n\n` +
		`Cases: text | image | video | all\n` +
		`Media cases require --allow-billable.\n\n` +
		`Optional environment:\n` +
		`  AI_DELIVERY_ACCEPTANCE_BEARER_TOKEN\n` +
		`  AI_DELIVERY_ACCEPTANCE_TEAM_ID\n` +
		`  AI_DELIVERY_ACCEPTANCE_MODEL_KEY\n` +
		`  AI_DELIVERY_ACCEPTANCE_TEXT_PROMPT\n` +
		`  AI_DELIVERY_ACCEPTANCE_IMAGE_PROMPT\n` +
		`  AI_DELIVERY_ACCEPTANCE_VIDEO_PROMPT\n` +
		`  AI_DELIVERY_ACCEPTANCE_TIMEOUT_MS (default 1800000)\n` +
		`  AI_DELIVERY_ACCEPTANCE_POLL_MS (default 2000)\n`);
}

function readRequiredEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function readPositiveIntegerEnv(name, fallback) {
	const raw = String(process.env[name] || "").trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	return value;
}

function parseArguments(argv) {
	let selectedCase = "";
	let allowBillable = false;
	let help = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--help" || argument === "-h") {
			help = true;
			continue;
		}
		if (argument === "--allow-billable") {
			allowBillable = true;
			continue;
		}
		if (argument === "--case") {
			selectedCase = String(argv[index + 1] || "").trim();
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	if (help) return { help: true, cases: [], allowBillable };
	if (!selectedCase) throw new Error("--case is required (text, image, video, or all)");
	const cases = selectedCase === "all"
		? ["text", "image", "video"]
		: [assertAcceptanceCaseKind(selectedCase)];
	if (cases.some((kind) => kind !== "text") && !allowBillable) {
		throw new Error("image/video acceptance may create billable assets; pass --allow-billable explicitly");
	}
	return { help: false, cases, allowBillable };
}

function buildRuntimeConfig() {
	const apiBase = readRequiredEnv("AI_DELIVERY_ACCEPTANCE_API_BASE").replace(/\/+$/, "");
	const parsedBase = new URL(apiBase);
	if (parsedBase.protocol !== "http:" && parsedBase.protocol !== "https:") {
		throw new Error("AI_DELIVERY_ACCEPTANCE_API_BASE must use http or https");
	}
	const apiKey = String(process.env.AI_DELIVERY_ACCEPTANCE_API_KEY || "").trim();
	const bearerToken = String(process.env.AI_DELIVERY_ACCEPTANCE_BEARER_TOKEN || "").trim();
	if (Boolean(apiKey) === Boolean(bearerToken)) {
		throw new Error(
			"provide exactly one of AI_DELIVERY_ACCEPTANCE_API_KEY or AI_DELIVERY_ACCEPTANCE_BEARER_TOKEN",
		);
	}
	const headers = apiKey
		? { "X-API-Key": apiKey }
		: { Authorization: `Bearer ${bearerToken}` };
	const teamId = String(process.env.AI_DELIVERY_ACCEPTANCE_TEAM_ID || "").trim();
	const modelKey = readRequiredEnv("AI_DELIVERY_ACCEPTANCE_MODEL_KEY");
	const canvasProjectId = String(process.env.AI_DELIVERY_ACCEPTANCE_PROJECT_ID || "").trim();
	const canvasFlowId = String(process.env.AI_DELIVERY_ACCEPTANCE_FLOW_ID || "").trim();
	if (Boolean(canvasProjectId) !== Boolean(canvasFlowId)) {
		throw new Error("AI_DELIVERY_ACCEPTANCE_PROJECT_ID and AI_DELIVERY_ACCEPTANCE_FLOW_ID must be provided together");
	}
	return {
		apiBase,
		headers: { ...headers, ...(teamId ? { "X-Team-Id": teamId } : {}) },
		modelKey,
		canvasProjectId: canvasProjectId || null,
		canvasFlowId: canvasFlowId || null,
		timeoutMs: readPositiveIntegerEnv("AI_DELIVERY_ACCEPTANCE_TIMEOUT_MS", 1_800_000),
		pollMs: readPositiveIntegerEnv("AI_DELIVERY_ACCEPTANCE_POLL_MS", 2_000),
	};
}

function promptForCase(kind) {
	const name = `AI_DELIVERY_ACCEPTANCE_${kind.toUpperCase()}_PROMPT`;
	const configured = String(process.env[name] || "").trim();
	return configured || DEFAULT_PROMPTS[kind];
}

function wait(milliseconds, signal) {
	if (signal.aborted) throw signal.reason;
	return new Promise((resolve, reject) => {
		const finish = () => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		};
		const timeoutId = setTimeout(finish, milliseconds);
		const onAbort = () => {
			clearTimeout(timeoutId);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function readStreamChunk(reader) {
	let timeoutId;
	try {
		return await Promise.race([
			reader.read().then((value) => ({ idle: false, value })),
			new Promise((resolve) => {
				timeoutId = setTimeout(() => resolve({ idle: true }), 60_000);
			}),
		]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

async function readJsonResponse(response, operation) {
	const text = await response.text();
	let payload = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		const error = new Error(`${operation} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
		error.status = response.status;
		throw error;
	}
	if (!response.ok) {
		const error = new Error(`${operation} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
		error.status = response.status;
		error.payload = payload;
		throw error;
	}
	return payload;
}

function readErrorCode(error) {
	const payload = error && typeof error === "object" ? error.payload : null;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
	if (typeof payload.code === "string" && payload.code.trim()) return payload.code.trim();
	const nested = payload.error;
	return nested && typeof nested === "object" && !Array.isArray(nested) &&
		typeof nested.code === "string" && nested.code.trim()
		? nested.code.trim()
		: null;
}

async function consumeInitialSse(response, signal) {
	if (!response.body) throw new Error("agents chat admission response has no SSE body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseEventDecoder();
	let resultResponse = null;
	let doneReason = null;
	let lastEventId = null;
	let terminalError = null;
	try {
		while (!signal.aborted) {
			const outcome = await readStreamChunk(reader);
			if (outcome.idle) {
				await reader.cancel("acceptance_status_reconcile");
				break;
			}
			if (outcome.value.done) break;
			const frames = parser.push(decoder.decode(outcome.value.value, { stream: true }));
			for (const frame of frames) {
				const event = parseSseJsonEvent(frame);
				if (event.id) lastEventId = event.id;
				if (event.event === "result") {
					const data = event.data && typeof event.data === "object" ? event.data : null;
					resultResponse = data && typeof data.response === "object" ? data.response : null;
				}
				if (event.event === "done") {
					const data = event.data && typeof event.data === "object" ? event.data : null;
					doneReason = typeof data?.reason === "string" ? data.reason : null;
				}
				if (event.event === "error") {
					const data = event.data && typeof event.data === "object" ? event.data : null;
					if (data?.terminal === true) terminalError = data;
				}
			}
			if (resultResponse || doneReason || terminalError) break;
		}
	} finally {
		await reader.cancel("acceptance_durable_status_reconcile").catch(() => undefined);
		reader.releaseLock();
	}
	return { resultResponse, doneReason, lastEventId, terminalError };
}

async function submitCase(config, kind, sessionKey, clientPendingId, prompt, signal) {
	const response = await fetch(`${config.apiBase}/public/agents/chat`, {
		method: "POST",
		headers: {
			...config.headers,
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify({
			vendor: "agents",
			modelKey: config.modelKey,
			prompt,
			clientPendingId,
			sessionKey,
			resetSession: true,
			chatContext: { chatMode: "creative" },
			mode: "auto",
			forceAssetGeneration: false,
			temperature: 0.7,
			stream: true,
			...(config.canvasProjectId && config.canvasFlowId
				? {
					canvasProjectId: config.canvasProjectId,
					canvasFlowId: config.canvasFlowId,
				}
				: {}),
		}),
		signal,
	});
	if (!response.ok) await readJsonResponse(response, `${kind} chat admission`);
	const turnId = String(response.headers.get("X-Trace-ID") || "").trim();
	if (!turnId) throw new Error(`${kind} chat admission is missing X-Trace-ID`);
	return { turnId, stream: await consumeInitialSse(response, signal) };
}

async function getStatus(config, sessionKey, signal) {
	const response = await fetch(`${config.apiBase}/public/agents/chat/status`, {
		method: "POST",
		headers: { ...config.headers, "Content-Type": "application/json" },
		body: JSON.stringify({ sessionKey }),
		signal,
	});
	return readJsonResponse(response, "chat status");
}

async function getFlow(config, flowId, signal) {
	const response = await fetch(`${config.apiBase}/public/flows/${encodeURIComponent(flowId)}`, {
		method: "GET",
		headers: config.headers,
		signal,
	});
	return readJsonResponse(response, "acceptance flow observation");
}

async function awaitMaterializedFlowEvidence(config, kind, status, baselineNodeIds, signal) {
	if (kind === "text") return [];
	const candidates = readMediaDeliveryCandidates(kind, status);
	const unresolvedCandidates = candidates.filter((candidate) => !candidate.url);
	if (unresolvedCandidates.length === 0 && candidates.length > 0) return [];
	if (!config.canvasFlowId) {
		throw new Error(`${kind} acceptance cannot observe materialization without an isolated flowId`);
	}
	if (candidates.length === 0) {
		throw new Error(`${kind} terminal delivery lacks an artifact receipt bound to a delivery requirement`);
	}
	while (!signal.aborted) {
		try {
			const flow = await getFlow(config, config.canvasFlowId, signal);
			const evidence = observeMaterializedEvidence(kind, unresolvedCandidates, flow, baselineNodeIds);
			if (evidence.length >= unresolvedCandidates.length) return evidence;
		} catch (error) {
			if (!isTransientAcceptanceStatusFailure(error)) throw error;
			process.stderr.write(
				`[ai-delivery-acceptance] transient flow observation failure: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		await wait(config.pollMs, signal);
	}
	throw signal.reason;
}

async function resumeTurn(config, sessionKey, turnId, signal) {
	const response = await fetch(`${config.apiBase}/public/agents/chat/resume`, {
		method: "POST",
		headers: { ...config.headers, "Content-Type": "application/json" },
		body: JSON.stringify({ sessionKey, turnId }),
		signal,
	});
	return readJsonResponse(response, "chat resume");
}

function recoveryIdentity(turn) {
	const updatedAt = typeof turn?.updatedAt === "string" ? turn.updatedAt : "";
	const reasonCode = typeof turn?.reasonCode === "string" ? turn.reasonCode : "";
	const checkpointPhysicalRunId = typeof turn?.recoveryCheckpoint?.physicalRunId === "string"
		? turn.recoveryCheckpoint.physicalRunId
		: "";
	const suspensionPhysicalRunId = typeof turn?.suspension?.physicalRunId === "string"
		? turn.suspension.physicalRunId
		: "";
	const physicalRunId = checkpointPhysicalRunId || suspensionPhysicalRunId;
	return `${updatedAt}|${reasonCode}|${physicalRunId}`;
}

async function awaitDurableTerminal(config, sessionKey, turnId, signal) {
	const attemptedRecoveries = new Set();
	let lifecycleObservation = createAcceptanceLifecycleObservation();
	while (!signal.aborted) {
		let status;
		try {
			status = await getStatus(config, sessionKey, signal);
		} catch (error) {
			if (!isTransientAcceptanceStatusFailure(error)) throw error;
			process.stderr.write(
				`[ai-delivery-acceptance] transient status observation failure for ${turnId}: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			await wait(config.pollMs, signal);
			continue;
		}
		lifecycleObservation = observeAcceptanceLifecycle(lifecycleObservation, status);
		const turn = status && typeof status === "object" && !Array.isArray(status) ? status.turn : null;
		if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
			throw new Error("durable status lost the accepted turn");
		}
		if (turn.turnId !== turnId) throw new Error("durable status resolved a different turn");
		if (turn.state === "succeeded" || turn.state === "needs_input" || turn.state === "cancelled") {
			return { status, lifecycleObservation };
		}
		const canResume = RECOVERABLE_RESUME_STATES.has(turn.state) && (
			(turn.suspension && typeof turn.suspension === "object") ||
			RECOVERABLE_RESUME_REASONS.has(turn.reasonCode)
		);
		if (canResume) {
			const identity = recoveryIdentity(turn);
			if (!attemptedRecoveries.has(identity)) {
				attemptedRecoveries.add(identity);
				try {
					const receipt = await resumeTurn(config, sessionKey, turnId, signal);
					if (
						!receipt || typeof receipt !== "object" || Array.isArray(receipt) ||
						receipt.ok !== true || receipt.resumed !== true ||
						receipt.sessionKey !== sessionKey || receipt.turnId !== turnId
					) {
						throw new Error(`chat resume returned an invalid receipt: ${JSON.stringify(receipt)}`);
					}
					process.stderr.write(
						`[ai-delivery-acceptance] resumed ${turnId}: ${JSON.stringify(receipt)}\n`,
					);
				} catch (error) {
					const code = readErrorCode(error);
					if (
						error?.status !== 409 ||
						!new Set([
							"chat_resume_turn_active",
							"chat_resume_continuation_not_ready",
							"chat_resume_claim_superseded",
						]).has(code)
					) throw error;
					process.stderr.write(
						`[ai-delivery-acceptance] resume pending ${turnId}: ${code}\n`,
					);
					// The same durable checkpoint can become claimable without changing
					// its identity. Allow another CAS attempt after the next status poll.
					attemptedRecoveries.delete(identity);
				}
			}
		} else if (turn.state === "failed") {
			return { status, lifecycleObservation };
		}
		await wait(config.pollMs, signal);
	}
	throw signal.reason;
}

async function runCase(config, kind) {
	const sessionKey = `ai-delivery-acceptance:${kind}:${crypto.randomUUID()}`;
	const clientPendingId = `acceptance-${kind}-${crypto.randomUUID()}`;
	const prompt = promptForCase(kind);
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error(`${kind} acceptance timed out after ${config.timeoutMs}ms`));
	}, config.timeoutMs);
	try {
		process.stderr.write(`[ai-delivery-acceptance] starting ${kind}: ${prompt}\n`);
		const baselineNodeIds = config.canvasFlowId && kind !== "text"
			? readFlowNodeIds(await getFlow(config, config.canvasFlowId, controller.signal))
			: new Set();
		const admitted = await submitCase(
			config,
			kind,
			sessionKey,
			clientPendingId,
			prompt,
			controller.signal,
		);
		const terminal = await awaitDurableTerminal(
			config,
			sessionKey,
			admitted.turnId,
			controller.signal,
		);
		const lifecycle = verifyAcceptanceLifecycle(kind, terminal.lifecycleObservation);
		const materializedEvidence = await awaitMaterializedFlowEvidence(
			config,
			kind,
			terminal.status,
			baselineNodeIds,
			controller.signal,
		);
		const verification = verifyAcceptanceDelivery({
			kind,
			sessionKey,
			turnId: admitted.turnId,
			status: terminal.status,
			materializedEvidence,
		});
		return {
			...verification,
			lifecycle,
			prompt,
			sessionKey,
			clientPendingId,
			stream: {
				doneReason: admitted.stream.doneReason,
				lastEventId: admitted.stream.lastEventId,
				sawResult: Boolean(admitted.stream.resultResponse),
				terminalError: admitted.stream.terminalError,
			},
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function main() {
	const argumentsResult = parseArguments(process.argv.slice(2));
	if (argumentsResult.help) {
		printHelp();
		return;
	}
	const config = buildRuntimeConfig();
	const results = [];
	for (const kind of argumentsResult.cases) {
		results.push(await runCase(config, kind));
	}
	process.stdout.write(`${JSON.stringify({
		ok: true,
		apiBase: config.apiBase,
		verifiedAt: new Date().toISOString(),
		results,
	}, null, 2)}\n`);
}

main().catch((error) => {
	process.stderr.write(`[ai-delivery-acceptance] failed: ${error?.stack || error}\n`);
	process.exitCode = 1;
});
