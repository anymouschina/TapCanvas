import { z } from "zod";

const NonEmptyTextSchema = z.string().trim().min(1);

export const MasterStoryboardShotSchema = z
  .object({
    shotNo: z.union([z.number().int().positive(), NonEmptyTextSchema]),
    景别: z.string(),
    构图: z.string(),
    运镜: z.string(),
    动作: z.string(),
    光效: z.string(),
    台词: z.string(),
    音效: z.string(),
  })
  .passthrough();

export const MasterStoryboardSegmentSchema = z
  .object({
    segmentIndex: z.number().int().nonnegative(),
    beatName: NonEmptyTextSchema,
    durationSeconds: z.number().int().positive(),
    shots: z.array(MasterStoryboardShotSchema).min(1).max(6),
  })
  .passthrough();

const MasterStoryboardLockSchema = z
  .object({
    name: NonEmptyTextSchema,
    cardNodeId: NonEmptyTextSchema.optional(),
    imageUrl: NonEmptyTextSchema.optional(),
  })
  .passthrough();

/**
 * Machine-readable master storyboard contract.
 *
 * This schema deliberately does not coerce strings to numbers and does not
 * manufacture missing shot fields. Semantic repair belongs to the agent that
 * authored the table; the server only validates the submitted structure.
 */
export const MasterShotTableSchema = z
  .object({
    title: NonEmptyTextSchema,
    globalStyleAnchor: NonEmptyTextSchema,
    characterLocks: z.array(MasterStoryboardLockSchema),
    sceneLocks: z.array(MasterStoryboardLockSchema),
    segments: z.array(MasterStoryboardSegmentSchema).min(1).max(64),
  })
  .passthrough()
  .superRefine((table, context) => {
    table.segments.forEach((segment, index) => {
      if (segment.segmentIndex !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["segments", index, "segmentIndex"],
          message: `segmentIndex must be contiguous and zero-based; expected ${index}`,
        });
      }
    });
  });

export type MasterShotTable = z.infer<typeof MasterShotTableSchema>;
export type MasterStoryboardSegment = z.infer<typeof MasterStoryboardSegmentSchema>;

export type MasterShotTableIssue = {
  path: Array<string | number>;
  message: string;
  code: string;
};

export function describeMasterShotTableIssues(error: z.ZodError): MasterShotTableIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path,
    message: issue.message,
    code: issue.code,
  }));
}
