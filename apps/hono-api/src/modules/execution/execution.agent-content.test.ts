import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { AgentNodeReadSchema, listAgentNodeMetadata, getAgentExecutionMetadata, listAgentExecutionMetadata } from "./execution.agent-history";
import { buildAgentContentQuery, readAgentNodeContent } from "./execution.agent-content";
import { encodeWorkflowOutput } from "./execution.output-storage";

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), workflow_node_runs: { findMany: vi.fn(), findFirst: vi.fn() }, workflow_node_attempts: { findMany: vi.fn(), findFirst: vi.fn() }, workflow_executions: { findFirst: vi.fn(), findMany: vi.fn() } }));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => db }));

describe("agent history reads", () => {
	it("accepts the shared chapter envelope while keeping unknown arguments explicit", () => {
		expect(AgentNodeReadSchema.safeParse({ executionId: "e1", bookId: "book1" }).success).toBe(true);
		expect(AgentNodeReadSchema.safeParse({ executionId: "e1", unexpected: true }).success).toBe(false);
	});
	it("restricts JSON subtree pages to content reads of frozen input", () => {
		expect(AgentNodeReadSchema.safeParse({ executionId: "e1", nodeId: "n1", view: "content", field: "input", format: "json" }).success).toBe(true);
		expect(AgentNodeReadSchema.safeParse({ executionId: "e1", nodeId: "n1", view: "content", field: "output", format: "json" }).success).toBe(false);
		expect(AgentNodeReadSchema.safeParse({ executionId: "e1", view: "metadata", field: "input", format: "json" }).success).toBe(false);
	});
	it("does not select any body for metadata, including the lookahead row", async () => {
		db.workflow_node_runs.findMany.mockResolvedValue([{ id: "n1", node_id: "node1", execution_id: "e1" }, { id: "n2" }]);
		const page = await listAgentNodeMetadata("owner1", { executionId: "e1", limit: 1 });
		expect(page.nextCursor).toBe("n1");
		expect(page.items[0]?.contentRead).toEqual({ executionId: "e1", nodeId: "node1", view: "content" });
		const query = db.workflow_node_runs.findMany.mock.lastCall![0];
		expect(query.where.workflow_executions).toEqual({ owner_id: "owner1" });
		for (const field of ["output_refs", "input_refs", "tool_calls"]) expect(query.select).not.toHaveProperty(field);
	});
	it("uses identical metadata projection for immutable attempts", async () => {
		db.workflow_node_attempts.findMany.mockResolvedValue([{ id: "a1", node_id: "n1", execution_id: "e1" }]);
		const result = await listAgentNodeMetadata("owner1", { executionId: "e1", limit: 30 }, true);
		expect(result.items[0]?.contentRead).toHaveProperty("attemptId", "a1");
		for (const field of ["semantics_snapshot", "provider_receipts", "output_refs"]) expect(db.workflow_node_attempts.findMany.mock.lastCall![0].select).not.toHaveProperty(field);
	});
	it("rejects a foreign cursor before listing rows", async () => {
		db.workflow_node_runs.findMany.mockClear();
		db.workflow_node_runs.findFirst.mockResolvedValue(null);
		await expect(listAgentNodeMetadata("owner1", { executionId: "e1", limit: 30, cursor: "foreign" })).rejects.toThrow("Cursor");
		expect(db.workflow_node_runs.findMany).not.toHaveBeenCalled();
	});
	it("lists canonical chapter executions with the same owner/project scope as detail reads", async () => {
		db.workflow_executions.findMany.mockResolvedValue([]);
		await listAgentExecutionMetadata("owner1", "chapter1", 3, { projectId: "project1", isChapterScope: true });
		expect(db.workflow_executions.findMany.mock.lastCall![0].where).toEqual({ owner_id: "owner1", OR: [
			{ flow_id: "chapter1" }, { project_id: "project1", canvas_id: { in: ["chapter1", "chapter:chapter1"] } },
		] });
	});
	it("authorizes executions without fetching context or snapshots", async () => {
		db.workflow_executions.findFirst.mockResolvedValue(null);
		await getAgentExecutionMetadata("owner1", "e1");
		const query = db.workflow_executions.findFirst.mock.lastCall![0];
		expect(query.where).toEqual({ id: "e1", owner_id: "owner1" });
		for (const field of ["project_context", "asset_snapshot", "user_input"]) expect(query.select).not.toHaveProperty(field);
	});
	it("keeps content reads scoped to owner, execution, node and exact attempt", async () => {
		db.$queryRaw.mockResolvedValue([{ revision: "r1", kind: "string", value: "abc", size: 6, keys: [], error: null }]);
		const args = AgentNodeReadSchema.parse({ executionId: "e1", view: "content", nodeId: "n1", attemptId: "a1", field: "semantics", textLimit: 3 });
		const page = await readAgentNodeContent("owner1", args);
		expect(page).toMatchObject({ text: "abc", nextOffset: 3, revision: "r1" });
		const query: Prisma.Sql = db.$queryRaw.mock.lastCall![0];
		expect(query.sql).toContain("workflow_node_attempts");
		expect(query.sql).toContain("n.semantics_snapshot");
		expect(query.values).toEqual(expect.arrayContaining(["owner1", "e1", "n1", "a1"]));
	});
	it("returns bounded JSON text pages for an exact frozen input subtree", async () => {
		db.$queryRaw.mockResolvedValueOnce([{ revision: "r1", kind: "object", value: '{"a":', size: 7, keys: [], error: null }])
			.mockResolvedValueOnce([{ revision: "r1", kind: "object", value: "1}", size: 7, keys: [], error: null }]);
		const args = AgentNodeReadSchema.parse({ executionId: "e1", view: "content", nodeId: "n1", field: "input", format: "json", path: ["payload"], textLimit: 5 });
		const page = await readAgentNodeContent("owner1", args);
		expect(page).toMatchObject({ field: "input", path: ["payload"], text: '{"a":', encoding: "json", offsetUnit: "unicode_code_points", totalLength: 7, nextOffset: 5, revision: "r1" });
		const finalPage = await readAgentNodeContent("owner1", AgentNodeReadSchema.parse({ ...args, offset: 5, revision: "r1" }));
		expect(finalPage).toMatchObject({ text: "1}", offset: 5, totalLength: 7, nextOffset: null, revision: "r1" });
		const query: Prisma.Sql = db.$queryRaw.mock.lastCall![0];
		expect(query.sql).toContain("n.input_refs");
		expect(query.sql).toContain("substring(json_text");
		expect(query.values).toContain(5);
	});
	it("rejects stale revisions instead of combining different outputs", async () => {
		db.$queryRaw.mockResolvedValue([{ revision: "r2", kind: "string", value: "changed", size: 7, keys: [], error: null }]);
		await expect(readAgentNodeContent("owner1", AgentNodeReadSchema.parse({ executionId: "e1", nodeId: "n1", view: "content", field: "input", format: "json", revision: "r1" }))).rejects.toMatchObject({ code: "workflow_content_revision_changed" });
	});
	it("distinguishes missing records from invalid stored references", async () => {
		const args = AgentNodeReadSchema.parse({ executionId: "e1", nodeId: "n1", view: "content" });
		db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ error: "missing_storage_block" }]);
		await expect(readAgentNodeContent("owner1", args)).rejects.toMatchObject({ code: "workflow_node_content_not_found" });
		await expect(readAgentNodeContent("owner1", args)).rejects.toMatchObject({ code: "missing_storage_block" });
	});
	it.each([
		{ view: "content" }, { view: "metadata", path: ["body"] }, { view: "content", nodeId: "n", limit: 201 },
		{ view: "content", nodeId: "n", field: "semantics" }, { view: "content", nodeId: "n", cursor: "x" },
	])("rejects unbounded or ambiguous content selectors %j", (args) => {
		expect(AgentNodeReadSchema.safeParse({ executionId: "e", ...args }).success).toBe(false);
	});
});

