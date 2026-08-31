import { z } from "zod";

export const CharacterIdentityBoardSpecSchema = z.object({
  layout: z.literal("identity_board_four_view"),
  faceViews: z.tuple([z.literal("front"), z.literal("three_quarter")]),
  fullBodyViews: z.tuple([z.literal("front"), z.literal("back")]),
  crossViewConsistency: z.literal(true),
  referenceRoleIsolation: z.literal(true),
  neutralReferenceBackground: z.literal(true),
  readableTextVisible: z.literal(false),
  brandingVisible: z.literal(false),
  neutralBaseState: z.literal(true),
  canonicalNameVisible: z.literal(false),
  ipSafeOriginal: z.literal(true),
}).strict();

export type CharacterIdentityBoardSpec = z.infer<typeof CharacterIdentityBoardSpecSchema>;
