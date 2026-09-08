import { describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { mountHonoToExpress } from "./hono-express-adapter";

type TestRequest = {
	headers: Record<string, string>;
	method: string;
	url: string;
	[Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array>;
};

type TestResponse = {
	statusCode: number;
	headersSent: boolean;
	writableEnded: boolean;
	headerCalls: number;
	setHeader: (name: string, value: string | string[]) => void;
	write: (chunk: Uint8Array) => boolean;
	end: (chunk?: string | Uint8Array) => void;
	once: (
		event: "drain" | "close" | "error",
		listener: (error?: Error) => void,
	) => void;
	off: (
		event: "drain" | "close" | "error",
		listener: (error?: Error) => void,
	) => void;
};

function createWorkerEnv(): WorkerEnv {
	return {
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "test-secret",
	};
}

describe("mountHonoToExpress", () => {
	it("does not attempt a second response after headers were already sent", async () => {
		let handler:
			| ((req: TestRequest, res: TestResponse) => Promise<void>)
			| undefined;
		const expressApp = {
			use(next: (req: TestRequest, res: TestResponse) => Promise<void>) {
				handler = next;
			},
		};
		const honoApp = {
			fetch: () =>
				new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: {
						"x-first-header": "ok",
						"content-type": "application/json; charset=utf-8",
					},
				}),
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mountHonoToExpress(expressApp, honoApp, createWorkerEnv());

		const res: TestResponse = {
			statusCode: 0,
			headersSent: false,
			writableEnded: false,
			headerCalls: 0,
			setHeader() {
				this.headerCalls += 1;
				if (this.headerCalls === 1) {
					this.headersSent = true;
					return;
				}
				throw new Error("Cannot set headers after they are sent to the client");
			},
			end() {
				this.writableEnded = true;
			},
			write: () => true,
			once: () => undefined,
			off: () => undefined,
		};

		await handler?.(
			{
				headers: { host: "localhost" },
				method: "GET",
				url: "/auth/phone/verify",
			},
			res,
		);

		expect(res.headerCalls).toBe(2);
		expect(errorSpy).toHaveBeenCalledWith(
			"[api] response failed after headers sent",
			expect.any(Error),
		);

		errorSpy.mockRestore();
	});

	it("streams a Node request body into Hono and writes the response bytes", async () => {
		let handler:
			| ((req: TestRequest, res: TestResponse) => Promise<void>)
			| undefined;
		const expressApp = {
			use(next: (req: TestRequest, res: TestResponse) => Promise<void>) {
				handler = next;
			},
		};
		let receivedBody = "";
		const honoApp = {
			fetch: async (request: Request) => {
				receivedBody = await request.text();
				return new Response("accepted", { status: 202 });
			},
		};
		const responseChunks: Uint8Array[] = [];
		const res: TestResponse = {
			statusCode: 0,
			headersSent: false,
			writableEnded: false,
			headerCalls: 0,
			setHeader() {
				this.headerCalls += 1;
			},
			write(chunk) {
				responseChunks.push(chunk);
				return true;
			},
			end() {
				this.writableEnded = true;
			},
			once: () => undefined,
			off: () => undefined,
		};

		mountHonoToExpress(expressApp, honoApp, createWorkerEnv());
		await handler?.(
			{
				headers: { host: "localhost", "content-type": "application/json" },
				method: "POST",
				url: "/echo",
				async *[Symbol.asyncIterator]() {
					yield new TextEncoder().encode('{"ok":true}');
				},
			},
			res,
		);

		expect(receivedBody).toBe('{"ok":true}');
		expect(res.statusCode).toBe(202);
		expect(new TextDecoder().decode(responseChunks[0])).toBe("accepted");
		expect(res.writableEnded).toBe(true);
	});

	it("settles when the client closes while response backpressure is active", async () => {
		let handler:
			| ((req: TestRequest, res: TestResponse) => Promise<void>)
			| undefined;
		const expressApp = {
			use(next: (req: TestRequest, res: TestResponse) => Promise<void>) {
				handler = next;
			},
		};
		const listeners = new Map<
			"drain" | "close" | "error",
			(error?: Error) => void
		>();
		const res: TestResponse = {
			statusCode: 0,
			headersSent: false,
			writableEnded: false,
			headerCalls: 0,
			setHeader() {
				this.headerCalls += 1;
			},
			write() {
				this.headersSent = true;
				queueMicrotask(() => listeners.get("close")?.());
				return false;
			},
			end() {
				this.writableEnded = true;
			},
			once(event, listener) {
				listeners.set(event, listener);
			},
			off(event, listener) {
				if (listeners.get(event) === listener) listeners.delete(event);
			},
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mountHonoToExpress(expressApp, {
			fetch: () => new Response("stream body"),
		}, createWorkerEnv());
		const result = await Promise.race([
			handler?.(
				{ headers: { host: "localhost" }, method: "GET", url: "/stream" },
				res,
			).then(() => "settled"),
			new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 50)),
		]);

		expect(result).toBe("settled");
		expect(errorSpy).toHaveBeenCalledWith(
			"[api] response failed after headers sent",
			expect.any(Error),
		);
		errorSpy.mockRestore();
	});
});
