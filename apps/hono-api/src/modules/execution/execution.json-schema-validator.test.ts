import { describe, expect, it } from "vitest";
import { buildAgentsBridgeRemoteTools } from "../task/task.agents-bridge";
import {
	findUnsupportedWorkflowToolSchemaKeywords,
	validateWorkflowToolArguments,
} from "./execution.json-schema-validator";

describe("workflow tool JSON Schema validation", () => {
	it("accepts exact registered arguments and rejects missing, extra and mistyped fields", () => {
		const schema = {
			type: "object",
			properties: {
				projectId: { type: "string", minLength: 1 },
				limit: { type: "integer", minimum: 1, maximum: 20 },
			},
			required: ["projectId"],
			additionalProperties: false,
		};
		expect(validateWorkflowToolArguments(schema, { projectId: "project-1", limit: 5 })).toEqual([]);
		expect(validateWorkflowToolArguments(schema, { limit: "5", unknown: true })).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: "$.projectId" }),
			expect.objectContaining({ path: "$.limit" }),
			expect.objectContaining({ path: "$.unknown" }),
		]));
	});

	it("enforces the structural constraints used by registered workflow tools", () => {
		const schema = {
			type: "object",
			minProperties: 3,
			properties: {
				mode: { type: "string", pattern: "^[a-z_]+$" },
				patch: { type: "object", minProperties: 1 },
				views: { type: "array", uniqueItems: true, minItems: 2, items: { type: "string" } },
				score: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
			},
			required: ["mode", "patch", "views"],
			not: { required: ["forbidden"] },
			additionalProperties: true,
		};
		expect(validateWorkflowToolArguments(schema, {
			mode: "preflight_begin",
			patch: { title: "ready" },
			views: ["front", "back"],
			score: 0.5,
		})).toEqual([]);
		const issues = validateWorkflowToolArguments(schema, {
			mode: "INVALID MODE",
			patch: {},
			views: [{ side: "front", order: 1 }, { order: 1, side: "front" }],
			score: 1,
			forbidden: true,
		});
		expect(issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: "$", message: expect.stringContaining("excluded schema") }),
			expect.objectContaining({ path: "$.mode", message: expect.stringContaining("pattern") }),
			expect.objectContaining({ path: "$.patch", message: expect.stringContaining("properties") }),
			expect.objectContaining({ path: "$.views[1]", message: expect.stringContaining("unique") }),
			expect.objectContaining({ path: "$.score", message: expect.stringContaining("< 1") }),
		]));
	});

	it("supports conditional, dependent, contains and property-name constraints", () => {
		const schema = {
			type: "object",
			propertyNames: { pattern: "^[a-z]+$" },
			properties: {
				mode: { enum: ["sync", "async"] },
				callback: { type: "string", minLength: 1 },
				values: {
					type: "array",
					contains: { type: "integer", minimum: 10 },
					minContains: 1,
					maxContains: 1,
				},
			},
			dependentRequired: { callback: ["mode"] },
			if: { properties: { mode: { const: "async" } }, required: ["mode"] },
			then: { required: ["callback"] },
			additionalProperties: false,
		};
		expect(validateWorkflowToolArguments(schema, { mode: "async", callback: "https://callback", values: [1, 10] })).toEqual([]);
		expect(validateWorkflowToolArguments(schema, { mode: "async", values: [10, 11], BadKey: true })).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: "$.callback" }),
			expect.objectContaining({ path: "$.values" }),
			expect.objectContaining({ path: "$.BadKey" }),
		]));
	});

	it("fails closed when a registered schema contains an unresolved reference", () => {
		expect(validateWorkflowToolArguments({ $ref: "#/$defs/input" }, {})).toEqual([
			{ path: "$", message: "$ cannot be validated because registered schema references are not supported" },
		]);
	});

	it("covers every JSON Schema keyword exposed by the live scoped tool catalog", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-schema-audit",
			canvasFlowId: "flow-schema-audit",
			executionId: "execution-schema-audit",
			adminWorkflowAccess: true,
		});
		const issues = tools.flatMap((tool) => tool.parameters
			? findUnsupportedWorkflowToolSchemaKeywords(tool.parameters as Record<string, unknown>)
				.map((issue) => ({ toolName: tool.name, ...issue }))
			: []);
		expect(issues).toEqual([]);
	});
});
