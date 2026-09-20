// 用户账号级生成偏好：记录用户通过节点“设为偏好”开关启用的生图/视频模型与规格，
// 存 users.generation_prefs（TEXT JSON 列）。消费方：
//   ① 聊天上下文块（task.agents-bridge contextBlocks）——小T 未被用户点名时按偏好选模型/规格；
//   ② web 端节点默认模型（getDefaultModel）。
// 优先级铁律：用户当次显式点名 > 章级 film_spec（用户真点过的章规格）> 账号已开启的偏好
// > 新账号固定初始偏好。选定精确模型后仍须通过实时目录验证；不可用时显式失败，禁止换模型。

export type UserGenerationPrefs = {
	imageModel?: string;
	imageSize?: string;
	imageQuality?: string;
	imagePreferenceEnabled?: boolean;
	videoPreferenceEnabled?: boolean;
	imageAspect?: string;
	imageResolution?: string;
	imageCount?: number;
	videoDuration?: number;
	videoCount?: number;
	videoGenerateAudio?: boolean;
	videoModel?: string;
	videoResolution?: string;
	videoAspect?: string;
};

export const DEFAULT_USER_GENERATION_PREFS: Readonly<Required<Pick<UserGenerationPrefs, "imageModel" | "imageSize" | "videoModel" | "videoResolution" | "videoAspect">>> = {
	imageModel: "gpt-image-2",
	imageSize: "1K",
	videoModel: "minimax-h3",
	videoResolution: "768p",
	videoAspect: "16:9",
};

const MAX_MODEL_ID_LEN = 128;
const MAX_SPEC_VALUE_LEN = 64;

function cleanModelId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_MODEL_ID_LEN) return null;
	return trimmed;
}

function cleanSpecValue(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_SPEC_VALUE_LEN) return null;
	for (let index = 0; index < trimmed.length; index += 1) {
		const code = trimmed.charCodeAt(index);
		if (code <= 31 || code === 127) return null;
	}
	return trimmed;
}

/** 从任意输入（PUT body / 解析后的 JSON 对象）清洗出合法偏好；无任何合法项返回 null。 */
export function sanitizeUserGenerationPrefs(input: unknown): UserGenerationPrefs | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const raw = input as Record<string, unknown>;
	const out: UserGenerationPrefs = {};
	const imageModel = cleanModelId(raw.imageModel);
	if (imageModel) out.imageModel = imageModel;
	const videoModel = cleanModelId(raw.videoModel);
	if (videoModel) out.videoModel = videoModel;
	const videoResolution = cleanSpecValue(raw.videoResolution);
	if (videoResolution) out.videoResolution = videoResolution;
	const videoAspect = cleanSpecValue(raw.videoAspect);
	if (videoAspect) out.videoAspect = videoAspect;
	const imageSize = cleanSpecValue(raw.imageSize);
	if (imageSize) out.imageSize = imageSize;
	const imageQuality = cleanSpecValue(raw.imageQuality);
	if (imageQuality) out.imageQuality = imageQuality;
	for (const key of ["imageAspect", "imageResolution"] as const) {
		const value = cleanSpecValue(raw[key]);
		if (value) out[key] = value;
	}
	for (const key of ["imageCount", "videoDuration", "videoCount"] as const) {
		const value = raw[key];
		if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) out[key] = value;
	}
	for (const key of ["imagePreferenceEnabled", "videoPreferenceEnabled", "videoGenerateAudio"] as const) {
		if (typeof raw[key] === "boolean") out[key] = raw[key];
	}
	return Object.keys(out).length ? out : null;
}

/**
 * 写入账号偏好时，图片与视频各自必须作为完整原子组提交。
 * 读取历史数据仍使用 sanitizeUserGenerationPrefs，以便把真实旧值展示给用户修正；
 * 新写入不得再制造“新模型 + 旧规格”的不可执行组合。
 */
