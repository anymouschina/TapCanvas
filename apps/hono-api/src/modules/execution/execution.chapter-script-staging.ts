import type { ChapterScriptScene, StagingLayout, StagingPosition } from "../../../../../packages/schemas/chapter-sequence/index.mjs";

/** Optional author facts, projected without creative continuity or placement validation. */
export type AuthoredSceneStaging = Readonly<{
	layout: StagingLayout | null;
	positions: Map<string, StagingPosition>;
}>;

export function projectAuthoredSceneStaging(
	scene: ChapterScriptScene,
	previous: AuthoredSceneStaging | null,
): AuthoredSceneStaging {
	const declared = scene.layout as Partial<StagingLayout> | undefined;
	const marks = new Map((previous?.layout?.marks ?? []).map((mark) => [mark.mark, mark]));
	for (const mark of declared?.marks ?? []) marks.set(mark.mark, mark);
	const landmarks = [...(previous?.layout?.landmarks ?? []), ...(declared?.landmarks ?? [])];
	const layout = (declared?.landmarks !== undefined || previous?.layout) && (declared?.marks !== undefined || previous?.layout)
		? { landmarks, marks: [...marks.values()] } : null;
	const positions = scene.positions === undefined
		? new Map(previous?.positions ?? [])
		: new Map(scene.positions.map((position) => [position.who, position]));
	return { layout, positions };
}
