export type AuthorJsonValue = null | boolean | number | string
  | readonly AuthorJsonValue[] | { readonly [key: string]: AuthorJsonValue };

/** This scope binds an author projection, never a compiled artifact or task verdict. */
export type AuthorEditScope = Readonly<{
  version: 1;
  representation: "author_projection";
  baseline: AuthorJsonValue;
  baselineHash: string;
  editablePaths: readonly string[];
  scopeHash: string;
}>;

export class AuthorEditScopeProtocolError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string);
}

export type AuthorEditScopeInspection =
  | Readonly<{ status: "within_scope"; violations: readonly [] }>
  | Readonly<{ status: "current_action_not_applied"; violations: readonly Readonly<{
    path: string;
    kind: "value_changed" | "presence_changed" | "array_structure_changed";
  }>[] }>;

export function createAuthorEditScope(input: Readonly<{ baseline: unknown; editablePaths: unknown }>): AuthorEditScope;
export function normalizeAuthorEditScope(value: unknown): AuthorEditScope;
export function inspectAuthorEditScope(input: Readonly<{ scope: unknown; candidate: unknown }>): AuthorEditScopeInspection;
