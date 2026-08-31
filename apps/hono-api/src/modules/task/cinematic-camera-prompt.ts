import type { CanvasIndexCinematicCamera } from "../material/material.repo";

/**
 * 服务端版摄像机规格 → prompt 片段构造器。
 * label 表与拼接句式照抄前端 apps/web/src/canvas/nodes/taskNode/components/CameraControlPanel.tsx
 * （CAMERA_BODIES/CAMERA_LENSES/CAMERA_FOCALS/CAMERA_APERTURES + buildCinematicCameraPrompt）——
 * 前端手动出图在客户端拼、agent 出图在这里拼，两处改动必须同步。
 */
const CAMERA_BODY_LABELS: Record<string, string> = {
	imax_keighley: "IMAX Keighley",
	arri_alexa35: "ARRI Alexa 35",
	arri_alexa_lf: "ARRI Alexa LF",
	red_komodo: "RED Komodo",
	sony_venice2: "Sony Venice 2",
	blackmagic_ursa: "Blackmagic URSA",
};

const CAMERA_LENS_LABELS: Record<string, string> = {
	cooke_speed_panchro: "Cooke Speed Panchro",
	zeiss_master_prime: "Zeiss Master Prime",
	leica_summilux_c: "Leica Summilux-C",
	panavision_ultra_speed: "Panavision Ultra Speed",
	arri_signature_prime: "ARRI Signature Prime",
};

const CAMERA_FOCAL_KEYS = new Set(["14mm", "21mm", "24mm", "35mm", "50mm", "85mm", "100mm"]);

const CAMERA_APERTURE_KEYS = new Set(["f/1.4", "f/2", "f/2.8", "f/4", "f/5.6", "f/8", "f/11"]);

/** 摄像机规格 prompt 前缀（幂等判定标记，与前端产出句式一致）。 */
export const CINEMATIC_CAMERA_PROMPT_MARKER = "摄影机参数（";

export function buildCinematicCameraPrompt(cam: CanvasIndexCinematicCamera | null): string {
	if (!cam || !cam.enabled) return "";
	const camera = CAMERA_BODY_LABELS[cam.cameraKey];
	const lens = CAMERA_LENS_LABELS[cam.lensKey];
	const focal = CAMERA_FOCAL_KEYS.has(cam.focalKey) ? cam.focalKey : undefined;
	const aperture = CAMERA_APERTURE_KEYS.has(cam.apertureKey) ? cam.apertureKey : undefined;
	const parts: string[] = [];
	if (camera) parts.push(`机身：${camera}`);
	if (lens) parts.push(`镜头：${lens}`);
	if (focal) parts.push(`焦距：${focal}`);
	if (aperture) parts.push(`光圈：${aperture}`);
	if (!parts.length) return "";
	return `${CINEMATIC_CAMERA_PROMPT_MARKER}${parts.join("；")}），呈现对应焦段透视、景深与镜头特有的光学质感。`;
}

/** 把摄像机规格拼进出图 prompt；已含标记（前端/上游已拼过）则原样返回，幂等。 */
export function appendCinematicCameraPrompt(
	prompt: string,
	cam: CanvasIndexCinematicCamera | null,
): string {
	const camText = buildCinematicCameraPrompt(cam);
	if (!camText) return prompt;
	if (prompt.includes(CINEMATIC_CAMERA_PROMPT_MARKER)) return prompt;
	return prompt ? `${prompt}\n${camText}` : camText;
}
