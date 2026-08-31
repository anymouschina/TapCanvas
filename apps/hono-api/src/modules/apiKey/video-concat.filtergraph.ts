/**
 * 单 pass 视频拼接的 ffmpeg 参数构建器（纯函数，供 video-concat.ts 调用）。
 *
 * 旧管线对每帧像素最多重编码 3 遍（normalize → color-match → xfade），
 * 而 xfade 那一遍反正要整片重编码，所以把 normalize（缩放/裁剪/统一帧率）
 * 和 color-match（eq/colorbalance）全部折进 xfade 的 filter_complex，
 * 整次合成只解码一次、编码一次。
 */

export const TARGET_FPS = 30;
export const TARGET_AR = 44100;

export type Dims = { w: number; h: number };

export type YuvStats = { y: number; u: number; v: number };

export type ClipTrim = {
	/** 源素材内起点（秒） */
	inSec: number;
	/** 源素材内终点（秒），必须 > inSec */
	outSec: number;
};

export type ClipMeta = {
	/**
	 * 片段有效时长（秒）：无 trim 时 = 源时长；有 trim 时 = outSec - inSec。
	 * 探测失败为 null；显式 xfade 会拒绝执行，明确 hard_cut 不依赖它。
	 */
	durationSec: number | null;
	hasAudio: boolean;
	/** signalstats 平均 YUV；仅 colorMatch 开启时探测，失败为 null */
	yuv: YuvStats | null;
	/** 逐段内切：只取源素材 [inSec, outSec) 区间（亚秒冲击簇/打击帧插帧的基建） */
	trim?: ClipTrim | null;
	/**
	 * 进入本段的 xfade 转场类型（第 0 段不适用，两段之间的转场记在后一段上）。
	 * xfade 模式下必须显式存在并命中白名单；hard_cut 模式不得携带。
	 * 语义映射见 agents-cli skills/video-shotcraft/references/tapcanvas-mapping.md。
	 */
	transition?: string | null;
};

export type ColorCorrection = { bOff: number; rm: number; bm: number };

/**
 * ffmpeg xfade 支持的全部 58 种 transition 值（`ffmpeg -h filter=xfade`，
 * 对 ffmpeg 8.1.1 逐条比对过，无多无缺）。
 * 白名单存在的意义是**在拼参数前挡掉非法值**——非法 transition 会让整条
 * ffmpeg 命令失败，那时素材已经下载、额度已经花掉，只能整批重跑。
 */
export const XFADE_TRANSITIONS = new Set([
	"fade", "wipeleft", "wiperight", "wipeup", "wipedown",
	"slideleft", "slideright", "slideup", "slidedown",
	"circlecrop", "rectcrop", "distance", "fadeblack", "fadewhite",
	"radial", "smoothleft", "smoothright", "smoothup", "smoothdown",
	"circleopen", "circleclose", "vertopen", "vertclose",
	"horzopen", "horzclose", "dissolve", "pixelize",
	"diagtl", "diagtr", "diagbl", "diagbr",
	"hlslice", "hrslice", "vuslice", "vdslice",
	"hblur", "fadegrays", "wipetl", "wipetr", "wipebl", "wipebr",
	"squeezeh", "squeezev", "zoomin", "fadefast", "fadeslow",
	"hlwind", "hrwind", "vuwind", "vdwind",
	"coverleft", "coverright", "coverup", "coverdown",
	"revealleft", "revealright", "revealup", "revealdown",
]);

/** 解析进入某段的显式转场类型；缺失或非法时原地失败。 */
export function resolveTransition(name?: string | null): string {
	const trimmed = (name ?? "").trim();
	if (!XFADE_TRANSITIONS.has(trimmed)) {
		throw new Error(`video_concat_transition_invalid:${trimmed || "missing"}`);
	}
	return trimmed;
}

function clampSigned(v: number, lim: number): number {
	if (!Number.isFinite(v)) return 0;
	return Math.max(-lim, Math.min(lim, v));
}

/**
 * 把时长向下取整到目标帧率的帧网格上。xfade 的 offset 由各段时长累加得出，
 * fps 滤镜量化后实际时长只会 ≤ 原始探测值；向下取整保证 offset 永不越过
 * 前一路流的真实末尾（越界会导致尾帧冻结/黑帧）。
 */
export function floorToFrameGrid(durationSec: number): number {
	return Math.floor(durationSec * TARGET_FPS) / TARGET_FPS;
}

/**
 * 跨镜色彩匹配参数：把各段曝光/色 cast 拉向全片均值。
 * 任一段探测失败 → 返回 null（整体跳过，宁可不匹配也不瞎改）；
 * 单段偏差可忽略 → 该位置为 null（省掉滤镜）。
 */
