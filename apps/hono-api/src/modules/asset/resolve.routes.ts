import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { findAssetUri } from "../task/asset-uri.repo";

export const resolveRouter = new Hono<AppEnv>();
resolveRouter.use("*", authMiddleware);

function parseTapCanvasUri(uri: string): { type: string; id: string } | null {
	const match = uri.match(/^tapcanvas:\/\/(image|video|audio)\/([^?#]+)$/);
	if (!match) return null;
	return { type: match[1], id: match[2] };
}

resolveRouter.get("/", async (c) => {
	const uri = c.req.query("uri") ?? "";
	if (!uri) return c.json({ error: "uri param required" }, 400);

	if (!uri.startsWith("tapcanvas://")) {
		return c.json({ cdnUrl: uri, passthrough: true });
	}

	const parsed = parseTapCanvasUri(uri);
	if (!parsed) return c.json({ error: "unsupported_uri_type" }, 400);

	const row = await findAssetUri(parsed.id);
	if (!row) return c.json({ error: "not_found" }, 404);

	return c.json({
		cdnUrl: row.cdn_url,
		type: row.type,
		taskId: row.task_id ?? null,
		nodeId: row.node_id ?? null,
	});
});
