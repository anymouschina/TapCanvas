import { describe, expect, it } from "vitest";

import {
	buildToolOperationIndexParameters,
	projectToolParametersBySelector,
	readToolSchemaOperationIndex,
} from "./agents-tool-schema-projection";

describe("projectToolParametersBySelector", () => {
	it("returns only the selected operation contract and its declared optional fields", () => {
		const projected = projectToolParametersBySelector({
			parameters: {
				type: "object",
				properties: {
					mode: { type: "string", enum: ["read", "write"] },
					id: { type: "string" },
					payload: { type: "object" },
					revision: { type: "string" },
					unrelated: { type: "string" },
				},
				oneOf: [
					{ properties: { mode: { const: "read" } }, required: ["mode", "id"] },
					{
						properties: { mode: { const: "write" } },
						required: ["mode", "id", "payload"],
						xOptionalProperties: ["revision"],
					},
				],
			},
			selector: { field: "mode", value: "write" },
		});

		expect(projected.required).toEqual(["mode", "id", "payload"]);
		expect(projected.properties).toEqual({
			mode: { type: "string", const: "write" },
			id: { type: "string" },
			payload: { type: "object" },
			revision: { type: "string" },
		});
		expect((projected.properties as Record<string, unknown>).unrelated).toBeUndefined();
	});

	it("fails explicitly for an unsupported selector", () => {
		expect(() =>
			projectToolParametersBySelector({
				parameters: {
					type: "object",
					oneOf: [
						{ properties: { mode: { const: "read" } }, required: ["mode"] },
						{ properties: { mode: { const: "write" } }, required: ["mode"] },
					],
				},
				selector: { field: "mode", value: "missing" },
			}),
		).toThrow(
			"tool_schema_selector_not_found: mode=missing; operationIndex.field=mode; operationIndex.values=[read,write]",
		);
	});

	it("discovers a generic operation discriminator without reading business text", () => {
		const parameters = {
			type: "object",
			properties: { operation: { type: "string", enum: ["alpha", "beta"] } },
			oneOf: [
				{ properties: { operation: { const: "alpha" }, version: { const: "v1" } }, required: ["operation"] },
				{ properties: { operation: { const: "beta" }, version: { const: "v1" } }, required: ["operation"] },
			],
		};
		const index = readToolSchemaOperationIndex(parameters);
		expect(index).toEqual({ field: "operation", values: ["alpha", "beta"] });
		const lightweight = buildToolOperationIndexParameters({ parameters, index: index! });
		expect(lightweight.properties).toEqual({});
		expect(lightweight).not.toHaveProperty("oneOf");
	});

	it("indexes every operation when one structural branch groups multiple values", () => {
		const index = readToolSchemaOperationIndex({
			type: "object",
			oneOf: [
				{ properties: { mode: { const: "compile" } }, required: ["mode"] },
				{
					properties: { mode: { enum: ["start", "status", "resume"] } },
					required: ["mode"],
				},
			],
		});

		expect(index).toEqual({ field: "mode", values: ["compile", "start", "status", "resume"] });
	});
});
