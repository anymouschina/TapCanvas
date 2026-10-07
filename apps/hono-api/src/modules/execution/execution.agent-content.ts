import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../../platform/node/prisma";
import { AppError } from "../../middleware/error";
import { WORKFLOW_OUTPUT_STORAGE_VERSION } from "./execution.output-storage";
import type { AgentNodeRead } from "./execution.agent-history";

type ContentPage = {
	revision: string | null;
	kind: string;
	size: number | null;
	value: string | number | boolean | null;
	keys: string[];
	error: string | null;
};
type ContentQueryArgs = Pick<AgentNodeRead, "path" | "offset" | "limit" | "textLimit"> & {
	format?: AgentNodeRead["format"];
};
const fields = {
	output: Prisma.sql`n.output_refs`, input: Prisma.sql`n.input_refs`, toolCalls: Prisma.sql`n.tool_calls`,
	semantics: Prisma.sql`n.semantics_snapshot`, providerReceipts: Prisma.sql`n.provider_receipts`,
	tokenUsage: Prisma.sql`n.token_usage`, creditUsage: Prisma.sql`n.credit_usage`,
};

/** Project on the database side. Only one shallow page crosses the connection.
 * The document CTE parses the stored JSON once; traversal never expands shared
 * blocks, builds the semantic tree, or materializes siblings in the JS process.
 */
export function buildAgentContentQuery(source: Prisma.Sql, args: ContentQueryArgs): Prisma.Sql {
	const format = args.format ?? "shallow";
	return Prisma.sql`
	WITH RECURSIVE document AS MATERIALIZED (
		SELECT raw::jsonb AS body, md5(raw) AS revision,
			COALESCE((jsonb_typeof((raw::jsonb)->'storageVersion') = 'string'
				AND (raw::jsonb)->>'storageVersion' LIKE 'workflow.output-storage/%'), false) AS storage_envelope
		FROM (${source}) scoped
	), settings AS (
		SELECT ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(args.path)}::jsonb)) AS path
	), walk(value, depth, hops, encoded, error) AS (
		SELECT CASE WHEN storage_envelope THEN body->'root' ELSE body END, 0, 0,
			storage_envelope,
			CASE WHEN storage_envelope AND (body->>'storageVersion' IS DISTINCT FROM ${WORKFLOW_OUTPUT_STORAGE_VERSION}
				OR NOT (body ? 'root') OR jsonb_typeof(body->'blocks') IS DISTINCT FROM 'object') THEN 'unsupported_storage_envelope' END
		FROM document
		UNION ALL
		SELECT CASE
			WHEN w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'ref' THEN d.body->'blocks'->(w.value->>1)
			WHEN w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'object' THEN (
				SELECT entry->1 FROM jsonb_array_elements(w.value->1) entry WHERE entry->>0 = s.path[w.depth+1] LIMIT 1)
			WHEN w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'array' THEN CASE
				WHEN s.path[w.depth+1] ~ '^(0|[1-9][0-9]{0,8})$' THEN w.value->1->(s.path[w.depth+1]::int) END
			WHEN NOT w.encoded AND jsonb_typeof(w.value) = 'object' THEN w.value->s.path[w.depth+1]
			WHEN NOT w.encoded AND jsonb_typeof(w.value) = 'array' THEN CASE
				WHEN s.path[w.depth+1] ~ '^(0|[1-9][0-9]{0,8})$' THEN w.value->(s.path[w.depth+1]::int) END
		END,
		w.depth + CASE WHEN w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'ref' THEN 0 ELSE 1 END,
		w.hops + 1, w.encoded,
		CASE WHEN w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'ref' AND NOT (d.body->'blocks' ? (w.value->>1)) THEN 'missing_storage_block' END
		FROM walk w CROSS JOIN document d CROSS JOIN settings s
		WHERE w.error IS NULL AND w.value IS NOT NULL AND w.hops < 2 * cardinality(s.path) + 2
			AND (w.depth < cardinality(s.path) OR (w.encoded AND jsonb_typeof(w.value) = 'array' AND w.value->>0 = 'ref'))
	), selected AS MATERIALIZED (
		SELECT * FROM walk ORDER BY hops DESC LIMIT 1
	), typed AS MATERIALIZED (
		SELECT value, encoded,
			CASE WHEN encoded AND jsonb_typeof(value) = 'array' THEN value->>0 ELSE jsonb_typeof(value) END AS kind,
			CASE WHEN encoded AND jsonb_typeof(value) = 'array' THEN value->1 ELSE value END AS payload,
			CASE WHEN error IS NOT NULL THEN error
				WHEN value IS NULL THEN 'path_not_found'
				WHEN ${format === "json"} AND encoded THEN 'encoded_input_json_unsupported'
				WHEN encoded AND jsonb_typeof(value) = 'array' AND (value->>0 NOT IN ('object','array','escaped-string') OR jsonb_array_length(value) <> 2) THEN 'invalid_storage_value'
				WHEN encoded AND jsonb_typeof(value) = 'object' THEN 'invalid_storage_value'
				WHEN depth <> cardinality(s.path) THEN 'path_not_found' END AS error
		FROM selected CROSS JOIN settings s
	), page AS (
		SELECT t.*,
			CASE WHEN ${format === "json"} THEN length(payload::text)
				WHEN kind IN ('string','escaped-string') THEN length(payload#>>'{}')
			WHEN kind = 'array' THEN jsonb_array_length(payload)
			WHEN kind = 'object' AND encoded THEN jsonb_array_length(payload)
			WHEN kind = 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(payload)) END AS size,
			CASE WHEN ${format === "json"} AND error IS NULL THEN payload::text END AS json_text
		FROM typed t
	)
	SELECT (SELECT revision FROM document) AS revision, kind, size, error,
		CASE WHEN error IS NOT NULL THEN NULL
			WHEN ${format === "json"} THEN to_jsonb(substring(json_text FROM ${args.offset + 1}::int FOR ${args.textLimit}::int))
			WHEN kind IN ('string','escaped-string') THEN to_jsonb(substring(payload#>>'{}' FROM ${args.offset + 1}::int FOR ${args.textLimit}::int))
			WHEN kind IN ('number','boolean','null') THEN payload END AS value,
		CASE WHEN error IS NOT NULL OR ${format === "json"} THEN '[]'::jsonb ELSE COALESCE((
			SELECT jsonb_agg(key ORDER BY ordinal) FROM (
				SELECT CASE WHEN kind = 'array' THEN (ordinal - 1)::text ELSE item->>0 END AS key, ordinal
				FROM jsonb_array_elements(CASE WHEN kind = 'array' OR (kind = 'object' AND encoded) THEN payload ELSE '[]'::jsonb END)
					WITH ORDINALITY AS e(item, ordinal)
				WHERE ordinal > ${args.offset} AND ordinal <= ${args.offset + args.limit}
				UNION ALL
				SELECT key, ordinal FROM (
					SELECT key, row_number() OVER (ORDER BY key COLLATE "C") AS ordinal
					FROM jsonb_object_keys(CASE WHEN kind = 'object' AND NOT encoded THEN payload ELSE '{}'::jsonb END) AS key
				) ordinary WHERE ordinal > ${args.offset} AND ordinal <= ${args.offset + args.limit}
			) entries
		), '[]'::jsonb) END AS keys
	FROM page`;
}

