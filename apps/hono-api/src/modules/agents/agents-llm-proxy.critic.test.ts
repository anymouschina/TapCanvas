import { afterEach, describe, expect, it, vi } from "vitest";

import { relayCriticChat } from "./agents-llm-proxy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayCriticChat inherited protocol", () => {
	it("reads reasoning_content only when the formal chat content channel is empty", async () => {
		const structuredVerdict = '{"pass":false,"score":61}';
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: "",
								reasoning_content: structuredVerdict,
							},
						},
					],
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const text = await relayCriticChat(
			{ baseUrl: "http://new-api.internal", token: "secret" },
			{
				model: "deepseek-v4-flash",
				apiStyle: "chat",
				system: "system",
				user: "user",
				responseFormat: { type: "json_object" },
			},
		);

		expect(text).toBe(structuredVerdict);
	});

	it("prefers formal chat content over reasoning_content when both are non-empty", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: '{"source":"content"}',
								reasoning_content: '{"source":"reasoning"}',
							},
						},
					],
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const text = await relayCriticChat(
			{ baseUrl: "http://new-api.internal", token: "secret" },
			{
				model: "deepseek-v4-flash",
				apiStyle: "chat",
				system: "system",
				user: "user",
			},
		);

		expect(text).toBe('{"source":"content"}');
	});

  it("honors inherited chat apiStyle even when model-name inference would choose responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"pass":true}' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await relayCriticChat(
      { baseUrl: "http://new-api.internal", token: "secret" },
      {
        model: "gpt-inherited-chat-model",
        apiStyle: "chat",
        system: "system",
        user: "user",
        responseFormat: { type: "json_object" },
      },
    );

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://new-api.internal/v1/chat/completions");
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-inherited-chat-model",
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("text");
  });

  it("honors inherited responses apiStyle and maps structured output to text.format", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: '{"pass":true}' }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await relayCriticChat(
      { baseUrl: "http://new-api.internal", token: "secret" },
      {
        model: "deepseek-inherited-responses-model",
        apiStyle: "responses",
        system: "system",
        user: "user",
        responseFormat: { type: "json_object" },
      },
    );

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://new-api.internal/v1/responses");
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "deepseek-inherited-responses-model",
      text: { format: { type: "json_object" } },
    });
    expect(body).not.toHaveProperty("response_format");
  });
});
