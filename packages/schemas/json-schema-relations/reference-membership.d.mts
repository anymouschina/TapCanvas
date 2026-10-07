export const REFERENCE_SOURCE_KEYWORD: 'x-referenceSource';
export const FROZEN_REFERENCE_CATALOGS_KEYWORD: 'x-frozenReferenceCatalogs';
export function inspectReferenceMembership(schema: unknown, value: unknown, path: string, catalogs: unknown): readonly Readonly<{ path: string; message: string }>[];
