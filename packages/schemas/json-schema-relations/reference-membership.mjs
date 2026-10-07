export const REFERENCE_SOURCE_KEYWORD = 'x-referenceSource';
export const FROZEN_REFERENCE_CATALOGS_KEYWORD = 'x-frozenReferenceCatalogs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate exact frozen permission membership without exposing the catalog to the author. */
export function inspectReferenceMembership(schema, value, path, catalogs) {
  if (!record(schema) || !Object.hasOwn(schema, REFERENCE_SOURCE_KEYWORD)) return [];
  // An unbound schema declares its reference sources but contains no runtime
  // permission contract. Structural-only parsing of that schema does not grant
  // access; permission verification runs against the separately bound contract.
  if (catalogs === undefined) return [];
  const source = schema[REFERENCE_SOURCE_KEYWORD];
  const ids = record(catalogs) && typeof source === 'string' ? catalogs[source] : undefined;
  if (typeof source !== 'string' || !source.length || !Array.isArray(ids)
    || ids.some(id => typeof id !== 'string' || !id.length) || new Set(ids).size !== ids.length) {
    return [{ path, message: `${path} has an invalid frozen reference catalog` }];
  }
  // Ordinary schema type constraints report non-string candidates.
  if (typeof value !== 'string') return [];
  return ids.includes(value) ? [] : [{ path,
    message: `${path}: reference ${JSON.stringify(value)} is outside frozen catalog ${JSON.stringify(source)}` }];
}
