// LLM 容错：模型（尤其是 schema 被 agents-cli defer 成无结构占位时）常把嵌套 object 参数
// 序列化成 JSON 字符串传入（2026-06-11 实证：image_generate_to_canvas 的 node、
// capture_director_scene 的 scene 连续 400）。对已知「期望 object/array」的顶层参数做一次
// 安全解套；解析失败或得到标量则保留原值，由下游 zod 校验给出明确报错。
const OBJECT_LIKE_ARG_KEYS = new Set([
	"node",
	"scene",
	"patch",
	"nodes",
	"edges",
	"segments",
	"camera",
	"characters",
	"pose",
	"options",
	"params",
	"animation",
	"motion",
	"keyframes",
	"storyPreviewContract",
]);

export function coerceStringifiedObjectArgs(args: Record<string, unknown>): Record<string, unknown> {
	for (const key of Object.keys(args)) {
		if (!OBJECT_LIKE_ARG_KEYS.has(key)) continue;
		const v = args[key];
		if (typeof v !== "string") continue;
		const t = v.trim();
		if (!t.startsWith("{") && !t.startsWith("[")) continue;
		try {
			const parsed: unknown = JSON.parse(t);
			if (parsed && typeof parsed === "object") args[key] = parsed;
		} catch {
			// 留给下游 zod 报错
		}
	}
	return args;
}
