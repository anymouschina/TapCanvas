export const STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION = "storyboard-director/v1.2" as const;

export const STORYBOARD_FACT_STATUSES = ["confirmed", "inferred", "draft_choice"] as const;
export const STORYBOARD_FACT_VISIBILITIES = ["objective", "viewpoint_only", "hidden"] as const;
export const STORYBOARD_SECRET_BLOCKED_CHANNELS = [
  "relationship_graph",
  "visual_prompt",
  "dialogue",
  "caption",
  "flashback",
  "prop",
  "background",
  "audio",
] as const;

export type StoryboardFactStatus = (typeof STORYBOARD_FACT_STATUSES)[number];
export type StoryboardFactVisibility = (typeof STORYBOARD_FACT_VISIBILITIES)[number];
export type StoryboardSecretBlockedChannel = (typeof STORYBOARD_SECRET_BLOCKED_CHANNELS)[number];

export type StoryboardStoryPoint = {
  chapter: number;
  sequence: number;
  label?: string;
};

export type StoryboardExpectedStoryFactDisclosure =
  | {
      mode: "immediate";
      revealAt: null;
    }
  | {
      mode: "gated";
      revealAt: StoryboardStoryPoint;
    };

export type StoryboardExpectedStoryFactPolicy = {
  factId: string;
  category: string;
  status: StoryboardFactStatus;
  validFrom: StoryboardStoryPoint;
  validUntil: StoryboardStoryPoint | null;
  disclosure: StoryboardExpectedStoryFactDisclosure;
};

export type StoryboardBookLedgerContext = {
  mode: "book_ledger";
  bookId: string;
  ledgerRevision: number;
  effectiveAt: StoryboardStoryPoint;
  consumedFactIds: string[];
  consumedContextKeys: [];
};

export type StoryboardTaskContext = {
  mode: "task_context";
  sourceLabel: string;
  bookId: null;
  ledgerRevision: null;
  effectiveAt: null;
  consumedFactIds: [];
  consumedContextKeys: string[];
};

export type StoryboardStoryFactsContext = StoryboardBookLedgerContext | StoryboardTaskContext;

type StoryboardFactBindingBase = {
  category: string;
  status: StoryboardFactStatus;
};

export type StoryboardVisibleStoryFactBinding = StoryboardFactBindingBase & {
  source: "story_fact";
  factId: string;
  visibility: "objective" | "viewpoint_only";
  directive: string;
};

export type StoryboardHiddenStoryFactBinding = StoryboardFactBindingBase & {
  source: "story_fact";
  factId: string;
  visibility: "hidden";
};

export type StoryboardVisibleTaskContextBinding = StoryboardFactBindingBase & {
  source: "task_context";
  contextKey: string;
  sourceLabel: string;
  visibility: "objective" | "viewpoint_only";
  directive: string;
};

export type StoryboardHiddenTaskContextBinding = StoryboardFactBindingBase & {
  source: "task_context";
  contextKey: string;
  visibility: "hidden";
};

export type StoryboardStoryFactBinding =
  | StoryboardVisibleStoryFactBinding
  | StoryboardHiddenStoryFactBinding
  | StoryboardVisibleTaskContextBinding
  | StoryboardHiddenTaskContextBinding;

type StoryboardRevealGuardBase = {
  blockedChannels: StoryboardSecretBlockedChannel[];
};

export type StoryboardStoryFactRevealGuard = StoryboardRevealGuardBase & {
  source: "story_fact";
  factId: string;
  notBefore: StoryboardStoryPoint;
};

export type StoryboardTaskContextRevealGuard = StoryboardRevealGuardBase & {
  source: "task_context";
  contextKey: string;
  notBeforeShotId: string | null;
};

export type StoryboardRevealGuard = StoryboardStoryFactRevealGuard | StoryboardTaskContextRevealGuard;

export type StoryboardStoryFactLocks = {
  effectiveAt: StoryboardStoryPoint | null;
  bindings: StoryboardStoryFactBinding[];
  revealGuards: StoryboardRevealGuard[];
};

export type StoryboardPurposeLayer = {
  dramaticBeat: string;
  storyPurpose: string;
  beatRole?: "opening" | "escalation" | "payoff";
  emotionalShift?: string;
  escalation?: string;
  continuity?: string;
  durationSec?: number;
  transitionHook?: string;
};

export type StoryboardRenderLayer = {
  promptText: string;
  subjectAction?: string;
  shotType?: string;
  cameraMovement?: string;
  perspective?: string;
  subjects?: string[];
  environment?: string;
  timeLighting?: string;
  colorTone?: string;
  composition?: string;
  qualityTags?: string[];
};

export type StoryboardStructuredShot = {
  shotNo: number | null;
  sourceShotId?: string;
  exitState?: string;
  storyFactLocks?: StoryboardStoryFactLocks;
  purpose: StoryboardPurposeLayer;
  render: StoryboardRenderLayer;
};

export type StoryboardStructuredData = {
  version: "two_phase_v1";
  sourceSchemaVersion?: typeof STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION;
  storyFactsContext?: StoryboardStoryFactsContext;
  totalDurationSec?: number;
  pacingGoal?: string;
  progressionSummary?: string;
  continuityPlan?: string;
  shots: StoryboardStructuredShot[];
};

export type StoryboardDirectorV12ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type StoryboardDirectorV12ValidatedShot = {
  record: Record<string, unknown>;
  shotId: string;
  exitState: string;
  continuityFromPrev: string;
  storyFactLocks: StoryboardStoryFactLocks;
};

export type StoryboardDirectorV12ValidatedContract = {
  record: Record<string, unknown>;
  globalStyle: Record<string, unknown>;
  storyFactsContext: StoryboardStoryFactsContext;
  shots: StoryboardDirectorV12ValidatedShot[];
};

export type StoryboardDirectorV12ValidationResult =
  | { ok: true; value: StoryboardDirectorV12ValidatedContract }
  | { ok: false; issues: StoryboardDirectorV12ValidationIssue[] };
