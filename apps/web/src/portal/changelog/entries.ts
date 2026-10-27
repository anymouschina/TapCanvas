export type ChangelogEntry = {
  id: string
  date: string
  title: string
  changes: readonly string[]
}

// Community changes recorded in README.md. These describe source capabilities,
// not deployment or real-model acceptance results.
export const CHANGELOG_ENTRIES: readonly [ChangelogEntry, ...ChangelogEntry[]] = [
  {
    id: '2026-10-26-manual-tools',
    date: '2026-10-26',
    title: '手动去噪、MCP 助手接入与剧本导出',
    changes: [
      '手动去噪支持轻度修复与清晰度增强，以保留原图材质为目标，不再强加渲染风格。',
      'MCP 页面可生成专用密钥并复制 AI 助手接入提示词，关闭弹窗清除内存凭据。',
      '流水线支持选择多个章节，将已保存的逐片段提示词按顺序导出为 TXT。',
    ],
  },
  {
    id: '2026-10-21-pipeline',
    date: '2026-10-21',
    title: '创作流水线与画布双视图',
    changes: [
      '同一项目可在创作流水线与节点画布间切换，查看剧本、角色与场景、分镜、视频片段及成片。',
      '流水线支持章节选择、素材筛选、媒体预览与当前阶段未完成素材生成，沿用画布执行链路。',
    ],
  },
  {
    id: '2026-10-20-image-compare',
    date: '2026-10-20',
    title: '图片对比节点',
    changes: [
      '新增并排、滑动分割、叠加透明度和按住切换四种图片对比模式。',
      '框选两张图片即可创建对比节点并连线，对比设置随节点保存。',
    ],
  },
]

export const LATEST_CHANGELOG_ID = CHANGELOG_ENTRIES[0].id
