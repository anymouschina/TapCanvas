import { z } from "zod";

export type StoryFactJsonValue =
	| string
	| number
	| boolean
	| null
	| StoryFactJsonValue[]
	| { [key: string]: StoryFactJsonValue };

export const StoryFactJsonValueSchema: z.ZodType<StoryFactJsonValue> = z.lazy(() =>
	z.union([
		z.string().max(4_000),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(StoryFactJsonValueSchema).max(64),
		z.record(z.string().min(1).max(120), StoryFactJsonValueSchema),
	]),
);

export const StoryFactStatusSchema = z.enum(["confirmed", "inferred", "draft_choice"]);

export const StoryPointSchema = z
	.object({
		chapter: z.number().int().min(1).max(999_999),
		sequence: z.number().int().min(0).max(999_999),
		label: z.string().trim().min(1).max(160).optional(),
	})
	.strict();

export const StoryFactDisclosureSchema = z.discriminatedUnion("mode", [
	z
		.object({
			mode: z.literal("immediate"),
			revealAt: z.null(),
		})
		.strict(),
	z
		.object({
			mode: z.literal("gated"),
			revealAt: StoryPointSchema,
		})
		.strict(),
]);

export const StoryFactSubjectSchema = z
	.object({
		kind: z.string().trim().min(1).max(40),
		key: z.string().trim().min(1).max(160),
		name: z.string().trim().min(1).max(200),
	})
	.strict();

export const StoryFactSourceSelectorSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("chapter_canvas_node"),
			chapterId: z.string().trim().min(1).max(160),
			nodeId: z.string().trim().min(1).max(160),
			field: z.string().trim().min(1).max(80),
		})
		.strict(),
	z
		.object({
			kind: z.literal("book_chapter"),
			chapter: z.number().int().min(1).max(999_999),
		})
		.strict(),
	z
		.object({
			kind: z.literal("creative_brief"),
		})
		.strict(),
]);

export const VerifiedStoryFactSourceSchema = z
	.object({
		kind: z.enum(["chapter_canvas_node", "book_chapter", "creative_brief"]),
		projectId: z.string().min(1).max(160),
		bookId: z.string().min(1).max(200),
		chapter: z.number().int().min(1).max(999_999).optional(),
		chapterId: z.string().min(1).max(160).optional(),
		nodeId: z.string().min(1).max(160).optional(),
		field: z.string().min(1).max(80).optional(),
		fileName: z.string().min(1).max(160).optional(),
		contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
		contentChars: z.number().int().min(1),
		capturedAt: z.string().datetime(),
	})
	.strict();

export const StoryFactAddOperationSchema = z
	.object({
		type: z.literal("add"),
		factId: z.string().trim().min(1).max(160),
		subject: StoryFactSubjectSchema,
		predicate: z.string().trim().min(1).max(160),
		value: StoryFactJsonValueSchema,
		status: StoryFactStatusSchema,
		validFrom: StoryPointSchema,
		disclosure: StoryFactDisclosureSchema,
	})
	.strict();

export const StoryFactCloseOperationSchema = z
	.object({
		type: z.literal("close"),
		factId: z.string().trim().min(1).max(160),
		validUntil: StoryPointSchema,
	})
	.strict();

export const StoryFactSetStatusOperationSchema = z
	.object({
		type: z.literal("set_status"),
		factId: z.string().trim().min(1).max(160),
		expectedStatus: StoryFactStatusSchema,
		status: StoryFactStatusSchema,
	})
	.strict();

export const StoryFactSetDisclosureOperationSchema = z
	.object({
		type: z.literal("set_disclosure"),
		factId: z.string().trim().min(1).max(160),
		expectedDisclosure: StoryFactDisclosureSchema,
		disclosure: StoryFactDisclosureSchema,
	})
	.strict();

