export type PerformanceMode = 'dialogue' | 'action' | 'vfx' | 'flashback' | 'atmosphere';
export const PERFORMANCE_MODES: readonly PerformanceMode[];
export const PERFORMANCE_MODE_LABELS: Readonly<Record<PerformanceMode, string>>;
export function isPerformanceMode(value: unknown): value is PerformanceMode;
export function distinctPerformanceModes(values: Iterable<unknown> | null | undefined): PerformanceMode[];
