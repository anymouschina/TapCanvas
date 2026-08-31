import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { PublicFlowGraphSchema } from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
	getFlowByIdUnsafe,
	getFlowForOwner,
	mapFlowRowToDto,
	updateFlow,
	updateFlowByIdUnsafe,
	type FlowRow,
} from "../flow/flow.repo";
import {
	broadcastPatch,
	countChapterConns,
} from "../chapter/canvas-sse.manager";
import { applyPatchToFlowYDoc } from "../realtime/yjs-realtime";
import {
	loadChapterCanvasAsFlowRow,
	mutateChapterCanvasGraph,
} from "./agents-tool-bridge.chapter-canvas-write";
import { getTaskResultByTaskId, upsertTaskResult } from "./task-result.repo";
import { pollUntilSettled } from "./task.polling-core";
import {
	BROWSER_CAPTURE_KIND,
	BROWSER_CAPTURE_VENDOR,
	buildResultJson,
	deriveCaptureId,
	deriveImageNodeId,
	deriveVideoNodeId,
	parseCaptureScene,
	readResultJson,
	type CaptureScene,
} from "./director-capture.shared";

// 导演台输出口 handle id（见 apps/web/src/canvas/nodes/directorConsole/DirectorConsoleNode.tsx）
const DIRECTOR_OUTPUT_HANDLE = "out-image";

export type CaptureDirectorSceneResult = {
	captureId: string;
	/** image 模式（默认）成功后的图片 URL。*/
	imageUrl?: string;
	/** clip 模式成功后的样片 URL。*/
	videoUrl?: string;
	assetId: string;
	/** 输出节点 id（image 模式 = image 节点；clip 模式 = video 节点）。*/
	imageNodeId: string;
};