export const StoryFactOperationSchema = z.discriminatedUnion("type", [
	StoryFactAddOperationSchema,
	StoryFactCloseOperationSchema,
	StoryFactSetStatusOperationSchema,
	StoryFactSetDisclosureOperationSchema,
]);

export const StoryFactRecordSchema = z
	.object({
		factId: z.string().min(1).max(160),
		subject: StoryFactSubjectSchema,
		predicate: z.string().min(1).max(160),
		value: StoryFactJsonValueSchema,
		status: StoryFactStatusSchema,
		validFrom: StoryPointSchema,
		validUntil: StoryPointSchema.nullable(),
		disclosure: StoryFactDisclosureSchema,
		source: VerifiedStoryFactSourceSchema,
		createdRevision: z.number().int().min(1),
		updatedRevision: z.number().int().min(1),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
	})
	.strict();

export const StoryFactsCommitRecordSchema = z
	.object({
		commitId: z.string().min(1).max(160),
		requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
		baseRevision: z.number().int().min(0),
		revision: z.number().int().min(1),
		actorId: z.string().min(1).max(240),
		source: VerifiedStoryFactSourceSchema,
		operations: z.array(StoryFactOperationSchema).min(1).max(100),
		note: z.string().max(500).optional(),
		createdAt: z.string().datetime(),
	})
	.strict();

export const StoryFactsLedgerSchema = z
	.object({
		schemaVersion: z.literal(2),
		projectId: z.string().min(1).max(160),
		bookId: z.string().min(1).max(200),
		revision: z.number().int().min(0),
		facts: z.array(StoryFactRecordSchema).max(20_000),
		commits: z.array(StoryFactsCommitRecordSchema).max(20_000),
		updatedAt: z.string().datetime().nullable(),
	})
	.strict();

export const StoryFactsGetRequestSchema = z
	.object({
		bookId: z.string().trim().min(1).max(200),
		projection: z.enum(["authoring", "audience_safe"]),
		at: StoryPointSchema.optional(),
		statuses: z.array(StoryFactStatusSchema).min(1).max(3).optional(),
		subjectKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(100).optional(),
		includeClosed: z.boolean().optional(),
		includeCommits: z.boolean().optional(),
		offset: z.number().int().min(0).max(20_000).optional(),
		limit: z.number().int().min(1).max(1_000).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.projection === "audience_safe" && !value.at) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["at"],
				message: "audience_safe projection requires an exact story point",
			});
		}
		if (value.projection === "audience_safe" && value.includeCommits === true) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["includeCommits"],
				message: "audience_safe projection cannot expose commit history",
			});
		}
	});

export const StoryFactsCommitRequestSchema = z
	.object({
		bookId: z.string().trim().min(1).max(200),
		commitId: z.string().trim().min(1).max(160),
		expectedRevision: z.number().int().min(0),
		source: StoryFactSourceSelectorSchema,
		operations: z.array(StoryFactOperationSchema).min(1).max(100),
		note: z.string().trim().max(500).optional(),
	})
	.strict();

export type StoryFactStatus = z.infer<typeof StoryFactStatusSchema>;
export type StoryFactDisclosure = z.infer<typeof StoryFactDisclosureSchema>;
export type StoryPoint = z.infer<typeof StoryPointSchema>;
export type StoryFactSourceSelector = z.infer<typeof StoryFactSourceSelectorSchema>;
export type VerifiedStoryFactSource = z.infer<typeof VerifiedStoryFactSourceSchema>;
export type StoryFactOperation = z.infer<typeof StoryFactOperationSchema>;
export type StoryFactRecord = z.infer<typeof StoryFactRecordSchema>;
export type StoryFactsCommitRecord = z.infer<typeof StoryFactsCommitRecordSchema>;
export type StoryFactsLedger = z.infer<typeof StoryFactsLedgerSchema>;
export type StoryFactsGetRequest = z.infer<typeof StoryFactsGetRequestSchema>;
export type StoryFactsCommitRequest = z.infer<typeof StoryFactsCommitRequestSchema>;
