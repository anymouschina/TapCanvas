import type { DurableObjectState } from "@cloudflare/workers-types";
import type { WorkerEnv } from "../../types";
import { queryOne } from "../../db/db";
import {
	ensureNodeRuns,
	insertExecutionEvent,
	updateExecutionStatus,
	updateNodeRun,
} from "./execution.repo";

type ReactFlowLike = {
	nodes?: Array<{ id?: string; data?: any }>;
	edges?: Array<{ source?: string; target?: string }>;
};

type GraphState = {
	status: "queued" | "running" | "success" | "failed";
	concurrency: number;
	running: number;
	seq: number;
	indeg: Record<string, number>;
	adj: Record<string, string[]>;
	ready: string[];
};

function buildGraph(input: ReactFlowLike): {
	nodeIds: string[];
	indeg: Record<string, number>;
	adj: Record<string, string[]>;
} {
	const nodes = Array.isArray(input?.nodes) ? input.nodes : [];
	const edges = Array.isArray(input?.edges) ? input.edges : [];
	const nodeIds = nodes
		.map((n) => (typeof n?.id === "string" ? n.id : ""))
		.filter(Boolean);
	const set = new Set(nodeIds);
	const indeg: Record<string, number> = {};
	const adj: Record<string, string[]> = {};
	nodeIds.forEach((id) => {
		indeg[id] = 0;
		adj[id] = [];
	});
	edges.forEach((e) => {
		const s = typeof e?.source === "string" ? e.source : "";
		const t = typeof e?.target === "string" ? e.target : "";
		if (!s || !t) return;
		if (!set.has(s) || !set.has(t)) return;
		adj[s].push(t);
		indeg[t] = (indeg[t] || 0) + 1;
	});
	return { nodeIds, indeg, adj };
}

function hasCycle(nodeIds: string[], indeg: Record<string, number>, adj: Record<string, string[]>): boolean {
	const q: string[] = [];
	const indegCopy: Record<string, number> = { ...indeg };
	nodeIds.forEach((id) => {
		if ((indegCopy[id] || 0) === 0) q.push(id);
	});
	let visited = 0;
	while (q.length) {
		const u = q.shift()!;
		visited++;
		for (const v of adj[u] || []) {
			indegCopy[v] = (indegCopy[v] || 0) - 1;
			if (indegCopy[v] === 0) q.push(v);
		}
	}
	return visited !== nodeIds.length;
}

async function loadFlowVersionData(db: D1Database, flowVersionId: string): Promise<ReactFlowLike | null> {
	const row = await queryOne<{ data: string }>(
		db,
		`SELECT data FROM flow_versions WHERE id = ?`,
		[flowVersionId],
	);
	if (!row?.data) return null;
	try {
		return JSON.parse(row.data) as ReactFlowLike;
	} catch {
		return null;
	}
}

type D1Database = WorkerEnv["DB"];

export class ExecutionDO {
	private state: DurableObjectState;
	private env: WorkerEnv;

	constructor(state: DurableObjectState, env: WorkerEnv) {
		this.state = state;
		this.env = env;
	}

	private get executionId() {
		return this.state.id.toString();
	}

	private async loadGraphState(): Promise<GraphState | null> {
		const stored = await this.state.storage.get<GraphState>("graph");
		return stored || null;
	}

	private async saveGraphState(next: GraphState): Promise<void> {
		await this.state.storage.put("graph", next);
	}

	private async nextSeq(): Promise<number> {
		const key = "seq";
		const current = (await this.state.storage.get<number>(key)) || 0;
		const next = current + 1;
		await this.state.storage.put(key, next);
		return next;
	}

	private async appendEvent(params: {
		eventType: string;
		level?: string;
		nodeId?: string | null;
		message?: string | null;
		data?: unknown;
	}) {
		const nowIso = new Date().toISOString();
		const seq = await this.nextSeq();
		await insertExecutionEvent(this.env.DB, {
			id: crypto.randomUUID(),
			executionId: this.executionId,
			seq,
			eventType: params.eventType,
			level: params.level,
			nodeId: params.nodeId ?? null,
			message: params.message ?? null,
			data: params.data,
			nowIso,
		});
	}

