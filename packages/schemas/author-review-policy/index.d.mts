export const AUTHOR_REVIEW_POLICIES: readonly ['disabled', 'independent'];
export type AuthorReviewPolicy = typeof AUTHOR_REVIEW_POLICIES[number];
export function isAuthorReviewPolicy(value: unknown): value is AuthorReviewPolicy;