// Explicitly enabled integration verification: only transaction-local fixtures,
// no access to project/user records and no persistent schema changes.
describe.skipIf(process.env.RUN_AGENT_CONTENT_SQL_TEST !== "1")("PostgreSQL bounded content projection", () => {
	it("reads exact paths/pages from plain and shared-block data without returning sibling bodies", async () => {
		const env = readFileSync(".env", "utf8");
		const url = env.split("\n").find((line) => line.startsWith("DATABASE_URL="))!.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
		const prisma = new PrismaClient({ datasources: { db: { url } } });
		try {
			await prisma.$transaction(async (tx) => {
				await tx.$executeRaw`CREATE TEMP TABLE agent_content_fixture (raw text) ON COMMIT DROP`;
				const large = { body: "中文😀内容".repeat(200_000), list: [{ answer: 42 }, { answer: false }], empty: {}, nil: null, ref: "ref" };
				for (const value of [large, encodeWorkflowOutput(large)]) {
					await tx.$executeRaw`TRUNCATE agent_content_fixture`;
					await tx.$executeRaw`INSERT INTO agent_content_fixture VALUES (${JSON.stringify(value)})`;
					const source = Prisma.sql`SELECT raw FROM agent_content_fixture`;
					const query = async (path: string[], offset = 0, limit = 30, textLimit = 4, format: "shallow" | "json" = "shallow") => tx.$queryRaw<Array<{ revision: string; kind: string; size: number; value: unknown; keys: string[]; error: string | null }>>(buildAgentContentQuery(source, { path, offset, limit, textLimit, format }));
					expect((await query([]))[0]).toMatchObject({ revision: createHash("md5").update(JSON.stringify(value)).digest("hex"), kind: "object", keys: ["body", "empty", "list", "nil", "ref"], error: null });
					expect((await query(["body"], 2))[0]).toMatchObject({ kind: "string", value: "😀内容中", size: 1_000_000 });
					expect((await query(["list"], 1, 1))[0]).toMatchObject({ kind: "array", keys: ["1"], size: 2 });
					expect((await query(["list", "0", "answer"]))[0]).toMatchObject({ kind: "number", value: 42 });
					expect((await query(["list", "1", "answer"]))[0]).toMatchObject({ kind: "boolean", value: false });
					expect((await query(["nil"]))[0]).toMatchObject({ kind: "null", value: null });
					expect((await query(["ref"]))[0]).toMatchObject({ kind: "string", value: "ref", error: null });
					expect((await query(["missing"]))[0]?.error).toBe("path_not_found");
					expect((await query(["list", "-1"]))[0]?.error).toBe("path_not_found");
					const page = await query(["body"], 0, 30, 12_000);
					expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(50_000);
				}
				for (const value of [["storageVersion", "ref"], "storageVersion", encodeWorkflowOutput("nul\u0000value")]) {
					await tx.$executeRaw`TRUNCATE agent_content_fixture`;
					await tx.$executeRaw`INSERT INTO agent_content_fixture VALUES (${JSON.stringify(value)})`;
					const rows = await tx.$queryRaw<Array<{ kind: string; error: string | null; value: unknown }>>(buildAgentContentQuery(Prisma.sql`SELECT raw FROM agent_content_fixture`, { path: [], offset: 0, limit: 30, textLimit: 100 }));
					expect(rows[0]?.error).toBeNull();
					if (rows[0]?.kind === "escaped-string") expect(JSON.parse(String(rows[0].value))).toBe("nul\u0000value");
				}
				for (const [value, expected] of [
					[{ storageVersion: "workflow.output-storage/v999", root: null, blocks: {} }, "unsupported_storage_envelope"],
					[{ storageVersion: "workflow.output-storage/v1", root: ["ref", "missing"], blocks: {} }, "missing_storage_block"],
				] as const) {
					await tx.$executeRaw`TRUNCATE agent_content_fixture`;
					await tx.$executeRaw`INSERT INTO agent_content_fixture VALUES (${JSON.stringify(value)})`;
					const rows = await tx.$queryRaw<Array<{ error: string }>>(buildAgentContentQuery(Prisma.sql`SELECT raw FROM agent_content_fixture`, { path: [], offset: 0, limit: 30, textLimit: 4 }));
					expect(rows[0]?.error).toBe(expected);
				}
				const frozenInput = { storageVersion: "business-v1", root: { keep: true }, blocks: { ordinary: "data" }, title: "中文😀内容", events: [{ id: 1 }, false], scalar: null };
				await tx.$executeRaw`TRUNCATE agent_content_fixture`;
				await tx.$executeRaw`INSERT INTO agent_content_fixture VALUES (${JSON.stringify(frozenInput)})`;
				const before = await tx.$queryRaw<Array<{ raw: string }>>(Prisma.sql`SELECT raw FROM agent_content_fixture`);
				const jsonQuery = async (path: string[], offset: number, textLimit: number) => tx.$queryRaw<Array<{ revision: string; kind: string; size: number; value: unknown; keys: string[]; error: string | null }>>(
					buildAgentContentQuery(Prisma.sql`SELECT raw FROM agent_content_fixture`, { path, offset, limit: 30, textLimit, format: "json" }),
				);
				const readJson = async (path: string[]) => {
					let offset = 0;
					let revision: string | undefined;
					let text = "";
					for (;;) {
						const [page] = await jsonQuery(path, offset, 4);
						expect(page?.error).toBeNull();
						expect(typeof page?.value).toBe("string");
						if (revision === undefined) revision = page?.revision;
						else expect(page?.revision).toBe(revision);
						const chunk = String(page?.value);
						expect(Array.from(chunk).length).toBeLessThanOrEqual(4);
						text += chunk;
						offset += Array.from(chunk).length;
						if (page && offset >= page.size) break;
					}
					return { text, value: JSON.parse(text) as unknown };
				};
				const wholeInput = await readJson([]);
				expect(wholeInput.value).toEqual(frozenInput);
				expect((await readJson(["title"])).value).toBe(frozenInput.title);
				expect((await readJson(["events"])).value).toEqual(frozenInput.events);
				expect((await readJson(["events", "0"])).value).toEqual(frozenInput.events[0]);
				expect((await readJson(["scalar"])).value).toBeNull();
				expect((await jsonQuery(["missing"], 0, 4))[0]?.error).toBe("path_not_found");
				const after = await tx.$queryRaw<Array<{ raw: string }>>(Prisma.sql`SELECT raw FROM agent_content_fixture`);
				expect(after).toEqual(before);

				await tx.$executeRaw`TRUNCATE agent_content_fixture`;
				await tx.$executeRaw`INSERT INTO agent_content_fixture VALUES (${JSON.stringify(encodeWorkflowOutput(frozenInput))})`;
				expect((await jsonQuery([], 0, 4))[0]?.error).toBe("encoded_input_json_unsupported");
			}, { timeout: 60_000 });
		} finally { await prisma.$disconnect(); }
	}, 65_000);
});