function str(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

type NodeLike = { id?: unknown; type?: unknown; position?: unknown; data?: unknown };

function readNodes(current: unknown): NodeLike[] {
	if (!current || typeof current !== "object" || Array.isArray(current)) return [];
	const nodes = (current as Record<string, unknown>).nodes;
	if (!Array.isArray(nodes)) return [];
	return nodes.filter(
		(n): n is NodeLike => Boolean(n) && typeof n === "object" && !Array.isArray(n),
	);
}

function readPosition(node: NodeLike | null | undefined): { x: number; y: number } {
	const pos = node?.position;
	if (pos && typeof pos === "object" && !Array.isArray(pos)) {
		const record = pos as Record<string, unknown>;
		const x = typeof record.x === "number" ? record.x : 0;
		const y = typeof record.y === "number" ? record.y : 0;
		return { x, y };
	}
	return { x: 0, y: 0 };
}

export async function captureDirectorScene(input: {
	c: AppContext;
	requestUserId: string;
	devBypass: boolean;
	flowId: string;
	row: FlowRow;
	bodyArgs: unknown;
	chapterId?: string;
}): Promise<CaptureDirectorSceneResult> {
	const args = (input.bodyArgs ?? {}) as Record<string, unknown>;
	const nodeId = str(args.id);
	const requestId = str(args.requestId);
	if (!nodeId || !requestId) {
		throw new AppError("缺少 id 或 requestId", { status: 400, code: "invalid_scene" });
	}
	const parsed = parseCaptureScene(args.scene);
	if (!parsed.ok) {
		throw new AppError(parsed.message, { status: 400, code: "invalid_scene" });
	}
	const scene = parsed.scene;
	// mode/animation 来自顶层 bodyArgs（与 nodeId/requestId 同级，非 scene 内字段）。
	// Task 8 的工具路由调用时传入；缺省 "image" 保持向后兼容。
	const mode: "image" | "clip" = args.mode === "clip" ? "clip" : "image";
	const animation: unknown = args.animation;
	const projectId = str(input.row.project_id);
	if (!projectId) {
		throw new AppError("flow 无 project_id", { status: 400, code: "invalid_scene" });
	}

	// 章节会话：导演台节点与产物必须落 chapters.canvas_flow（与 flow_patch 同源），
	// 否则节点写进项目主 flow，开着章节画布的浏览器永远接不到 claim（裂脑）。
	const chapterId = str(input.chapterId);
	if (chapterId) {
		input.row = await loadChapterCanvasAsFlowRow(
			input.c,
			input.requestUserId,
			chapterId,
			projectId,
		);
	}

	const captureId = deriveCaptureId(nodeId, requestId);
	const db = input.c.env.DB;

	// 幂等：已成功直接返回缓存结果，不重复渲染。
	const existingResult = await getTaskResultByTaskId(db, input.requestUserId, captureId);
	if (existingResult && existingResult.status === "succeeded") {
		const payload = readResultJson(existingResult.result);
		// clip 模式：优先取 videoUrl（report 端写入）
		if (payload.videoUrl) {
			return {
				captureId,
				videoUrl: payload.videoUrl,
				assetId: payload.assets?.[0]?.assetId ?? "",
				imageNodeId: deriveVideoNodeId(nodeId, captureId),
			};
		}
		const asset = payload.assets?.[0];
		if (asset?.url) {
			return {
				captureId,
				imageUrl: asset.url,
				assetId: asset.assetId,
				// C1: 用确定性公式推导 image node id，与成功路径一致，而非读错误的 director node id
				imageNodeId: deriveImageNodeId(nodeId, captureId),
			};
		}
	}

	// presence：无在线浏览器画布会话即时失败（本范式靠浏览器离屏渲染兑现）。
	// 章节会话的 SSE 房间以 chapterId 为 key，渲染浏览器必须开着该章节画布。
	const canvasRoomId = chapterId || projectId;
	if (countChapterConns(canvasRoomId) === 0) {
		throw new AppError(
			chapterId
				? "当前章节无在线画布会话，无法截图。请让用户打开该章节画布后重试。"
				: "当前项目无在线画布会话，无法截图。请让用户打开该项目画布后重试。",
			{ status: 409, code: "no_live_canvas" },
		);
	}

	const nowIso = new Date().toISOString();

	// 把节点里 define_motion 已写的 customMotions 并进 queued scene → claim 端点透传给浏览器离屏渲染器。
	// 否则渲染器拿不到自定义骨骼 PoseClip、解析不了角色 motionClip 引用 → 退回静态/默认动作（实测两人都只摆手）。
	let sceneForResult: Record<string, unknown> = scene as unknown as Record<string, unknown>;
	try {
		const dirNodes = readNodes(sanitizeFlowDataForStorage(mapFlowRowToDto(input.row).data ?? {}));
		const dirNode = dirNodes.find((n) => str(n.id) === nodeId);
		const nodeScene =
			dirNode && dirNode.data && typeof dirNode.data === "object" && !Array.isArray(dirNode.data)
				? (dirNode.data as Record<string, unknown>).scene
				: undefined;
		const nodeCustomMotions =
			nodeScene && typeof nodeScene === "object" && !Array.isArray(nodeScene)
				? (nodeScene as Record<string, unknown>).customMotions
				: undefined;
		if (Array.isArray(nodeCustomMotions) && nodeCustomMotions.length > 0) {
			sceneForResult = { ...sceneForResult, customMotions: nodeCustomMotions };
		}
	} catch {
		/* 读不到节点 customMotions 就用原 scene */
	}

	// 写 queued task_result。result.provider=task_store 标记为本地浏览器任务；
	// 带上 scene 与 mode，使 claim 端点能直接把场景透传给前端（不依赖可能被画布其它写覆盖的节点 data）。
	await upsertTaskResult(db, {
		userId: input.requestUserId,
		taskId: captureId,
		vendor: BROWSER_CAPTURE_VENDOR,
		kind: BROWSER_CAPTURE_KIND,
		status: "queued",
		result: JSON.parse(
			buildResultJson({
				phase: "queued",
				projectId,
				flowId: input.flowId,
				nodeId,
				requestId,
				aspect: scene.aspect,
				mode,
				scene: sceneForResult as never,
			}),
		),
		chapterId: canvasRoomId,
		nodeId,
		nowIso,
	});

	// create-if-absent 导演台节点 + 写一次性 pendingCapture，并广播。
	const directorNode = await upsertDirectorPending({
		c: input.c,
		requestUserId: input.requestUserId,
		devBypass: input.devBypass,
		flowId: input.flowId,
		row: input.row,
		projectId,
		chapterId,
		nodeId,
		captureId,
		scene,
		mode,
		...(animation !== undefined ? { animation } : {}),
	});

	const clearPendingNow = () =>
		clearPending({
			c: input.c,
			requestUserId: input.requestUserId,
			devBypass: input.devBypass,
			flowId: input.flowId,
			row: input.row,
			projectId,
			chapterId,
			nodeId,
		});

	// I2: wrap everything after the queued writes so ANY unexpected throw also clears pendingCapture.
	try {
		// claim 窗口（~10s）：等待某个在线浏览器接手。
		const claimSettled = await pollUntilSettled({
			timeoutMs: 10_000,
			intervalMs: 800,
			pollOnce: () => getTaskResultByTaskId(db, input.requestUserId, captureId),
			evaluate: (row) => {
				const s = row?.status ?? "";
				return s === "claimed" || s === "succeeded" || s === "failed" ? "success" : "continue";
			},
		});
		if (claimSettled.state !== "success") {
			// I1: best-effort cleanup so a cleanup failure can't mask the real error
			throw new AppError("无浏览器接手渲染（claim 超时）。", {
				status: 504,
				code: "capture_claim_timeout",
			});
		}

		let finalRow = claimSettled.value;
		// 渲染窗口：image 模式 1 帧很快（90s 足够）；clip 模式逐帧 readback+编码耗时长，
		// 必须 > 浏览器 clip 看门狗（220s），否则服务端先超时把任务判死、还堵住下一次 claim
		// （192 帧 8s clip 实测：浏览器仍在渲、服务端 90s 已 capture_render_timeout）。
		if (finalRow?.status === "claimed") {
			const renderSettled = await pollUntilSettled({
				timeoutMs: mode === "clip" ? 240_000 : 90_000,
				intervalMs: 1_200,
				pollOnce: () => getTaskResultByTaskId(db, input.requestUserId, captureId),
				evaluate: (row) => {
					const s = row?.status ?? "";
					return s === "succeeded" || s === "failed" ? "success" : "continue";
				},
			});
			finalRow = renderSettled.value;
			if (renderSettled.state !== "success") {
				// I1: best-effort cleanup so a cleanup failure can't mask the real error
				throw new AppError("渲染超时。", { status: 504, code: "capture_render_timeout" });
			}
		}

		const payload = finalRow ? readResultJson(finalRow.result) : null;
		const asset = payload?.assets?.[0];
		// clip 模式成功条件：videoUrl；image 模式：asset.url
		const isClipMode = mode === "clip";
		const captureOk = finalRow?.status === "succeeded" && (isClipMode ? !!payload?.videoUrl : !!asset?.url);
		if (!captureOk) {
			// I1: best-effort cleanup so a cleanup failure can't mask the real error
			throw new AppError(payload?.error || (isClipMode ? "样片渲染失败。" : "截图失败。"), {
				status: 502,
				code: "capture_failed",
			});
		}

		// M5: re-fetch the flow row fresh from DB before post-render writes to avoid clobbering
		// concurrent canvas edits that occurred during the up-to-90s render window.
		const freshRow = chapterId
			? await loadChapterCanvasAsFlowRow(input.c, input.requestUserId, chapterId, projectId)
			: ((input.devBypass
					? await getFlowByIdUnsafe(input.c.env.DB, input.flowId)
					: await getFlowForOwner(input.c.env.DB, input.flowId, input.requestUserId)) ??
				input.row);

		const persistBase = {
			c: input.c,
			requestUserId: input.requestUserId,
			devBypass: input.devBypass,
			flowId: input.flowId,
			row: freshRow,
			projectId,
			chapterId,
		};

		let outputNodeId: string;
		let resultReturn: CaptureDirectorSceneResult;

		if (isClipMode) {
			// 成功（clip 模式）：建 video 节点 + 连边并广播。
			const videoUrl = payload!.videoUrl!;
			const assetId = asset?.assetId ?? "";
			outputNodeId = await createVideoNodeFromCapture({
				...persistBase,
				directorNodeId: nodeId,
				directorNode,
				captureId,
				videoUrl,
				assetId,
			});
			resultReturn = { captureId, videoUrl, assetId, imageNodeId: outputNodeId };
		} else {
			// 成功（image 模式）：建 image 节点 + 连边并广播。
			outputNodeId = await createImageNodeFromCapture({
				...persistBase,
				directorNodeId: nodeId,
				directorNode,
				captureId,
				asset: { url: asset!.url, assetId: asset!.assetId },
			});
			resultReturn = { captureId, imageUrl: asset!.url, assetId: asset!.assetId, imageNodeId: outputNodeId };
		}

		// M5: clearPending also uses the fresh row via the refreshed clearPendingNow closure below.
		const clearPendingFresh = () =>
			clearPending({
				c: input.c,
				requestUserId: input.requestUserId,
				devBypass: input.devBypass,
				flowId: input.flowId,
				row: freshRow,
				projectId,
				chapterId,
				nodeId,
			});
		await clearPendingFresh();

		return resultReturn;
	} catch (e) {
		// I2: single cleanup point for all failure paths; best-effort so cleanup can't replace the real error
		await clearPendingNow().catch(() => {});
		throw e;
	}
}

// ---- flow 写操作（镜像 generate-image-to-canvas 的 sanitize→parse→persist→broadcast）----

type PersistInput = {
	c: AppContext;
	requestUserId: string;
	devBypass: boolean;
	flowId: string;
	row: FlowRow;
	projectId: string;
	// 章节会话：写 chapters.canvas_flow 并广播到章节房间，而非 flows 表。
	chapterId?: string;
};

/**
 * 统一持久化入口：以「当前图 → 下一张图」的纯变换表达写操作。
 * 章节模式走乐观锁重试（冲突时对最新图重放变换）；flows 模式保持原整图写。
 */
async function persistMutationAndBroadcast(
	base: PersistInput,
	mutate: (current: unknown) => unknown,
	broadcastNodeIds: string[],
): Promise<Map<string, NodeLike>> {
	if (base.chapterId) {
		const nextFlow = await mutateChapterCanvasGraph({
			c: base.c,
			userId: base.requestUserId,
			chapterId: base.chapterId,
			mutate,
			broadcastNodeIds,
		});
		// 同步内存 row.data，便于同一请求内多次读改。
		(base.row as { data: string }).data = JSON.stringify(nextFlow);
		return new Map<string, NodeLike>(
			nextFlow.nodes.map((n) => [str((n as NodeLike).id), n as NodeLike]),
		);
	}
	const dto = mapFlowRowToDto(base.row);
	const current = sanitizeFlowDataForStorage(dto.data ?? {});
	return persistGraphAndBroadcast(base, mutate(current), broadcastNodeIds);
}

/**
 * 写回整张图（已构造好的 next graph）并广播指定节点。直接落库 nodes，
 * 用于无法走 applyPublicFlowGraphPatch.createNodes 的非 taskNode/groupNode 节点
 * （如 directorConsole；public createNodes 仅支持 taskNode/groupNode）。
 */
async function persistGraphAndBroadcast(
	base: PersistInput,
	nextGraph: unknown,
	broadcastNodeIds: string[],
): Promise<Map<string, NodeLike>> {
	const sanitizedNext = sanitizeFlowDataForStorage(nextGraph);
	const nextParsed = PublicFlowGraphSchema.safeParse(sanitizedNext);
	if (!nextParsed.success) {
		throw new AppError("Flow patch produced invalid data", {
			status: 500,
			code: "flow_patch_invalid",
			details: { issues: nextParsed.error.issues },
		});
	}
	const nowIso = new Date().toISOString();
	const nextJson = JSON.stringify(sanitizedNext ?? {});
	if (base.devBypass) {
		await updateFlowByIdUnsafe(base.c.env.DB, {
			id: base.flowId,
			name: base.row.name,
			data: nextJson,
			nowIso,
		});
	} else {
		await updateFlow(base.c.env.DB, {
			id: base.flowId,
			name: base.row.name,
			data: nextJson,
			ownerId: base.requestUserId,
			projectId: base.row.project_id,
			nowIso,
		});
	}
	// 同步内存 row.data，便于同一请求内多次写。
	(base.row as { data: string }).data = nextJson;

	const nodeMap = new Map<string, NodeLike>(
		(nextParsed.data.nodes ?? []).map((n) => [str((n as NodeLike).id), n as NodeLike]),
	);
	const upsertNodes = broadcastNodeIds
		.map((id) => nodeMap.get(id))
		.filter((n): n is NodeLike => Boolean(n));
	if (upsertNodes.length) {
		broadcastPatch(base.projectId, { upsertNodes }, "");
		applyPatchToFlowYDoc(base.flowId, { upsertNodes });
	}
	return nodeMap;
}

/** 走 applyPublicFlowGraphPatch（taskNode/groupNode/边/patchNodeData 等受支持的操作）。 */
async function persistPatchAndBroadcast(
	base: PersistInput,
	patch: Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"],
	broadcastNodeIds: string[],
): Promise<Map<string, NodeLike>> {
	return persistMutationAndBroadcast(
		base,
		(current) => applyPublicFlowGraphPatch({ current, patch }).data,
		broadcastNodeIds,
	);
}

function mapCaptureCharacter(c: unknown): Record<string, unknown> {
	const cc = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
	return {
		id: cc.id,
		name: cc.name,
		modelId: cc.modelId,
		position: cc.position,
		rotation: Array.isArray(cc.rotation) ? cc.rotation : [0, 0, 0],
		scale: [1, 1, 1],
		uniformScale: typeof cc.uniformScale === "number" ? cc.uniformScale : 1,
		colorHex: typeof cc.colorHex === "string" ? cc.colorHex : "#9aa7b8",
		...(typeof cc.posePresetId === "string" ? { posePresetId: cc.posePresetId } : {}),
	};
}

function mapCaptureCamera(cam0: unknown, nodeId: string): Record<string, unknown> {
	const cam = (cam0 && typeof cam0 === "object" ? cam0 : {}) as Record<string, unknown>;
	return {
		id: `${nodeId}-cam-1`,
		name: "机位1",
		position: cam.position,
		lookAtMode: typeof cam.lookAtMode === "string" ? cam.lookAtMode : "manual",
		lookAt: Array.isArray(cam.lookAt) ? cam.lookAt : [0, 1.2, 0],
		fovDeg: typeof cam.fovDeg === "number" ? cam.fovDeg : 45,
	};
}

/**
 * 渲染即留痕：把渲染场景**合并**进导演台可编辑 data.scene——只**追加 capture 里现有 scene 没有的新角色**，
 * **绝不覆盖既有 characters(含其 motion)/cameras/timeline/customMotions**。这样小T 渲染时新角色实时出现在导演台，
 * 而 define_motion/set_character_motion/flow_patch 之前写的骨骼动画与镜头不会被冲掉（修上一版「渲染清空场景」回归）。
 * existingScene 为空（新建节点）时退化为「用 capture 场景初始化」。
 */
function mergeCaptureIntoDirectorScene(existing: unknown, scene: CaptureScene, nodeId: string): Record<string, unknown> {
	const ex = existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
	const exChars = Array.isArray(ex.characters) ? (ex.characters as Record<string, unknown>[]) : [];
	const exIds = new Set(exChars.map((c) => String((c as Record<string, unknown>).id)));
	const added = scene.characters.filter((c) => !exIds.has(String((c as Record<string, unknown>).id))).map(mapCaptureCharacter);
	const characters = [...exChars, ...added];
	const exCams = Array.isArray(ex.cameras) ? (ex.cameras as unknown[]) : [];
	const cameras = exCams.length ? exCams : [mapCaptureCamera(scene.camera, nodeId)];
	return {
		...ex, // 保留 customMotions / timeline / activeCameraId / skybox 等既有字段
		characters,
		cameras,
		aspect: ex.aspect ?? scene.aspect,
		skybox: ex.skybox ?? scene.skybox,
		skyboxYaw: ex.skyboxYaw ?? scene.skyboxYaw,
		skyboxPitch: ex.skyboxPitch ?? scene.skyboxPitch,
	};
}

async function upsertDirectorPending(
	base: PersistInput & {
		nodeId: string;
		captureId: string;
		scene: CaptureScene;
		mode?: "image" | "clip";
		animation?: unknown;
	},
): Promise<NodeLike | null> {
	const pendingCapture = {
		captureId: base.captureId,
		scene: base.scene,
		aspect: base.scene.aspect,
		status: "queued" as const,
		mode: base.mode ?? "image",
		...(base.animation !== undefined ? { animation: base.animation } : {}),
	};

	// public createNodes 仅支持 taskNode/groupNode，directorConsole 走手工建图；
	// 变换内自带存在性判断，章节模式冲突重试时可安全重放。
	const nodeMap = await persistMutationAndBroadcast(
		base,
		(current) => {
			const nodes = readNodes(current);
			const existing = nodes.find((n) => str(n.id) === base.nodeId) ?? null;
			const graphBase =
				current && typeof current === "object" && !Array.isArray(current)
					? (current as Record<string, unknown>)
					: {};
			if (existing) {
				// 既有导演台节点：merge pendingCapture。
				const data =
					existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
						? (existing.data as Record<string, unknown>)
						: {};
				// 合并保留：只追加新角色，绝不冲掉既有 motion/customMotions/timeline/机位。
				const mergedScene = mergeCaptureIntoDirectorScene(data.scene, base.scene, base.nodeId);
				// 关键：把节点里 define_motion 写的 customMotions 带进渲染 pendingCapture.scene，
				// 否则浏览器离屏渲染拿不到自定义骨骼 PoseClip、解析不了 motionClip 引用 → 退回默认动作（实测两角色都只摆手）。
				const exScene = data.scene && typeof data.scene === "object" && !Array.isArray(data.scene) ? (data.scene as Record<string, unknown>) : {};
				const pendingForNode = exScene.customMotions
					? { ...pendingCapture, scene: { ...(pendingCapture.scene as Record<string, unknown>), customMotions: exScene.customMotions } }
					: pendingCapture;
				const nextNode: NodeLike = { ...existing, data: { ...data, scene: mergedScene, pendingCapture: pendingForNode } };
				return {
					...graphBase,
					nodes: nodes.map((n) => (str(n.id) === base.nodeId ? nextNode : n)),
				};
			}
			const newNode: NodeLike = {
				id: base.nodeId,
				type: "directorConsole",
				position: { x: 0, y: 0 },
				data: {
					kind: "directorConsole",
					label: "导演台",
					scene: mergeCaptureIntoDirectorScene(undefined, base.scene, base.nodeId),
					activeViewpoint: "director",
					status: "idle",
					pendingCapture,
				},
			};
			return { ...graphBase, nodes: [...nodes, newNode] };
		},
		[base.nodeId],
	);
	return nodeMap.get(base.nodeId) ?? null;
}

async function clearPending(base: PersistInput & { nodeId: string }): Promise<void> {
	{
		// 快路径：节点不存在或无 pendingCapture 时跳过写。
		const dto = mapFlowRowToDto(base.row);
		const current = sanitizeFlowDataForStorage(dto.data ?? {});
		const nodes = readNodes(current);
		const existing = nodes.find((n) => str(n.id) === base.nodeId) ?? null;
		if (!existing) return;
		const data =
			existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
				? (existing.data as Record<string, unknown>)
				: {};
		if (!("pendingCapture" in data)) return;
	}
	await persistMutationAndBroadcast(
		base,
		(current) => {
			const nodes = readNodes(current);
			const existing = nodes.find((n) => str(n.id) === base.nodeId) ?? null;
			const graphBase =
				current && typeof current === "object" && !Array.isArray(current)
					? (current as Record<string, unknown>)
					: {};
			if (!existing) return graphBase;
			const data =
				existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
					? (existing.data as Record<string, unknown>)
					: {};
			const { pendingCapture: _drop, ...rest } = data;
			void _drop;
			const nextNode: NodeLike = { ...existing, data: rest };
			return {
				...graphBase,
				nodes: nodes.map((n) => (str(n.id) === base.nodeId ? nextNode : n)),
			};
		},
		[base.nodeId],
	);
}

async function createImageNodeFromCapture(
	base: PersistInput & {
		directorNodeId: string;
		directorNode: NodeLike | null;
		captureId: string;
		asset: { url: string; assetId: string };
	},
): Promise<string> {
	// C1: use shared helper so success path and idempotency return always produce the same id
	const imageNodeId = deriveImageNodeId(base.directorNodeId, base.captureId);
	const origin = readPosition(base.directorNode);
	const imageNode = {
		id: imageNodeId,
		type: "taskNode" as const,
		position: { x: origin.x + 800, y: origin.y },
		data: {
			kind: "image",
			label: "导演台占位图",
			status: "success",
			imageUrl: base.asset.url,
			imageResults: [
				{ url: base.asset.url, title: "导演台占位图", assetId: base.asset.assetId },
			],
			imagePrimaryIndex: 0,
			assetId: base.asset.assetId,
		},
	};
	const edge = {
		id: `edge-${base.directorNodeId}-${imageNodeId}`,
		source: base.directorNodeId,
		target: imageNodeId,
		sourceHandle: DIRECTOR_OUTPUT_HANDLE,
	};
	type CreatePatch = Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"];
	type CreateNode = NonNullable<CreatePatch["createNodes"]>[number];
	const patch: CreatePatch = {
		// `kind:"image"` 是合法 taskNode 协议；运行时由 applyPublicFlowGraphPatch
		// 的 validateCreateNode (Zod) 兜底校验，这里仅放宽编译期字面量推断。
		createNodes: [imageNode as unknown as CreateNode],
		createEdges: [edge],
	};
	await persistPatchAndBroadcast(base, patch, [imageNodeId]);
	return imageNodeId;
}

// ---- defineDirectorMotion：把自定义骨骼动画 PoseClip 存入导演台节点 data.scene.customMotions ----

export type DefineDirectorMotionResult = {
	ok: true;
	motionId: string;
	name: string;
};

export async function defineDirectorMotion(input: {
	c: AppContext;
	requestUserId: string;
	devBypass: boolean;
	flowId: string;
	row: FlowRow;
	bodyArgs: unknown;
	chapterId?: string;
}): Promise<DefineDirectorMotionResult> {
	const args = (input.bodyArgs ?? {}) as Record<string, unknown>;
	const nodeId = str(args.id);
	if (!nodeId) {
		throw new AppError("缺少导演台节点 id", { status: 400, code: "invalid_motion" });
	}

	const motionRaw = args.motion;
	if (!motionRaw || typeof motionRaw !== "object" || Array.isArray(motionRaw)) {
		throw new AppError("motion 必须是对象", { status: 400, code: "invalid_motion" });
	}
	const motion = motionRaw as Record<string, unknown>;
	const motionId = str(motion.id);
	const motionName = str(motion.name);
	const durationSeconds = Number(motion.durationSeconds);
	const loop = motion.loop === true ? true : undefined;
	const keyframes = Array.isArray(motion.keyframes) ? motion.keyframes : null;

	if (!motionId || !motionName) {
		throw new AppError("motion.id 和 motion.name 不能为空", { status: 400, code: "invalid_motion" });
	}
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new AppError("motion.durationSeconds 必须 > 0", { status: 400, code: "invalid_motion" });
	}
	if (!keyframes || keyframes.length === 0) {
		throw new AppError("motion.keyframes 不能为空", { status: 400, code: "invalid_motion" });
	}

	const characterId = str(args.characterId);

	const projectId = str(input.row.project_id);
	if (!projectId) {
		throw new AppError("flow 无 project_id", { status: 400, code: "invalid_motion" });
	}

	const chapterId = str(input.chapterId);

	const persistBase: PersistInput = {
		c: input.c,
		requestUserId: input.requestUserId,
		devBypass: input.devBypass,
		flowId: input.flowId,
		row: input.row,
		projectId,
		...(chapterId ? { chapterId } : {}),
	};

	const newMotion = {
		id: motionId,
		name: motionName,
		durationSeconds,
		...(loop !== undefined ? { loop } : {}),
		keyframes,
	};

	await persistMutationAndBroadcast(
		persistBase,
		(current) => {
			const nodes = readNodes(current);
			const graphBase =
				current && typeof current === "object" && !Array.isArray(current)
					? (current as Record<string, unknown>)
					: {};
			const existing = nodes.find((n) => str(n.id) === nodeId) ?? null;

			if (!existing) {
				// 节点不存在：create-if-absent，携带自定义动画
				const newNode: NodeLike = {
					id: nodeId,
					type: "directorConsole",
					position: { x: 0, y: 0 },
					data: {
						kind: "directorConsole",
						label: "导演台",
						scene: {
							characters: [],
							cameras: [],
							aspect: "16:9",
							customMotions: [newMotion],
						},
						activeViewpoint: "director",
						status: "idle",
					},
				};
				return { ...graphBase, nodes: [...nodes, newNode] };
			}

			const data =
				existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
					? (existing.data as Record<string, unknown>)
					: {};
			const scene =
				data.scene && typeof data.scene === "object" && !Array.isArray(data.scene)
					? (data.scene as Record<string, unknown>)
					: { characters: [], cameras: [], aspect: "16:9" as const };

			// 同 id 替换，否则追加
			const existingMotions = Array.isArray(scene.customMotions)
				? (scene.customMotions as unknown[])
				: [];
			const filteredMotions = existingMotions.filter((m) => {
				if (!m || typeof m !== "object" || Array.isArray(m)) return true;
				return str((m as Record<string, unknown>).id) !== motionId;
			});
			const nextMotions = [...filteredMotions, newMotion];

			// 若提供 characterId，设该角色的 motionClip
			let nextCharacters = Array.isArray(scene.characters) ? [...scene.characters] : [];
			if (characterId) {
				nextCharacters = nextCharacters.map((ch) => {
					if (!ch || typeof ch !== "object" || Array.isArray(ch)) return ch;
					const charObj = ch as Record<string, unknown>;
					if (str(charObj.id) === characterId) {
						return { ...charObj, motionClip: motionId };
					}
					return ch;
				});
			}

			const nextScene = { ...scene, customMotions: nextMotions, characters: nextCharacters };
			const nextNode: NodeLike = { ...existing, data: { ...data, scene: nextScene } };
			return {
				...graphBase,
				nodes: nodes.map((n) => (str(n.id) === nodeId ? nextNode : n)),
			};
		},
		[nodeId],
	);

	return { ok: true, motionId, name: motionName };
}

