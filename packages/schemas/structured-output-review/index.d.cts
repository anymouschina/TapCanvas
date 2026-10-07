import type {
  StructuredOutputReviewProjectionIssueV1,
  StructuredOutputReviewProjectionV1,
  StructuredOutputReviewV1,
} from "@tapcanvas/agent-observability";

export function projectStructuredOutputReview(value: unknown): StructuredOutputReviewProjectionV1;
export function normalizeStructuredOutputReview(value: unknown): StructuredOutputReviewV1 | null;
export function normalizeStructuredOutputReviewProjectionIssue(
  value: unknown,
): StructuredOutputReviewProjectionIssueV1 | null;
