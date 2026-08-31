import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workingDirectory = process.cwd();
const repositoryRoot = fs.existsSync(path.resolve(workingDirectory, "apps/hono-api/package.json"))
  ? workingDirectory
  : path.resolve(workingDirectory, "../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repositoryRoot, relativePath), "utf8");
}

function readComposeService(source: string, serviceName: string): string {
  const marker = `  ${serviceName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`compose service missing: ${serviceName}`);
  const remainder = source.slice(start + marker.length);
  const nextServiceOffset = remainder.search(/\n  [a-zA-Z0-9][a-zA-Z0-9_-]*:\n/);
  return nextServiceOffset < 0 ? remainder : remainder.slice(0, nextServiceOffset);
}

describe("background worker deployment ownership", () => {
  const composePaths = [
    "apps/hono-api/docker-compose.yml",
    "apps/hono-api/docker-compose.prod.yml",
  ];

  for (const composePath of composePaths) {
    it(`${composePath} exposes exactly one canonical run-driver slot`, () => {
      const source = read(composePath);
      const worker = readComposeService(source, "credit-finalizer-worker");

      expect(source).not.toMatch(/^  inprocess-worker:$/m);
      expect(worker).toContain("inprocess:worker");
      expect(worker).not.toContain("credit-finalizer:worker");
      expect(worker).toContain("DATABASE_URL:");
      expect(worker).toContain("NEW_API_INTERNAL_BASE_URL:");
      expect(worker).toContain("NEW_API_INTERNAL_DOCKER_BASE_URL");
      expect(worker).not.toContain("${NEW_API_INTERNAL_BASE_URL:");
      expect(worker).toContain("stop_grace_period: 10m");
      expect(worker).toContain('test: ["CMD", "node", "dist/inprocess-worker-healthcheck.js"]');
      expect(worker).toContain("INPROCESS_MEDIA_RECOVERY_EVERY_MS:");
      expect(worker).not.toContain("INPROCESS_DRIVE_EVERY_MS:");
      expect(worker).not.toContain("driveAt");
      expect(worker).toContain("INPROCESS_ASYNC_CONTINUATION_SWEEP_EVERY_MS:");
      expect(worker).toContain("5000");
      expect(worker).toContain("replicas: 1");
    });
  }

  it("does not expose the legacy HTTP-callback worker command", () => {
    const packageJson = read("apps/hono-api/package.json");
    expect(packageJson).not.toContain('"credit-finalizer:worker"');
  });

  it("builds and exposes the shared in-process worker healthcheck entrypoint", () => {
    const buildScript = read("apps/hono-api/scripts/build.mjs");
    const packageJson = read("apps/hono-api/package.json");
    const envExample = read("apps/hono-api/.env.example");

    expect(buildScript).toContain("'inprocess-worker-healthcheck':");
    expect(packageJson).toContain(
      '"inprocess:worker:health": "node dist/inprocess-worker-healthcheck.js"',
    );
    expect(envExample).toContain("INPROCESS_MEDIA_RECOVERY_EVERY_MS=60000");
    expect(envExample).not.toContain("VIDEO_RUN_DRIVER_EVERY_MS");
  });

  it("keeps durable delivery closure on a dedicated short-interval worker lane", () => {
    const worker = read("apps/hono-api/scripts/inprocess-worker.ts");
    const tasks = read("apps/hono-api/src/modules/internal/inprocess-tasks.ts");

    expect(worker).toContain('const asyncContinuationSweepQueueName = "tapcanvas-inprocess-async-continuation-sweep"');
    expect(worker).toContain('readIntEnv("INPROCESS_ASYNC_CONTINUATION_SWEEP_EVERY_MS", 5_000)');
    expect(worker).toContain("runAsyncAgentContinuationSweepTick(env)");
    expect(tasks).toContain("export async function runAsyncAgentContinuationSweepTick");
    const videoDriveBody = tasks.slice(tasks.indexOf("export async function runVideoDriveTick"));
    expect(videoDriveBody).not.toContain("sweepReadyAsyncAgentContinuations(c");
  });

  it("gives durable workflow restart recovery one dedicated queue-worker owner", () => {
    const main = read("apps/hono-api/src/main.ts");
    const nodeEnv = read("apps/hono-api/src/platform/node/node-env.ts");
    const inprocessWorker = read("apps/hono-api/scripts/inprocess-worker.ts");
    const workflowWorker = read("apps/hono-api/scripts/workflow-runtime-worker.ts");
    const restoreCall = "await restorePersistedWorkflowState(env);";

    expect(main).not.toContain(restoreCall);
    expect(main).not.toContain("handleWorkflowNodeJob");
    expect(workflowWorker).toContain(restoreCall);
    expect(workflowWorker.indexOf(restoreCall)).toBeLessThan(
      workflowWorker.indexOf("const consumer = createRedisWorkflowNodeQueueConsumer"),
    );
    expect(workflowWorker).toContain("acquireWorkflowRuntimeOwnership");
    expect(workflowWorker).toContain("handleWorkflowNodeJob(env, job)");
    expect(inprocessWorker).not.toContain("restorePersistedWorkflowState");
    expect(nodeEnv).toContain("createRedisWorkflowNodeQueueProducer");
    expect(nodeEnv).not.toContain("createLocalWorkflowNodeQueue");
    expect(nodeEnv).not.toContain("setTimeout(() => {\n\t\tvoid (async () => {\n\t\t\tconst recovery = await recoverInterruptedWorkflowExecutions(env);");
  });

  for (const composePath of composePaths) {
    it(`${composePath} isolates workflow execution from the API service`, () => {
      const source = read(composePath);
      const workflowWorker = readComposeService(source, "workflow-runtime-worker");
      const api = readComposeService(source, "api");

      expect(workflowWorker).toContain("workflow-runtime:worker");
      expect(workflowWorker).toContain("WORKFLOW_NODE_WORKER_CONCURRENCY:");
      expect(workflowWorker).toContain('WORKFLOW_RUNTIME_PORT: "8790"');
      expect(workflowWorker).toContain('WORKFLOW_RUNTIME_REMOTE_BASE_URL: ""');
      expect(workflowWorker).toContain("MEDIA_WORKER_GRPC_ADDR:");
      expect(workflowWorker).toContain("media-worker:9090");
      expect(workflowWorker).toContain("media-worker:\n        condition: service_healthy");
      expect(workflowWorker).toContain("replicas: 1");
      expect(workflowWorker).toContain("memory: 4g");
      expect(api).toContain("WORKFLOW_RUNTIME_REMOTE_BASE_URL: http://workflow-runtime-worker:8790");
      expect(api).not.toContain("workflow-runtime:worker");
    });
  }

  it("deployment waits for queue readiness and every standard startup removes the retired profile container", () => {
    const deployScript = read("deploy.sh");
    const devScript = read("scripts/dev.sh");

    expect(deployScript).toContain("wait_service_healthy credit-finalizer-worker 180");
    expect(deployScript).toContain(
      'verify_running_image credit-finalizer-worker "$TAPCANVAS_API_IMAGE"',
    );
    expect(deployScript).toContain(
      "compose up -d --no-deps --remove-orphans credit-finalizer-worker",
    );
    expect(devScript).toContain("args+=(--remove-orphans)");
    expect(devScript).toContain("docker compose -f apps/hono-api/docker-compose.yml");
    expect(devScript).toContain("docker-compose -f apps/hono-api/docker-compose.yml");
  });

  it("waits for the previous workflow owner before starting the replacement worker", () => {
    const deployScript = read("deploy.sh");
    const stopWorker = deployScript.indexOf("compose stop -t 1800 workflow-runtime-worker");
    const stopApi = deployScript.indexOf("compose stop -t 600 api");
    const waitForLease = deployScript.indexOf("wait_workflow_runtime_ownership_released 75");
    const startApi = deployScript.indexOf("compose up -d --no-deps api");
    const startWorker = deployScript.indexOf("compose up -d --no-deps workflow-runtime-worker");

    expect(stopWorker).toBeGreaterThan(-1);
    expect(stopApi).toBeGreaterThan(-1);
    expect(stopApi).toBeGreaterThan(stopWorker);
    expect(waitForLease).toBeGreaterThan(stopApi);
    expect(startApi).toBeGreaterThan(waitForLease);
    expect(startWorker).toBeGreaterThan(startApi);
    expect(deployScript).not.toContain("redis-cli DEL tapcanvas:workflow-runtime-owner");
  });
});
