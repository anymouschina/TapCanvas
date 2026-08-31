import { z } from "zod";

const KnowledgeRoleSchema = z.enum([
  "director",
  "storyboard",
  "generation",
  "editor",
  "post",
  "qa",
]);

export const KnowledgeAdminCardInputSchema = z.object({
  id: z.string().trim().min(1).max(128),
  domain: z.string().trim().min(1).max(160),
  facet: z.string().trim().max(160).nullable(),
  title: z.string().trim().min(1).max(2_000),
  roleScope: z.array(KnowledgeRoleSchema).max(128),
  keywords: z.array(z.string().trim().min(1).max(2_000)).max(128),
  sourceUrls: z.array(z.string().trim().min(1).max(2_000)).max(128),
  body: z.string().trim().min(1).max(500_000),
}).strict();

export type KnowledgeAdminCardInputDto = z.infer<typeof KnowledgeAdminCardInputSchema>;

export const KnowledgeAdminListQuerySchema = z.object({
  collection: z.string().trim().min(1).max(64).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  query: z.string().trim().max(500).optional(),
  domain: z.string().trim().max(160).optional(),
  facet: z.string().trim().max(160).optional(),
  roleScope: KnowledgeRoleSchema.optional(),
}).strict();

export type KnowledgeAdminListQueryDto = z.infer<typeof KnowledgeAdminListQuerySchema>;

// Stored cards predate the admin input contract and may contain longer,
// methodologically rich titles. Responses must validate their shape without
// applying create/edit limits to already-persisted knowledge.
export const KnowledgeAdminCardSchema = z.object({
  id: z.string().min(1),
  domain: z.string(),
  facet: z.string().nullable(),
  title: z.string().min(1),
  roleScope: z.array(KnowledgeRoleSchema),
  keywords: z.array(z.string()),
  sourceUrls: z.array(z.string()),
  body: z.string(),
  path: z.string(),
  sourceRoot: z.string(),
  sourceKind: z.enum(["filesystem", "admin"]),
  contentSha256: z.string().length(64),
  embeddingModel: z.string().min(1),
  updatedAt: z.string().min(1),
  collectionId: z.string().min(1).max(64),
  collectionLabel: z.string().min(1),
  editable: z.boolean(),
}).strict();

export type KnowledgeAdminCardDto = z.infer<typeof KnowledgeAdminCardSchema>;

export const KnowledgeAdminListResponseSchema = z.object({
  embeddingModel: z.string().min(1),
  cards: z.array(KnowledgeAdminCardSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }).strict(),
  filters: z.object({
    collections: z.array(z.object({
      id: z.string().min(1).max(64),
      label: z.string().min(1),
      sourceRoot: z.string().min(1),
      editable: z.boolean(),
      count: z.number().int().nonnegative(),
    }).strict()),
    domains: z.array(z.string()),
    facets: z.array(z.string()),
    roles: z.array(KnowledgeRoleSchema),
  }).strict(),
}).strict();

export type KnowledgeAdminListResponseDto = z.infer<typeof KnowledgeAdminListResponseSchema>;

export const KnowledgeAdminSyncSummarySchema = z.object({
  status: z.literal("synced"),
  scope: z.enum(["card", "all"]),
  indexedCards: z.number().int().nonnegative(),
  totalCards: z.number().int().nonnegative(),
  embeddingModel: z.string().min(1),
}).strict();

export type KnowledgeAdminSyncSummaryDto = z.infer<typeof KnowledgeAdminSyncSummarySchema>;

export const KnowledgeAdminUpsertResponseSchema = z.object({
  card: KnowledgeAdminCardSchema,
  sync: KnowledgeAdminSyncSummarySchema,
}).strict();

export type KnowledgeAdminUpsertResponseDto = z.infer<typeof KnowledgeAdminUpsertResponseSchema>;
