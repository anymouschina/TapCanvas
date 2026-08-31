import { createHash } from "node:crypto";
import { z } from "zod";

export const BROWSER_CAPTURE_VENDOR = "browser-director-capture";
export const BROWSER_CAPTURE_KIND = "image_edit";

// 与 apps/web/src/canvas/nodes/directorConsole/assets.ts 的 BODY_TYPES/PROP_TYPES id 对齐
export const DIRECTOR_BODY_IDS = ["male", "female", "broad", "muscular", "slim", "teen", "child", "chibi"] as const;
// 含家具道具（与 web FURNITURE_TYPES 同步；缺同步实测后果=小T拿不到沙发/茶几只能用巨型 box 硬拼，
// 出"一面墙挡死镜头"的废 blocking 帧）。新增 web 道具时必须同步此表与 PROP_APPROX_DIMS。
export const DIRECTOR_PROP_IDS = [
	"prop-box", "prop-sphere", "prop-cylinder", "prop-cone", "prop-plane",
	"prop-table", "prop-low-table", "prop-chair", "prop-stool", "prop-sofa",
	"prop-bed", "prop-cabinet", "prop-sideboard", "prop-shelf", "prop-lamp",
] as const;

/** 道具 id → 中文名（供 LLM 工具描述/报错提示），与 web PROP_TYPES/FURNITURE_TYPES 对齐 */
export const DIRECTOR_PROP_LABELS =
	"几何: prop-box立方体(1m) prop-sphere球 prop-cylinder圆柱 prop-cone圆锥 prop-plane平面；" +
	"家具(真实米制尺寸,底面落地): prop-table桌子 prop-low-table茶几 prop-chair椅子 prop-stool凳子 prop-sofa沙发 prop-bed床 prop-cabinet柜子 prop-sideboard矮柜 prop-shelf书架 prop-lamp落地灯";

// 道具近似包围盒尺寸 [宽x, 高y, 深z]（米，底面落地、以 position 为底面中心），与 web PropObject 几何对齐。
// 用于构图校验的遮挡测试；近似即可，不追求精确。
const PROP_APPROX_DIMS: Record<string, [number, number, number]> = {
	"prop-box": [1, 1, 1],
	"prop-sphere": [1, 1, 1],
	"prop-cylinder": [0.8, 1.2, 0.8],
	"prop-cone": [1, 1.2, 1],
	"prop-plane": [1.5, 0.02, 1.5],
	"prop-table": [1.4, 0.77, 0.8],
	"prop-low-table": [1.0, 0.45, 0.6],
	"prop-chair": [0.45, 0.95, 0.45],
	"prop-stool": [0.36, 0.45, 0.36],
	"prop-sofa": [1.8, 0.85, 0.85],
	"prop-bed": [1.5, 0.6, 2.0],
	"prop-cabinet": [0.9, 1.9, 0.45],
	"prop-sideboard": [1.6, 0.58, 0.45],
	"prop-shelf": [0.94, 1.8, 0.32],
	"prop-lamp": [0.4, 1.7, 0.4],
};

// 素体身高（米），与 web BODY_TYPES 对齐；构图校验取胸/头测试点用。
const BODY_HEIGHTS: Record<string, number> = {
	male: 1.78, female: 1.66, broad: 1.74, muscular: 1.82,
	slim: 1.72, teen: 1.5, child: 1.2, chibi: 1.0,
};
export const DIRECTOR_ASPECTS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

// 与 apps/web/src/canvas/nodes/directorConsole/state/pose.ts 的 POSE_PRESETS id 对齐（改预设须同步两处）
export const DIRECTOR_POSE_IDS = [
	// 基础
	"stand", "tpose", "arms-down", "akimbo", "crossed", "hands-behind", "pockets",
	// 坐跪
	"sit", "squat", "kneel", "seiza", "cross-legged", "beg",
	// 行动
	"walk", "run", "jump", "sprint", "push", "carry", "climb", "stretch", "dance",
	// 武戏
	"salute-fist", "punch", "block", "kick", "horse-stance", "lunge", "sword", "aim", "archery", "throw", "taichi",
	// 交流
	"wave", "reach", "point", "bow", "assist", "clap", "cheer", "pray", "salute", "phone", "offer", "hug",
	// 情绪
	"think", "roar", "clutch-belly", "stagger", "cover-head", "dejected", "look-up", "cover-face", "shocked", "listen", "shield-eyes",
] as const;

