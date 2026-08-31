import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const postgresContainer = `tapcanvas-continuation-chaos-pg-${suffix}`;
const redisContainer = `tapcanvas-continuation-chaos-redis-${suffix}`;

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: options.capture ? "pipe" : "inherit",
		env: options.env ?? process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const detail = options.capture ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() : "";
		throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail ? `: ${detail}` : ""}`);
	}
	return String(result.stdout ?? "").trim();
}

function stopFixtureContainers() {
	spawnSync("docker", ["stop", postgresContainer, redisContainer], { stdio: "ignore" });
}

function waitFor(container, args) {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		const result = spawnSync("docker", ["exec", container, ...args], { stdio: "ignore" });
		if (result.status === 0) return;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
	}
	throw new Error(`fixture container did not become ready: ${container}`);
}

function publishedPort(container, containerPort) {
	const output = run("docker", ["port", container, `${containerPort}/tcp`], { capture: true });
	const match = output.match(/:(\d+)$/);
	if (!match) throw new Error(`cannot resolve published port for ${container}:${containerPort}`);
	return match[1];
}

process.once("SIGINT", () => {
	stopFixtureContainers();
	process.exit(130);
});
process.once("SIGTERM", () => {
	stopFixtureContainers();
	process.exit(143);
});

try {
	run("docker", [
		"run", "-d", "--rm", "--name", postgresContainer,
		"-e", "POSTGRES_DB=tapcanvas_chaos",
		"-e", "POSTGRES_USER=tapcanvas_chaos",
		"-e", "POSTGRES_PASSWORD=tapcanvas_chaos",
		"-p", "127.0.0.1::5432",
		process.env.CONTINUATION_CHAOS_POSTGRES_IMAGE || "docker.m.daocloud.io/pgvector/pgvector:pg16",
	], { capture: true });
	run("docker", [
		"run", "-d", "--rm", "--name", redisContainer,
		"-p", "127.0.0.1::6379",
		process.env.CONTINUATION_CHAOS_REDIS_IMAGE || "docker.m.daocloud.io/redis:7-alpine",
	], { capture: true });
	waitFor(postgresContainer, ["pg_isready", "-U", "tapcanvas_chaos", "-d", "tapcanvas_chaos"]);
	waitFor(redisContainer, ["redis-cli", "ping"]);

	const postgresPort = publishedPort(postgresContainer, 5432);
	const redisPort = publishedPort(redisContainer, 6379);
	const databaseUrl = `postgresql://tapcanvas_chaos:tapcanvas_chaos@127.0.0.1:${postgresPort}/tapcanvas_chaos?schema=public`;
	const redisUrl = `redis://127.0.0.1:${redisPort}`;
	run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"], {
		env: { ...process.env, DATABASE_URL: databaseUrl },
	});
	run("pnpm", [
		"exec", "vitest", "run",
		"src/modules/task/continuation-settlement.chaos.integration.test.ts",
		"--reporter=verbose",
	], {
		env: {
			...process.env,
			CONTINUATION_CHAOS_DATABASE_URL: databaseUrl,
			CONTINUATION_CHAOS_REDIS_URL: redisUrl,
		},
	});
} finally {
	stopFixtureContainers();
}
