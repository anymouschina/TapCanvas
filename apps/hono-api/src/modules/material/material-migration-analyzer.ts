import { toIdentityKey } from "./identity-key";

export interface MigrationAssetInput {
  id: string;
  kind: string;
  name: string;
  updatedAt: string;
  styleLockId: string | null;
}

export interface MigrationGroup {
  kind: string;
  identityKey: string;
  normalizedName: string;
  canonicalCandidateId: string;
  foldVersionIds: string[];
  memberIds: string[];
}

export function analyzeMaterialMigration(input: {
  assets: MigrationAssetInput[];
  currentStyleLockId: string | null;
}): MigrationGroup[] {
  const byKey = new Map<string, { kind: string; identityKey: string; members: MigrationAssetInput[] }>();
  for (const a of input.assets) {
    const identityKey = toIdentityKey(a.name);
    const key = `${a.kind} ${identityKey}`; // NUL 分隔，名字里不可能出现
    let g = byKey.get(key);
    if (!g) {
      g = { kind: a.kind, identityKey, members: [] };
      byKey.set(key, g);
    }
    g.members.push(a);
  }
  const groups: MigrationGroup[] = [];
  for (const g of byKey.values()) {
    // canonical 启发式：先选 styleLockId === 当前锁 的，再按 updatedAt 最新。
    const sorted = [...g.members].sort((x, y) => {
      const xs = input.currentStyleLockId && x.styleLockId === input.currentStyleLockId ? 1 : 0;
      const ys = input.currentStyleLockId && y.styleLockId === input.currentStyleLockId ? 1 : 0;
      if (xs !== ys) return ys - xs;
      return (y.updatedAt || "").localeCompare(x.updatedAt || "");
    });
    const canonical = sorted[0]!;
    groups.push({
      kind: g.kind,
      identityKey: g.identityKey,
      normalizedName: g.identityKey,
      canonicalCandidateId: canonical.id,
      foldVersionIds: sorted.slice(1).map((m) => m.id),
      memberIds: g.members.map((m) => m.id),
    });
  }
  return groups;
}
