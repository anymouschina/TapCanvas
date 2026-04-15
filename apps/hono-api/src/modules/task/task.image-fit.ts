type CanvasImageLike = {
	width: number;
	height: number;
};

type CanvasRenderingContext2DLike = {
	fillStyle: string;
	fillRect: (x: number, y: number, width: number, height: number) => void;
	drawImage: (
		image: CanvasImageLike,
		dx: number,
		dy: number,
		dWidth: number,
		dHeight: number,
	) => void;
};

type CanvasLike = {
	getContext: (type: "2d") => CanvasRenderingContext2DLike | null;
	toBuffer: (mimeType?: string) => Buffer;
};

type CanvasModule = {
	createCanvas: (width: number, height: number) => CanvasLike;
	loadImage: (source: Buffer | Uint8Array | string) => Promise<CanvasImageLike>;
};

export type ParsedImageSize = {
	width: number;
	height: number;
};

export type ContainPadPlacement = {
	drawWidth: number;
	drawHeight: number;
	offsetX: number;
	offsetY: number;
};

function normalizePositiveInt(value: number): number {
	return Math.max(1, Math.floor(value));
}

export function parseSizeToDimensions(value: string | null | undefined): ParsedImageSize | null {
	const raw = String(value || "").trim();
	if (!raw) return null;
	const match = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}
	return {
		width: normalizePositiveInt(width),
		height: normalizePositiveInt(height),
	};
}

export function computeContainPadPlacement(input: {
	sourceWidth: number;
	sourceHeight: number;
	targetWidth: number;
	targetHeight: number;
}): ContainPadPlacement {
	const sourceWidth = normalizePositiveInt(input.sourceWidth);
	const sourceHeight = normalizePositiveInt(input.sourceHeight);
	const targetWidth = normalizePositiveInt(input.targetWidth);
	const targetHeight = normalizePositiveInt(input.targetHeight);
	const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
	const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
	const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
	const offsetX = Math.floor((targetWidth - drawWidth) / 2);
	const offsetY = Math.floor((targetHeight - drawHeight) / 2);
	return { drawWidth, drawHeight, offsetX, offsetY };
}

async function loadCanvasModule(): Promise<CanvasModule> {
	const mod = (await import("@napi-rs/canvas")) as unknown as Partial<CanvasModule>;
	if (typeof mod.createCanvas !== "function" || typeof mod.loadImage !== "function") {
		throw new Error("@napi-rs/canvas is unavailable");
	}
	return {
		createCanvas: mod.createCanvas,
		loadImage: mod.loadImage,
	};
}

export async function renderImageContainPad(input: {
	buffer: Buffer;
	contentType: string;
	targetWidth: number;
	targetHeight: number;
	background?: string;
}): Promise<{
	buffer: Buffer;
	contentType: string;
	filenameExtension: string;
	sourceWidth: number;
	sourceHeight: number;
}> {
	const canvasModule = await loadCanvasModule();
	const image = await canvasModule.loadImage(input.buffer);
	const sourceWidth = normalizePositiveInt(image.width);
	const sourceHeight = normalizePositiveInt(image.height);
	const targetWidth = normalizePositiveInt(input.targetWidth);
	const targetHeight = normalizePositiveInt(input.targetHeight);

	if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
		return {
			buffer: input.buffer,
			contentType: input.contentType || "image/png",
			filenameExtension: input.contentType === "image/jpeg" ? "jpg" : "png",
			sourceWidth,
			sourceHeight,
		};
	}

	const canvas = canvasModule.createCanvas(targetWidth, targetHeight);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("2d canvas context unavailable");
	}

	const placement = computeContainPadPlacement({
		sourceWidth,
		sourceHeight,
		targetWidth,
		targetHeight,
	});

	ctx.fillStyle = input.background && input.background.trim() ? input.background.trim() : "#000000";
	ctx.fillRect(0, 0, targetWidth, targetHeight);
	ctx.drawImage(
		image,
		placement.offsetX,
		placement.offsetY,
		placement.drawWidth,
		placement.drawHeight,
	);

	return {
		buffer: canvas.toBuffer("image/png"),
		contentType: "image/png",
		filenameExtension: "png",
		sourceWidth,
		sourceHeight,
	};
}
