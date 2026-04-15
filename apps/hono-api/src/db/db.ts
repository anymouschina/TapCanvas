import type { PrismaClient } from "../types";

export type DbClient = {
	db: PrismaClient;
};

type TableInfoRow = {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
	pk: number;
};

function replaceSqliteJsonExtract(sql: string): string {
	return sql.replace(
		/json_extract\(\s*([a-zA-Z0-9_.]+)\s*,\s*'\$\.([a-zA-Z0-9_]+)'\s*\)/g,
		"($1::jsonb ->> '$2')",
	);
}

function replaceSqliteDatetime(sql: string): string {
	const withNow = sql
		.replace(
			/datetime\(\s*'now'\s*,\s*'(-?\d+)\s+day'\s*\)/g,
			"(NOW() + INTERVAL '1 day' * ($1))",
		)
		.replace(
			/datetime\(\s*'now'\s*,\s*'(-?\d+)\s+minutes?'\s*\)/g,
			"(NOW() + INTERVAL '1 minute' * ($1))",
		)
		.replace(
			/datetime\(\s*'now'\s*,\s*'(-?\d+)\s+hour'\s*\)/g,
			"(NOW() + INTERVAL '1 hour' * ($1))",
		);
	return withNow.replace(/datetime\(\s*([a-zA-Z0-9_.]+)\s*\)/g, "($1::timestamptz)");
}

function replaceSqliteInsertOrIgnore(sql: string): string {
	if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(sql)) return sql;
	const replaced = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i, "INSERT INTO ");
	if (/\bON\s+CONFLICT\b/i.test(replaced)) return replaced;
	return `${replaced} ON CONFLICT DO NOTHING`;
}

function replaceSqliteIfNull(sql: string): string {
	return sql.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
}

function replaceTextTimestampComparisons(sql: string): string {
	return sql.replace(
		/\b([a-zA-Z_][a-zA-Z0-9_.]*)\b\s*(>=|>|<=|<)\s*\(\s*NOW\(\)\s*\+\s*INTERVAL/g,
		"($1::timestamptz) $2 (NOW() + INTERVAL",
	);
}

function replacePlaceholders(sql: string): string {
	let index = 0;
	let out = "";
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < sql.length; i += 1) {
		const ch = sql[i];
		if (ch === "'" && !inDouble) {
			const next = sql[i + 1];
			if (inSingle && next === "'") {
				out += "''";
				i += 1;
				continue;
			}
			inSingle = !inSingle;
			out += ch;
			continue;
		}
		if (ch === `"` && !inSingle) {
			inDouble = !inDouble;
			out += ch;
			continue;
		}
		if (ch === "?" && !inSingle && !inDouble) {
			index += 1;
			out += `$${index}`;
			continue;
		}
		out += ch;
	}
	return out;
}

function toPgSql(rawSql: string): string {
	let sql = String(rawSql || "").trim();
	sql = replaceSqliteJsonExtract(sql);
	sql = replaceSqliteDatetime(sql);
	sql = replaceSqliteInsertOrIgnore(sql);
	sql = replaceSqliteIfNull(sql);
	sql = replaceTextTimestampComparisons(sql);
	sql = replacePlaceholders(sql);
	return sql;
}

function normalizeBigIntValue(value: unknown): unknown {
	if (typeof value === "bigint") return Number(value);
	if (Array.isArray(value)) return value.map((item) => normalizeBigIntValue(item));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			out[key] = normalizeBigIntValue(v);
		}
		return out;
	}
	return value;
}

function isTableExistsSql(sql: string): boolean {
	return /select\s+name\s+from\s+sqlite_master\s+where\s+type='table'\s+and\s+name=/i.test(sql);
}

function isPragmaTableInfoSql(sql: string): boolean {
	return /^PRAGMA\s+table_info\(/i.test(sql.trim());
}

function parsePragmaTableName(sql: string): string {
	const m = sql.trim().match(/^PRAGMA\s+table_info\(([^)]+)\)/i);
	if (!m) throw new Error(`Invalid PRAGMA table_info SQL: ${sql}`);
	return m[1].trim().replace(/^['"]|['"]$/g, "");
}

export async function queryAll<T = unknown>(
	db: PrismaClient,
	sql: string,
	bindings: unknown[] = [],
): Promise<T[]> {
	if (isTableExistsSql(sql)) {
		const table = String(bindings[0] ?? "");
		const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
			`SELECT table_name AS name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1`,
			table,
		);
		return (rows as T[]) ?? [];
	}
	if (isPragmaTableInfoSql(sql)) {
		const table = parsePragmaTableName(sql);
		const rows = await db.$queryRawUnsafe<TableInfoRow[]>(
			`SELECT
         ordinal_position - 1 AS cid,
         column_name AS name,
         data_type AS type,
         CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
         column_default AS dflt_value,
         CASE WHEN ordinal_position = 1 THEN 1 ELSE 0 END AS pk
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position ASC`,
			table,
		);
		return (rows as T[]) ?? [];
	}
	const rows = await db.$queryRawUnsafe<unknown[]>(toPgSql(sql), ...bindings);
	if (!Array.isArray(rows)) return [];
	return rows.map((row) => normalizeBigIntValue(row) as T);
}

export async function queryOne<T = unknown>(
	db: PrismaClient,
	sql: string,
	bindings: unknown[] = [],
): Promise<T | null> {
	const rows = await queryAll<T>(db, sql, bindings);
	return rows.length > 0 ? rows[0] : null;
}

export async function execute(
	db: PrismaClient,
	sql: string,
	bindings: unknown[] = [],
): Promise<void> {
	await db.$executeRawUnsafe(toPgSql(sql), ...bindings);
}

export async function executeWithChanges(
	db: PrismaClient,
	sql: string,
	bindings: unknown[] = [],
): Promise<number> {
	const changes = await db.$executeRawUnsafe(toPgSql(sql), ...bindings);
	return Number(changes || 0);
}
