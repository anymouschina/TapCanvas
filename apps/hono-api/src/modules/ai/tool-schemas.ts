/**
 * AI tool contracts + canvas node capability specs.
 *
 * NOTE: This file is intentionally a lightweight, implementation-aligned
 * source of truth for model/node capabilities (kept in sync with apps/web).
 */

export type CanvasNodeKind =
	| "text"
	| "image"
	| "storyboardImage"
	| "imageFission"
	| "mosaic"
	| "video"
	| "composeVideo"
	| "storyboard"
	| "audio"
	| "subtitle"
	| "character";

/**
 * Tool schemas (reserved).
 * The repo currently executes canvas operations on the web side; this export
 * exists to keep a single documented contract surface for future LLM tooling.
 */
export const canvasToolSchemas = [] as const;

/**
 * Node kind + model capability specs.
 * Keep this aligned with the frontend model lists / runner constraints.
 */
export const canvasNodeSpecs = {
	video: {
		label: "图生/文生视频",
		recommendedModels: ["sora-2", "sora-2-pro"],
		models: {
			"sora-2": {
				label: "Sora 2",
				vendor: "sora2api",
				supports: {
					aspectRatio: ["16:9", "9:16"],
					durationSeconds: [10, 15],
					hd: false,
				},
				input: {
					prompt: "string",
					images: "string[] (url/base64)",
				},
			},
			"sora-2-pro": {
				label: "Sora 2 Pro",
				vendor: "sora2api",
				supports: {
					aspectRatio: ["16:9", "9:16"],
					durationSeconds: [10, 15, 25],
					hd: true,
				},
				input: {
					prompt: "string",
					images: "string[] (url/base64)",
					hd: "boolean (default false)",
				},
			},
		},
	},
} as const satisfies Record<string, any>;