export async function readAgentNodeContent(ownerId: string, args: AgentNodeRead) {
	const table = args.attemptId ? Prisma.sql`workflow_node_attempts` : Prisma.sql`workflow_node_runs`;
	const source = Prisma.sql`SELECT ${fields[args.field]} AS raw FROM ${table} n
		JOIN workflow_executions e ON e.id = n.execution_id
		WHERE e.owner_id = ${ownerId} AND n.execution_id = ${args.executionId} AND n.node_id = ${args.nodeId}
		${args.attemptId ? Prisma.sql`AND n.id = ${args.attemptId}` : Prisma.empty}`;
	const rows = await getPrismaClient().$queryRaw<ContentPage[]>(buildAgentContentQuery(source, args));
	const page = rows[0];
	if (!page) throw new AppError("Node or attempt not found in this execution", { status: 404, code: "workflow_node_content_not_found" });
	if (args.revision && page.revision !== args.revision) throw new AppError("Workflow content changed during inspection; restart this read from offset 0", { status: 409, code: "workflow_content_revision_changed" });
	if (page.error) throw new AppError(`Cannot inspect workflow content: ${page.error}`, { status: page.error === "path_not_found" ? 404 : 422, code: page.error, details: { nodeId: args.nodeId, field: args.field, path: args.path } });
	const isJsonText = args.format === "json";
	const isText = page.kind === "string" || page.kind === "escaped-string";
	const consumed = isJsonText || isText ? Array.from(String(page.value)).length : page.keys.length;
	return {
		executionId: args.executionId, nodeId: args.nodeId, attemptId: args.attemptId ?? null,
		field: args.field, path: args.path, revision: page.revision, kind: page.kind, size: page.size,
		...(isJsonText ? { text: page.value, encoding: "json", offsetUnit: "unicode_code_points", totalLength: page.size }
			: isText ? { text: page.value, encoding: page.kind === "escaped-string" ? "json-string" : "text", offsetUnit: "unicode_code_points" }
			: page.kind === "object" || page.kind === "array" ? { entries: page.keys.map((key) => ({ key, path: [...args.path, key] })) }
			: { value: page.value }),
		offset: args.offset, nextOffset: page.size !== null && args.offset + consumed < page.size ? args.offset + consumed : null,
	};
}
