import { Prisma } from "@prisma/client";
import {
	WORKFLOW_OUTPUT_STORAGE_VERSION,
	workflowOutputDelta,
	type StoredWorkflowOutput,
} from "./execution.output-storage";

/** Call inside the node/attempt transaction. Lock and merge share its lifetime. */
export async function persistWorkflowOutput(
	transaction: Pick<Prisma.TransactionClient, "$queryRaw">,
	nodeRunId: string,
	output: StoredWorkflowOutput,
): Promise<Readonly<{ outputBytes: number; transferredBytes: number; newBlocks: number; reusedBlocks: number }>> {
	const rows = await transaction.$queryRaw<{ block_ids: string[]; storage_version: string | null }[]>(Prisma.sql`
		SELECT output_refs::jsonb->>'storageVersion' AS storage_version,
			ARRAY(SELECT jsonb_object_keys(CASE
				WHEN output_refs::jsonb->>'storageVersion' = ${WORKFLOW_OUTPUT_STORAGE_VERSION}
				THEN output_refs::jsonb->'blocks' ELSE '{}'::jsonb END)) AS block_ids
		FROM workflow_node_runs WHERE id = ${nodeRunId} FOR UPDATE
	`);
	if (rows.length !== 1) throw new Error("Workflow output target row is missing");
	const previous = rows[0]!;
	if (previous.storage_version !== null && previous.storage_version !== WORKFLOW_OUTPUT_STORAGE_VERSION) {
		throw new Error("Unsupported persisted workflow output storage version");
	}
	const delta = workflowOutputDelta(output, previous.block_ids);
	const root = JSON.stringify(delta.root);
	const ids = JSON.stringify(delta.blockIds);
	const blocks = JSON.stringify(delta.blocks);
	// Retain only blocks reachable from the new complete manifest. Previous
	// physical attempts remain immutable in their own ledger rows. PostgreSQL
	// still writes the resulting row; only connection payload is incremental.
	const updated = await transaction.$queryRaw<{ output_bytes: number }[]>(Prisma.sql`
		UPDATE workflow_node_runs SET output_refs = jsonb_build_object(
			'storageVersion', ${WORKFLOW_OUTPUT_STORAGE_VERSION}::text,
			'root', ${root}::jsonb,
			'blocks', COALESCE((SELECT jsonb_object_agg(key, value)
				FROM jsonb_each(CASE
					WHEN output_refs::jsonb->>'storageVersion' = ${WORKFLOW_OUTPUT_STORAGE_VERSION}
					THEN output_refs::jsonb->'blocks' ELSE '{}'::jsonb END)
				WHERE key IN (SELECT jsonb_array_elements_text(${ids}::jsonb))), '{}'::jsonb) || ${blocks}::jsonb
		)::text WHERE id = ${nodeRunId}
		RETURNING octet_length(output_refs) AS output_bytes
	`);
	if (updated.length !== 1) throw new Error("Workflow output target row changed");
	const newBlocks = Object.keys(delta.blocks).length;
	return {
		outputBytes: updated[0]!.output_bytes,
		transferredBytes: Buffer.byteLength(root) + Buffer.byteLength(ids) + Buffer.byteLength(blocks),
		newBlocks,
		reusedBlocks: delta.blockIds.length - newBlocks,
	};
}