export function sanitizeUserGenerationPrefsUpdate(input: unknown): UserGenerationPrefs | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	const raw = input as Record<string, unknown>;
	const sanitized = sanitizeUserGenerationPrefs(input);
	if (!sanitized) return null;
	// Each enabled media group is a complete snapshot. Disabling requires only its switch.
	for (const key of Object.keys(raw)) {
		if (!(key in sanitized)) return null;
	}
	const imageTouched = IMAGE_PREF_KEYS.some((key) => key in raw);
	const videoTouched = VIDEO_PREF_KEYS.some((key) => key in raw);
	if (imageTouched && sanitized.imagePreferenceEnabled !== false &&
		(sanitized.imagePreferenceEnabled !== true || !sanitized.imageModel || !sanitized.imageSize || !sanitized.imageAspect)) return null;
	if (videoTouched && sanitized.videoPreferenceEnabled !== false &&
		(sanitized.videoPreferenceEnabled !== true || !sanitized.videoModel || !sanitized.videoResolution || !sanitized.videoAspect)) return null;
	return imageTouched || videoTouched ? sanitized : null;
}

const IMAGE_PREF_KEYS = ["imagePreferenceEnabled", "imageModel", "imageSize", "imageQuality", "imageAspect", "imageResolution", "imageCount"] as const;
const VIDEO_PREF_KEYS = ["videoPreferenceEnabled", "videoModel", "videoResolution", "videoAspect", "videoDuration", "videoCount", "videoGenerateAudio"] as const;

export function mergeUserGenerationPrefs(
	current: UserGenerationPrefs | null,
	patch: UserGenerationPrefs,
): UserGenerationPrefs {
	const merged = { ...current };
	for (const keys of [IMAGE_PREF_KEYS, VIDEO_PREF_KEYS]) {
		if (keys.some((key) => key in patch)) {
			for (const key of keys) delete merged[key];
		}
	}
	return { ...merged, ...patch };
}

/** Model-scoped preference; explicit node quality always takes precedence. */
export function resolveImageGenerationQuality(input: {
	prefs: UserGenerationPrefs | null;
	modelAlias: string;
	explicitQuality: string;
}): string | undefined {
	return input.explicitQuality.trim() ||
		(input.prefs?.imagePreferenceEnabled === true && input.modelAlias === input.prefs.imageModel ? input.prefs.imageQuality : undefined);
}

/** 解析 users.generation_prefs 列的 JSON 文本；空/坏 JSON/非对象返回 null。 */
export function parseUserGenerationPrefs(raw: string | null | undefined): UserGenerationPrefs | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	try {
		return sanitizeUserGenerationPrefs(JSON.parse(raw));
	} catch {
		return null;
	}
}

/** 将账号已保存的部分偏好补全为当前有效偏好；只补缺失字段，不覆盖用户最近选择。 */
export function resolveEffectiveUserGenerationPrefs(
	prefs: UserGenerationPrefs | null,
): typeof DEFAULT_USER_GENERATION_PREFS & UserGenerationPrefs {
	const active: UserGenerationPrefs = {};
	if (prefs?.imagePreferenceEnabled === true) {
		Object.assign(active, Object.fromEntries(IMAGE_PREF_KEYS.filter((key) => key in prefs).map((key) => [key, prefs[key]])));
	}
	if (prefs?.videoPreferenceEnabled === true) {
		Object.assign(active, Object.fromEntries(VIDEO_PREF_KEYS.filter((key) => key in prefs).map((key) => [key, prefs[key]])));
	}
	return { ...DEFAULT_USER_GENERATION_PREFS, ...active,
		imagePreferenceEnabled: prefs?.imagePreferenceEnabled === true,
		videoPreferenceEnabled: prefs?.videoPreferenceEnabled === true,
	};
}

/**
 * 服务端生图选择解析：
 * 显式指定（节点 modelAlias/imageModel/imageSize，含画风锚 seedream 等工艺路径）永远优先；
 * 未显式指定时使用账号已开启的偏好；新账号使用固定初始偏好。
 * 本函数只做来源优先级解析，调用方仍必须用实时目录验证精确模型和规格。
 */
