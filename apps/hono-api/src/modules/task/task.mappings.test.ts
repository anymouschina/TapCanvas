import { describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import {
	buildMappedUpstreamRequest,
	parseMappedTaskResultFromPayload,
	selectEnabledModelCatalogMappingForRequest,
} from "./task.mappings";

const mockContext = {} as AppContext;

describe("task.mappings request_profile v2", () => {
	it("selects the mapping row that explicitly matches the model key", () => {
		const mappings = [
			{
				id: "latest-generic",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "generic-openai-video",
				requestMapping: {
					enabled: true,
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
						},
					},
				},
				responseMapping: null,
			},
			{
				id: "kling-omni",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "kling-omni-video",
				requestMapping: {
					enabled: true,
					version: "v2",
					when: {
						equals: {
							left: "model.model_key",
							value: "kling-video-o1",
						},
					},
					create: {
						default: {
							method: "POST",
							path: "/kling/v1/videos/omni-video",
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			stage: "create",
			req: {
				kind: "text_to_video",
				prompt: "test",
				extras: {
					modelKey: "kling-video-o1",
				},
			},
			modelKey: "kling-video-o1",
		});

		expect(selected?.id).toBe("kling-omni");
	});

	it("falls back to the generic mapping when a newer specialized mapping does not match", () => {
		const mappings = [
			{
				id: "seedream-specialized",
				vendorKey: "yunwu",
				taskKind: "text_to_image" as const,
				name: "yunwu-seedream-5-text-to-image",
				requestMapping: {
					version: "v2",
					match: {
						all: [
							{
								equals: {
									left: "request.kind",
									value: "text_to_image",
								},
							},
							{
								equals: {
									left: "model.model_key",
									value: "doubao-seedream-5-0-260128",
								},
							},
						],
					},
					create: {
						default: {
							method: "POST",
							path: "/v1/images/generations",
						},
					},
				},
				responseMapping: null,
			},
			{
				id: "generic-gemini",
				vendorKey: "yunwu",
				taskKind: "text_to_image" as const,
				name: "默认映射",
				requestMapping: {
					create: {
						default: {
							method: "POST",
							path: "/v1beta/models/${modelKey}:generateContent",
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			stage: "create",
			req: {
				kind: "text_to_image",
				prompt: "test",
				extras: {
					modelKey: "gemini-2.5-flash-image",
				},
			},
			modelKey: "gemini-2.5-flash-image",
		});

		expect(selected?.id).toBe("generic-gemini");
	});

	it("skips a newer fixed-model video mapping when the requested model key targets another mapping", () => {
		const mappings = [
			{
				id: "seedance-fixed",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "yunwu-seedance-video",
				requestMapping: {
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
							body: {
								model: "doubao-seedance-2-0-pro-250528",
								prompt: "{{request.prompt}}",
							},
						},
					},
				},
				responseMapping: null,
			},
			{
				id: "veo-generic",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "yunwu-openai-video",
				requestMapping: {
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
							body: {
								model: "{{model.model_key}}",
								prompt: "{{request.prompt}}",
							},
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			stage: "create",
			req: {
				kind: "text_to_video",
				prompt: "test",
				extras: {
					modelKey: "veo3.1-pro",
				},
			},
			modelKey: "veo3.1-pro",
		});

		expect(selected?.id).toBe("veo-generic");
	});

	it("prefers the fixed-model video mapping when the requested model key matches it exactly", () => {
		const mappings = [
			{
				id: "generic-video",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "yunwu-openai-video",
				requestMapping: {
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
							body: {
								model: "{{model.model_key}}",
								prompt: "{{request.prompt}}",
							},
						},
					},
				},
				responseMapping: null,
			},
			{
				id: "seedance-fixed",
				vendorKey: "yunwu",
				taskKind: "text_to_video" as const,
				name: "yunwu-seedance-video",
				requestMapping: {
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
							body: {
								model: "doubao-seedance-2-0-pro-250528",
								prompt: "{{request.prompt}}",
							},
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			stage: "create",
			req: {
				kind: "text_to_video",
				prompt: "test",
				extras: {
					modelKey: "doubao-seedance-2-0-pro-250528",
				},
			},
			modelKey: "doubao-seedance-2-0-pro-250528",
		});

		expect(selected?.id).toBe("seedance-fixed");
	});

	it("returns null when all mappings are specialized and none match", () => {
		const mappings = [
			{
				id: "seedream-only",
				vendorKey: "yunwu",
				taskKind: "text_to_image" as const,
				name: "yunwu-seedream-5-text-to-image",
				requestMapping: {
					version: "v2",
					match: {
						equals: {
							left: "model.model_key",
							value: "doubao-seedream-5-0-260128",
						},
					},
					create: {
						default: {
							method: "POST",
							path: "/v1/images/generations",
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			stage: "create",
			req: {
				kind: "text_to_image",
				prompt: "test",
				extras: {
					modelKey: "gemini-2.5-flash-image",
				},
			},
			modelKey: "gemini-2.5-flash-image",
		});

		expect(selected).toBeNull();
	});

	it("reuses the preferred mapping id during later selection", () => {
		const mappings = [
			{
				id: "generic-openai",
				vendorKey: "yunwu",
				taskKind: "image_to_video" as const,
				name: "generic-openai-video",
				requestMapping: {
					enabled: true,
					version: "v2",
					create: {
						default: {
							method: "POST",
							path: "/v1/videos",
						},
					},
					result: {
						default: {
							method: "GET",
							path: "/v1/videos/{{task.id}}",
						},
					},
				},
				responseMapping: null,
			},
			{
				id: "kling-image2video",
				vendorKey: "yunwu",
				taskKind: "image_to_video" as const,
				name: "kling-image2video",
				requestMapping: {
					enabled: true,
					version: "v2",
					when: {
						equals: {
							left: "model.model_key",
							value: "kling-video-o1",
						},
					},
					create: {
						default: {
							method: "POST",
							path: "/kling/v1/videos/omni-video",
						},
					},
					result: {
						default: {
							method: "GET",
							path: "/kling/v1/videos/omni-video/{{task.id}}",
						},
					},
				},
				responseMapping: null,
			},
		];

		const selected = selectEnabledModelCatalogMappingForRequest(mappings, {
			preferredMappingId: "kling-image2video",
			stage: "result",
			req: {
				kind: "image_to_video",
				prompt: "",
				extras: {},
			},
			taskId: "task_123",
		});

		expect(selected?.id).toBe("kling-image2video");
	});

	it("selects v2 candidates, extracts provider meta, and reuses query_id for polling", async () => {
		const requestProfile = {
			enabled: true,
			version: "v2",
			status_mapping: {
				running: ["running", "processing"],
				succeeded: ["success", "completed"],
				failed: ["failed", "error"],
			},
			create: {
				candidates: [
					{
						name: "by_image",
						when: { exists: "request.params.images" },
						method: "POST",
						path: "/v1/video/createVideoByImage",
						headers: {
							"Content-Type": "application/json",
						},
						body: {
							prompt: "{{request.prompt}}",
							images: "{{request.params.images}}",
							model: "{{model.model_key}}",
						},
						response_mapping: {
							task_id: ["data.task_id", "task_id"],
							status: ["data.status", "status"],
						},
						provider_meta_mapping: {
							query_id: ["data.task_id", "task_id"],
						},
					},
				],
				default: {
					name: "by_text",
					method: "POST",
					path: "/v1/video/create",
					headers: {
						"Content-Type": "application/json",
					},
					body: {
						prompt: "{{request.prompt}}",
						model: "{{model.model_key}}",
					},
					response_mapping: {
						task_id: ["data.task_id", "task_id"],
						status: ["data.status", "status"],
					},
					provider_meta_mapping: {
						query_id: ["data.task_id", "task_id"],
					},
				},
			},
			query: {
				default: {
					name: "query_status",
					method: "GET",
					path: "/v1/video/query/{{providerMeta.query_id}}",
					query: {},
					response_mapping: {
						status: ["data.status", "status"],
						video_url: ["data.output", "output"],
					},
				},
			},
		};

		const createRequest = await buildMappedUpstreamRequest({
			c: mockContext,
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			auth: { authType: "bearer", authHeader: null, authQueryParam: null },
			stage: "create",
			requestMapping: requestProfile,
			req: {
				kind: "image_to_video",
				prompt: "让小猫跳起来",
				extras: {
					images: ["https://example.com/frame.png"],
					modelKey: "veo3-fast",
				},
			},
		});

		expect(createRequest.url).toBe("https://api.example.com/v1/video/createVideoByImage");
		expect(createRequest.requestLog.jsonBody).toEqual({
			prompt: "让小猫跳起来",
			images: ["https://example.com/frame.png"],
			model: "veo3-fast",
		});

		const createParsed = parseMappedTaskResultFromPayload({
			vendorKey: "acme",
			model: "veo3-fast",
			stage: "create",
			reqKind: "image_to_video",
			payload: {
				data: {
					task_id: "query_123",
					status: "processing",
				},
			},
			responseMapping: requestProfile,
			selectedStageMapping: createRequest.selectedStageMapping,
		});

		expect(createParsed.id).toBe("query_123");
		expect(createParsed.status).toBe("running");
		expect(
			(createParsed.raw as { pid?: string | null; providerMeta?: { query_id?: string } | null }).pid,
		).toBe("query_123");
		expect(
			(createParsed.raw as { providerMeta?: { query_id?: string } | null }).providerMeta?.query_id,
		).toBe("query_123");

		const resultRequest = await buildMappedUpstreamRequest({
			c: mockContext,
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			auth: { authType: "bearer", authHeader: null, authQueryParam: null },
			stage: "result",
			requestMapping: requestProfile,
			req: {
				kind: "image_to_video",
				prompt: "",
				extras: {},
			},
			taskId: "query_123",
		});

		expect(resultRequest.url).toBe("https://api.example.com/v1/video/query/query_123");

		const resultParsed = parseMappedTaskResultFromPayload({
			vendorKey: "acme",
			model: "veo3-fast",
			stage: "result",
			reqKind: "image_to_video",
			payload: {
				data: {
					status: "completed",
					output: "https://cdn.example.com/video.mp4",
				},
			},
			responseMapping: requestProfile,
			fallbackTaskId: "query_123",
			selectedStageMapping: resultRequest.selectedStageMapping,
		});

		expect(resultParsed.status).toBe("succeeded");
		expect(resultParsed.assets).toEqual([
			{
				type: "video",
				url: "https://cdn.example.com/video.mp4",
				thumbnailUrl: null,
			},
		]);
	});

	it("supports openai-compatible request_profile v2 with multimodal messages and null query body", async () => {
		const requestProfile = {
			enabled: true,
			version: "v2",
			status_mapping: {
				failed: ["error", "failed", "timeout", "expired"],
				succeeded: ["stop", "length"],
			},
			query: {
				body: null,
				path: "/health",
				query: {},
				method: "GET",
				default: {
					body: null,
					name: "query_cached_sync_result",
					path: "/health",
					when: null,
					query: {},
					method: "GET",
					headers: {
						Authorization: "Bearer {{account.account_key}}",
					},
					allow_get_body: false,
					status_mapping: {},
					response_mapping: {
						status: ["status"],
					},
					provider_meta_mapping: {},
				},
				headers: {
					Authorization: "Bearer {{account.account_key}}",
				},
				candidates: [],
				allow_get_body: false,
				status_mapping: {},
				response_mapping: {
					status: ["status"],
				},
				provider_meta_mapping: {},
			},
			create: {
				body: {
					model: "{{model.model_key}}",
					messages: [
						{
							role: "user",
							content: [
								{
									text: "{{request.prompt}}",
									type: "text",
								},
							],
						},
					],
					max_tokens: "{{request.params.max_tokens}}",
				},
				path: "/v1/chat/completions",
				query: {},
				method: "POST",
				default: {
					body: {
						model: "{{model.model_key}}",
						messages: [
							{
								role: "user",
								content: [
									{
										text: "{{request.prompt}}",
										type: "text",
									},
								],
							},
						],
						max_tokens: "{{request.params.max_tokens}}",
					},
					name: "create_text_only",
					path: "/v1/chat/completions",
					when: null,
					query: {},
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						Authorization: "Bearer {{account.account_key}}",
					},
					allow_get_body: false,
					status_mapping: {},
					response_mapping: {
						assets: ["choices.0.message.content"],
						status: ["choices.0.finish_reason"],
						task_id: ["id"],
					},
					provider_meta_mapping: {},
				},
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					Authorization: "Bearer {{account.account_key}}",
				},
				candidates: [
					{
						body: {
							model: "{{model.model_key}}",
							messages: [
								{
									role: "user",
									content: [
										{
											text: "{{request.prompt}}",
											type: "text",
										},
										{
											type: "image_url",
											image_url: {
												url: "{{request.params.image_url}}",
											},
										},
									],
								},
							],
							max_tokens: "{{request.params.max_tokens}}",
						},
						name: "create_with_image",
						path: "/v1/chat/completions",
						when: {
							exists: "request.params.image_url",
						},
						query: {},
						method: "POST",
						headers: {
							Accept: "application/json",
							"Content-Type": "application/json",
							Authorization: "Bearer {{account.account_key}}",
						},
						allow_get_body: false,
						status_mapping: {},
						response_mapping: {
							assets: ["choices.0.message.content"],
							status: ["choices.0.finish_reason"],
							task_id: ["id"],
						},
						provider_meta_mapping: {},
					},
				],
				allow_get_body: false,
				status_mapping: {},
				response_mapping: {
					assets: ["choices.0.message.content"],
					status: ["choices.0.finish_reason"],
					task_id: ["id"],
				},
				provider_meta_mapping: {},
			},
		};

		const createRequest = await buildMappedUpstreamRequest({
			c: mockContext,
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			auth: { authType: "bearer", authHeader: null, authQueryParam: null },
			stage: "create",
			requestMapping: requestProfile,
			req: {
				kind: "image_to_prompt",
				prompt: "描述这张图",
				extras: {
					image_url: "https://example.com/reference.png",
					max_tokens: 512,
					modelKey: "gpt-4.1-mini",
				},
			},
		});

		expect(createRequest.url).toBe("https://api.example.com/v1/chat/completions");
		expect(createRequest.requestLog.jsonBody).toEqual({
			model: "gpt-4.1-mini",
			messages: [
				{
					role: "user",
					content: [
						{
							text: "描述这张图",
							type: "text",
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/reference.png",
							},
						},
					],
				},
			],
			max_tokens: 512,
		});

		const createParsed = parseMappedTaskResultFromPayload({
			vendorKey: "openai",
			model: "gpt-4.1-mini",
			stage: "create",
			reqKind: "image_to_prompt",
			payload: {
				id: "chatcmpl_123",
				choices: [
					{
						finish_reason: "length",
						message: {
							content: "这是一个同步返回的文本结果",
						},
					},
				],
			},
			responseMapping: requestProfile,
			selectedStageMapping: createRequest.selectedStageMapping,
		});

		expect(createParsed.id).toBe("chatcmpl_123");
		expect(createParsed.status).toBe("succeeded");

		const queryRequest = await buildMappedUpstreamRequest({
			c: mockContext,
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			auth: { authType: "bearer", authHeader: null, authQueryParam: null },
			stage: "result",
			requestMapping: requestProfile,
			req: {
				kind: "image_to_prompt",
				prompt: "",
				extras: {},
			},
			taskId: "chatcmpl_123",
		});

		expect(queryRequest.url).toBe("https://api.example.com/health");
		expect(queryRequest.init.method).toBe("GET");
		expect(queryRequest.init.body).toBeUndefined();
	});

	it("parses yunwu video result payloads with succeed status and nested videos", () => {
		const parsed = parseMappedTaskResultFromPayload({
			vendorKey: "yunwu",
			model: "kling-video-o1",
			stage: "result",
			reqKind: "text_to_video",
			payload: {
				data: {
					task_id: "866162325110825012",
					task_status: "succeed",
					task_result: {
						videos: [
							{
								url: "https://cdn.example.com/final.mp4",
							},
						],
					},
				},
			},
			responseMapping: {
				status: ["data.task_status"],
				assets: {
					type: "video",
					urls: ["data.task_result.videos[*].url"],
				},
				task_id: ["data.task_id"],
			},
		});

		expect(parsed.id).toBe("866162325110825012");
		expect(parsed.status).toBe("succeeded");
		expect(parsed.assets).toEqual([
			{
				type: "video",
				url: "https://cdn.example.com/final.mp4",
				thumbnailUrl: null,
			},
		]);
	});

	it("keeps the full signed firstFrameUrl and surfaces upstream fetch error details", async () => {
		const signedUrl =
			"https://ark-common-storage-prod-ap-southeast-1.tos-ap-southeast-1.volces.com/seedream/example/2026-03-29/sample.jpeg?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Content-Sha256=UNSIGNED-PAYLOAD&X-Tos-Credential=EXAMPLE_ACCESS_KEY_ID%2F20260329%2Ftos-ap-southeast-1.volces.com%2Ftos-ap-southeast-1.volces.com%2Ftos%2Frequest&X-Tos-Date=20260329T142006Z&X-Tos-Expires=604800&X-Tos-SignedHeaders=host&X-Tos-Signature=example-signature";
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						Code: "AuthorizationHeaderMalformed",
						Message:
							'The authorization header is malformed; the Credential is mal-formed; expecting "<YOUR-AKID>/YYYYMMDD/REGION/SERVICE/request".',
					}),
					{
						status: 400,
						headers: {
							"content-type": "application/json",
						},
					},
				),
			);

		try {
			let thrown: unknown = null;
			try {
				await buildMappedUpstreamRequest({
					c: { env: {} } as AppContext,
					baseUrl: "https://api.example.com",
					apiKey: "sk-test",
					auth: { authType: "bearer", authHeader: null, authQueryParam: null },
					stage: "create",
					requestMapping: {
						enabled: true,
						version: "v2",
						create: {
							default: {
								method: "POST",
								path: "/v1/videos",
								contentType: "multipart",
								formData: {
									model: "{{model.model_key}}",
									input_reference: {
										transform: "fetchAsFile",
										from: "request.extras.firstFrameUrl",
									},
								},
							},
						},
					},
					req: {
						kind: "image_to_video",
						prompt: "test",
						extras: {
							modelKey: "veo3-fast",
							firstFrameUrl: signedUrl,
						},
					},
				});
			} catch (error) {
				thrown = error;
			}

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(fetchSpy.mock.calls[0]?.[0]).toBe(signedUrl);
			expect(thrown).toMatchObject({
				name: "AppError",
				code: "mapping_fetchAsFile_fetch_failed",
				details: {
					upstreamStatus: 400,
					upstreamCode: "AuthorizationHeaderMalformed",
				},
			});
			expect((thrown as Error).message).toContain("AuthorizationHeaderMalformed");
			expect((thrown as Error).message).toContain("Credential is mal-formed");
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
