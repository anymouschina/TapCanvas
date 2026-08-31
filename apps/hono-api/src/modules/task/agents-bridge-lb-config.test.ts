import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepositoryFile(relativePath: string): string {
	return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function readComposeService(compose: string, serviceName: string): string {
	const serviceHeader = `  ${serviceName}:`;
	const start = compose.indexOf(serviceHeader);
	if (start < 0) throw new Error(`Compose service not found: ${serviceName}`);
	const remaining = compose.slice(start + serviceHeader.length);
	const nextServiceOffset = remaining.search(/\n {2}[^\s][^:\n]*:/u);
	return nextServiceOffset < 0
		? compose.slice(start)
		: compose.slice(start, start + serviceHeader.length + nextServiceOffset);
}

describe("agents bridge load-balancer contract", () => {
	it("materializes Docker replicas as consistent-hash peers without proxy retries", () => {
		const config = readRepositoryFile("docker/agents-bridge-lb.haproxy.cfg");

		expect(config).toContain(
			"balance hdr(x-tapcanvas-agent-session-affinity)",
		);
		expect(config).toContain("hash-type consistent");
		expect(config).toContain("server-template bridge 16 agents-bridge:8799");
		expect(config).toContain("retries 0");
		expect(config).toContain(
			"capture request header x-tapcanvas-agent-session-affinity len 67",
		);
	});

	it("uses the stateful HAProxy contract in local and production Compose", () => {
		for (const path of [
			"docker-compose.yml",
			"docker-compose.prod.yml",
		]) {
			const compose = readRepositoryFile(path);
			expect(compose).toContain("haproxy:3.0-alpine");
			expect(compose).toContain(
				"agents-bridge-lb.haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro",
			);
			expect(compose).not.toContain("agents-bridge-lb.nginx.conf");
		}
	});

	it("gives every agents bridge replica a stable internal TapCanvas callback base", () => {
		for (const path of [
			"docker-compose.yml",
			"docker-compose.prod.yml",
		]) {
			const compose = readRepositoryFile(path);
			const agentsBridge = readComposeService(compose, "agents-bridge");
			expect(agentsBridge).toContain(
				"TAPCANVAS_API_INTERNAL_BASE: http://api:8788",
			);
		}
	});

	it("persists the canonical Agent runtime database across container replacement and replicas", () => {
		for (const path of [
			"docker-compose.yml",
			"docker-compose.prod.yml",
		]) {
			const compose = readRepositoryFile(path);
			const agentsBridge = readComposeService(compose, "agents-bridge");
			expect(agentsBridge).toContain(
				"AGENTS_RUNTIME_DB_PATH: /runtime/workspace/.agents/runtime/runtime.sqlite",
			);
			expect(agentsBridge).toContain(
				"agents_memory:/runtime/bootstrap/apps/agents-cli/.agents",
			);
			expect(agentsBridge).toContain(
				"agents_runtime:/runtime/workspace/.agents",
			);
			expect(compose).toMatch(/\n  agents_runtime:\n    driver: local/u);
		}
	});

	it("exposes the installed Office runtime dependencies to workspace scripts", () => {
		const compose = readRepositoryFile("docker-compose.yml");
		const agentsBridge = readComposeService(compose, "agents-bridge");

		expect(agentsBridge).toContain(
			"ln -sfn /runtime/bootstrap/apps/agents-cli/node_modules /runtime/workspace/node_modules",
		);
	});
});
