import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import type { WorkflowPipelineRunSpecV1 } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowNodeExecutionContext, WorkflowNodeExecutorDependencies } from "./execution.node-executors";
import type { WorkflowNodeExecutionResult, WorkflowNodeOutputV1, WorkflowNodeSnapshot } from "./execution.node-runtime";
import { AgentNodeReadSchema } from "./execution.agent-history";
import { readAgentNodeContent } from "./execution.agent-content";
import { collectWorkflowInputReadProjections } from "./execution.input-read-projection";
import { runWorkflowPipelineNode } from "./execution.pipeline-runner";

const prismaAccess = vi.hoisted(() => ({ $queryRaw: vi.fn<[Prisma.Sql], Promise<unknown>>() }));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prismaAccess }));

const executionId = "inline-pipeline-content-read-test-execution";
const ownerId = "inline-pipeline-content-read-test-owner";
const parentNodeId = "inline-pipeline-content-read-test-parent";

function frozenStep(id: string, executorRef: string, inputPort: string, outputPort: string) {
	return {
		stepId: id,
		node: {
			id,
			type: "taskNode",
			kind: "workflowStage",
			data: {
				workflowAtomicSpec: {
					version: 1,
					category: "control",
					operation: "test",
					executorRef,
					executionMode: "once",
					inputPorts: [inputPort],
					outputPorts: [outputPort],
					inputArtifactTypes: { [inputPort]: ["tapcanvas.test-value/v1"] },
					outputArtifactTypes: { [outputPort]: ["tapcanvas.test-value/v1"] },
				},
			},
		},
	};
}

function pipelineSpec(): WorkflowPipelineRunSpecV1 {
	return {
		protocolVersion: "workflow.pipeline.run/v1",
		inputs: [{ portId: "seed", mode: "value", artifactTypes: ["tapcanvas.test-value/v1"] }],
		steps: [
			frozenStep("prepare", "video.clip-contexts/v1", "seed", "context"),
			frozenStep("submit", "tapcanvas.video.generate/v1", "context", "video"),
		],
		bindings: [
			{ from: { kind: "input", portId: "seed" }, to: { stepId: "prepare", portId: "seed" }, mode: "value" },
			{ from: { kind: "step", stepId: "prepare", portId: "context" }, to: { stepId: "submit", portId: "context" }, mode: "value" },
		],
		outputs: [{ portId: "video", from: { stepId: "submit", portId: "video" }, mode: "value" }],
	};
}

function outerNode(spec: WorkflowPipelineRunSpecV1): WorkflowNodeSnapshot {
	return {
		id: parentNodeId,
		type: "taskNode",
		kind: "workflowStage",
		data: {
			workflowPipeline: spec,
			workflowAtomicSpec: {
				version: 1,
				category: "control",
				operation: "run",
				executorRef: "workflow.pipeline.run/v1",
				executionMode: "once",
				inputPorts: ["seed"],
				outputPorts: ["video"],
			},
		},
	};
}

function readContext(spec: WorkflowPipelineRunSpecV1, inputs: Readonly<Record<string, readonly unknown[]>>, revision: string): WorkflowNodeExecutionContext {
	return {
		executionId,
		executionFamilyId: "inline-pipeline-content-read-test-family",
		ownerId,
		flowId: "inline-pipeline-content-read-test-flow",
		projectId: "inline-pipeline-content-read-test-project",
		workflowKey: "video",
		node: outerNode(spec),
		inputs,
		persistedInputSource: { nodeId: parentNodeId, revision, inputs },
	};
}

function output(node: WorkflowNodeSnapshot, executorRef: string, portId: string, value: unknown): WorkflowNodeOutputV1 {
	return {
		protocolVersion: "1",
		executorRef,
		nodeId: node.id,
		executionMode: "once",
		ports: { [portId]: value },
		artifacts: [],
		evidence: {},
		itemRuns: [],
	};
}