export function resolveImageGenerateDefaults(input: {
	prefs: UserGenerationPrefs | null;
	explicitModelKey?: string;
	explicitModelAlias: string;
	explicitImageModel: string;
	explicitSize: string;
}): { modelAlias: string; imageSize: string } {
	const effectivePrefs = resolveEffectiveUserGenerationPrefs(input.prefs);
	const modelAlias =
		input.explicitModelKey?.trim() ||
		input.explicitModelAlias.trim() ||
		input.explicitImageModel.trim() ||
		effectivePrefs.imageModel ||
		"";
	const imageSize = input.explicitSize.trim() || (modelAlias === effectivePrefs.imageModel || !effectivePrefs.imagePreferenceEnabled ? effectivePrefs.imageSize : "");
	return { modelAlias, imageSize };
}

/** 拼给小T的对话上下文块；新账号也会得到固定初始偏好。 */
export function buildGenerationPrefsContextBlock(
	prefs: UserGenerationPrefs | null,
): string {
	const effectivePrefs = resolveEffectiveUserGenerationPrefs(prefs);
	const lines: string[] = [];
	if (effectivePrefs.imagePreferenceEnabled && effectivePrefs.imageModel) {
		lines.push(`- 生图模型：${effectivePrefs.imageModel}${effectivePrefs.imageSize ? `（默认 ${effectivePrefs.imageSize}）` : ""}`);
	} else if (effectivePrefs.imagePreferenceEnabled && effectivePrefs.imageSize) {
		lines.push(`- 生图规格：${effectivePrefs.imageSize}`);
	}
	if (effectivePrefs.imageAspect) lines.push(`- 生图比例：${effectivePrefs.imageAspect}`);
	if (effectivePrefs.imageCount) lines.push(`- 生图数量：${effectivePrefs.imageCount}`);
	if (effectivePrefs.videoDuration) lines.push(`- 视频时长：${effectivePrefs.videoDuration}s`);
	if (effectivePrefs.videoCount) lines.push(`- 视频数量：${effectivePrefs.videoCount}`);
	if (typeof effectivePrefs.videoGenerateAudio === "boolean") lines.push(`- 视频音频：${effectivePrefs.videoGenerateAudio ? "开启" : "关闭"}`);
	if (effectivePrefs.imageQuality) lines.push(`- 生图质量：${effectivePrefs.imageQuality}`);
	if (effectivePrefs.videoPreferenceEnabled && effectivePrefs.videoModel) lines.push(`- 视频模型：${effectivePrefs.videoModel}`);
	const spec = [effectivePrefs.videoResolution, effectivePrefs.videoAspect].filter(Boolean).join("·");
	if (effectivePrefs.videoPreferenceEnabled && spec) lines.push(`- 视频规格：${spec}`);
	if (!effectivePrefs.imagePreferenceEnabled) lines.push("- 图片偏好未开启");
	if (!effectivePrefs.videoPreferenceEnabled) lines.push("- 视频偏好未开启");
	return [
		"【用户账号生成偏好】",
		...lines,
		"应用规则：这些值是账号级候选偏好，不是用户本轮已经确认的交付事实；" +
			"用户当次显式点名 > 章级 film_spec（章级规格优先于本偏好）> 账号已开启的偏好 > 新账号初始偏好。" +
			"若用户本轮禁止预设、委托其他事实源决定，或当前执行已受理并冻结配置，不得把本块值写入 UserIntentContract 或按次 triggerPayload。" +
			"新执行受理前应将已开启偏好作为同一组模型与规格采用；用户当次选择和章级规格优先，共享工作流模板默认值不覆盖账号偏好。已受理执行使用原快照，不在执行中重新读取偏好。" +
			"提交前必须用本轮实时目录验证这些精确值；任一值不可执行时显式报告规格冲突，禁止自动切换其他模型或规格；不要逐字复述本块。",
	].join("\n");
}
