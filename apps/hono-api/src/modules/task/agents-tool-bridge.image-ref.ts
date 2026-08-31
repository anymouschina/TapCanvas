/**
 * 判定一个图片引用是否「可用」（纯函数）。
 *
 * Q3(a) 修复：trace 里小T 把 imageUrl 传成 "data:image/png;base64,placeholder" 占位符。
 * analyze-image 是 nodeId 优先，所以那次靠 nodeId 兜底没出事；但若只传占位符（无可解析 nodeId），
 * 就会把垃圾 data URL 发给视觉模型 → 幻觉/失败。这里把占位/残缺的引用判为不可用，让上层直接报错，
 * 强制小T 传组内图的真实 http(s) URL 或可解析 nodeId。
 */
export function isUsableImageRef(value: unknown): boolean {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  // data:image/...;base64,<payload> —— payload 必须是像样的 base64，不能是 "placeholder" 之类占位。
  if (/^data:image\//i.test(s)) {
    const comma = s.indexOf(",");
    if (comma < 0) return false;
    const payload = s.slice(comma + 1).trim();
    if (!payload) return false;
    if (/placeholder/i.test(payload)) return false;
    // 真实 base64 图片远比一个单词长；64 字符门槛足以挡掉占位/截断。
    return payload.length >= 64;
  }
  return false;
}
