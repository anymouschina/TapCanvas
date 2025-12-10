export type DbClient = {
	db: D1Database;
};

export async function queryAll<T = unknown>(
	db: D1Database,
	sql: string,
	bindings: unknown[] = [],
): Promise<T[]> {
	const stmt = db.prepare(sql).bind(...bindings);
	const { results } = await stmt.all<T>();
	return results ?? [];
}

export async function queryOne<T = unknown>(
	db: D1Database,
	sql: string,
	bindings: unknown[] = [],
): Promise<T | null> {
	const rows = await queryAll<T>(db, sql, bindings);
	return rows.length > 0 ? rows[0] : null;
}

export async function execute(
	db: D1Database,
	sql: string,
	bindings: unknown[] = [],
): Promise<void> {
	await db.prepare(sql).bind(...bindings).run();
}