/** 姿势预设 id → 中文名（供 LLM 工具描述/报错提示），与 web POSE_PRESETS 对齐 */
export const DIRECTOR_POSE_LABELS =
	"基础: stand站立 tpose T型 arms-down立正 akimbo叉腰 crossed抱臂 hands-behind负手而立 pockets插兜；" +
	"坐跪: sit坐姿 squat蹲下 kneel单膝跪 seiza跪坐 cross-legged盘腿坐 beg跪地哀求；" +
	"行动: walk行走 run奔跑 jump跳跃 sprint冲刺起跑 push用力推 carry搬重物 climb攀爬 stretch伸懒腰 dance舞姿；" +
	"武戏: salute-fist抱拳行礼 punch出拳 block格挡 kick踢腿 horse-stance马步 lunge弓步 sword持剑式 aim持枪瞄准 archery拉弓 throw投掷 taichi太极云手；" +
	"交流: wave招手 reach伸手 point指斥 bow鞠躬 assist搀扶 clap鼓掌 cheer欢呼 pray双手合十 salute敬礼 phone打电话 offer双手呈递 hug张臂相拥；" +
	"情绪: think思考 roar怒吼 clutch-belly捂腹受伤 stagger踉跄后仰 cover-head抱头畏缩 dejected低头沮丧 look-up仰望 cover-face掩面而泣 shocked惊愕后仰 listen侧耳倾听 shield-eyes手搭凉棚";

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);

function isAllowedModelId(v: string): boolean {
	if ((DIRECTOR_BODY_IDS as readonly string[]).includes(v)) return true;
	if ((DIRECTOR_PROP_IDS as readonly string[]).includes(v)) return true;
	return /^https?:\/\//i.test(v);
}

const CharacterSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	modelId: z.string().min(1).refine(isAllowedModelId, { message: "modelId 非法" }),
	position: vec3,
	rotation: vec3.optional().default([0, 0, 0]),
	uniformScale: finite.positive().optional().default(1),
	colorHex: z.string().optional().default("#9aa7b8"),
	// 姿势：预设 id（推荐），或逐关节欧拉角弧度覆盖（进阶，两者同给时 pose 优先）
	posePresetId: z.enum(DIRECTOR_POSE_IDS).optional(),
	pose: z.record(z.string(), vec3).optional(),
});

const CameraSchema = z.object({
	position: vec3,
	lookAtMode: z.string().min(1).default("manual"),
	lookAt: vec3.optional().default([0, 1, 0]),
	fovDeg: finite.positive().max(179).default(45),
});