// ---- setDirectorCharacterMotion：把混合分层动作 CharacterMotion 直接写入角色 motion 字段 ----

export type SetDirectorCharacterMotionResult = {
	ok: true;
	characterId: string;
};

export async function setDirectorCharacterMotion(input: {
	c: AppContext;
	requestUserId: string;
	devBypass: boolean;
	flowId: string;
	row: FlowRow;
	bodyArgs: unknown;
	chapterId?: string;
}): Promise<SetDirectorCharacterMotionResult> {
	const args = (input.bodyArgs ?? {}) as Record<string, unknown>;
	const nodeId = str(args.id);
	if (!nodeId) {
		throw new AppError("缺少导演台节点 id", { status: 400, code: "invalid_motion" });
	}

	const characterId = str(args.characterId);
	if (!characterId) {
		throw new AppError("缺少 characterId", { status: 400, code: "invalid_motion" });
	}

	const motionRaw = args.motion;
	if (!motionRaw || typeof motionRaw !== "object" || Array.isArray(motionRaw)) {
		throw new AppError("motion 必须是对象", { status: 400, code: "invalid_motion" });
	}
	const motion = motionRaw as Record<string, unknown>;
	const durationSeconds = Number(motion.durationSeconds);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new AppError("motion.durationSeconds 必须 > 0", { status: 400, code: "invalid_motion" });
	}

	// 校验 locomotion（若存在）
	const locomotionRaw = motion.locomotion;
	if (locomotionRaw !== undefined) {
		if (!locomotionRaw || typeof locomotionRaw !== "object" || Array.isArray(locomotionRaw)) {
			throw new AppError("motion.locomotion 必须是对象", { status: 400, code: "invalid_motion" });
		}
		const loco = locomotionRaw as Record<string, unknown>;
		const validClips = new Set(["walk", "run", "idle"]);
		if (!validClips.has(str(loco.clip))) {
			throw new AppError(
				"motion.locomotion.clip 必须是 walk | run | idle",
				{ status: 400, code: "invalid_motion" },
			);
		}
		const pathRaw = loco.path;
		if (pathRaw !== undefined) {
			if (!pathRaw || typeof pathRaw !== "object" || Array.isArray(pathRaw)) {
				throw new AppError("motion.locomotion.path 必须是对象", { status: 400, code: "invalid_motion" });
			}
			const path = pathRaw as Record<string, unknown>;
			if (!Array.isArray(path.waypoints)) {
				throw new AppError("motion.locomotion.path.waypoints 必须是数组", { status: 400, code: "invalid_motion" });
			}
			const validModes = new Set(["linear", "curve"]);
			if (!validModes.has(str(path.mode))) {
				throw new AppError(
					"motion.locomotion.path.mode 必须是 linear | curve",
					{ status: 400, code: "invalid_motion" },
				);
			}
		}
	}

	// 校验 poseTrack（若存在）
	if (motion.poseTrack !== undefined && !Array.isArray(motion.poseTrack)) {
		throw new AppError("motion.poseTrack 必须是数组", { status: 400, code: "invalid_motion" });
	}

	// 只保留已知字段（不盲存任意 key）
	const sanitizedMotion: Record<string, unknown> = { durationSeconds };
	if (Array.isArray(motion.poseTrack)) {
		sanitizedMotion.poseTrack = motion.poseTrack;
	}
	if (Array.isArray(motion.poseMask)) {
		sanitizedMotion.poseMask = motion.poseMask;
	}
	if (locomotionRaw && typeof locomotionRaw === "object" && !Array.isArray(locomotionRaw)) {
		const loco = locomotionRaw as Record<string, unknown>;
		const locoOut: Record<string, unknown> = { clip: str(loco.clip) };
		const pathRaw = loco.path;
		if (pathRaw && typeof pathRaw === "object" && !Array.isArray(pathRaw)) {
			const path = pathRaw as Record<string, unknown>;
			const pathOut: Record<string, unknown> = {
				waypoints: path.waypoints,
				mode: str(path.mode),
			};
			if (typeof path.closed === "boolean") pathOut.closed = path.closed;
			locoOut.path = pathOut;
		}
		if (typeof loco.speed === "number") locoOut.speed = loco.speed;
		sanitizedMotion.locomotion = locoOut;
	}

	const projectId = str(input.row.project_id);
	if (!projectId) {
		throw new AppError("flow 无 project_id", { status: 400, code: "invalid_motion" });
	}

	const chapterId = str(input.chapterId);

	const persistBase: PersistInput = {
		c: input.c,
		requestUserId: input.requestUserId,
		devBypass: input.devBypass,
		flowId: input.flowId,
		row: input.row,
		projectId,
		...(chapterId ? { chapterId } : {}),
	};

	await persistMutationAndBroadcast(
		persistBase,
		(current) => {
			const nodes = readNodes(current);
			const graphBase =
				current && typeof current === "object" && !Array.isArray(current)
					? (current as Record<string, unknown>)
					: {};
			const existing = nodes.find((n) => str(n.id) === nodeId) ?? null;

			if (!existing) {
				// 节点不存在：create-if-absent，带空角色列表（角色尚未落场景）
				const newNode: NodeLike = {
					id: nodeId,
					type: "directorConsole",
					position: { x: 0, y: 0 },
					data: {
						kind: "directorConsole",
						label: "导演台",
						scene: {
							characters: [],
							cameras: [],
							aspect: "16:9",
						},
						activeViewpoint: "director",
						status: "idle",
					},
				};
				return { ...graphBase, nodes: [...nodes, newNode] };
			}

			const data =
				existing.data && typeof existing.data === "object" && !Array.isArray(existing.data)
					? (existing.data as Record<string, unknown>)
					: {};
			const scene =
				data.scene && typeof data.scene === "object" && !Array.isArray(data.scene)
					? (data.scene as Record<string, unknown>)
					: { characters: [], cameras: [], aspect: "16:9" as const };

			// 找到匹配角色并写入 motion；未找到则保持原样（与 defineDirectorMotion 一致）
			const existingCharacters = Array.isArray(scene.characters) ? scene.characters : [];
			const nextCharacters = existingCharacters.map((ch) => {
				if (!ch || typeof ch !== "object" || Array.isArray(ch)) return ch;
				const charObj = ch as Record<string, unknown>;
				if (str(charObj.id) === characterId) {
					return { ...charObj, motion: sanitizedMotion };
				}
				return ch;
			});

			const nextScene = { ...scene, characters: nextCharacters };
			const nextNode: NodeLike = { ...existing, data: { ...data, scene: nextScene } };
			return {
				...graphBase,
				nodes: nodes.map((n) => (str(n.id) === nodeId ? nextNode : n)),
			};
		},
		[nodeId],
	);

	return { ok: true, characterId };
}