export function buildColorCorrections(
	stats: Array<YuvStats | null>,
): Array<ColorCorrection | null> | null {
	if (stats.some((s) => !s)) return null;
	const valid = stats as YuvStats[];
	const n = valid.length;
	const tY = valid.reduce((a, s) => a + s.y, 0) / n;
	const tU = valid.reduce((a, s) => a + s.u, 0) / n;
	const tV = valid.reduce((a, s) => a + s.v, 0) / n;
	return valid.map((s) => {
		const bOff = clampSigned((tY - s.y) / 255, 0.3);
		const rm = clampSigned(((tV - s.v) / 255) * 0.6, 0.3);
		const bm = clampSigned(((tU - s.u) / 255) * 0.6, 0.3);
		if (Math.abs(bOff) < 0.01 && Math.abs(rm) < 0.01 && Math.abs(bm) < 0.01) {
			return null;
		}
		return { bOff, rm, bm };
	});
}

/** eq/colorbalance 滤镜片段（含前导逗号），无需校正时为空串。 */
export function colorFilterOf(corr: ColorCorrection | null): string {
	if (!corr) return "";
	return `,eq=brightness=${corr.bOff.toFixed(4)},colorbalance=rm=${corr.rm.toFixed(4)}:bm=${corr.bm.toFixed(4)}`;
}

export type SinglePassInput = {
	clips: ClipMeta[];
	/** 与 clips 一一对应的本地文件路径；缺省时输出空串占位（仅测试用） */
	files?: string[];
	dims: Dims;
	/** env 解析后的期望叠化时长（秒）；≤0 表示叠化关闭 */
	xfadeSeconds: number;
	colorMatch: boolean;
	outFile: string;
};

/**
 * 构建显式 xfade 的单 pass 拼接参数。返回 null 只表示该显式策略当前不可执行；
 * 调用方必须报错，不能静默改成 hard_cut。
 */
export function buildSinglePassConcatArgs(
	input: SinglePassInput,
): string[] | null {
	const { clips, files, dims, xfadeSeconds, colorMatch, outFile } = input;
	if (clips.length < 2 || xfadeSeconds <= 0) return null;
	if (clips.some((c) => typeof c.durationSec !== "number" || c.durationSec <= 0)) {
		return null;
	}

	const durations = clips.map((c) => floorToFrameGrid(c.durationSec as number));
	const minDur = Math.min(...durations);
	// 每段叠化时长不得超过最短片段 ~40%，否则 xfade offset 为负/超片段长会报错。
	const t = Math.min(xfadeSeconds, Math.max(0.1, minDur * 0.4));
	if (t < 0.1) return null;

	const corrections = colorMatch
		? buildColorCorrections(clips.map((c) => c.yuv))
		: null;

	const chains: string[] = [];
	for (let i = 0; i < clips.length; i += 1) {
		const color = colorFilterOf(corrections ? corrections[i] : null);
		const trim = clips[i].trim;
		// 逐段内切：先 trim 到源区间并重置 PTS，再进统一 normalize 链。
		const vTrim = trim
			? `trim=start=${trim.inSec.toFixed(3)}:end=${trim.outSec.toFixed(3)},setpts=PTS-STARTPTS,`
			: "";
		chains.push(
			`[${i}:v]${vTrim}scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h},setsar=1,fps=${TARGET_FPS}${color}[vn${i}]`,
		);
		const dur = durations[i].toFixed(3);
		if (clips[i].hasAudio) {
			const aTrim = trim
				? `atrim=start=${trim.inSec.toFixed(3)}:end=${trim.outSec.toFixed(3)},asetpts=PTS-STARTPTS,`
				: "";
			// 统一采样率/声道并把音轨钉到该段视频时长，保证 acrossfade 与 xfade 对齐。
			chains.push(
				`[${i}:a]${aTrim}aformat=sample_rates=${TARGET_AR}:sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${dur}[an${i}]`,
			);
		} else {
			chains.push(
				`anullsrc=channel_layout=stereo:sample_rate=${TARGET_AR},atrim=duration=${dur}[an${i}]`,
			);
		}
	}

	// 视频 xfade 链 + 音频 acrossfade 链。offset_i = Σd[0..i-1] − i·t（输出时间轴）。
	const ts = t.toFixed(3);
	let vPrev = "vn0";
	let aPrev = "an0";
	let cum = 0;
	const last = clips.length - 1;
	for (let i = 1; i < clips.length; i += 1) {
		cum += durations[i - 1];
		const offset = (cum - i * t).toFixed(3);
		const vOut = i === last ? "vout" : `v${i}`;
		const aOut = i === last ? "aout" : `a${i}`;
		// 两段之间的转场记在后一段上；音频侧始终 acrossfade（xfade 只管画面）。
		const transition = resolveTransition(clips[i].transition);
		chains.push(
			`[${vPrev}][vn${i}]xfade=transition=${transition}:duration=${ts}:offset=${offset}[${vOut}]`,
		);
		chains.push(`[${aPrev}][an${i}]acrossfade=d=${ts}[${aOut}]`);
		vPrev = vOut;
		aPrev = aOut;
	}

	const args: string[] = ["-y"];
	for (let i = 0; i < clips.length; i += 1) args.push("-i", files?.[i] ?? "");
	args.push(
		"-filter_complex",
		chains.join(";"),
		"-map",
		"[vout]",
		"-map",
		"[aout]",
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-ar",
		String(TARGET_AR),
		"-ac",
		"2",
		"-movflags",
		"+faststart",
		outFile,
	);
	return args;
}
