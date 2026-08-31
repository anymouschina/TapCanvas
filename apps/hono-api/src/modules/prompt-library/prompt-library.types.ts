export const PROMPT_LIBRARY_AUTHOR_LABEL = "搜集自网络";

export const SUPPORTED_PROMPT_MODELS = [
	{ slug: "gpt-image-2", name: "GPT Image 2" },
	{ slug: "nano-banana-pro", name: "Nano Banana Pro" },
	{ slug: "seedream-4-5", name: "Seedream 4.5" },
	{ slug: "gpt-image-1-5", name: "GPT Image 1.5" },
	{ slug: "seedance-2-5", name: "Seedance 2.5" },
	{ slug: "seedance-2-0", name: "Seedance 2.0" },
	{ slug: "grok-imagine", name: "Grok Imagine" },
	{ slug: "gemini-3-pro", name: "Gemini 3 Pro" },
] as const;

export type PromptMediaKind = "image" | "video";
export type PromptLibrarySort = "likes_desc" | "name_asc" | "time_asc" | "time_desc";

export type ParsedPromptMedia = {
	kind: PromptMediaKind;
	url: string;
	thumbnailUrl: string | null;
	width: number | null;
	height: number | null;
};

export type ParsedPromptSource = {
	sourcePromptId: string;
	sourceUrl: string;
	title: string;
	description: string | null;
	promptText: string;
	promptTextOriginal: string;
	mediaType: PromptMediaKind;
	media: ParsedPromptMedia[];
	sourceAuthor: string | null;
	sourceAuthorUrl: string | null;
	originalLanguage: string | null;
	modelSlug: string;
	modelName: string;
	originalSourceUrl: string | null;
	categories: string[];
	publishedAt: string | null;
	metrics: {
		likes: number;
		views: number;
		shares: number;
		comments: number;
		bookmarks: number;
		quotes: number;
	};
};

export type PromptLibraryModel = {
	slug: string;
	name: string;
};

export type PromptLibraryMedia = {
	id: string;
	kind: PromptMediaKind;
	url: string;
	thumbnailUrl: string | null;
	width: number | null;
	height: number | null;
	order: number;
};

export type PromptLibraryCard = {
	id: string;
	title: string;
	description: string | null;
	promptText: string;
	mediaType: PromptMediaKind;
	authorLabel: string;
	publishedAt: string | null;
	models: PromptLibraryModel[];
	media: PromptLibraryMedia[];
	likes: number;
	comments: number;
};

export type PromptLibraryFacets = {
	media: Array<{ kind: PromptMediaKind; count: number }>;
	models: Array<{ slug: string; name: string; count: number }>;
	allMediaCount: number;
	allModelCount: number;
};

export type PromptLibraryDetail = PromptLibraryCard & {
	promptTextOriginal: string | null;
	categories: string[];
	sourceUrl: string;
	originalSourceUrl: string | null;
	originalLanguage: string | null;
	metrics: ParsedPromptSource["metrics"];
	viewerLiked: boolean;
	communityComments: PromptLibraryComment[];
};

export type PromptLibraryComment = {
	id: string;
	content: string;
	authorName: string;
	createdAt: string;
	canDelete: boolean;
};

export type CrawlRunStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "partial"
	| "failed";

export type PromptLibraryCrawlRun = {
	id: string;
	targetSite: string;
	status: CrawlRunStatus;
	discoveredCount: number;
	processedCount: number;
	importedCount: number;
	deduplicatedCount: number;
	skippedCount: number;
	failedCount: number;
	currentUrl: string | null;
	errorMessage: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	createdAt: string;
	updatedAt: string;
};