async function createVideoNodeFromCapture(
	base: PersistInput & {
		directorNodeId: string;
		directorNode: NodeLike | null;
		captureId: string;
		videoUrl: string;
		assetId: string;
	},
): Promise<string> {
	const videoNodeId = deriveVideoNodeId(base.directorNodeId, base.captureId);
	const origin = readPosition(base.directorNode);
	const videoNode = {
		id: videoNodeId,
		type: "taskNode" as const,
		position: { x: origin.x + 800, y: origin.y },
		data: {
			kind: "video",
			label: "导演台灰模样片",
			status: "success",
			sourceVideoUrl: base.videoUrl,  // seedance v2v 入口字段
			videoUrl: base.videoUrl,         // 节点可播放
			assetId: base.assetId,
		},
	};
	const edge = {
		id: `edge-${base.directorNodeId}-${videoNodeId}`,
		source: base.directorNodeId,
		target: videoNodeId,
		sourceHandle: DIRECTOR_OUTPUT_HANDLE,
	};
	type CreatePatch = Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"];
	type CreateNode = NonNullable<CreatePatch["createNodes"]>[number];
	const patch: CreatePatch = {
		createNodes: [videoNode as unknown as CreateNode],
		createEdges: [edge],
	};
	await persistPatchAndBroadcast(base, patch, [videoNodeId]);
	return videoNodeId;
}
