export type RuntimeBindingIssue = Readonly<{
  path: string;
  message: string;
}>;

export type RuntimeBindingErrorCode = 'invalid_schema' | 'invalid_metadata' | 'invalid_candidate';
export type RuntimeDerivedOutputPath = readonly string[];

export class RuntimeBindingSchemaError extends Error {
  readonly code: RuntimeBindingErrorCode;
  readonly path: string;
  constructor(code: RuntimeBindingErrorCode, path: string, message: string);
}

/** Return an Agent-facing schema with host-owned binding fields and metadata removed. */
export function projectRuntimeBoundJsonSchema(schema: unknown): Record<string, unknown>;

/** All schema-declared host-owned output paths; `*` marks array items. */
export function runtimeDerivedOutputPaths(schema: unknown): readonly RuntimeDerivedOutputPath[];

/** All host-owned output paths, including table-bound and derived fields. */
export function runtimeOwnedOutputPaths(schema: unknown): readonly RuntimeDerivedOutputPath[];

/** Remove only schema-declared runtime-owned fields from a cloned delivered value. */
export function projectRuntimeBoundJsonValueForAuthor(value: unknown, schema: unknown): unknown;

/** Project both JSON Schema fields and auxiliary contract rules owned by runtime derivations. */
export function projectRuntimeBoundJsonOutputContract<T extends object>(contract: T): T;

/**
 * Add frozen table columns selected by explicit schema metadata.
 * Candidate shape or binding conflicts are returned in `issues`; malformed
 * schemas throw RuntimeBindingSchemaError.
 */
export function materializeRuntimeBoundJson(
  value: unknown,
  schema: unknown,
): Readonly<{ value: unknown; issues: readonly RuntimeBindingIssue[] }>;
