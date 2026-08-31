import type { WorkerEnv } from "../../types";
import {
	WORKFLOW_PURE_NODE_CACHE_POLICY_VERSION,
	type WorkflowPureNodeCachePolicyV1,
} from "@tapcanvas/workflow-kernel-protocol";
import {
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutorRef,
	type WorkflowNodeOutputV1,
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";

const CACHE_PROTOCOL_VERSION = "workflow.pure-node-cache/v1" as const;
const CACHE_CANDIDATE_LIMIT = 20;

type PureExecutorAttestation = Readonly<{
	contractVersion: string;
	executionMode: "once";
	requiresNullArtifactIdentities: true;
}>;

/**
 * This registry is the trusted purity boundary. Canvas data can request caching, but it
 * cannot grant purity to an executor that performs I/O, uses time/randomness, or creates
 * execution-scoped identities.
 */
const PURE_EXECUTOR_ATTESTATIONS: Readonly<Record<string, PureExecutorAttestation>> = Object.freeze({
	"workflow.input.text/v1": {
		contractVersion: "workflow.input.text/v1@1",
		executionMode: "once",
		requiresNullArtifactIdentities: true,
	},
	"workflow.input/v1": {
		contractVersion: "workflow.input/v1@1",
		executionMode: "once",
		requiresNullArtifactIdentities: true,
	},
	"agents.skill.require/v1": {
		contractVersion: "agents.skill.require/v1@1",
		executionMode: "once",
		requiresNullArtifactIdentities: true,
	},
	"agents.tool.allow/v1": {
		contractVersion: "agents.tool.allow/v1@1",
		executionMode: "once",
		requiresNullArtifactIdentities: true,
	},
});

export type WorkflowPureCacheRequest = Readonly<{
	cacheKey: string;
	contractVersion: string;
	executorRef: string;
}>;

type WorkflowPureCacheReceipt = Readonly<{
	protocolVersion: typeof CACHE_PROTOCOL_VERSION;
	status: "stored" | "hit";
	cacheKey: string;
	contractVersion: string;
	originExecutionId: string;
	originNodeRunId: string;
	sourceExecutionId?: string;
	sourceNodeRunId?: string;
}>;

export type WorkflowPureCacheHit = Readonly<{
	outputRefs: WorkflowNodeOutputV1;
	sourceExecutionId: string;
	sourceNodeRunId: string;
	originExecutionId: string;
	originNodeRunId: string;
}>;

type CacheCandidateRow = Readonly<{
	id: string;
	execution_id: string;
	output_refs: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow pure cache ${field} must be a non-empty string`);
	}
	return value.trim();
}

function parseCachePolicy(value: unknown): WorkflowPureNodeCachePolicyV1 | null {
	if (value === undefined) return null;
	if (!isRecord(value)) throw new Error("Workflow pure cache policy must be an object");
	if (value.version !== WORKFLOW_PURE_NODE_CACHE_POLICY_VERSION) {
		throw new Error("Workflow pure cache policy version must be 1");
	}
	if (value.strategy !== "content_addressed") {
		throw new Error("Workflow pure cache strategy must be content_addressed");
	}
	return {
		version: WORKFLOW_PURE_NODE_CACHE_POLICY_VERSION,
		strategy: "content_addressed",
		contractVersion: requireText(value.contractVersion, "contractVersion"),
	};
}

function canonicalize(value: unknown, path: string): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`Workflow pure cache key ${path} contains a non-finite number`);
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
	}
	if (!isRecord(value)) {
		throw new Error(`Workflow pure cache key ${path} is not JSON-serializable`);
	}
	return Object.fromEntries(
		Object.keys(value)
			.sort((left, right) => left.localeCompare(right))
			.map((key) => [key, canonicalize(value[key], `${path}.${key}`)]),
	);
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function atomicSpec(node: WorkflowNodeSnapshot): Record<string, unknown> | null {
	const value = node.data.workflowAtomicSpec;
	return isRecord(value) ? value : null;
}

export async function createWorkflowPureCacheRequest(input: Readonly<{
	ownerId: string;
	node: WorkflowNodeSnapshot;
	inputs: Record<string, readonly unknown[]>;
	resumeOnly: boolean;
}>): Promise<WorkflowPureCacheRequest | null> {
	const spec = atomicSpec(input.node);
	if (!spec) return null;
	const policy = parseCachePolicy(spec.cachePolicy);
	if (!policy) return null;
	if (input.resumeOnly) {
		throw new Error(`Workflow node ${input.node.id} cannot use pure cache while resuming persisted work`);
	}
	const executorRef = resolveWorkflowNodeExecutorRef(input.node);
	if (!executorRef) throw new Error(`Workflow node ${input.node.id} cache policy has no executorRef`);
	const attestation = PURE_EXECUTOR_ATTESTATIONS[executorRef];
	if (!attestation) {
		throw new Error(`Workflow executor ${executorRef} has no server purity attestation`);
	}
	if (policy.contractVersion !== attestation.contractVersion) {
		throw new Error(
			`Workflow executor ${executorRef} cache contract ${policy.contractVersion} does not match server contract ${attestation.contractVersion}`,
		);
	}
	if (spec.executionMode !== attestation.executionMode) {
		throw new Error(`Workflow executor ${executorRef} pure cache requires executionMode ${attestation.executionMode}`);
	}
	const keyFacts = canonicalize({
		protocolVersion: CACHE_PROTOCOL_VERSION,
		ownerId: requireText(input.ownerId, "ownerId"),
		executorRef,
		contractVersion: attestation.contractVersion,
		nodeType: input.node.type,
		nodeKind: input.node.kind,
		nodeData: input.node.data,
		inputs: input.inputs,
	}, "facts");
	return {
		cacheKey: await sha256Hex(JSON.stringify(keyFacts)),
		contractVersion: attestation.contractVersion,
		executorRef,
	};
}

function parseReceipt(value: unknown, request: WorkflowPureCacheRequest): WorkflowPureCacheReceipt | null {
	if (!isRecord(value)) return null;
	if (
		value.protocolVersion !== CACHE_PROTOCOL_VERSION
		|| (value.status !== "stored" && value.status !== "hit")
		|| value.cacheKey !== request.cacheKey
		|| value.contractVersion !== request.contractVersion
	) return null;
	try {
		return {
			protocolVersion: CACHE_PROTOCOL_VERSION,
			status: value.status,
			cacheKey: request.cacheKey,
			contractVersion: request.contractVersion,
			originExecutionId: requireText(value.originExecutionId, "originExecutionId"),
			originNodeRunId: requireText(value.originNodeRunId, "originNodeRunId"),
			...(typeof value.sourceExecutionId === "string" && value.sourceExecutionId.trim()
				? { sourceExecutionId: value.sourceExecutionId.trim() }
				: {}),
			...(typeof value.sourceNodeRunId === "string" && value.sourceNodeRunId.trim()
				? { sourceNodeRunId: value.sourceNodeRunId.trim() }
				: {}),
		};
	} catch {
		return null;
	}
}

function reusableOutput(
	value: unknown,
	request: WorkflowPureCacheRequest,
): Readonly<{ output: WorkflowNodeOutputV1; receipt: WorkflowPureCacheReceipt }> | null {
	const output = parseWorkflowNodeOutputV1(value);
	if (!output || output.executorRef !== request.executorRef || output.executionMode !== "once") return null;
	if (output.itemRuns.length !== 0 || output.artifacts.some((artifact) => artifact.identity !== null)) return null;
	const receipt = parseReceipt(output.evidence.workflowPureCache, request);
	return receipt ? { output, receipt } : null;
}

export async function findWorkflowPureCacheHit(
	db: WorkerEnv["DB"],
	ownerId: string,
	request: WorkflowPureCacheRequest,
): Promise<WorkflowPureCacheHit | null> {
	const rows = await db.workflow_node_runs.findMany({
		where: {
			status: "success",
			output_refs: { contains: request.cacheKey },
			workflow_executions: { owner_id: ownerId },
		},
		select: { id: true, execution_id: true, output_refs: true },
		orderBy: { finished_at: "desc" },
		take: CACHE_CANDIDATE_LIMIT,
	}) as readonly CacheCandidateRow[];
	for (const row of rows) {
		const reusable = reusableOutput(row.output_refs, request);
		if (!reusable) continue;
		return {
			outputRefs: reusable.output,
			sourceExecutionId: row.execution_id,
			sourceNodeRunId: row.id,
			originExecutionId: reusable.receipt.originExecutionId,
			originNodeRunId: reusable.receipt.originNodeRunId,
		};
	}
	return null;
}

export function recordWorkflowPureCacheStore(input: Readonly<{
	request: WorkflowPureCacheRequest;
	outputRefs: WorkflowNodeOutputV1;
	executionId: string;
	nodeRunId: string;
}>): WorkflowNodeOutputV1 {
	const attestation = PURE_EXECUTOR_ATTESTATIONS[input.request.executorRef];
	if (!attestation) throw new Error(`Workflow executor ${input.request.executorRef} lost its purity attestation`);
	if (input.outputRefs.itemRuns.length !== 0) {
		throw new Error("Workflow pure cache cannot store outputs with item runs");
	}
	if (attestation.requiresNullArtifactIdentities && input.outputRefs.artifacts.some((artifact) => artifact.identity !== null)) {
		throw new Error("Workflow pure cache cannot store execution-scoped artifact identities");
	}
	return {
		...input.outputRefs,
		evidence: {
			...input.outputRefs.evidence,
			workflowPureCache: {
				protocolVersion: CACHE_PROTOCOL_VERSION,
				status: "stored",
				cacheKey: input.request.cacheKey,
				contractVersion: input.request.contractVersion,
				originExecutionId: requireText(input.executionId, "originExecutionId"),
				originNodeRunId: requireText(input.nodeRunId, "originNodeRunId"),
			} satisfies WorkflowPureCacheReceipt,
		},
	};
}

export function materializeWorkflowPureCacheHit(input: Readonly<{
	request: WorkflowPureCacheRequest;
	hit: WorkflowPureCacheHit;
	node: WorkflowNodeSnapshot;
}>): WorkflowNodeOutputV1 {
	return {
		...input.hit.outputRefs,
		nodeId: input.node.id,
		evidence: {
			...input.hit.outputRefs.evidence,
			workflowPureCache: {
				protocolVersion: CACHE_PROTOCOL_VERSION,
				status: "hit",
				cacheKey: input.request.cacheKey,
				contractVersion: input.request.contractVersion,
				originExecutionId: input.hit.originExecutionId,
				originNodeRunId: input.hit.originNodeRunId,
				sourceExecutionId: input.hit.sourceExecutionId,
				sourceNodeRunId: input.hit.sourceNodeRunId,
			} satisfies WorkflowPureCacheReceipt,
		},
	};
}
