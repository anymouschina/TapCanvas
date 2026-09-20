/** Deployment-owned model choice; tool callers cannot override it or silently downgrade. */
export function resolveImageUnderstandingModelKey(configured: string | undefined): string {
	if (configured === undefined) return "doubao-seed-2-1-turbo-260628";
	const value = configured.trim();
	if (!value) throw new Error("IMAGE_UNDERSTANDING_MODEL_KEY must not be empty");
	return value;
}

/** Read once at process startup so request, evidence reuse and tool schema agree. */
export const IMAGE_UNDERSTANDING_MODEL_KEY = resolveImageUnderstandingModelKey(
	globalThis.process?.env.IMAGE_UNDERSTANDING_MODEL_KEY,
);

/** 视频理解使用的唯一多模态模型；调用方无权覆盖或隐式降级。 */
export const VIDEO_UNDERSTANDING_MODEL_KEY = "doubao-seed-2-0-lite-260428";
