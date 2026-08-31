type UnknownRecord = Record<string, unknown>;

function positiveNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function clipDurationSeconds(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const clip = value as UnknownRecord;
  const declared = positiveNumber(clip.durationSeconds);
  if (declared != null) return declared;
  if (!Array.isArray(clip.shots) || clip.shots.length === 0) return null;
  const shotDurations = clip.shots.map((shot) => {
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) return null;
    return positiveNumber((shot as UnknownRecord).durationSeconds);
  });
  if (shotDurations.some((duration) => duration == null)) return null;
  return shotDurations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
}

/**
 * 从冻结计划的真实 clip 时长恢复章级总时长。任一 clip 缺少确定性时长即返回 null；
 * 禁止用默认镜长、平均值或部分求和掩盖损坏的持久计划。
 */
export function deriveStoredPlanTargetDurationSeconds(plan: unknown): number | null {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const record = plan as UnknownRecord;
  const declared = positiveNumber(record.targetDurationSeconds);
  if (declared != null) return declared;
  if (!Array.isArray(record.clips) || record.clips.length === 0) return null;
  const durations = record.clips.map(clipDurationSeconds);
  if (durations.some((duration) => duration == null)) return null;
  const total = durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
  return total > 0 ? total : null;
}
