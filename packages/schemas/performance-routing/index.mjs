/**
 * Performance modes: what kind of performance a story beat is. The chapter author
 * tags every beat; each Clip author then receives the Skills and knowledge cards
 * routed to the modes its window actually contains, so a fight Clip gets action
 * methods and a system-panel Clip gets VFX methods instead of one shared set.
 *
 * Routes are declared where the content lives: a Skill's own frontmatter
 * `metadata.performance-preload`, and the knowledge-card table in the
 * `tapcanvas-performance-routing` Skill. This module only names the modes.
 */
export const PERFORMANCE_MODES = Object.freeze(['dialogue', 'action', 'vfx', 'flashback', 'atmosphere']);

/** How each mode is explained to the author who tags beats. */
export const PERFORMANCE_MODE_LABELS = Object.freeze({
  dialogue: '文戏：对话、表演、人物之间的交锋与反应',
  action: '动作：打斗、追逐、身体发力与受力',
  vfx: '特效：法术、能量、系统面板与光幕等超现实画面',
  flashback: '回忆：闪回、插入的往事、蒙太奇与意识流',
  atmosphere: '氛围：环境、空镜、等待与转场间的静态铺垫',
});

export function isPerformanceMode(value) {
  return typeof value === 'string' && PERFORMANCE_MODES.includes(value);
}

/** The distinct modes in first-seen order; unknown values are dropped. */
export function distinctPerformanceModes(values) {
  const modes = [];
  for (const value of values ?? []) if (isPerformanceMode(value) && !modes.includes(value)) modes.push(value);
  return modes;
}
