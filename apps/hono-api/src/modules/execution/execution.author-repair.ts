import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeAuthorRevisionEvidence, normalizeAuthorRevisionEditablePaths, type AuthorRevisionEvidenceV1 } from "../../../../../packages/schemas/author-revision-evidence/index.cjs";
import { createAuthorEditScope } from "../../../../../packages/schemas/author-edit-scope/index.mjs";
import { projectRuntimeBoundJsonValueForAuthor, projectRuntimeBoundJsonOutputContract } from "../../../../../packages/schemas/json-schema-runtime-bindings/index.mjs";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { parseWorkflowNodeOutputV1, type WorkflowNodeOutputV1 } from "./execution.node-runtime";
import { WorkflowAuthorRepairTargetPathSchema } from "./execution.author-repair-target";
import { normalizeVerifiedAuthorSourceEvidence, type VerifiedAuthorSourceEvidenceV1 } from "../../../../../packages/schemas/author-source-representation/index.mjs";

export const WorkflowAuthorRepairRequestSchema = z.object({
	version: z.literal(1),
	sourceNodeRunId: z.string().trim().min(1),
	sourceKind: z.literal("delivery_artifact"),
	idempotencyKey: z.string().trim().min(1),
	deliveryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	diagnostic: z.string().trim().min(1),
	targetPath: WorkflowAuthorRepairTargetPathSchema.optional(),
	editablePaths: z.array(z.string()).min(1).superRefine((value, context) => {
		try { normalizeAuthorRevisionEditablePaths(value); }
		catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "Literal nonoverlapping RFC6901 editablePaths required" }); }
	}).transform(value => [...normalizeAuthorRevisionEditablePaths(value)!]).optional(),
}).strict();
export type WorkflowAuthorRepairRequest = Readonly<z.infer<typeof WorkflowAuthorRepairRequestSchema>>;

export type ResolvedWorkflowAuthorRepairV1 = AuthorRevisionEvidenceV1;
export function normalizeResolvedWorkflowAuthorRepair(value: unknown): AuthorRevisionEvidenceV1 | null {
	const receipt = normalizeAuthorRevisionEvidence(value);
	if (receipt?.authorSource) normalizeVerifiedAuthorSourceEvidence(receipt.authorSource);
	return receipt;
}

export type WorkflowAuthorRepairAttemptV1 = Readonly<{ version: 1; idempotencyKey: string; requestHash: string }>;
export function workflowAuthorRepairAttempt(request: WorkflowAuthorRepairRequest, sourceExecutionId: string, targetNodeId: string): WorkflowAuthorRepairAttemptV1 {
	const admitted = WorkflowAuthorRepairRequestSchema.parse(request);
	return { version: 1, idempotencyKey: admitted.idempotencyKey,
		requestHash: workflowAuthorDeliveryHash(JSON.stringify({ sourceExecutionId, targetNodeId,
			sourceNodeRunId: admitted.sourceNodeRunId, sourceKind: admitted.sourceKind,
			...(admitted.targetPath ? { targetPath: admitted.targetPath } : {}),
			...(admitted.editablePaths ? { editablePaths: admitted.editablePaths } : {}),
			deliveryHash: admitted.deliveryHash, diagnostic: admitted.diagnostic })) };
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function workflowAuthorDeliveryHash(deliveryArtifact: string): string {
	return `sha256:${createHash("sha256").update(deliveryArtifact, "utf8").digest("hex")}`;
}

/** Only the real compiled delivery is read here; it is never an original submission checkpoint. */
export function workflowAuthorDeliveryArtifact(output: WorkflowNodeOutputV1): string {
	const artifacts = Object.values(output.ports).flatMap(value =>
		record(value) && typeof value.text === "string" && value.text ? [value.text] : []);
	if (artifacts.length !== 1) throw new Error("workflow_author_repair_delivery_ambiguous");
	return artifacts[0];
}

/** Bind observer feedback to a successful, immutable author receipt, without changing its status. */
export function resolveWorkflowAuthorRepair(input: Readonly<{
	request: WorkflowAuthorRepairRequest;
	sourceExecutionId: string;
	targetNodeId: string;
	nodeData: Record<string, unknown>;
	authorSource?: VerifiedAuthorSourceEvidenceV1;
	run: Readonly<{ id: string; nodeId: string; status: string; outputRefs: unknown }>;
}>): ResolvedWorkflowAuthorRepairV1 {
	const { run, nodeData, request } = input;
	const output = parseWorkflowNodeOutputV1(run.outputRefs);
	if (run.id !== request.sourceNodeRunId || run.nodeId !== input.targetNodeId || run.status !== "success"
		|| !output || output.nodeId !== input.targetNodeId || output.executorRef !== "agents.logical-task/v2"
		|| output.executionMode !== "once") throw new Error("workflow_author_repair_source_run_invalid");
	if (nodeData.workflowAgentOutputEncoding === "plain_text" || !nodeData.workflowAgentOutputEncoding
		|| nodeData.workflowAgentFailurePolicy !== "repair_with_correction") throw new Error("workflow_author_repair_contract_not_repairable");
	const deliveryArtifact = workflowAuthorDeliveryArtifact(output);
	if (request.editablePaths) {
		try {
			const source = normalizeVerifiedAuthorSourceEvidence(input.authorSource);
			const contract = source?.source.authorContract.value ?? (record(nodeData.workflowAgentJsonObjectContract) ? nodeData.workflowAgentJsonObjectContract : null);
			const delivery: unknown = JSON.parse(source?.source.candidate ?? deliveryArtifact);
			const baseline = contract?.jsonSchema ? projectRuntimeBoundJsonValueForAuthor(delivery, contract.jsonSchema) : delivery;
			if (record(contract?.jsonSchema)) {
				const authorSchema = projectRuntimeBoundJsonOutputContract({ jsonSchema: contract.jsonSchema }).jsonSchema;
				const issues = validateWorkflowToolArguments(authorSchema, baseline);
				if (issues.length) throw new Error(`author_projection_schema_mismatch: ${JSON.stringify({ paths: issues.slice(0, 24).map(issue => issue.path), omittedIssueCount: Math.max(0, issues.length - 24) })}`);
			}
			createAuthorEditScope({ baseline, editablePaths: request.editablePaths });
		} catch (error: unknown) {
			throw new Error(`workflow_author_repair_edit_scope_admission_invalid: ${error instanceof Error ? error.message : "invalid delivery projection"}`);
		}
	}
	return normalizeResolvedWorkflowAuthorRepair({ ...request, sourceExecutionId: input.sourceExecutionId,
		targetNodeId: input.targetNodeId, deliveryArtifact, ...(input.authorSource ? { authorSource: input.authorSource } : {}) })!;
}
