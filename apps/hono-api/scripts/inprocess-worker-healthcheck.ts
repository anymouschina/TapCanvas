import fs from "node:fs";

import {
  assessInprocessWorkerHealth,
  DEFAULT_INPROCESS_WORKER_HEALTH_MAX_AGE_MS,
  DEFAULT_INPROCESS_WORKER_READY_FILE,
} from "../src/modules/internal/inprocess-worker-health";

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, received: ${raw}`);
  }
  return parsed;
}

function runHealthcheck(): void {
  const configuredReadyFile = String(process.env.INPROCESS_WORKER_READY_FILE ?? "").trim();
  const readyFilePath = configuredReadyFile || DEFAULT_INPROCESS_WORKER_READY_FILE;
  const maxAgeMs = readPositiveNumberEnv(
    "INPROCESS_HEALTH_MAX_AGE_MS",
    DEFAULT_INPROCESS_WORKER_HEALTH_MAX_AGE_MS,
  );
  const healthState: unknown = JSON.parse(fs.readFileSync(readyFilePath, "utf8"));
  const assessment = assessInprocessWorkerHealth(healthState, Date.now(), maxAgeMs);
  if (!assessment.healthy) throw new Error(assessment.reason);
}

try {
  runHealthcheck();
} catch (error) {
  console.error(
    `[inprocess-worker-healthcheck] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
