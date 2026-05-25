#!/usr/bin/env node
// sync-new-api-catalog.mjs
//
// Reverse sync: populate hono-api's `model_catalog_models` with any
// (vendor_key, model_key) rows that already exist as enabled abilities in
// new-api but haven't been registered in the catalog yet. Fixes the
// "forgot to add catalog row when introducing a new channel" drift.
//
// Design principles:
//   - Read-only for new-api (reads channels + abilities + models via psql).
//   - Additive for hono-api catalog. NEVER updates `meta` / `label_zh` /
//     `enabled` of an existing row — those are hand-curated UI metadata.
//   - Skips vendors not already in `model_catalog_vendors` (creating a
//     vendor row implies display-name + base-url curation decisions).
//   - Skips catalog rows that would require a kind we don't recognize.
//
// kind mapping (new-api → hono-api):
//   chat  → text
//   image → image
//   video → video
//   audio → (skipped; catalog has no audio kind today)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function assertNonEmptyEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	const unresolvedPlaceholders = value.match(/\$\{[^}]+\}/g) || [];
	if (unresolvedPlaceholders.length > 0) {
		throw new Error(
			`${name} contains unresolved placeholders: ${unresolvedPlaceholders.join(", ")}`,
		);
	}
	return value;
}

async function runPsql(dsn, sql) {
	return await new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const child = spawn(
			"psql",
			["-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "\t", dsn, "-c", sql],
			{
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			reject(
				new Error(
					`psql exited with code ${code ?? "unknown"}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
				),
			);
		});
	});
}

const NEW_API_KIND_TO_CATALOG_KIND = Object.freeze({
	chat: "text",
	text: "text",
	image: "image",
	video: "video",
});

// Channel tags in new-api may be finer-grained than catalog vendor keys
// (e.g. tag="yunwu-gemini" rolls up to vendor="yunwu"). Try the raw tag
// first; if no matching vendor row exists, fall back to the first "-"
// segment. Scripts must never create vendor rows implicitly.
function normalizeVendorKey(rawTag, knownVendorKeys) {
	const tag = String(rawTag || "").trim();
	if (!tag) return "";
	if (knownVendorKeys.has(tag)) return tag;
	const head = tag.split("-")[0] || "";
	if (head && knownVendorKeys.has(head)) return head;
	return "";
}

async function fetchNewApiAbilities(dsn) {
	// Inner join on channels ensures we only consider abilities whose channel is
	// still active; left join on models lets us fall back to empty kind when the
	// models row is missing (legacy data).
	const sql = `
SELECT DISTINCT
  c.tag                                  AS vendor_key,
  a.model                                AS model_key,
  COALESCE(m.kind, '')                   AS kind
FROM abilities AS a
JOIN channels AS c
  ON c.id = a.channel_id
  AND c.status = 1
  AND COALESCE(c.tag, '') <> ''
LEFT JOIN models AS m
  ON m.model_name = a.model
  AND m.deleted_at IS NULL
WHERE a.enabled = true
  AND a."group" = 'default'
ORDER BY c.tag, a.model;
`;
	const { stdout } = await runPsql(dsn, sql);
	return stdout
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter(Boolean)
		.map((line) => {
			const [vendorKey, modelKey, kind] = line.split("\t");
			return {
				vendorKey: (vendorKey || "").trim(),
				modelKey: (modelKey || "").trim(),
				kind: (kind || "").trim().toLowerCase(),
			};
		})
		.filter((row) => row.vendorKey && row.modelKey);
}

async function fetchCatalogState() {
	const [vendors, models] = await Promise.all([
		prisma.model_catalog_vendors.findMany({
			select: { key: true, enabled: true },
		}),
		prisma.model_catalog_models.findMany({
			select: { vendor_key: true, model_key: true, meta: true, label_zh: true, kind: true },
		}),
	]);
	const vendorKeys = new Set(vendors.map((v) => String(v.key || "").trim()).filter(Boolean));
	const existing = new Set();
	const byVendorModel = new Map();
	const emptyMetaByKey = [];
	for (const row of models) {
		const v = String(row.vendor_key).trim();
		const m = String(row.model_key).trim();
		existing.add(`${v}::${m}`);
		byVendorModel.set(`${v}::${m}`, row);
		const hasMeta = typeof row.meta === "string" && row.meta.trim() !== "";
		if (!hasMeta) emptyMetaByKey.push({ vendor_key: v, model_key: m });
	}
	return { vendorKeys, existing, byVendorModel, emptyMetaByKey };
}

// Returns the base meta/label to inherit when inserting or backfilling an
// alias row. An "alias" is a model_key ending in `-<vendorKey>` whose base
// strip is registered under the SAME vendor. If that base has non-empty
// meta, we copy it; otherwise return null and the caller leaves the field
// empty.
function resolveAliasInheritance(vendorKey, modelKey, byVendorModel) {
	const suffix = `-${vendorKey}`;
	if (!modelKey.endsWith(suffix)) return null;
	const baseKey = modelKey.slice(0, -suffix.length);
	if (!baseKey || baseKey === modelKey) return null;
	const base = byVendorModel.get(`${vendorKey}::${baseKey}`);
	if (!base) return null;
	const baseMeta = typeof base.meta === "string" ? base.meta.trim() : "";
	if (!baseMeta) return null;
	return {
		baseModelKey: baseKey,
		meta: base.meta,
		label_zh: base.label_zh,
	};
}

function nowIso() {
	return new Date().toISOString();
}

async function insertMissingRows(missing) {
	if (missing.length === 0) return 0;
	const createdAt = nowIso();
	// Prisma has no bulk upsert, but these rows are unique per (vendor_key,
	// model_key) and we already filtered by `existing` on the read side.
	const results = await prisma.$transaction(
		missing.map((row) =>
			prisma.model_catalog_models.upsert({
				where: {
					vendor_key_model_key: {
						vendor_key: row.vendorKey,
						model_key: row.modelKey,
					},
				},
				create: {
					vendor_key: row.vendorKey,
					model_key: row.modelKey,
					model_alias: row.modelKey,
					label_zh: row.label_zh || `${row.modelKey} (${row.vendorKey})`,
					kind: row.catalogKind,
					enabled: 1,
					meta: row.meta ?? null,
					created_at: createdAt,
					updated_at: createdAt,
				},
				// UPDATE is a no-op touch: new-api-sync must not clobber hand-curated
				// fields. We only bump updated_at so the row shows "still referenced".
				update: { updated_at: createdAt },
			}),
		),
	);
	return results.length;
}

// Backfill empty meta on existing alias rows whose base (same vendor, name
// stripped of `-<vendor>` suffix) now has meta. Does NOT touch rows whose
// meta is already set; never clears meta.
async function backfillEmptyAliasMeta(emptyMetaRows, byVendorModel) {
	const updates = [];
	for (const row of emptyMetaRows) {
		const inherit = resolveAliasInheritance(row.vendor_key, row.model_key, byVendorModel);
		if (!inherit) continue;
		updates.push({
			vendor_key: row.vendor_key,
			model_key: row.model_key,
			meta: inherit.meta,
			label_zh: inherit.label_zh,
			baseModelKey: inherit.baseModelKey,
		});
	}
	if (updates.length === 0) return updates;
	const updatedAt = nowIso();
	await prisma.$transaction(
		updates.map((row) =>
			prisma.model_catalog_models.update({
				where: {
					vendor_key_model_key: {
						vendor_key: row.vendor_key,
						model_key: row.model_key,
					},
				},
				data: {
					meta: row.meta,
					// Keep label_zh untouched if someone hand-curated it — only
					// overwrite when it looks like our auto-generated placeholder.
					...(row.label_zh ? { label_zh: row.label_zh } : {}),
					updated_at: updatedAt,
				},
			}),
		),
	);
	return updates;
}

async function main() {
	const newApiSqlDsn = assertNonEmptyEnv("NEW_API_SQL_DSN");
	const [rawAbilities, catalog] = await Promise.all([
		fetchNewApiAbilities(newApiSqlDsn),
		fetchCatalogState(),
	]);

	// Normalize channel tags → vendor keys (e.g. yunwu-gemini → yunwu). Rows
	// whose tag can't be resolved to any known vendor are reported but not
	// auto-created — catalog vendor rows carry display metadata a sync script
	// has no business fabricating.
	const normalized = rawAbilities
		.map((row) => ({
			rawTag: row.vendorKey,
			vendorKey: normalizeVendorKey(row.vendorKey, catalog.vendorKeys),
			modelKey: row.modelKey,
			kind: row.kind,
		}))
		.filter((row) => row.modelKey);

	// Deduplicate at the (vendor_key, model_key) granularity. Same model may
	// appear under multiple tags (e.g. yunwu-gemini + yunwu-openai-image both
	// normalize to yunwu); prefer the entry with a non-empty kind.
	const byKey = new Map();
	const unresolvedTagCounts = new Map();
	for (const row of normalized) {
		if (!row.vendorKey) {
			unresolvedTagCounts.set(row.rawTag, (unresolvedTagCounts.get(row.rawTag) || 0) + 1);
			continue;
		}
		const key = `${row.vendorKey}::${row.modelKey}`;
		const prev = byKey.get(key);
		if (!prev) {
			byKey.set(key, row);
			continue;
		}
		if (!prev.kind && row.kind) byKey.set(key, row);
	}

	const missing = [];
	const skippedKind = [];
	const presentKey = new Set(
		Array.from(byKey.keys()).filter((key) => catalog.existing.has(key)),
	);

	for (const row of byKey.values()) {
		const compoundKey = `${row.vendorKey}::${row.modelKey}`;
		if (catalog.existing.has(compoundKey)) continue;
		const catalogKind = NEW_API_KIND_TO_CATALOG_KIND[row.kind];
		if (!catalogKind) {
			skippedKind.push(row);
			continue;
		}
		// If this is a `-<vendor>` alias and the base model already has meta,
		// inherit meta + label_zh. Prevents freshly-synced aliases from landing
		// with empty UI parameter panels.
		const inherited = resolveAliasInheritance(
			row.vendorKey,
			row.modelKey,
			catalog.byVendorModel,
		);
		missing.push({
			...row,
			catalogKind,
			meta: inherited?.meta ?? null,
			label_zh: inherited?.label_zh ?? null,
			inheritedFrom: inherited?.baseModelKey ?? null,
		});
	}

	console.log(
		`[sync:new-api:catalog] new-api abilities scanned: ${byKey.size} (present=${presentKey.size}, missing_candidates=${missing.length + skippedKind.length})`,
	);

	if (unresolvedTagCounts.size > 0) {
		const summary = [...unresolvedTagCounts.entries()]
			.map(([tag, count]) => `${tag} (${count})`)
			.sort();
		console.warn(
			`[sync:new-api:catalog] skipping rows with tag not mapped to any model_catalog_vendors key: ${summary.join(", ")}`,
		);
		console.warn(
			`[sync:new-api:catalog] (add the vendor row first if you want these rows auto-seeded next run)`,
		);
	}
	if (skippedKind.length > 0) {
		const groups = new Map();
		for (const r of skippedKind) {
			if (!groups.has(r.kind)) groups.set(r.kind, []);
			groups.get(r.kind).push(`${r.vendorKey}:${r.modelKey}`);
		}
		for (const [kind, refs] of groups) {
			console.warn(
				`[sync:new-api:catalog] skipping ${refs.length} rows with unsupported kind=${kind || "(empty)"}: ${refs.slice(0, 5).join(", ")}${refs.length > 5 ? ` …(+${refs.length - 5})` : ""}`,
			);
		}
	}

	if (missing.length > 0) {
		console.log(`[sync:new-api:catalog] inserting ${missing.length} new rows:`);
		for (const row of missing) {
			const tag = row.inheritedFrom ? ` (meta ⟵ ${row.inheritedFrom})` : "";
			console.log(
				`[sync:new-api:catalog]   + ${row.vendorKey} :: ${row.modelKey} (kind=${row.catalogKind})${tag}`,
			);
		}
		const inserted = await insertMissingRows(missing);
		console.log(`[sync:new-api:catalog] upserted ${inserted} rows`);
	}

	// Backfill phase: for rows already present but with empty meta, copy from
	// the sibling base (same vendor, without the `-<vendor>` suffix) if the
	// base now has meta. This is idempotent and only widens — never clears.
	const backfilled = await backfillEmptyAliasMeta(
		catalog.emptyMetaByKey,
		catalog.byVendorModel,
	);
	if (backfilled.length > 0) {
		console.log(`[sync:new-api:catalog] backfilled meta on ${backfilled.length} alias rows:`);
		for (const row of backfilled) {
			console.log(
				`[sync:new-api:catalog]   ~ ${row.vendor_key} :: ${row.model_key} (meta ⟵ ${row.baseModelKey})`,
			);
		}
	} else if (missing.length === 0) {
		console.log(`[sync:new-api:catalog] catalog is in sync, nothing to insert or backfill`);
	}
}

main()
	.catch((error) => {
		console.error("[sync:new-api:catalog] failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
