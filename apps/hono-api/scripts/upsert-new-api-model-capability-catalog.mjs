#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "node:url";

const MODEL_CAPABILITY_CATALOG_OPTION_KEY = "ModelCapabilityCatalog";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCatalogPath() {
  const explicit = String(process.env.MODEL_CAPABILITY_CATALOG_PATH || "").trim();
  const candidates = [
    explicit,
    path.resolve(process.cwd(), "..", "new-api", "data", "model-capability-catalog.json"),
    path.resolve(__dirname, "..", "..", "new-api", "data", "model-capability-catalog.json"),
    path.resolve("/workspace/apps/new-api/data/model-capability-catalog.json"),
    path.resolve(
      "/Users/libiqiang/workspace/TapCanvas-pro/apps/new-api/data/model-capability-catalog.json",
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `model capability catalog not found; checked: ${candidates.join(", ")}`,
  );
}

function readNewApiSqlDsn() {
  const value = String(process.env.NEW_API_SQL_DSN || "").trim();
  if (!value) {
    throw new Error("NEW_API_SQL_DSN is required");
  }
  return value;
}

function readCatalog() {
  const filePath = resolveCatalogPath();
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model capability catalog must be a JSON object");
  }
  if (!parsed.models || typeof parsed.models !== "object" || Array.isArray(parsed.models)) {
    throw new Error("model capability catalog must include an object 'models'");
  }
  return JSON.stringify(parsed);
}

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: readNewApiSqlDsn(),
      },
    },
  });

  try {
    const value = readCatalog();
    await prisma.$executeRawUnsafe(
      `
INSERT INTO options(key, value)
VALUES ($1, $2)
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value
`,
      MODEL_CAPABILITY_CATALOG_OPTION_KEY,
      value,
    );
    console.log(
      `[model-capability-catalog] upserted option ${MODEL_CAPABILITY_CATALOG_OPTION_KEY}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[model-capability-catalog] failed:", error);
  process.exit(1);
});
