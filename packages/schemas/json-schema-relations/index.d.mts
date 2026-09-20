export const FIELD_RELATIONS_KEYWORD: 'x-fieldRelations';
export function inspectFieldRelations(schema: Readonly<Record<string, unknown>>, value: Readonly<Record<string, unknown>>, path: string): readonly Readonly<{ path: string; message: string }>[];
