export const clipObjectStateFields: readonly string[];
export const clipObjectStateSchema: Readonly<Record<string, unknown>>;
export function inspectClipReferenceSelection(
  state: Readonly<Record<string, unknown>>,
  registry: Readonly<Record<string, unknown>>,
  path: string,
): string | null;
