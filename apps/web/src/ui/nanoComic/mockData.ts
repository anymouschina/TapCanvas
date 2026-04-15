import type {
  NanoComicActivityItem,
  NanoComicEpisodeItem,
  NanoComicMetricCard,
  NanoComicReviewItem,
  NanoComicRiskItem,
  NanoComicShotItem,
} from './types'

function buildMockArtwork(title: string, subtitle: string, accent: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#06111f" />
          <stop offset="52%" stop-color="${accent}" />
          <stop offset="100%" stop-color="#120d16" />
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)" />
      <rect x="36" y="36" width="1208" height="648" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2" />
      <circle cx="992" cy="154" r="138" fill="rgba(255,255,255,0.08)" />
      <rect x="112" y="432" width="464" height="124" fill="rgba(0,0,0,0.28)" />
      <text x="112" y="210" fill="rgba(255,255,255,0.72)" font-size="34" font-family="Inter, Arial, sans-serif">${subtitle}</text>
      <text x="112" y="506" fill="#ffffff" font-size="84" font-weight="700" font-family="Inter, Arial, sans-serif">${title}</text>
      <text x="114" y="566" fill="rgba(255,255,255,0.74)" font-size="28" font-family="Inter, Arial, sans-serif">TapCanvas Nano Comic Workspace Mock Preview</text>
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export const nanoComicMetrics: readonly NanoComicMetricCard[] = [
  { id: 'episodes', title: '剧集推进', value: '03 / 12', detail: '3 集进入分镜或审核阶段', tone: 'sky' },
  { id: 'review', title: '待审核', value: '18', detail: '其中 6 项阻塞下游视频', tone: 'amber' },
  { id: 'rework', title: '返工次数', value: '07', detail: '主要集中在 E02 宫殿段', tone: 'rose' },
  { id: 'cost', title: '模型消耗', value: '4,280', detail: '较昨日下降 12%', tone: 'mint' },
]

export const nanoComicEpisodes: readonly NanoComicEpisodeItem[] = [
  { id: 'ep-01', chapterNo: 1, code: 'E01', title: '丧队截停强拆', stage: '分镜生产', storyboardProgress: 82, videoProgress: 40, reviewCount: 4, ownerName: '张三' },
  { id: 'ep-02', chapterNo: 2, code: 'E02', title: '怪书夜翻页', stage: '导演审核', storyboardProgress: 100, videoProgress: 0, reviewCount: 9, ownerName: '李四' },
  { id: 'ep-03', chapterNo: 3, code: 'E03', title: '土屋冷月', stage: '资产拆解', storyboardProgress: 24, videoProgress: 0, reviewCount: 5, ownerName: '王五' },
]

export const nanoComicRisks: readonly NanoComicRiskItem[] = [
  { id: 'risk-1', title: '主角青年形态已更新', level: 'blocked', detail: 'E02 的 12 个镜头仍绑定旧版角色卡。', impact: '阻塞 2 个视频片段继续提交审核' },
  { id: 'risk-2', title: '宫殿香炉道具锚点不一致', level: 'warning', detail: '第 8 集和第 10 集使用了不同香炉结构。', impact: '正反打镜头可能穿帮' },
  { id: 'risk-3', title: '尾帧承接缺失', level: 'stale', detail: 'E01 第 4 组首镜未读取上组 tail frame。', impact: '候选镜头衔接生硬' },
]

export const nanoComicActivities: readonly NanoComicActivityItem[] = [
  { id: 'activity-1', actorName: '李四', action: '提交审核', target: 'E02 镜头 023', timeLabel: '10 分钟前' },
  { id: 'activity-2', actorName: '张三', action: '更新角色卡', target: '主角青年形态', timeLabel: '38 分钟前' },
  { id: 'activity-3', actorName: '系统', action: '生成分镜组', target: 'E01 第 4 组分镜', timeLabel: '1 小时前' },
]

