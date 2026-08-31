import { describe, expect, it, vi } from "vitest";

import type { S3Client } from "@aws-sdk/client-s3";

import type { AppContext } from "../../types";
import { prepareImageReferenceTransport } from "./image-reference-hosting";

const context = {
	env: {
		OBJECT_STORAGE_PROVIDER: "tos",
		TOS_ACCESS_KEY_ID: "key",
		TOS_SECRET_ACCESS_KEY: "secret",
		TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
		TOS_REGION: "cn-guangzhou",
		TOS_BUCKET: "bucket",
		TOS_PUBLIC_BASE_URL: "https://cdn.tapcanvas.test",
	},
} as AppContext;

const client = { send: vi.fn() } as unknown as S3Client;

describe("prepareImageReferenceTransport", () => {
	it("keeps active object-storage URLs without downloading or uploading", async () => {
		const fetchMock = vi.fn();
		const upload = vi.fn();
		const result = await prepareImageReferenceTransport({
			c: context,
			userId: "user-1",
			urls: ["https://cdn.tapcanvas.test/gen/images/frame.png"],
			dependencies: {
				fetch: fetchMock as unknown as typeof fetch,
				createClient: () => client,
				upload,
			},
		});

		expect(result).toEqual([
			{
				sourceUrl: "https://cdn.tapcanvas.test/gen/images/frame.png",
				transportUrl: "https://cdn.tapcanvas.test/gen/images/frame.png",
				hosted: false,
			},
		]);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});

	it("redacts signed URL query parameters from transport logs", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		try {
			const result = await prepareImageReferenceTransport({
				c: context,
				userId: "user-1",
				urls: ["https://cdn.tapcanvas.test/gen/images/frame.png?token=secret#preview"],
				dependencies: {
					createClient: () => client,
				},
			});

			expect(result[0]?.sourceUrl).toContain("token=secret");
			expect(info).toHaveBeenCalledWith(
				"[image-reference-transport]",
				JSON.stringify({
					sourceUrl: "https://cdn.tapcanvas.test/gen/images/frame.png",
					transportUrl: "https://cdn.tapcanvas.test/gen/images/frame.png",
					hosted: false,
				}),
			);
		} finally {
			info.mockRestore();
		}
	});

	it("copies external image bytes to a new immutable object key", async () => {
		const upload = vi.fn().mockResolvedValue(undefined);
		const result = await prepareImageReferenceTransport({
			c: context,
			userId: "user-1",
			urls: ["https://legacy.test/frame.png"],
			dependencies: {
				fetch: vi.fn().mockResolvedValue(
					new Response(new Uint8Array([1, 2, 3]), {
						status: 200,
						headers: { "content-type": "image/png" },
					}),
				),
				createClient: () => client,
				upload,
				randomId: () => "new-object-id",
			},
		});

		expect(result[0]).toMatchObject({
			sourceUrl: "https://legacy.test/frame.png",
			transportUrl: expect.stringMatching(
				/^https:\/\/cdn\.tapcanvas\.test\/gen\/reference-transport\/user-1\/\d{8}\/new-object-id\.png$/,
			),
			hosted: true,
		});
		expect(upload).toHaveBeenCalledWith(
			expect.objectContaining({
				bucket: "bucket",
				contentType: "image/png",
				contentLength: 3,
			}),
		);
	});

	it("fails explicitly for an inaccessible reference before upload", async () => {
		const upload = vi.fn();
		await expect(
			prepareImageReferenceTransport({
				c: context,
				userId: "user-1",
				urls: ["https://legacy.test/missing.png"],
				dependencies: {
					fetch: vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
					createClient: () => client,
					upload,
				},
			}),
		).rejects.toMatchObject({ code: "image_reference_transport_download_failed" });
		expect(upload).not.toHaveBeenCalled();
	});

	it("rejects a non-image response instead of forwarding it upstream", async () => {
		await expect(
			prepareImageReferenceTransport({
				c: context,
				userId: "user-1",
				urls: ["https://legacy.test/not-image"],
				dependencies: {
					fetch: vi.fn().mockResolvedValue(
						new Response("html", {
							status: 200,
							headers: { "content-type": "text/html" },
						}),
					),
					createClient: () => client,
				},
			}),
		).rejects.toMatchObject({ code: "image_reference_transport_content_type_invalid" });
	});
});
