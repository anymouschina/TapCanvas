export const INDEX_REFERENCES_KEYWORD: 'x-indexReferences';
export function inspectIndexReferences(schema: Readonly<Record<string, unknown>>, value: Readonly<Record<string, unknown>>, path: string): readonly Readonly<{ path: string; message: string }>[];