	private async schedule(): Promise<void> {
		const graph = await this.loadGraphState();
		if (!graph) return;
		if (graph.status !== "running") return;

		while (graph.running < graph.concurrency && graph.ready.length) {
			const nodeId = graph.ready.shift()!;
			graph.running += 1;
			await this.saveGraphState(graph);
			await this.appendEvent({ eventType: "node_queued", nodeId });
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "queued",
			});
			await this.env.WORKFLOW_NODE_QUEUE.send({
				executionId: this.executionId,
				nodeId,
			});
		}
		await this.saveGraphState(graph);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (request.method === "POST" && path === "/start") {
			return this.handleStart();
		}
		if (request.method === "POST" && path === "/nodeStarted") {
			return this.handleNodeStarted(request);
		}
		if (request.method === "POST" && path === "/nodeComplete") {
			return this.handleNodeComplete(request);
		}
		return new Response("Not found", { status: 404 });
	}

	private async handleStart(): Promise<Response> {
		const execution = await queryOne<{
			id: string;
			flow_version_id: string;
			status: string;
			concurrency: number;
		}>(
			this.env.DB,
			`SELECT id, flow_version_id, status, concurrency
       FROM workflow_executions
       WHERE id = ?`,
			[this.executionId],
		);
		if (!execution) return new Response("Execution not found", { status: 404 });
		if (execution.status !== "queued") {
			return new Response("Execution already started", { status: 409 });
		}

		const nowIso = new Date().toISOString();
		await updateExecutionStatus(this.env.DB, {
			executionId: this.executionId,
			status: "running",
			startedAt: nowIso,
		});

		const flowData = await loadFlowVersionData(
			this.env.DB,
			execution.flow_version_id,
		);
		if (!flowData) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: "Invalid flow version data",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: "Invalid flow version data",
			});
			return new Response("Invalid flow version data", { status: 400 });
		}

		const { nodeIds, indeg, adj } = buildGraph(flowData);
		if (!nodeIds.length) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
				message: "Empty workflow",
			});
			return new Response("ok");
		}
		if (hasCycle(nodeIds, indeg, adj)) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: "Cycle detected in workflow graph",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: "Cycle detected in workflow graph",
			});
			return new Response("Cycle detected", { status: 400 });
		}

		await ensureNodeRuns(this.env.DB, {
			executionId: this.executionId,
			nodeIds,
			nowIso,
		});

		const ready = nodeIds.filter((id) => (indeg[id] || 0) === 0);
		const graphState: GraphState = {
			status: "running",
			concurrency: Math.max(
				1,
				Math.min(8, Number(execution.concurrency || 1)),
			),
			running: 0,
			seq: 0,
			indeg,
			adj,
			ready: [...ready],
		};
		await this.saveGraphState(graphState);
		await this.state.storage.put("seq", 0);
		await this.appendEvent({ eventType: "execution_created", level: "info" });
		await this.appendEvent({ eventType: "execution_started", level: "info" });
		await this.schedule();
		return new Response("ok");
	}

	private async handleNodeStarted(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		if (!graph || graph.status !== "running") return new Response("ignored");
		const body = (await request.json().catch(() => ({}))) as any;
		const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
		if (!nodeId) return new Response("bad request", { status: 400 });
		const nowIso = new Date().toISOString();
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "running",
			startedAt: nowIso,
		});
		await this.appendEvent({ eventType: "node_started", nodeId });
		return new Response("ok");
	}

	private async handleNodeComplete(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		if (!graph || graph.status !== "running") return new Response("ignored");
		const body = (await request.json().catch(() => ({}))) as any;
		const nodeId = typeof body?.nodeId === "string" ? body.nodeId : "";
		const ok = Boolean(body?.ok);
		const errorMessage =
			typeof body?.errorMessage === "string" ? body.errorMessage : null;
		const outputRefs = body?.outputRefs;
		if (!nodeId) return new Response("bad request", { status: 400 });

		const nowIso = new Date().toISOString();
		graph.running = Math.max(0, graph.running - 1);

		if (!ok) {
			graph.status = "failed";
			await this.saveGraphState(graph);
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "failed",
				errorMessage: errorMessage || "node failed",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "node_failed",
				level: "error",
				nodeId,
				message: errorMessage || "node failed",
			});
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: errorMessage || "node failed",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: errorMessage || "node failed",
				data: { nodeId },
			});
			return new Response("ok");
		}

		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "success",
			outputRefs,
			finishedAt: nowIso,
		});
		await this.appendEvent({ eventType: "node_succeeded", nodeId });

		for (const child of graph.adj[nodeId] || []) {
			graph.indeg[child] = Math.max(0, (graph.indeg[child] || 0) - 1);
			if (graph.indeg[child] === 0) graph.ready.push(child);
		}

		const remaining =
			Object.values(graph.indeg).reduce((acc, v) => acc + v, 0) +
			graph.ready.length +
			graph.running;
		if (remaining === 0) {
			graph.status = "success";
			await this.saveGraphState(graph);
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
			});
			return new Response("ok");
		}

		await this.saveGraphState(graph);
		await this.schedule();
		return new Response("ok");
	}
}

