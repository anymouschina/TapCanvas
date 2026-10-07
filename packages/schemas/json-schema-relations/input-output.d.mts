export const INPUT_OUTPUT_RELATIONS_KEYWORD: 'x-inputOutputRelations';

export type JsonPathSegment = string | number;

export type InputOutputRelationDeclaration = Readonly<{
  inputPort: string;
  inputIndex: number;
  inputPath: readonly JsonPathSegment[];
  outputPath: readonly JsonPathSegment[];
  optional?: boolean;
}>;

export type BoundInputOutputRelation = Readonly<{
  inputPort: string;
  inputIndex: number;
  inputPath: readonly JsonPathSegment[];
  outputPath: readonly JsonPathSegment[];
  expectedValue: unknown;
}>;

export type InputOutputRelationIssue = Readonly<{ path: string; message: string }>;

export function bindInputOutputRelations(
  schema: Readonly<Record<string, unknown>>,
  inputPorts: Readonly<Record<string, readonly unknown[]>>,
): Record<string, unknown>;

export function inspectInputOutputRelations(
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
  path?: string,
): readonly InputOutputRelationIssue[];
