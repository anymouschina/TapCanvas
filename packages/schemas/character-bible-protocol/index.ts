export const CHARACTER_BIBLE_PROTOCOL_VERSION = "v1" as const;

export const CHARACTER_REFERENCE_IMAGE_SLOTS = [
	"fullBody",
	"threeView",
	"expression",
	"closeup",
] as const;

export type CharacterReferenceImageSlot =
	(typeof CHARACTER_REFERENCE_IMAGE_SLOTS)[number];

export type CharacterReferenceImage = {
	slot: CharacterReferenceImageSlot;
	label: string;
	url: string;
};

export type CharacterBibleImageSet = {
	fullBody: string;
	threeView: string;
	expression: string;
	closeup: string;
};

export type CharacterBible = {
	version: typeof CHARACTER_BIBLE_PROTOCOL_VERSION;
	id: string;
	name: string;
	projectId: string | null;
	sourceCharacterId: string;
	sourceGroupNumber: string;
	identityHint: string;
	era: string;
	culturalRegion: string;
	genre: string;
	timePeriod: string;
	appearanceBackground: string;
	scene: string;
	gender: string;
	ageGroup: string;
	species: string;
	physique: string;
	heightLevel: string;
	skinColor: string;
	hairLength: string;
	hairColor: string;
	temperament: string;
	outfit: string;
	distinctiveFeatures: string;
	filterWorldview: string;
	filterTheme: string;
	filterScene: string;
	sourceImages: CharacterBibleImageSet;
	importedImages: CharacterBibleImageSet;
	importedAt: string;
	updatedAt: string;
};

export type AiCharacterLibraryCharacterDto = {
	id: string;
	name: string;
	projectId: string | null;
	character_id: string;
	group_number: string;
	era: string;
	cultural_region: string;
	genre: string;
	time_period: string;
	appearance_background: string;
	scene: string;
	gender: string;
	age_group: string;
	species: string;
	physique: string;
	height_level: string;
	skin_color: string;
	hair_length: string;
	hair_color: string;
	temperament: string;
	outfit: string;
	distinctive_features: string;
	identity_hint: string;
	full_body_image_url: string;
	three_view_image_url: string;
	expression_image_url: string;
	closeup_image_url: string;
	filter_worldview: string;
	filter_theme: string;
	filter_scene: string;
	imported_at: string;
	updated_at: string;
};

export type AiCharacterLibrarySyncStateDto = {
	totalCharacters: number;
	importedCharacters: number;
	lastSyncedAt: string;
};

export type AiCharacterLibraryUpsertPayload = {
	name?: string;
	projectId?: string | null;
	sourceCharacterUid?: string;
	character_id?: string;
	group_number?: string;
	era?: string;
	cultural_region?: string;
	genre?: string;
	time_period?: string;
	appearance_background?: string;
	scene?: string;
	gender?: string;
	age_group?: string;
	species?: string;
	physique?: string;
	height_level?: string;
	skin_color?: string;
	hair_length?: string;
	hair_color?: string;
	temperament?: string;
	outfit?: string;
	distinctive_features?: string;
	identity_hint?: string;
	filter_worldview?: string;
	filter_theme?: string;
	filter_scene?: string;
	full_body_image_url?: string;
	three_view_image_url?: string;
	expression_image_url?: string;
	closeup_image_url?: string;
};

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function buildCharacterReferenceImages(
	character: Pick<
		AiCharacterLibraryCharacterDto,
		| "full_body_image_url"
		| "three_view_image_url"
		| "expression_image_url"
		| "closeup_image_url"
	>,
): CharacterReferenceImage[] {
	const refs: CharacterReferenceImage[] = [];
	const candidates: Array<{ slot: CharacterReferenceImageSlot; label: string; url: string }> = [
		{
			slot: "fullBody",
			label: "角色立绘",
			url: normalizeText(character.full_body_image_url),
		},
		{
			slot: "threeView",
			label: "三视图",
			url: normalizeText(character.three_view_image_url),
		},
		{
			slot: "expression",
			label: "表情参考",
			url: normalizeText(character.expression_image_url),
		},
		{
			slot: "closeup",
			label: "肖像特写",
			url: normalizeText(character.closeup_image_url),
		},
	];
	for (const candidate of candidates) {
		if (!candidate.url) continue;
		refs.push(candidate);
	}
	return refs;
}

export function buildCharacterBibleFromDto(
	character: AiCharacterLibraryCharacterDto,
): CharacterBible {
	return {
		version: CHARACTER_BIBLE_PROTOCOL_VERSION,
		id: normalizeText(character.id),
		name: normalizeText(character.name),
		projectId: character.projectId ?? null,
		sourceCharacterId: normalizeText(character.character_id),
		sourceGroupNumber: normalizeText(character.group_number),
		identityHint: normalizeText(character.identity_hint),
		era: normalizeText(character.era),
		culturalRegion: normalizeText(character.cultural_region),
		genre: normalizeText(character.genre),
		timePeriod: normalizeText(character.time_period),
		appearanceBackground: normalizeText(character.appearance_background),
		scene: normalizeText(character.scene),
		gender: normalizeText(character.gender),
		ageGroup: normalizeText(character.age_group),
		species: normalizeText(character.species),
		physique: normalizeText(character.physique),
		heightLevel: normalizeText(character.height_level),
		skinColor: normalizeText(character.skin_color),
		hairLength: normalizeText(character.hair_length),
		hairColor: normalizeText(character.hair_color),
		temperament: normalizeText(character.temperament),
		outfit: normalizeText(character.outfit),
		distinctiveFeatures: normalizeText(character.distinctive_features),
		filterWorldview: normalizeText(character.filter_worldview),
		filterTheme: normalizeText(character.filter_theme),
		filterScene: normalizeText(character.filter_scene),
		sourceImages: {
			fullBody: normalizeText(character.full_body_image_url),
			threeView: normalizeText(character.three_view_image_url),
			expression: normalizeText(character.expression_image_url),
			closeup: normalizeText(character.closeup_image_url),
		},
		importedImages: {
			fullBody: normalizeText(character.full_body_image_url),
			threeView: normalizeText(character.three_view_image_url),
			expression: normalizeText(character.expression_image_url),
			closeup: normalizeText(character.closeup_image_url),
		},
		importedAt: normalizeText(character.imported_at),
		updatedAt: normalizeText(character.updated_at),
	};
}