export const CaptureSceneSchema = z.object({
	characters: z.array(CharacterSchema).min(1).max(12),
	camera: CameraSchema,
	aspect: z.enum(DIRECTOR_ASPECTS).default("16:9"),
	// 720° 等距全景图 URL，作 3D 场景天空盒环境（web Viewport <Skybox> 已支持，
	// 缺省=空舞台 prop-box 摆场）。~2:1 等距图直接作天空盒；非 2:1 普通图前端会自适应
	// （seam 重定位+接缝混合+极点软化）转 backdrop 穹顶展示，不再硬性畸变。
	skybox: z
		.string()
		.regex(/^https?:\/\//i, { message: "skybox 须为 http(s) URL" })
		.optional(),
	// 全景背景水平旋转(度)：转动背景取景而不动机位；与 web DirectorScene.skyboxYaw 对齐
	skyboxYaw: finite.min(-360).max(360).optional(),
	// 全景地平线俯仰校准(度)：让背景地面与导演台 y=0 网格对齐
	skyboxPitch: finite.min(-45).max(45).optional(),
});

export type CaptureScene = z.infer<typeof CaptureSceneSchema>;

export type ParseSceneResult =
	| { ok: true; scene: CaptureScene }
	| { ok: false; message: string };

export function parseCaptureScene(input: unknown): ParseSceneResult {
	const parsed = CaptureSceneSchema.safeParse(input);
	if (parsed.success) {
		// 【构图校验闸】schema 合法 ≠ 构图可用。实测翻车：巨型 box 怼在镜头前把全部角色挡成
		// "一面墙+两条腿"、角色摆到视锥外只剩一个人——这类图作为 blocking 参考毫无价值还烧轮次。
		// 服务端用纯几何（视锥+射线遮挡）在接受前拒绝，报错信息直接说"谁出画/谁被什么挡了"。
		const composition = validateSceneComposition(parsed.data);
		if (!composition.ok) return { ok: false, message: composition.message };
		return { ok: true, scene: parsed.data };
	}
	const hasModelIdErr = parsed.error.issues.some((i) => i.path.includes("modelId"));
	const hasPoseErr = parsed.error.issues.some((i) => i.path.includes("posePresetId"));
	const base = parsed.error.issues[0]?.message ?? "场景参数非法";
	let message = base;
	if (hasModelIdErr) {
		message = `${base}；合法素体 modelId：${DIRECTOR_BODY_IDS.join(", ")}（或道具 ${DIRECTOR_PROP_LABELS}、或 http(s) GLB URL）`;
	} else if (hasPoseErr) {
		message = `${base}；合法姿势预设 posePresetId 见：${DIRECTOR_POSE_LABELS}`;
	}
	return { ok: false, message };
}

// ── 构图校验（纯几何，可单测） ───────────────────────────────────────────────

type Vec = [number, number, number];

function vSub(a: Vec, b: Vec): Vec { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vDot(a: Vec, b: Vec): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vCross(a: Vec, b: Vec): Vec {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function vNorm(a: Vec): Vec {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
}

function aspectRatioOf(aspect: string): number {
	const m = /^(\d+):(\d+)$/.exec(aspect);
	if (!m) return 16 / 9;
	const w = Number(m[1]); const h = Number(m[2]);
	return h > 0 ? w / h : 16 / 9;
}

const MAX_PROP_SCALE = 3;
// 帧缘容差：测试点略出视锥仍算可接受（构图允许人物贴边）。
const FRUSTUM_TOLERANCE = 1.08;

/** 射线(origin→target) 与 y 轴旋转包围盒(AABB 近似)求交：把旋转盒展开成轴对齐外接盒。 */
function segmentHitsPropBox(
	origin: Vec,
	target: Vec,
	prop: { position: Vec; rotationYDeg: number; scale: number; dims: [number, number, number] },
): boolean {
	const [w, h, d] = prop.dims;
	const cos = Math.abs(Math.cos((prop.rotationYDeg * Math.PI) / 180));
	const sin = Math.abs(Math.sin((prop.rotationYDeg * Math.PI) / 180));
	// y 旋转后的轴对齐外接半宽/半深
	const hx = ((w * cos + d * sin) / 2) * prop.scale;
	const hz = ((w * sin + d * cos) / 2) * prop.scale;
	const min: Vec = [prop.position[0] - hx, prop.position[1], prop.position[2] - hz];
	const max: Vec = [prop.position[0] + hx, prop.position[1] + h * prop.scale, prop.position[2] + hz];
	const dir = vSub(target, origin);
	let tMin = 0;
	let tMax = 1;
	for (let axis = 0; axis < 3; axis += 1) {
		const o = origin[axis]!; const dd = dir[axis]!;
		if (Math.abs(dd) < 1e-9) {
			if (o < min[axis]! || o > max[axis]!) return false;
			continue;
		}
		let t1 = (min[axis]! - o) / dd;
		let t2 = (max[axis]! - o) / dd;
		if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
		tMin = Math.max(tMin, t1);
		tMax = Math.min(tMax, t2);
		if (tMin > tMax) return false;
	}
	// 命中区间须明显在角色之前（t<0.97），擦到角色脚边不算遮挡
	return tMin < 0.97;
}

export type CompositionVerdict = { ok: true } | { ok: false; message: string };

/**
 * 构图校验：所有具名角色（素体）必须 ①在镜头视锥内（胸点）②胸/头连线不被道具盒完全遮挡。
 * 道具 uniformScale 超限直接拒绝。报错信息可执行（说清谁出画/谁被谁挡、建议怎么改）。
 */
export function validateSceneComposition(scene: CaptureScene): CompositionVerdict {
	const cam = scene.camera;
	const camPos = cam.position as Vec;
	const forward = vNorm(vSub(cam.lookAt as Vec, camPos));
	const right = vNorm(vCross(forward, [0, 1, 0]));
	const up = vCross(right, forward);
	const vHalf = ((cam.fovDeg / 2) * Math.PI) / 180;
	const tanV = Math.tan(vHalf);
	const tanH = tanV * aspectRatioOf(scene.aspect);

	const props = scene.characters
		.filter((c) => (DIRECTOR_PROP_IDS as readonly string[]).includes(c.modelId))
		.map((c) => ({
			name: c.name,
			position: c.position as Vec,
			rotationYDeg: (c.rotation?.[1] ?? 0),
			scale: c.uniformScale ?? 1,
			dims: PROP_APPROX_DIMS[c.modelId] ?? ([1, 1, 1] as [number, number, number]),
		}));
	for (const prop of props) {
		if (prop.scale > MAX_PROP_SCALE) {
			return {
				ok: false,
				message: `道具「${prop.name}」uniformScale=${prop.scale} 超上限 ${MAX_PROP_SCALE}：家具道具是真实米制尺寸，不需要放大成墙。要表达大体量（如车辆）用 ≤${MAX_PROP_SCALE} 的 box 并放在人物侧后方。`,
			};
		}
	}

	const bodies = scene.characters.filter(
		(c) => !(DIRECTOR_PROP_IDS as readonly string[]).includes(c.modelId),
	);
	for (const body of bodies) {
		const heightM = (BODY_HEIGHTS[body.modelId] ?? 1.7) * (body.uniformScale ?? 1);
		const base = body.position as Vec;
		const chest: Vec = [base[0], base[1] + heightM * 0.55, base[2]];
		const head: Vec = [base[0], base[1] + heightM * 0.9, base[2]];
		// ① 视锥检查（胸点）
		const rel = vSub(chest, camPos);
		const z = vDot(rel, forward);
		if (z <= 0.2) {
			return {
				ok: false,
				message: `角色「${body.name}」在镜头后方或与镜头重叠（沿视线深度 ${z.toFixed(2)}m）：把镜头后撤或把角色移到 lookAt 方向上。`,
			};
		}
		const x = Math.abs(vDot(rel, right));
		const y = Math.abs(vDot(rel, up));
		if (x > z * tanH * FRUSTUM_TOLERANCE || y > z * tanV * FRUSTUM_TOLERANCE) {
			return {
				ok: false,
				message: `角色「${body.name}」出画（胸点在 ${scene.aspect} 视锥外）：把 camera.lookAt 指向两角色中点、加大 fovDeg 或后撤机位，确保每个具名角色都在画面内。`,
			};
		}
		// ② 遮挡检查：胸与头连线都被同一批道具盒挡死才算完全遮挡
		const chestBlocker = props.find((p) => segmentHitsPropBox(camPos, chest, p));
		if (chestBlocker && props.some((p) => segmentHitsPropBox(camPos, head, p))) {
			return {
				ok: false,
				message: `角色「${body.name}」被道具「${chestBlocker.name}」完全遮挡：道具不要放在镜头与人物之间——家具放人物侧后方，或机位换到无遮挡一侧。`,
			};
		}
	}
	return { ok: true };
}

export function deriveCaptureId(nodeId: string, requestId: string): string {
	const h = createHash("sha256").update(`${nodeId}\n${requestId}`).digest("hex");
	return `dcap_${h.slice(0, 32)}`;
}

export function deriveImageNodeId(directorNodeId: string, captureId: string): string {
	return `${directorNodeId}-shot-${captureId.slice(5, 13)}`;
}

export function deriveVideoNodeId(directorNodeId: string, captureId: string): string {
	return `${directorNodeId}-clip-${captureId.slice(5, 13)}`;
}

export type CapturePhase = "queued" | "claimed" | "succeeded" | "failed";

// 注意：归属(userId)不放进本 result JSON——它是 task_results.user_id 列，
// 由 getTaskResultByTaskId(db, userId, taskId) 强制过滤。claim/report 的越权校验
// 依赖该列，不要在这里冗余加 userId 字段。
export type CaptureResultPayload = {
	provider: "task_store";
	phase: CapturePhase;
	projectId: string;
	flowId: string;
	nodeId: string;
	requestId: string;
	aspect: string;
	/** 渲染模式：image=截图（默认）；clip=灰模动画样片（seedance v2v 入口）。*/
	mode?: "image" | "clip";
	scene?: CaptureScene;
	leaseToken?: string;
	leaseOwner?: string;
	assets?: { type: "image"; url: string; assetId: string }[];
	/** clip 模式成功后由 report 端写入，供轮询端建 video 节点用。*/
	videoUrl?: string;
	error?: string;
};

export function buildResultJson(input: Omit<CaptureResultPayload, "provider">): string {
	return JSON.stringify({ provider: "task_store", ...input } satisfies CaptureResultPayload);
}

export function readResultJson(json: string): CaptureResultPayload {
	const obj = JSON.parse(json) as Partial<CaptureResultPayload>;
	return { provider: "task_store", phase: "queued", projectId: "", flowId: "", nodeId: "", requestId: "", aspect: "16:9", ...obj } as CaptureResultPayload;
}
