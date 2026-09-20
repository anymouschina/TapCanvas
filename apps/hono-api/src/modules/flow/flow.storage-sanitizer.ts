/** Remove transient media URLs and true cycles without dropping shared values. */
export function sanitizeFlowDataForStorage(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  const walk = (value: unknown): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^data:[^;]+;base64,/i.test(trimmed) || trimmed.toLowerCase().startsWith("blob:")) return undefined;
      return value;
    }
    if (typeof value !== "object") return value;
    if (ancestors.has(value)) return undefined;
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const result: unknown[] = [];
        for (const item of value) {
          const sanitized = walk(item);
          if (sanitized !== undefined) result.push(sanitized);
        }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const sanitized = walk(item);
        if (sanitized !== undefined) result[key] = sanitized;
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return walk(value);
}
