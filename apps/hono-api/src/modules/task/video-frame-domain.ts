import { deriveVideoSizeShape, type VideoSizeShape } from "./video-size-shape";

/**
 * A video frame is described by two values in two different domains:
 *
 * - `size`         the model's executable frame token, e.g. `1280x720`;
 * - `aspect_ratio` the reduced ratio the provider validates, e.g. `16:9`.
 *
 * Providers reject a size token in the ratio field. A model catalog may declare
 * either domain as its `size` option value, and it may carry the matching ratio
 * on the same option (`{ value: "1280x720", aspectRatio: "16:9" }` is the
 * canonical new-api shape). Every boundary that writes `aspect_ratio` must
 * therefore project its input through this contract instead of forwarding a
 * caller value verbatim.
 */

export type VideoFrameSizeOption = Readonly<{
	value: string;
	aspectRatio?: string | null;
}>;

export type VideoAspectRatioProjection = Readonly<
	| { kind: "resolved"; aspectRatio: string }
	| { kind: "unresolved"; reason: "size_token_in_ratio_field"; requested: string }
>;

function readTrimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function matchOption(
	sizeOptions: readonly VideoFrameSizeOption[],
	requested: string,
): VideoFrameSizeOption | null {
	const normalized = requested.toLocaleLowerCase("en-US");
	const matches = sizeOptions.filter(
		(option) => readTrimmed(option.value).toLocaleLowerCase("en-US") === normalized,
	);
	return matches.length === 1 ? matches[0]! : null;
}

function matchDeclaredRatio(
	sizeOptions: readonly VideoFrameSizeOption[],
	requested: string,
): string | null {
	const normalized = requested.toLocaleLowerCase("en-US");
	const declared = sizeOptions
		.map((option) => readTrimmed(option.aspectRatio))
		.filter(Boolean);
	const matches = declared.filter((value) => value.toLocaleLowerCase("en-US") === normalized);
	return matches.length >= 1 ? matches[0]! : null;
}

/**
 * Projects one caller-supplied aspect ratio into the ratio domain.
 *
 * Resolution order is structural: a declared size token resolves through its own
 * declared ratio, a declared ratio stays as-is, and a raw `WxH` token reduces to
 * its ratio. A raw dimension token that the model does not offer is reported as
 * unresolved rather than forwarded, because the provider is guaranteed to reject
 * it and the failure must surface before a paid submission.
 */
export function projectVideoAspectRatio(input: Readonly<{
	requested: unknown;
	sizeOptions: readonly VideoFrameSizeOption[];
}>): VideoAspectRatioProjection {
	const requested = readTrimmed(input.requested);
	if (!requested) return { kind: "resolved", aspectRatio: "" };

	const asSize = matchOption(input.sizeOptions, requested);
	const declaredForSize = readTrimmed(asSize?.aspectRatio);
	if (declaredForSize) return { kind: "resolved", aspectRatio: declaredForSize };

	const asRatio = matchDeclaredRatio(input.sizeOptions, requested);
	if (asRatio) return { kind: "resolved", aspectRatio: asRatio };

	const derived: VideoSizeShape = deriveVideoSizeShape(requested);
	if (derived.aspectRatio) {
		const declaredForDerived = matchDeclaredRatio(input.sizeOptions, derived.aspectRatio);
		if (declaredForDerived) return { kind: "resolved", aspectRatio: declaredForDerived };
		if (input.sizeOptions.length > 0) {
			return { kind: "unresolved", reason: "size_token_in_ratio_field", requested };
		}
		return { kind: "resolved", aspectRatio: derived.aspectRatio };
	}

	return { kind: "resolved", aspectRatio: requested };
}
