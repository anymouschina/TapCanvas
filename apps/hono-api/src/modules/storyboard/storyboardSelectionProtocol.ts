import { z } from "zod";

export {
	STORYBOARD_GROUP_SIZES,
	STORYBOARD_REFERENCE_BINDING_KINDS,
	STORYBOARD_SELECTION_PROTOCOL_VERSION,
	STORYBOARD_SELECTION_SCOPES,
	collectStoryboardSelectionReferenceImageUrls,
	normalizeStoryboardReferenceBinding,
	normalizeStoryboardReferenceBindings,
	normalizeStoryboardSelectionContext,
	type StoryboardGroupSize,
	type StoryboardReferenceBinding,
	type StoryboardReferenceBindingKind,
	type StoryboardSelectionContext,
	type StoryboardSelectionScope,
} from "../../../../../packages/schemas/storyboard-selection-protocol";

import {
	STORYBOARD_GROUP_SIZES,
	STORYBOARD_REFERENCE_BINDING_KINDS,
	STORYBOARD_SELECTION_PROTOCOL_VERSION,
	STORYBOARD_SELECTION_SCOPES,
} from "../../../../../packages/schemas/storyboard-selection-protocol";

export const storyboardSelectionScopeSchema = z.enum(STORYBOARD_SELECTION_SCOPES);

export const storyboardReferenceBindingKindSchema = z.enum(
	STORYBOARD_REFERENCE_BINDING_KINDS,
);

export const storyboardReferenceBindingSchema = z
	.object({
		kind: storyboardReferenceBindingKindSchema,
		refId: z.string().min(1).max(200).optional(),
		label: z.string().min(1).max(200),
		imageUrl: z.string().min(1).max(10_000),
	})
	.strict();

const storyboardGroupSizeSchema = z.union(
	STORYBOARD_GROUP_SIZES.map((size) => z.literal(size)) as [
		z.ZodLiteral<1>,
		z.ZodLiteral<4>,
		z.ZodLiteral<9>,
		z.ZodLiteral<25>,
	],
);

export const storyboardSelectionContextSchema = z
	.object({
		version: z.literal(STORYBOARD_SELECTION_PROTOCOL_VERSION),
		scope: storyboardSelectionScopeSchema,
		taskId: z.string().min(1).max(200).optional(),
		planId: z.string().min(1).max(200).optional(),
		chunkId: z.string().min(1).max(200).optional(),
		chunkIndex: z.number().int().min(0).max(9_999).optional(),
		groupSize: storyboardGroupSizeSchema.optional(),
		shotStart: z.number().int().min(1).max(5_000).optional(),
		shotEnd: z.number().int().min(1).max(5_000).optional(),
		shotNo: z.number().int().min(1).max(5_000).optional(),
		frameIndex: z.number().int().min(0).max(24).optional(),
		title: z.string().min(1).max(200).optional(),
		imageUrl: z.string().min(1).max(10_000).optional(),
		sourceBookId: z.string().min(1).max(200).optional(),
		materialChapter: z.number().int().min(1).max(9_999).optional(),
		storyContext: z.string().min(1).max(4_000).optional(),
		shotPrompt: z.string().min(1).max(12_000).optional(),
		storyboardScript: z.string().min(1).max(20_000).optional(),
		modelKey: z.string().min(1).max(200).optional(),
		aspectRatio: z.string().min(1).max(40).optional(),
		referenceBindings: z.array(storyboardReferenceBindingSchema).max(12).optional(),
	})
	.strict();
