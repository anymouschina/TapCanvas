// 章节画布整图 autosave 的乐观锁冲突退避曲线。
//
// 修复背景:同一章被两个写者(双页签 / 路由重挂导致的双份 autosave / 多端)同时整图 PUT 时,
// 彼此推进 revision 互相 409。原实现的退避只在「409 后的合并重试又失败」时才累加,
// 而合并重试通常成功(200)→ 计数被清零 → 退避永不启动 → 全速乒乓。
// 改为:每次 409 都按「连续冲突次数」升级退避,只有一次干净保存(无冲突)才清零,
// 让两个写者错峰、几轮内收敛。
//
// 曲线:streak=1→600ms, 2→1.2s, 3→2.4s, 4→4.8s …… 封顶 30s。
export function conflictBackoffMs(streak: number): number {
  if (streak <= 0) return 0
  return Math.min(30_000, 300 * 2 ** Math.min(streak, 7))
}
