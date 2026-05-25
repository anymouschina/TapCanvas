#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const CHANNEL_DEFINITIONS = Object.freeze([
	{
		name: "yunwu-gemini",
		type: 24,
		vendorKey: "yunwu",
		baseUrl: "https://generativelanguage.googleapis.com",
		modelKinds: ["text", "image", "video"],
		classify(model) {
			const modelKey = String(model.model_key || "").trim();
			if (!modelKey.startsWith("gemini-")) {
				return false;
			}
			return this.modelKinds.includes(String(model.kind || "").trim());
		},
	},
	{
		name: "yunwu-deepseek",
		type: 1,
		vendorKey: "yunwu",
		baseUrl: "https://api.openai.com",
		modelKinds: ["text"],
		classify(model) {
			const modelKey = String(model.model_key || "").trim();
			return modelKey.startsWith("deepseek-") && this.modelKinds.includes(String(model.kind || "").trim());
		},
	},
	{
		name: "yunwu-openai",
		type: 1,
		vendorKey: "yunwu",
		baseUrl: "https://api.openai.com",
		modelKinds: ["text"],
		classify(model) {
			const modelKey = String(model.model_key || "").trim();
			const kind = String(model.kind || "").trim();
			return kind === "text" && !modelKey.startsWith("gemini-") && !modelKey.startsWith("deepseek-");
		},
	},
	{
		name: "yunwu-openai-image",
		type: 1,
		vendorKey: "yunwu",
		baseUrl: "https://api.openai.com",
		modelKinds: ["image"],
		classify(model) {
			const modelKey = String(model.model_key || "").trim();
			return String(model.kind || "").trim() === "image" && !modelKey.startsWith("gemini-");
		},
	},
	{
		name: "yunwu-openai-video",
		type: 1,
		vendorKey: "yunwu",
		baseUrl: "https://api.openai.com",
		modelKinds: ["video"],
		classify(model) {
			const modelKey = String(model.model_key || "").trim();
			return String(model.kind || "").trim() === "video" && !modelKey.startsWith("gemini-");
		},
	},
	{
		name: "ark-doubao-video",
		type: 54,
		vendorKey: "ark",
		baseUrl: "https://ark.cn-beijing.volces.com",
		modelKinds: ["video"],
		classify(model) {
			return String(model.kind || "").trim() === "video";
		},
	},
	{
		name: "ark-doubao-image",
		type: 45,
		vendorKey: "ark",
		baseUrl: "https://ark.cn-beijing.volces.com",
		modelKinds: ["image"],
		classify(model) {
			return String(model.kind || "").trim() === "image";
		},
	},
	{
		name: "ark-doubao-text",
		type: 45,
		vendorKey: "ark",
		baseUrl: "https://ark.cn-beijing.volces.com",
		modelKinds: ["text"],
		classify(model) {
			return String(model.kind || "").trim() === "text";
		},
	},
]);

const CHANNEL_NAMES = Object.freeze(CHANNEL_DEFINITIONS.map((entry) => entry.name));

function assertNonEmptyEnv(name) {
	const value = String(process.env[name] || "").trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	const unresolvedPlaceholders = value.match(/\$\{[^}]+\}/g) || [];
	if (unresolvedPlaceholders.length > 0) {
		throw new Error(`${name} contains unresolved placeholders: ${unresolvedPlaceholders.join(", ")}`);
	}
	return value;
}

