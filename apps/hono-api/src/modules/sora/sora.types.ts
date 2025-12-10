export type VideoHistoryRecord = {
	id: string;
	prompt: string;
	parameters?: any;
	imageUrl?: string | null;
	taskId: string;
	generationId?: string | null;
	status: string;
	videoUrl?: string | null;
	thumbnailUrl?: string | null;
	duration?: number | null;
	width?: number | null;
	height?: number | null;
	tokenId?: string | null;
	provider: string;
	model?: string | null;
	cost?: number | null;
	createdAt: string;
	isFavorite?: boolean;
	rating?: number | null;
	notes?: string | null;
};

