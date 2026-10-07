/** Independent model review is separate from structural validation and author repair. */
export const AUTHOR_REVIEW_POLICIES = Object.freeze(['disabled', 'independent']);
export function isAuthorReviewPolicy(value) {
  return typeof value === 'string' && AUTHOR_REVIEW_POLICIES.includes(value);
}
