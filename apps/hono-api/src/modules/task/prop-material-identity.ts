export type PropBaseMaterialIdentity = {
  mode: "base";
  canonicalName: string;
};

export type PropStateMaterialIdentity = {
  mode: "state";
  canonicalName: string;
  canonicalAssetId: string;
  stateKey: string;
  stateDescription: string;
};

export type PropMaterialIdentity =
  | PropBaseMaterialIdentity
  | PropStateMaterialIdentity;

export type PropMaterialIdentityParseResult =
  | { ok: true; value: PropMaterialIdentity }
  | { ok: false; error: string };

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePropMaterialIdentity(
  value: unknown,
): PropMaterialIdentityParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "materialIdentity 必须是对象" };
  }
  const record = value as Record<string, unknown>;
  const mode = trimmedString(record.mode);
  const canonicalName = trimmedString(record.canonicalName);
  if (mode !== "base" && mode !== "state") {
    return { ok: false, error: "materialIdentity.mode 必须是 base 或 state" };
  }
  if (!canonicalName) {
    return { ok: false, error: "materialIdentity.canonicalName 必填" };
  }
  if (mode === "base") {
    return { ok: true, value: { mode, canonicalName } };
  }
  const canonicalAssetId = trimmedString(record.canonicalAssetId);
  const stateKey = trimmedString(record.stateKey);
  const stateDescription = trimmedString(record.stateDescription);
  if (!canonicalAssetId) {
    return { ok: false, error: "state materialIdentity.canonicalAssetId 必填" };
  }
  if (!stateKey) {
    return { ok: false, error: "state materialIdentity.stateKey 必填" };
  }
  if (!stateDescription) {
    return { ok: false, error: "state materialIdentity.stateDescription 必填" };
  }
  return {
    ok: true,
    value: {
      mode,
      canonicalName,
      canonicalAssetId,
      stateKey,
      stateDescription,
    },
  };
}

export function readPropMaterialIdentity(
  nodeData: Record<string, unknown> | null | undefined,
): PropMaterialIdentity | null {
  const parsed = parsePropMaterialIdentity(nodeData?.materialIdentity);
  return parsed.ok ? parsed.value : null;
}

export function selectCanonicalPropBaseImageUrl(
  versions: Array<{ version: number; data: unknown }>,
): string | null {
  const base = versions
    .filter((version) => {
      if (!version.data || typeof version.data !== "object" || Array.isArray(version.data)) {
        return false;
      }
      const data = version.data as Record<string, unknown>;
      return (
        !trimmedString(data.stateKey) &&
        /^https?:\/\//.test(trimmedString(data.imageUrl))
      );
    })
    .sort((left, right) => right.version - left.version)[0];
  if (!base || !base.data || typeof base.data !== "object" || Array.isArray(base.data)) {
    return null;
  }
  return trimmedString((base.data as Record<string, unknown>).imageUrl) || null;
}
