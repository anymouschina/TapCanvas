// 世界书编排层：加载条目 → 命中注入 → 拼装 prompt。
// loader 依赖注入 → 纯逻辑可单测；真实 loader 见 world-info.loader.ts。
// 设计见 docs/design/world-info-injection-engine.md
import {
	buildWorldEntries,
	inject,
	assemblePrompt,
	type CharacterBibleLike,
	type LabeledImage,
	type MaterialLike,
	type StyleBibleLike,
} from "./world-info.engine";

export interface WorldInfoLoader {
	loadMaterials: () => Promise<MaterialLike[]>;
	loadCharacterBibles?: () => Promise<CharacterBibleLike[]>;
	loadStyleBible?: () => Promise<StyleBibleLike | null>;
}

export interface ResolvedWorldInfo {
	prompt: string;
	negativePrompt: string;
	referenceImages: LabeledImage[];
	hitCount: number;
}

export async function resolveWorldInfo(opts: {
	shotText: string;
	loader: WorldInfoLoader;
}): Promise<ResolvedWorldInfo> {
	const [materials, characterBibles, styleBible] = await Promise.all([
		opts.loader.loadMaterials(),
		opts.loader.loadCharacterBibles?.() ?? Promise.resolve([]),
		opts.loader.loadStyleBible?.() ?? Promise.resolve(null),
	]);

	const entries = buildWorldEntries({ materials, characterBibles, styleBible });
	const out = inject({ shotText: opts.shotText, entries });
	const assembled = assemblePrompt(out, opts.shotText);

	return {
		// no-op 安全：无命中时 assembled.prompt 即原脚本；空串再兜回原脚本
		prompt: assembled.prompt || opts.shotText,
		negativePrompt: assembled.negative,
		referenceImages: assembled.refs,
		hitCount: out.injectedEntries.length,
	};
}
