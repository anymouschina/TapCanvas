import { z } from "@hono/zod-openapi";

const IntentSelectionTraceSchema = z.object({
  candidateId: z.string().trim().min(1).max(200),
  candidateKind: z.enum(["skill", "domain", "asset", "execution", "other"]),
  selected: z.boolean(),
  candidateSetId: z.string().trim().min(1).max(160).optional(),
  recallSource: z.enum(["skill_catalog", "project_context", "canvas", "agent", "other"]).optional(),
  rank: z.number().int().positive().optional(),
  score: z.number().finite().min(0).max(1).optional(),
  coversRequirementIds: z.array(z.string().trim().min(1).max(120)).max(48),
  conflictsRequirementIds: z.array(z.string().trim().min(1).max(120)).max(48),
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).max(16),
  reason: z.string().trim().min(1).max(400),
  at: z.string().trim().min(1).max(80),
}).strict();

export const AgentExecutionProvenanceSchema = z.object({
  version: z.literal(1),
  executionId: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(200).optional(),
  parentAgentId: z.string().trim().min(1).max(200).optional(),
  sessionId: z.string().trim().min(1).max(500).optional(),
  depth: z.number().int().min(0),
  model: z.string().trim().min(1).max(200),
  apiStyle: z.enum(["chat", "responses"]),
  requiredSkills: z.array(z.string().trim().min(1).max(200)).max(64),
  loadedSkills: z.array(z.string().trim().min(1).max(200)).max(64),
  loadedSkillResources: z.array(z.object({
    skill: z.string().trim().min(1).max(200),
    resource: z.string().trim().min(1).max(500),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    contentChars: z.number().int().min(0).optional(),
  }).strict()).max(64).optional(),
  loadedSkillSources: z.array(z.object({
    skill: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).max(4_000).optional(),
    sourceKind: z.enum(["skill", "section", "resource", "external"]),
    source: z.string().trim().min(1).max(500),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentChars: z.number().int().min(0),
    decisionBasisRole: z.enum(["professional_method", "evidence_only"]).optional(),
  }).strict()).max(128).optional(),
  loadedKnowledgeSources: z.array(z.object({
    cardId: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(4_000).optional(),
    domain: z.string().trim().min(1).max(200).optional(),
    facet: z.string().trim().min(1).max(200).optional(),
    sourceUrls: z.array(z.string().trim().min(1).max(2_000)).max(16),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentChars: z.number().int().min(0),
  }).strict()).max(64).optional(),
  startedAt: z.string().datetime(),
  userIntentContractHash: z.string().trim().min(1).max(128).optional(),
  intentSelectionTrace: z.array(IntentSelectionTraceSchema).max(64).optional(),
}).strict();

export type AgentExecutionProvenance = z.infer<typeof AgentExecutionProvenanceSchema>;

export const ParentAgentExecutionSchema = z.object({
  model: z.string().trim().min(1),
  apiStyle: z.enum(["chat", "responses"]),
  provenance: AgentExecutionProvenanceSchema.optional(),
});

export type ParentAgentExecution = z.infer<typeof ParentAgentExecutionSchema>;

export function parseAgentExecutionProvenance(value: unknown): AgentExecutionProvenance | null {
  const parsed = AgentExecutionProvenanceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
