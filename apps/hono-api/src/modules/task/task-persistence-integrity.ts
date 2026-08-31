import type { PrismaClient } from "../../types";

type DuplicateIdentityRow = {
	table_name: string;
	identity_key: string;
	duplicate_count: number;
};

type IdentityIndexRow = {
	index_name: string;
	indisunique: boolean;
	indisvalid: boolean;
	indisready: boolean;
	indislive: boolean;
};

const REQUIRED_IDENTITY_INDEXES = [
	"task_results_pkey",
	"task_statuses_task_id_provider_key",
] as const;

export class TaskPersistenceIntegrityError extends Error {
	readonly code = "task_persistence_identity_corrupt";

	constructor(message: string) {
		super(message);
		this.name = "TaskPersistenceIntegrityError";
	}
}

function assertIdentityIndexes(rows: readonly IdentityIndexRow[]): void {
	const indexesByName = new Map(rows.map((row) => [row.index_name, row]));
	for (const indexName of REQUIRED_IDENTITY_INDEXES) {
		const row = indexesByName.get(indexName);
		if (!row) {
			throw new TaskPersistenceIntegrityError(`required task identity index is missing: ${indexName}`);
		}
		if (!row.indisunique || !row.indisvalid || !row.indisready || !row.indislive) {
			throw new TaskPersistenceIntegrityError(
				`required task identity index is unhealthy: ${indexName} ` +
				`unique=${row.indisunique} valid=${row.indisvalid} ready=${row.indisready} live=${row.indislive}`,
			);
		}
	}
}

export async function assertTaskPersistenceIntegrity(database: PrismaClient): Promise<void> {
	await database.$transaction(async (transaction) => {
		// These settings are deliberate: an already-corrupt unique index can hide
		// duplicate heap tuples from the same lookup intended to diagnose it.
		await transaction.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
		await transaction.$executeRawUnsafe("SET LOCAL enable_indexonlyscan = off");
		await transaction.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

		const duplicateIdentities = await transaction.$queryRaw<DuplicateIdentityRow[]>`
			SELECT table_name, identity_key, duplicate_count
			FROM (
				SELECT
					'task_results'::text AS table_name,
					user_id || ':' || task_id AS identity_key,
					COUNT(*)::integer AS duplicate_count
				FROM task_results
				GROUP BY user_id, task_id
				HAVING COUNT(*) > 1

				UNION ALL

				SELECT
					'task_statuses'::text AS table_name,
					task_id || ':' || provider AS identity_key,
					COUNT(*)::integer AS duplicate_count
				FROM task_statuses
				GROUP BY task_id, provider
				HAVING COUNT(*) > 1
			) violations
			LIMIT 1
		`;
		const duplicate = duplicateIdentities[0];
		if (duplicate) {
			throw new TaskPersistenceIntegrityError(
				`${duplicate.table_name} contains ${duplicate.duplicate_count} physical rows for identity ${duplicate.identity_key}`,
			);
		}

		const identityIndexes = await transaction.$queryRaw<IdentityIndexRow[]>`
			SELECT
				index_relation.relname::text AS index_name,
				index_state.indisunique,
				index_state.indisvalid,
				index_state.indisready,
				index_state.indislive
			FROM pg_index index_state
			JOIN pg_class index_relation ON index_relation.oid = index_state.indexrelid
			WHERE index_relation.relname IN (
				'task_results_pkey',
				'task_statuses_task_id_provider_key'
			)
		`;
		assertIdentityIndexes(identityIndexes);
	});
}