function escapeSqlLiteral(value) {
	return value.replace(/'/g, "''");
}

function uniqueSorted(values) {
	return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function getDefinitionByName(channelName) {
	const definition = CHANNEL_DEFINITIONS.find((entry) => entry.name === channelName);
	if (!definition) {
		throw new Error(`Unknown channel definition: ${channelName}`);
	}
	return definition;
}

function classifyChannel(model, definitions) {
	const modelKey = String(model.model_key || "").trim();
	if (!modelKey) {
		throw new Error(`Encountered empty model_key in model catalog: ${JSON.stringify(model)}`);
	}
	const matched = definitions.filter((definition) => definition.classify(model));
	if (matched.length !== 1) {
		throw new Error(
			`Expected exactly one new-api channel rule for ${model.vendor_key}:${modelKey}, got ${matched.map((item) => item.name).join(", ") || "none"}`,
		);
	}
	return matched[0].name;
}

function deriveDesiredChannels(models, vendorStateByKey) {
	const desired = new Map(
		CHANNEL_NAMES.map((channelName) => [
			channelName,
			{
				channelName,
				type: getDefinitionByName(channelName).type,
				baseUrl: getDefinitionByName(channelName).baseUrl,
				status: 0,
				key: "",
				models: [],
			},
		]),
	);
	for (const model of models) {
		const vendorKey = String(model.vendor_key || "").trim();
		const channelDefinitions = CHANNEL_DEFINITIONS.filter((entry) => entry.vendorKey === vendorKey);
		if (channelDefinitions.length === 0) {
			throw new Error(`No new-api channel definitions configured for vendor ${vendorKey}`);
		}
		const channelName = classifyChannel(model, channelDefinitions);
		const target = desired.get(channelName);
		if (!target) {
			throw new Error(`Missing channel rule target for ${channelName}`);
		}
		target.models.push(model.model_key);
	}
	for (const entry of desired.values()) {
		const definition = getDefinitionByName(entry.channelName);
		const vendorState = vendorStateByKey.get(definition.vendorKey);
		if (!vendorState) {
			throw new Error(`Missing vendor state for ${definition.vendorKey}`);
		}
		entry.models = uniqueSorted(entry.models);
		entry.baseUrl = vendorState.baseUrl || definition.baseUrl;
		entry.key = vendorState.apiKey;
		entry.status = vendorState.enabled && vendorState.apiKeyEnabled && entry.models.length > 0 ? 1 : 0;
	}
	return [...desired.values()];
}

async function runPsql(dsn, sql) {
	return await new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const child = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", dsn, "-c", sql], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
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

async function fetchExistingChannels(dsn) {
	const sql = `SELECT name FROM channels WHERE name IN (${CHANNEL_NAMES.map((name) => `'${escapeSqlLiteral(name)}'`).join(", ")}) ORDER BY name;`;
	const { stdout } = await runPsql(dsn, sql);
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

async function syncChannels(dsn, desiredChannels) {
	const valuesClause = desiredChannels
		.map(
			(entry) =>
				`('${escapeSqlLiteral(entry.channelName)}',${entry.type},${entry.status},'${escapeSqlLiteral(entry.baseUrl)}','${escapeSqlLiteral(entry.models.join(","))}','${escapeSqlLiteral(entry.key)}')`,
		)
		.join(",\n      ");
	// NOTE: UPDATE intentionally does NOT overwrite `models` — the new-api patch
	// files own the channel model lists. This sync only manages API credentials
	// (key), availability (status), and base_url so the channel stays live when
	// the vendor key rotates or the vendor is disabled.
	const sql = `
WITH desired(name, type, status, base_url, models, key) AS (
  VALUES
      ${valuesClause}
),
updated AS (
  UPDATE channels AS c
  SET
    type = desired.type,
    status = CASE WHEN c.status = 2 THEN c.status ELSE desired.status END,
    base_url = desired.base_url,
    key = desired.key
  FROM desired
  WHERE c.name = desired.name
  RETURNING c.name, c.type, c.status, c.base_url, c.models
),
inserted AS (
  INSERT INTO channels (name, type, status, base_url, models, key)
  SELECT desired.name, desired.type, desired.status, desired.base_url, desired.models, desired.key
  FROM desired
  WHERE NOT EXISTS (
    SELECT 1 FROM channels existing WHERE existing.name = desired.name
  )
  RETURNING name, type, status, base_url, models
)
SELECT name || '|' || type || '|' || status || '|' || base_url || '|' || models
FROM (
  SELECT * FROM updated
  UNION ALL
  SELECT * FROM inserted
) rows
ORDER BY name;
`;
	const { stdout } = await runPsql(dsn, sql);
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.includes("|"))
		.map((line) => {
			const [name, type, status, baseUrl, models] = line.split("|");
			return { name, type, status, baseUrl, models };
		});
}

async function loadVendorState(vendorKey) {
	const [vendor, apiKey] = await Promise.all([
		prisma.model_catalog_vendors.findUnique({
			where: { key: vendorKey },
			select: {
				enabled: true,
				base_url_hint: true,
			},
		}),
		prisma.model_catalog_vendor_api_keys.findUnique({
			where: {
				vendor_key: vendorKey,
			},
			select: {
				api_key: true,
				enabled: true,
			},
		}),
	]);
	if (!vendor) {
		throw new Error(`Vendor ${vendorKey} not found in model_catalog_vendors`);
	}
	const normalizedApiKey = String(apiKey?.api_key || "").trim();
	return {
		vendorKey,
		enabled: Number(vendor.enabled) === 1,
		apiKeyEnabled: Number(apiKey?.enabled || 0) === 1,
		apiKey: normalizedApiKey,
		baseUrl: String(vendor.base_url_hint || "").trim(),
	};
}

async function main() {
	const newApiSqlDsn = assertNonEmptyEnv("NEW_API_SQL_DSN");
	const sourceModels = await prisma.model_catalog_models.findMany({
		where: {
			vendor_key: {
				in: ["yunwu", "ark"],
			},
			enabled: 1,
		},
		orderBy: [{ vendor_key: "asc" }, { kind: "asc" }, { model_key: "asc" }],
		select: {
			vendor_key: true,
			model_key: true,
			kind: true,
		},
	});
	if (sourceModels.length === 0) {
		throw new Error("No enabled yunwu/ark models found in model_catalog_models");
	}
	const vendorStateByKey = new Map();
	for (const vendorKey of [...new Set(CHANNEL_DEFINITIONS.map((item) => item.vendorKey))]) {
		vendorStateByKey.set(vendorKey, await loadVendorState(vendorKey));
	}
	const desiredChannels = deriveDesiredChannels(sourceModels, vendorStateByKey);
	const existingChannels = await fetchExistingChannels(newApiSqlDsn);
	console.log(
		`[sync:new-api] existing channels: ${existingChannels.join(", ") || "(none yet, will create as needed)"}`,
	);
	console.log("[sync:new-api] source catalog (enabled):");
	for (const entry of desiredChannels) {
		const definition = getDefinitionByName(entry.channelName);
		console.log(
			`[sync:new-api] ${entry.channelName} [vendor=${definition.vendorKey} type=${entry.type} status=${entry.status}] <= ${entry.models.length} models: ${entry.models.join(", ") || "(empty)"}`,
		);
	}
	const updated = await syncChannels(newApiSqlDsn, desiredChannels);
	if (updated.length !== CHANNEL_NAMES.length) {
		throw new Error(
			`Expected to update ${CHANNEL_NAMES.length} channels, but updated ${updated.length}: ${updated.map((item) => item.name).join(", ")}`,
		);
	}
	for (const row of updated) {
		console.log(
			`[sync:new-api] upserted ${row.name}: type=${row.type} status=${row.status} base_url=${row.baseUrl} models=${row.models}`,
		);
	}
}

main()
	.catch((error) => {
		console.error("[sync:new-api] failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