function readDatabaseUrl(): string {
	const env = readFileSync(".env", "utf8");
	const value = env.split("\n").find((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL is missing from .env");
	return value;
}

async function readJsonPages(args: ReturnType<typeof AgentNodeReadSchema.parse>) {
	let offset = 0;
	let revision: string | undefined;
	let text = "";
	let pageCount = 0;
	for (;;) {
		const page = await readAgentNodeContent(ownerId, AgentNodeReadSchema.parse({ ...args, offset, ...(revision ? { revision } : {}) }));
		if (!("text" in page) || typeof page.text !== "string" || !("encoding" in page) || page.encoding !== "json") throw new Error("Expected a JSON text page from frozen input");
		if (!page.revision) throw new Error("Frozen input page has no revision");
		if (revision !== undefined && page.revision !== revision) throw new Error("Frozen input revision changed between pages");
		revision = page.revision;
		text += page.text;
		pageCount += 1;
		if (page.nextOffset === null) break;
		offset = page.nextOffset;
	}
	return { revision, pageCount, text, value: JSON.parse(text) as unknown };
}

describe.skipIf(process.env.RUN_AGENT_CONTENT_SQL_TEST !== "1")("PostgreSQL inline-pipeline input content read", () => {
	it("reads the emitted parent handle through the real content query and rejects the legacy synthetic identity", async () => {
		const sourceDocument = { text: "章节原文😀/".repeat(2_400), sourceId: "persisted-parent-source" };
		const inputs = { seed: [{ document: sourceDocument }] };
		const inputJson = JSON.stringify(inputs);
		const parentRevision = createHash("md5").update(inputJson).digest("hex");
		const derivedDocument = { text: "inline 派生内容🎬/".repeat(1_600), sourceId: "derived-by-prepare-step" };
		const stages: Array<{ context: WorkflowNodeExecutionContext; projection: ReturnType<typeof collectWorkflowInputReadProjections> }> = [];
		const spec = pipelineSpec();

		const pipelineResult = await runWorkflowPipelineNode(readContext(spec, inputs, parentRevision), {} as WorkflowNodeExecutorDependencies,
			async (context): Promise<WorkflowNodeExecutionResult> => {
				stages.push({ context, projection: collectWorkflowInputReadProjections(context.inputs, context) });
				const prepare = context.node.id.endsWith("::step::prepare");
				const executorRef = prepare ? "video.clip-contexts/v1" : "tapcanvas.video.generate/v1";
				const portId = prepare ? "context" : "video";
				const value = prepare ? derivedDocument : { url: "https://assets.invalid/test-video.mp4" };
				return { ok: true, outputRefs: output(context.node, executorRef, portId, value) };
			});

		expect(pipelineResult.ok).toBe(true);
		expect(stages).toHaveLength(2);
		const parentProjection = stages[0]!.projection;
		expect(parentProjection.projections).toHaveLength(1);
		const parentReference = JSON.parse(parentProjection.projections[0]!.reference) as { contentRead: { args: unknown } };
		const parentArgs = AgentNodeReadSchema.parse(parentReference.contentRead.args);
		expect(parentArgs).toMatchObject({
			executionId,
			nodeId: parentNodeId,
			revision: parentRevision,
			view: "content",
			field: "input",
			format: "json",
			path: ["seed", "0", "document"],
		});
		const derivedProjection = stages[1]!.projection;
		expect(derivedProjection.projections).toEqual([]);
		expect(derivedProjection.diagnostics.retainedUnmatched).toBeGreaterThan(0);
		expect(JSON.stringify(stages[1]!.context.inputs)).toContain(derivedDocument.text);

		const prisma = new PrismaClient({ datasources: { db: { url: readDatabaseUrl() } } });
		try {
			await prisma.$transaction(async (tx) => {
				// Temporary tables shadow the production table names only within this transaction/session.
				// ON COMMIT DROP and transaction-local inserts ensure no persistent project rows are touched.
				await tx.$executeRaw`CREATE TEMP TABLE workflow_executions (id text NOT NULL, owner_id text NOT NULL) ON COMMIT DROP`;
				await tx.$executeRaw`CREATE TEMP TABLE workflow_node_runs (execution_id text NOT NULL, node_id text NOT NULL, input_refs text) ON COMMIT DROP`;
				await tx.$executeRaw`INSERT INTO workflow_executions (id, owner_id) VALUES (${executionId}, ${ownerId})`;
				await tx.$executeRaw`INSERT INTO workflow_node_runs (execution_id, node_id, input_refs) VALUES (${executionId}, ${parentNodeId}, ${inputJson})`;
				prismaAccess.$queryRaw.mockImplementation((query) => tx.$queryRaw(query));

				const readback = await readJsonPages(parentArgs);
				expect(readback.revision).toBe(parentRevision);
				expect(readback.pageCount).toBeGreaterThan(1);
				expect(readback.value).toEqual(sourceDocument);

				const legacySyntheticNodeId = stages[0]!.context.node.id;
				const legacySha256Revision = createHash("sha256").update(JSON.stringify(stages[0]!.context.inputs)).digest("hex");
				const legacyArgs = AgentNodeReadSchema.parse({ ...parentArgs, nodeId: legacySyntheticNodeId, revision: legacySha256Revision });
				await expect(readAgentNodeContent(ownerId, legacyArgs)).rejects.toMatchObject({ code: "workflow_node_content_not_found" });
			}, { timeout: 60_000 });
		} finally {
			prismaAccess.$queryRaw.mockReset();
			await prisma.$disconnect();
		}
	}, 65_000);
});
