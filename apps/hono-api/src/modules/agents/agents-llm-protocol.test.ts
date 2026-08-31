import { describe, expect, it } from "vitest";
import {
	AgentsLlmProtocolError,
	buildChatCompletionResponse,
	buildResponsesRequestFromChat,
	extractResponsesOutputEnvelope,
	extractResponsesOutputText,
	usesResponsesApi,
} from "./agents-llm-protocol";

describe("agents LLM protocol", () => {
	it("routes GPT model keys through the Responses API", () => {
		expect(usesResponsesApi("gpt-5.4")).toBe(true);
		expect(usesResponsesApi(" GpT-5.6-sol ")).toBe(true);
		expect(usesResponsesApi("claude-sonnet-4-6")).toBe(false);
	});

	it("converts the conversation title chat request into a native Responses request", () => {
		const request = buildResponsesRequestFromChat({
			model: "gpt-5.4",
			temperature: 0.3,
			max_tokens: 32,
			messages: [
				{ role: "system", content: "你是会话标题助手。" },
				{ role: "user", content: "用户：你好\n助手：已读取画布。" },
			],
		});

		expect(request).toEqual({
			model: "gpt-5.4",
			stream: true,
			instructions: "你是会话标题助手。",
			max_output_tokens: 32,
			input: [
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "用户：你好\n助手：已读取画布。" }],
				},
			],
		});
		expect(request).not.toHaveProperty("temperature");
	});

	it("converts chat image content into Responses input_image content", () => {
		const request = buildResponsesRequestFromChat({
			model: "gpt-5.5",
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: "https://example.com/frame.png", detail: "high" } },
						{ type: "text", text: "描述画面" },
					],
				},
			],
		});
		expect(request.input).toEqual([
			{
				type: "message",
				role: "user",
				content: [
					{ type: "input_image", image_url: "https://example.com/frame.png", detail: "high" },
					{ type: "input_text", text: "描述画面" },
				],
			},
		]);
	});

	it("converts Tanva web search and reasoning fields into Responses fields", () => {
		const request = buildResponsesRequestFromChat({
			model: "gpt-5.4",
			thinking_level: "high",
			tools: [{ type: "web_search_preview" }],
			messages: [{ role: "user", content: "查找今天的公开资料" }],
		});

		expect(request).toMatchObject({
			tools: [{ type: "web_search" }],
			reasoning: { effort: "high" },
		});
	});

	it("fails explicitly for unsupported request tools", () => {
		expect(() =>
			buildResponsesRequestFromChat({
				model: "gpt-5.6",
				tools: [{ type: "function", name: "hidden_fallback" }],
				messages: [{ role: "user", content: "执行工具" }],
			}),
		).toThrow("unsupported tool type: function");
	});

	it("extracts Responses SSE deltas and returns a chat-shaped completion", () => {
		const text = extractResponsesOutputText(
			[
				'event: response.output_text.delta',
				'data: {"type":"response.output_text.delta","delta":"画布"}',
				'',
				'event: response.output_text.delta',
				'data: {"type":"response.output_text.delta","delta":"接续"}',
				'',
				'data: {"type":"response.completed","response":{"output":[]}}',
				'data: [DONE]',
			].join("\n"),
		);
		expect(text).toBe("画布接续");

		const response = buildChatCompletionResponse("gpt-5.4", text);
		expect(response.model).toBe("gpt-5.4");
		expect(response.choices).toEqual([
			{
				index: 0,
				message: { role: "assistant", content: "画布接续" },
				finish_reason: "stop",
			},
		]);
	});

	it("extracts auditable Responses metadata from a completed JSON response", () => {
		const envelope = extractResponsesOutputEnvelope(JSON.stringify({
			id: "resp_primary",
			model: "doubao-seed-2-0-lite-260428",
			status: "completed",
			previous_response_id: null,
			store: true,
			output: [{
				type: "message",
				content: [{ type: "output_text", text: "{\"version\":1}" }],
			}],
		}));

		expect(envelope).toEqual({
			id: "resp_primary",
			model: "doubao-seed-2-0-lite-260428",
			status: "completed",
			previousResponseId: null,
			store: true,
			text: '{"version":1}',
		});
	});

	it("fails explicitly for unsupported tool history", () => {
		expect(() =>
			buildResponsesRequestFromChat({
				model: "gpt-5.4",
				messages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [{ id: "call-1" }],
					},
				],
			}),
		).toThrow(AgentsLlmProtocolError);
	});
});
