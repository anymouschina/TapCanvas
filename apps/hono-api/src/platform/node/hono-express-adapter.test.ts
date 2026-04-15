import { describe, expect, it, vi } from "vitest";
import { mountHonoToExpress } from "./hono-express-adapter";

type TestRequest = {
	headers: Record<string, string>;
	method: string;
	url: string;
};

type TestResponse = {
	statusCode: number;
	headersSent: boolean;
	writableEnded: boolean;
	headerCalls: number;
	setHeader: (name: string, value: string | string[]) => void;
	end: (chunk?: string) => void;
	on: (
		event: "error" | "close" | "finish",
		listener: (error?: Error) => void,
	) => void;
};

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

		mountHonoToExpress(expressApp, honoApp, {});

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
			on() {
				return;
			},
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
});
