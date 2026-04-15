export type StoryboardPlanRecord = {
  planId: string;
  taskId: string;
  chapter?: number;
  taskTitle?: string;
  mode: "single" | "full";
  groupSize: 1 | 4 | 9 | 25;
  outputAssetId?: string;
  runId?: string;
  storyboardContent?: string;
  storyboardStructured?: unknown;
  shotPrompts: string[];
  nextChunkIndexByGroup?: {
    "1"?: number;
    "4"?: number;
    "9"?: number;
    "25"?: number;
  };
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortStoryboardPlansNewestFirst(plans: StoryboardPlanRecord[]): StoryboardPlanRecord[] {
  return [...plans].sort((left, right) => {
    const updatedSort = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    if (updatedSort !== 0) return updatedSort;
    const createdSort = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
    if (createdSort !== 0) return createdSort;
    return String(right.planId || "").localeCompare(String(left.planId || ""));
  });
}

export function selectStoryboardPlanReadResult(input: {
  plans: StoryboardPlanRecord[];
  chapter: number;
  taskId?: string;
  planId?: string;
}): {
  matchedPlan: StoryboardPlanRecord | null;
  chapterPlans: StoryboardPlanRecord[];
} {
  const chapter = Math.trunc(Number(input.chapter || 0));
  const chapterPlans = sortStoryboardPlansNewestFirst(
    input.plans.filter((plan) => Number(plan.chapter || 0) === chapter),
  );
  const planId = readTrimmedString(input.planId);
  if (planId) {
    return {
      matchedPlan: chapterPlans.find((plan) => plan.planId === planId) || null,
      chapterPlans,
    };
  }
  const taskId = readTrimmedString(input.taskId);
  if (taskId) {
    return {
      matchedPlan: chapterPlans.find((plan) => plan.taskId === taskId) || null,
      chapterPlans,
    };
  }
  return {
    matchedPlan: chapterPlans[0] || null,
    chapterPlans,
  };
}
