import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateSoraVideoRequestSchema,
	CreateSoraVideoResponseSchema,
	ComflyCreateCharacterRequestSchema,
	ComflyCreateCharacterResponseSchema,
	SoraDraftListSchema,
	SoraVideoDraftResponseSchema,
	PublishSoraVideoRequestSchema,
	PublishSoraVideoResponseSchema,
	UnwatermarkVideoRequestSchema,
	UnwatermarkVideoResponseSchema,
} from "./sora.schemas";
import {
	checkCharacterUsername,
	createComflyCharacterFromVideo,
	createSoraVideoTask,
	deleteSoraCharacter,
	deleteSoraDraft,
	finalizeCharacter,
	getCameoStatus,
	getSoraVideoDraftByTask,
	listSoraCharacters,
	listSoraDrafts,
	listSoraPendingVideos,
	listSoraPublishedVideos,
	publishSoraVideo,
	uploadCharacterViaSora2Api,
	createCharacterFromPidViaSora2Api,
	fetchSora2ApiCharacterResult,
	searchSoraMentions,
	setCameoPublic,
	unwatermarkVideo,
	uploadCharacterVideo,
	uploadProfileAsset,
	uploadSoraImage,
	updateSoraCharacter,
} from "./sora.service";
import { listSoraVideoHistory } from "./sora.history";

export const soraRouter = new Hono<AppEnv>();

soraRouter.use("*", authMiddleware);

soraRouter.post("/video/unwatermark", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UnwatermarkVideoRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const result = await unwatermarkVideo(c, parsed.data.url);
	const validated = UnwatermarkVideoResponseSchema.parse(result);
	return c.json(validated);
});

soraRouter.post("/video/create", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateSoraVideoRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createSoraVideoTask(c, userId, parsed.data);
	const validated = CreateSoraVideoResponseSchema.parse(result);
	return c.json(validated);
});

soraRouter.get("/video/pending", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const items = await listSoraPendingVideos(c, userId);
	// Frontend accepts either [] or { items: [] }
	return c.json(items);
});

soraRouter.get("/drafts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || undefined;
	const cursor = c.req.query("cursor") || undefined;
	const result = await listSoraDrafts(c, userId, {
		tokenId,
		cursor,
	});
	const validated = SoraDraftListSchema.parse(result);
	return c.json(validated);
});

soraRouter.get("/drafts/delete", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || "";
	const draftId = c.req.query("draftId") || "";
	if (!tokenId || !draftId) {
		return c.json(
			{ error: "tokenId and draftId are required" },
			400,
		);
	}
	await deleteSoraDraft(c, userId, { tokenId, draftId });
	return c.body(null, 204);
});

soraRouter.get("/video/draft-by-task", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || undefined;
	const taskId = c.req.query("taskId") || "";
	if (!taskId) {
		return c.json(
			{ error: "taskId is required" },
			400,
		);
	}
	const result = await getSoraVideoDraftByTask(c, userId, {
		tokenId,
		taskId,
	});
	const validated = SoraVideoDraftResponseSchema.parse(result);
	return c.json(validated);
});

soraRouter.get("/characters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || undefined;
	const cursor = c.req.query("cursor") || undefined;
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const result = await listSoraCharacters(c, userId, {
		tokenId,
		cursor,
		limit,
	});
	return c.json(result);
});

soraRouter.post("/comfly/v1/characters", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ComflyCreateCharacterRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await createComflyCharacterFromVideo(c, userId, parsed.data);
	const validated = ComflyCreateCharacterResponseSchema.parse(result);
	return c.json(validated);
});

soraRouter.get("/characters/delete", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || "";
	const characterId = c.req.query("characterId") || "";
	if (!tokenId || !characterId) {
		return c.json(
			{ error: "tokenId and characterId are required" },
			400,
		);
	}
	await deleteSoraCharacter(c, userId, {
		tokenId,
		characterId,
	});
	return c.body(null, 204);
});

soraRouter.post("/characters/check-username", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const tokenId =
		typeof body.tokenId === "string" ? (body.tokenId as string) : undefined;
	const username = typeof body.username === "string" ? body.username : "";
	if (!username) {
		return c.json(
			{ error: "username is required" },
			400,
		);
	}
	const result = await checkCharacterUsername(c, userId, {
		tokenId,
		username,
	});
	return c.json(result);
});

soraRouter.post("/characters/update", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const tokenId = body.tokenId as string | undefined;
	const characterId = body.characterId as string | undefined;
	if (!tokenId || !characterId) {
		return c.json(
			{ error: "tokenId and characterId are required" },
			400,
		);
	}
	const payload = {
		tokenId,
		characterId,
		username: body.username as string | undefined,
		display_name: body.display_name as string | null | undefined,
		profile_asset_pointer: body.profile_asset_pointer,
	};
	const result = await updateSoraCharacter(c, userId, payload);
	return c.json(result);
});

soraRouter.post("/characters/upload", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const form = await c.req.formData();
	const tokenId = form.get("tokenId");
	const file = form.get("file");
	const timestamps = form.get("timestamps");

	if (!(file instanceof File)) {
		return c.json({ error: "file is required" }, 400);
	}
	if (typeof tokenId !== "string" || !tokenId) {
		return c.json({ error: "tokenId is required" }, 400);
	}
	const [startStr, endStr] =
		typeof timestamps === "string" ? timestamps.split(",") : ["0", "0"];
	const start = Number(startStr) || 0;
	const end = Number(endStr) || 0;

	const result = await uploadCharacterVideo(c, userId, {
		tokenId,
		file,
		range: [start, end],
	});
	return c.json(result);
});

