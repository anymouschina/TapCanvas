export const UNIQUE_BY_KEYWORD: 'x-uniqueBy';
type Issue = Readonly<{ path: string; message: string }>;
export function inspectUniqueBy(schema: Readonly<Record<string, unknown>>, values: readonly unknown[], path: string): readonly Issue[];
export function inspectUniqueItems(schema: Readonly<Record<string, unknown>>, values: readonly unknown[], path: string): readonly Issue[];
