import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { DurableObjectNamespace } from "../../types";

const WORKFLOW_RUNTIME_ROUTE_PREFIX = "/internal/workflow-runtime/executions";
const MAX_WORKFLOW_RUNTIME_REQUEST_BYTES = 1_048_576;
const WORKFLOW_RUNTIME_ACTIONS = new Set([
	"start",
	"recoverAfterRestart",
	"nodeStarted",
	"nodeHeartbeat",
	"nodeRecoveryStarted",
	"nodeExternalCheckStarted",
	"nodeWaiting",
	"nodeProgress",
	"nodeComplete",
	"cancel",
]);

type DurableObjectIdLike = Readonly<{ toString: () => string }>;
type DurableObjectStubLike = Readonly<{
	fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}>;

function assertAbsoluteHttpUrl(raw: string, field: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`${field} must be an absolute HTTP(S) URL`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`${field} must be an absolute HTTP(S) URL`);
	}
	return parsed;
}

function bearerMatches(header: string | undefined, expectedToken: string): boolean {
	const actual = String(header ?? "").replace(/^Bearer\s+/iu, "");
	const actualBytes = Buffer.from(actual, "utf8");
	const expectedBytes = Buffer.from(expectedToken, "utf8");
	return actualBytes.length === expectedBytes.length
		&& timingSafeEqual(actualBytes, expectedBytes);
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let receivedBytes = 0;
	for await (const rawChunk of request) {
		const chunk = Buffer.isBuffer(rawChunk)
			? rawChunk
			: rawChunk instanceof Uint8Array
				? Buffer.from(rawChunk)
				: Buffer.from(String(rawChunk), "utf8");
		receivedBytes += chunk.byteLength;
		if (receivedBytes > MAX_WORKFLOW_RUNTIME_REQUEST_BYTES) {
			throw new Error("workflow_runtime_request_too_large");
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

function writeNodeResponse(response: ServerResponse, status: number, body: string): void {
	response.statusCode = status;
	response.setHeader("content-type", "text/plain; charset=utf-8");
	response.end(body);
}

export function createRemoteWorkflowRuntimeNamespace(input: Readonly<{
	baseUrl: string;
	token: string;
}>): DurableObjectNamespace {
	const baseUrl = assertAbsoluteHttpUrl(input.baseUrl.trim(), "WORKFLOW_RUNTIME_REMOTE_BASE_URL");
	const token = input.token.trim();
	if (!token) throw new Error("Remote workflow runtime requires INTERNAL_WORKER_TOKEN");

	const namespace = {
		idFromName(name: string): DurableObjectIdLike {
			const id = String(name ?? "").trim();
			if (!id) throw new Error("Workflow execution identity must be non-empty");
			return { toString: () => id };
		},
		get(id: DurableObjectIdLike): DurableObjectStubLike {
			const executionId = id.toString().trim();
			if (!executionId) throw new Error("Workflow execution identity must be non-empty");
			return {
				fetch: async (requestInput, init) => {
					const request = requestInput instanceof Request
						? requestInput
						: new Request(String(requestInput), init);
					const sourceUrl = new URL(request.url);
					const action = sourceUrl.pathname.replace(/^\/+|\/+$/gu, "");
					if (!WORKFLOW_RUNTIME_ACTIONS.has(action)) {
						throw new Error(`Unsupported workflow runtime action: ${action || "<empty>"}`);
					}
					const target = new URL(
						`${WORKFLOW_RUNTIME_ROUTE_PREFIX}/${encodeURIComponent(executionId)}/${encodeURIComponent(action)}`,
						baseUrl,
					);
					target.search = sourceUrl.search;
					const headers = new Headers(request.headers);
					headers.set("authorization", `Bearer ${token}`);
					const body = request.method === "GET" || request.method === "HEAD"
						? undefined
						: await request.arrayBuffer();
					return fetch(target, {
						method: request.method,
						headers,
						...(body === undefined ? {} : { body }),
					});
				},
			};
		},
	};
	return namespace as unknown as DurableObjectNamespace;
}

export async function startWorkflowRuntimeControlServer(input: Readonly<{
	namespace: DurableObjectNamespace;
	token: string;
	host?: string;
	port: number;
}>): Promise<Readonly<{ close: () => Promise<void>; origin: string }>> {
	const token = input.token.trim();
	if (!token) throw new Error("Workflow runtime control server requires INTERNAL_WORKER_TOKEN");
	const host = input.host?.trim() || "0.0.0.0";
	const port = Math.floor(input.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
		throw new Error("WORKFLOW_RUNTIME_PORT must be an integer between 1 and 65535");
	}

	const server: Server = http.createServer((request, response) => {
		void (async () => {
			if (!bearerMatches(request.headers.authorization, token)) {
				writeNodeResponse(response, 401, "Unauthorized");
				return;
			}
			const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "workflow-runtime"}`);
			const segments = requestUrl.pathname.split("/").filter(Boolean);
			if (segments.length !== 5
				|| segments[0] !== "internal"
				|| segments[1] !== "workflow-runtime"
				|| segments[2] !== "executions") {
				writeNodeResponse(response, 404, "Not found");
				return;
			}
			const executionId = decodeURIComponent(segments[3] ?? "").trim();
			const action = decodeURIComponent(segments[4] ?? "").trim();
			if (!executionId || !WORKFLOW_RUNTIME_ACTIONS.has(action)) {
				writeNodeResponse(response, 404, "Not found");
				return;
			}
			const body = await readRequestBody(request);
			const headers = new Headers();
			for (const [name, value] of Object.entries(request.headers)) {
				if (value === undefined || name.toLowerCase() === "authorization") continue;
				headers.set(name, Array.isArray(value) ? value.join(",") : value);
			}
			const stub = input.namespace.get(input.namespace.idFromName(executionId));
			const runtimeResponse = await stub.fetch(`https://do/${action}${requestUrl.search}`, {
				method: request.method ?? "POST",
				headers,
				...(body.byteLength === 0 ? {} : { body }),
			});
			response.statusCode = runtimeResponse.status;
			runtimeResponse.headers.forEach((value, name) => response.setHeader(name, value));
			response.end(Buffer.from(await runtimeResponse.arrayBuffer()));
		})().catch((error: unknown) => {
			if (response.headersSent) {
				response.destroy(error instanceof Error ? error : new Error(String(error)));
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			writeNodeResponse(
				response,
				message === "workflow_runtime_request_too_large" ? 413 : 500,
				message,
			);
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		origin: `http://${host}:${port}`,
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
			});
		},
	};
}