export const nanoComicShots: readonly NanoComicShotItem[] = [
  {
    id: 'shot-023',
    chapterNo: 2,
    shotNo: 23,
    sceneCode: 'S2',
    shotCode: '023',
    title: '宫殿正反打',
    script: '人群拥挤的前院中，宫殿门口形成正反打对峙，角色视线持续交锋。',
    productionStatus: '候选已出',
    reviewStatus: '待审核',
    riskLabel: '角色主设更新',
    continuityHint: '上一镜尾帧角度偏左，需要继续保持偏轴视角。',
    prevShotCode: '022',
    nextShotCode: '024',
    castNames: ['沈青', '陈叔', '抬棺队'],
    locationName: '旧宅前院',
    propNames: ['棺材', '香炉', '现金袋'],
    note: '前景保留人群脏乱热闹，背景必须看到院门与强拆机械。',
    commentPreview: '导演：人物表情对了，但香炉位置还在飘。',
    previewImageUrl: buildMockArtwork('宫殿正反打', 'E02 / 镜头 023', '#2563eb'),
    promptJson: '{"shot":"023","camera":"over-shoulder","style":"anchored"}',
    referenceImageUrls: [buildMockArtwork('院门参考', 'scene ref', '#0ea5e9')],
    anchorImageUrls: [buildMockArtwork('沈青角色卡', 'role ref', '#2563eb')],
    isActionRequired: true,
    isHighRisk: true,
  },
  {
    id: 'shot-024',
    chapterNo: 2,
    shotNo: 24,
    sceneCode: 'S2',
    shotCode: '024',
    title: '棺材特写',
    script: '镜头切入棺材纹理和白幡，强调旧木破损与压迫感。',
    productionStatus: '需复检',
    reviewStatus: '返工中',
    riskLabel: '固定道具不一致',
    continuityHint: '棺盖纹理应与前一镜保持灰白旧木，不可发亮。',
    prevShotCode: '023',
    nextShotCode: '025',
    castNames: ['抬棺队'],
    locationName: '旧宅前院',
    propNames: ['棺材', '白幡'],
    note: '局部高光只打到书页，不要把棺材拍成高魔法物件。',
    commentPreview: '制片：这一镜可直接加入返工组。',
    previewImageUrl: buildMockArtwork('棺材特写', 'E02 / 镜头 024', '#f97316'),
    promptJson: '{"shot":"024","camera":"macro","prop":"棺材"}',
    referenceImageUrls: [buildMockArtwork('棺材参考', 'prop ref', '#f97316')],
    anchorImageUrls: [],
    isActionRequired: true,
    isHighRisk: true,
  },
  {
    id: 'shot-025',
    chapterNo: 2,
    shotNo: 25,
    sceneCode: 'S2',
    shotCode: '025',
    title: '强拆机械压近',
    script: '机械前压，旧宅与人群被迫后退，画面压迫感持续上升。',
    productionStatus: '生成中',
    reviewStatus: '未提交',
    riskLabel: '等待候选',
    continuityHint: '机械只做现实压迫感，不要动作大片化。',
    prevShotCode: '024',
    nextShotCode: '026',
    castNames: ['开发方打手', '抬棺队'],
    locationName: '旧宅前院',
    propNames: ['挖机', '警戒绳'],
    note: '镜头要保留旧宅和人群密度，不能只剩机械。',
    commentPreview: '系统：等待第 4 组分镜图片完成。',
    previewImageUrl: buildMockArtwork('强拆机械压近', 'E02 / 镜头 025', '#14b8a6'),
    promptJson: '{"shot":"025","camera":"push-in","subject":"挖机"}',
    referenceImageUrls: [],
    anchorImageUrls: [],
    isActionRequired: false,
    isHighRisk: false,
  },
]

export const nanoComicReviewItems: readonly NanoComicReviewItem[] = [
  {
    id: 'review-023',
    entityType: 'shot',
    title: 'E02 / 镜头 023 / 宫殿正反打',
    summary: '角色主设已更新，下游 2 个视频片段需复检。',
    riskLevel: 'blocked',
    projectLabel: '王朝疑云',
    episodeLabel: 'E02',
    assigneeName: '张三',
    reviewerName: '李四',
    updatedAtLabel: '今天 10:32',
    impactLabel: '影响视频 2 段',
    canvasKind: 'image',
    previewImageUrl: buildMockArtwork('待审镜头', 'E02 / 宫殿正反打', '#db2777'),
    isActionRequired: true,
    isHighRisk: true,
  },
  {
    id: 'review-role-main',
    entityType: 'asset',
    title: '主角青年形态角色卡',
    summary: '服装层级已更新，旧镜头仍绑定旧卡。',
    riskLevel: 'warning',
    projectLabel: '王朝疑云',
    episodeLabel: '全项目',
    assigneeName: '王五',
    reviewerName: '导演',
    updatedAtLabel: '今天 09:18',
    impactLabel: '影响镜头 12 个',
    canvasKind: 'image',
    previewImageUrl: buildMockArtwork('角色卡更新', '主角青年形态', '#0ea5e9'),
    isActionRequired: true,
    isHighRisk: true,
  },
  {
    id: 'review-rework-clip',
    entityType: 'video_segment',
    title: 'E01 / 视频片段 004 / 丧队对峙',
    summary: '建议打回重做，当前片段衔接生硬。',
    riskLevel: 'pending',
    projectLabel: '王朝疑云',
    episodeLabel: 'E01',
    assigneeName: '陈导',
    reviewerName: '李四',
    updatedAtLabel: '今天 08:46',
    impactLabel: '需返工 1 段',
    canvasKind: 'text',
    isActionRequired: true,
    isHighRisk: false,
  },
]

export const nanoComicVideoPlaceholderUrl = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