soraRouter.post("/sora2api/characters/upload", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const url = typeof body.url === "string" ? body.url.trim() : "";
	if (!url) return c.json({ error: "url is required" }, 400);
	const vendorRaw = typeof body.vendor === "string" ? body.vendor.trim() : "";
	const vendor = vendorRaw.toLowerCase() === "grsai" ? "grsai" : "sora2api";
	const timestamps =
		typeof body.timestamps === "string" && body.timestamps.trim()
			? body.timestamps.trim()
			: undefined;
	const webHook =
		typeof body.webHook === "string" && body.webHook.trim()
			? body.webHook.trim()
			: undefined;
	const shutProgress = body.shutProgress === true;
	const result = await uploadCharacterViaSora2Api(c, userId, {
		url,
		timestamps,
		webHook,
		shutProgress,
		vendor,
	});
	if (vendor === "grsai") {
		(result as any).vendor = "grsai";
	}
	return c.json(result);
});

soraRouter.post("/sora2api/characters/create", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const pid = typeof body.pid === "string" ? body.pid.trim() : "";
	if (!pid) return c.json({ error: "pid is required" }, 400);
	const timestamps =
		typeof body.timestamps === "string" && body.timestamps.trim()
			? body.timestamps.trim()
			: undefined;
	const webHook =
		typeof body.webHook === "string" && body.webHook.trim()
			? body.webHook.trim()
			: undefined;
	const shutProgress = body.shutProgress === true;
	const result = await createCharacterFromPidViaSora2Api(c, userId, {
		pid,
		timestamps,
		webHook,
		shutProgress,
	});
	return c.json(result);
});

soraRouter.post("/sora2api/characters/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
	if (!taskId) return c.json({ error: "taskId is required" }, 400);
	const result = await fetchSora2ApiCharacterResult(c, userId, taskId);
	return c.json(result);
});

soraRouter.get("/cameos/in-progress", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || "";
	const id = c.req.query("id") || "";
	if (!tokenId || !id) {
		return c.json(
			{ error: "tokenId and id are required" },
			400,
		);
	}
	const result = await getCameoStatus(c, userId, { tokenId, id });
	return c.json(result);
});

soraRouter.post("/characters/finalize", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const tokenId = body.tokenId as string | undefined;
	if (typeof tokenId !== "string" || !tokenId) {
		return c.json({ error: "tokenId is required" }, 400);
	}
	const payload = {
		tokenId,
		cameo_id: String(body.cameo_id || ""),
		username: String(body.username || ""),
		display_name: String(body.display_name || ""),
		profile_asset_pointer: body.profile_asset_pointer,
	};
	if (!payload.cameo_id || !payload.username || !payload.display_name) {
		return c.json(
			{ error: "cameo_id, username and display_name are required" },
			400,
		);
	}
	const result = await finalizeCharacter(c, userId, payload);
	return c.json(result);
});

soraRouter.post("/cameos/set-public", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const tokenId = body.tokenId;
	const cameoId = body.cameoId;
	if (typeof tokenId !== "string" || typeof cameoId !== "string") {
		return c.json(
			{ error: "tokenId and cameoId are required" },
			400,
		);
	}
	const result = await setCameoPublic(c, userId, { tokenId, cameoId });
	return c.json(result);
});

soraRouter.post("/profile/upload", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const form = await c.req.formData();
	const tokenId = form.get("tokenId");
	const file = form.get("file");
	if (!(file instanceof File)) {
		return c.json({ error: "file is required" }, 400);
	}
	if (typeof tokenId !== "string" || !tokenId) {
		return c.json({ error: "tokenId is required" }, 400);
	}
	const result = await uploadProfileAsset(c, userId, {
		tokenId,
		file,
	});
	return c.json(result);
});

soraRouter.post("/upload/image", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const form = await c.req.formData();
	const tokenIdValue = form.get("tokenId");
	const file = form.get("file");
	if (!(file instanceof File)) {
		return c.json({ error: "file is required" }, 400);
	}
	const tokenId =
		typeof tokenIdValue === "string" && tokenIdValue
			? tokenIdValue
			: undefined;
	const result = await uploadSoraImage(c, userId, {
		tokenId,
		file,
	});
	return c.json(result);
});

soraRouter.get("/mentions", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const username = c.req.query("username") || "";
	const tokenId = c.req.query("tokenId") || undefined;
	const intent = c.req.query("intent") || undefined;
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const result = await searchSoraMentions(c, userId, {
		tokenId,
		username,
		intent,
		limit,
	});
	return c.json(result);
});

soraRouter.get("/video/history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const limitParam = c.req.query("limit");
	const offsetParam = c.req.query("offset");
	const status = c.req.query("status") || undefined;
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const offset =
		typeof offsetParam === "string" && offsetParam
			? Number(offsetParam)
			: undefined;
	const result = await listSoraVideoHistory(c, userId, {
		limit,
		offset,
		status,
	});
	return c.json(result);
});

soraRouter.get("/published/me", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const tokenId = c.req.query("tokenId") || undefined;
	const limitParam = c.req.query("limit");
	const limit =
		typeof limitParam === "string" && limitParam
			? Number(limitParam)
			: undefined;
	const result = await listSoraPublishedVideos(c, userId, {
		tokenId,
		limit,
	});
	const validated = SoraDraftListSchema.parse(result);
	return c.json(validated);
});

soraRouter.post("/video/publish", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PublishSoraVideoRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const result = await publishSoraVideo(c, userId, parsed.data);
	const validated = PublishSoraVideoResponseSchema.parse(result);
	return c.json(validated);
});
