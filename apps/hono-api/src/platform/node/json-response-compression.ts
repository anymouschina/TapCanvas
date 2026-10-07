import type { MiddlewareHandler } from "hono";
import { compress } from "hono/compress";

function acceptsGzip(header: string | undefined): boolean {
	const encodings = new Map<string, number>();
	for (const token of (header ?? "").split(",")) {
		const [name, ...parameters] = token.trim().toLowerCase().split(";");
		if (!name) continue;
		const quality = parameters.map((part) => part.trim().split("="))
			.find(([key]) => key === "q")?.[1];
		const weight = quality === undefined ? 1 : Number(quality);
		encodings.set(name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0);
	}
	return (encodings.get("gzip") ?? encodings.get("*") ?? 0) > 0;
}

/** Opt in for JSON read endpoints only; never wrap event streams. */
export const compressJsonResponse: MiddlewareHandler = async (context, next) => {
	if (acceptsGzip(context.req.header("Accept-Encoding"))) {
		await compress({ encoding: "gzip" })(context, next);
	} else {
		await next();
	}
	const vary = context.res.headers.get("Vary");
	const names = (vary ?? "").split(",").map((name) => name.trim().toLowerCase());
	if (!names.includes("*") && !names.includes("accept-encoding")) {
		context.res.headers.set("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
	}
};
