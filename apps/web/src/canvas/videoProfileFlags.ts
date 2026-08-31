// apps/web/src/canvas/videoProfileFlags.ts
//
// 灰度 flag：VIDEO_PROFILE_ROUTING（前端用 Vite env，须带 VITE_ 前缀）。
// 见设计 spec docs/superpowers/specs/2026-06-06-video-workflow-intent-profile-routing-design.md C6。
//
// OFF（默认）：发起视频创作时不调意图分类器、不出确认卡、不钉 videoProfileId
//             → 行为与改造前逐字等价（零回归）。
// ON：发起视频创作时先调 tapcanvas-intent-classifier 识别领域档案，出确认卡，
//     用户确认后把 videoProfileId 确定性钉到组 data。
//
// 模式与现有 yjsFlags.ts（VITE_CANVAS_YJS）一致：import.meta.env + 小写归一 + 默认 OFF。

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>

/** 视频领域档案路由是否开启。默认 OFF。接受 on/1/true（大小写不敏感）。 */
export function isVideoProfileRoutingEnabled(): boolean {
  const raw = String(viteEnv.VITE_VIDEO_PROFILE_ROUTING || '').trim().toLowerCase()
  return raw === 'on' || raw === '1' || raw === 'true'
}
