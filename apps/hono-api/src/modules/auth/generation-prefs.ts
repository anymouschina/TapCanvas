// 用户账号级生成偏好：记录用户最近一次明确选择的生图/视频模型与规格，
// 存 users.generation_prefs（TEXT JSON 列）。消费方：
//   ① 聊天上下文块（task.agents-bridge contextBlocks）——小T 未被用户点名时按偏好选模型/规格；
//   ② web 端节点默认模型（getDefaultModel）。
// 优先级铁律：用户当次显式点名 > 章级 film_spec（用户真点过的章规格）> 账号最近选择
// > 新账号固定初始偏好。选定精确模型后仍须通过实时目录验证；不可用时显式失败，禁止换模型。

export type UserGenerationPrefs = {
	imageModel?: string;
	imageSize?: string;
	videoModel?: string;
	videoResolution?: string;
	videoAspect?: string;
};

export const DEFAULT_USER_GENERATION_PREFS: Readonly<Required<UserGenerationPrefs>> = {
	imageModel: "gpt-image-2",
	imageSize: "1K",
	videoModel: "minimax-h3",
	videoResolution: "768p",
	videoAspect: "16:9",
};

const MAX_MODEL_ID_LEN = 128;
const VIDEO_RESOLUTIONS = new Set(["480p", "720p", "768p", "1080p", "1440p"]);
const VIDEO_ASPECTS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]);
const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

function cleanModelId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length > MAX_MODEL_ID_LEN) return null;
	return trimmed;
}

function cleanEnum(value: unknown, allowed: Set<string>): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return allowed.has(trimmed) ? trimmed : null;
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
	const videoResolution = cleanEnum(raw.videoResolution, VIDEO_RESOLUTIONS);
	if (videoResolution) out.videoResolution = videoResolution;
	const videoAspect = cleanEnum(raw.videoAspect, VIDEO_ASPECTS);
	if (videoAspect) out.videoAspect = videoAspect;
	const imageSize = cleanEnum(raw.imageSize, IMAGE_SIZES);
	if (imageSize) out.imageSize = imageSize;
	return Object.keys(out).length ? out : null;
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
): Required<UserGenerationPrefs> {
	return {
		...DEFAULT_USER_GENERATION_PREFS,
		...(prefs ?? {}),
	};
}

/**
 * 服务端生图选择解析：
 * 显式指定（节点 modelAlias/imageModel/imageSize，含画风锚 seedream 等工艺路径）永远优先；
 * 未显式指定时使用账号最近选择；新账号使用固定初始偏好。
 * 本函数只做来源优先级解析，调用方仍必须用实时目录验证精确模型和规格。
 */
export function resolveImageGenerateDefaults(input: {
	prefs: UserGenerationPrefs | null;
	explicitModelAlias: string;
	explicitImageModel: string;
	explicitSize: string;
}): { modelAlias: string; imageSize: string } {
	const effectivePrefs = resolveEffectiveUserGenerationPrefs(input.prefs);
	const modelAlias =
		input.explicitModelAlias.trim() ||
		input.explicitImageModel.trim() ||
		effectivePrefs.imageModel ||
		"";
	const imageSize = input.explicitSize.trim() || effectivePrefs.imageSize;
	return { modelAlias, imageSize };
}

/** 拼给小T的对话上下文块；新账号也会得到固定初始偏好。 */
export function buildGenerationPrefsContextBlock(
	prefs: UserGenerationPrefs | null,
): string {
	const effectivePrefs = resolveEffectiveUserGenerationPrefs(prefs);
	const lines: string[] = [];
	if (effectivePrefs.imageModel) {
		lines.push(`- 生图模型：${effectivePrefs.imageModel}${effectivePrefs.imageSize ? `（默认 ${effectivePrefs.imageSize}）` : ""}`);
	} else if (effectivePrefs.imageSize) {
		lines.push(`- 生图规格：${effectivePrefs.imageSize}`);
	}
	if (effectivePrefs.videoModel) lines.push(`- 视频模型：${effectivePrefs.videoModel}`);
	const spec = [effectivePrefs.videoResolution, effectivePrefs.videoAspect].filter(Boolean).join("·");
	if (spec) lines.push(`- 视频规格：${spec}`);
	return [
		"【用户账号生成偏好】",
		...lines,
		"应用规则：这些值是账号级候选偏好，不是用户本轮已经确认的交付事实；" +
			"用户当次显式点名 > 章级 film_spec（章级规格优先于本偏好）> 账号最近选择 > 新账号初始偏好。" +
			"若用户本轮禁止预设、委托其他事实源决定，或已装配 Workflow IR 已冻结配置，不得把本块值写入 UserIntentContract 或按次 triggerPayload。" +
			"只有用户未给出冲突指令、Workflow IR 明确要求按次提供且 UserIntentContract 已冻结该选择时，才可使用对应偏好。" +
			"提交前必须用本轮实时目录验证这些精确值；任一值不可执行时显式报告规格冲突，禁止自动切换其他模型或规格；不要逐字复述本块。",
	].join("\n");
}
