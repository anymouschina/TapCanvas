// 把卡名/label 规范化成「纯身份键」：剥类型前缀 + 剥画风/状态/复用尾缀。
// 身份只承载「是谁」；画风归全局风格锁；状态走 stateKey/version（见状态继承根治 spec）。

const PREFIX_RE = /^(角色卡|身份板|场景卡|场景锚|场景参考)\s*[｜|:：·]\s*/;
const SEP = /[｜|]/;

export function toIdentityKey(raw: string): string {
  const original = String(raw ?? "").trim();
  let s = original;
  if (!s) return "";
  // 1) 剥类型前缀（可能带多重，如「角色卡｜」）
  while (PREFIX_RE.test(s)) s = s.replace(PREFIX_RE, "").trim();
  // 2) 以分隔符切段，第一段即身份名（后续段都是画风/状态/复用变体）
  const firstSeg = s.split(SEP)[0]!.trim();
  // 3) 剥空格尾缀（如「枯木浓雾林 场景参考图」「X 场景参考」）
  const SPACE_TAIL_RE = /\s+(场景参考图|场景参考|参考图|身份板|角色卡)$/;
  let out = firstSeg;
  while (SPACE_TAIL_RE.test(out)) out = out.replace(SPACE_TAIL_RE, "").trim();
  return out || original;
}

export function computeIdentityKeyBackfill(
  rows: Array<{ id: string; name: string }>,
): Array<{ id: string; identityKey: string }> {
  return rows.map((r) => ({ id: r.id, identityKey: toIdentityKey(r.name) }));
}
