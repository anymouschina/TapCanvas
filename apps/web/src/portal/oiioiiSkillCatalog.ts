import type { SkillMarketplaceItemDto } from '../api/server'

type OiioiiSkillSeed = {
  name: string
  description: string
  category: '自媒体' | '广告营销' | '游戏' | '周边设计'
  hasCase?: boolean
}

const OIIOII_CASE_URLS = [
  'https://file.beqlee.icu/portal/skills/oiioii/cases/01-741e388b37bdcbe0.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/02-dfb3ca8622eeebdd.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/03-4691c194fb4dc050.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/04-8ced13c3ba292661.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/05-c42d1352c813dfbc.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/06-f949317bea8826f2.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/07-1aeec6c9cf1071ef.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/08-bd1cd6f00d99f426.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/09-a647b22c9b38e559.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/10-de2dbe21d11aeacf.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/11-d127e3c88068e5af.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/12-ea333c5434876a8f.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/13-8ba69793b1e06e86.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/14-968b90d3323e583f.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/15-b3ace495edb234b8.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/16-0fc0ceef1f7eb87c.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/17-b661a9bec4dbb3a6.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/18-338b5eb61b776ffc.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/19-8dc95c76ef162ca9.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/20-eaafc3d5c33484c4.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/21-82516140566c874f.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/22-236061fa8799b0f8.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/23-ae9aa0880931dbf1.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/24-485eb05fc985e7fe.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/25-d5bdd4bb98bbf31f.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/26-a60781b4c86367f7.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/27-0d70ab5fea226fdc.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/28-53d18e5174163ceb.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/29-339997ddaa3a43f1.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/30-3d136cbea258bb05.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/31-19017d0ce4877a3d.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/32-8afff3543935daee.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/33-2edc2b01d6df7582.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/34-135ee2315884b2ee.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/35-52075afb67c57d94.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/36-35e0d0fce8a719c8.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/37-8f0a1205d246ef64.mp4',
  'https://file.beqlee.icu/portal/skills/oiioii/cases/38-2fa17e929bb0590f.mp4',
] as const

const OIIOII_COVER_URLS = [
  'https://file.beqlee.icu/portal/skills/oiioii/covers/01-2326564101b78f3b.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/02-625db30b1b5499be.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/03-df8617a62e74ea38.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/04-02e9326987f76fa0.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/05-8c204e239981cd71.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/06-926c521aa35cc9d5.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/07-ca6d4cf004c2420c.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/08-2b35624d1538bc9c.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/09-30e1057df4fb16bf.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/10-d6d455851e5a144a.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/11-75b1d1202f6da53d.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/12-dd0bcb75c4aabfac.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/13-e0bba4c1cc517466.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/14-49540569e7a8816f.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/15-ad51167ba76fed80.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/16-6b6e8eee9e5cb518.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/17-220d71acff0efac5.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/18-c7a6f290038ea5c1.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/19-772df9b8f3729354.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/20-8bb0499689b52c46.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/21-8495988cac153a9b.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/22-8935bb32fe7b022b.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/23-0291dbcfb2068d85.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/24-5aa184344b28eab3.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/25-3d7d9bddbb2acc60.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/26-955ae08135bf38c4.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/27-032d75820c8bbd69.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/28-78c8e5f31a8b9a58.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/29-8e90fb4961e89939.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/30-573b3c32c80d5b92.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/31-fe0dea19863fc8cf.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/32-3da6a9d3d6f99a09.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/33-d310833e6a11c56f.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/34-bf92df6524fdc003.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/35-36c8c5c0117dba66.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/36-9fcaaec1279af1ac.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/37-960730293c62c22c.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/38-f4c1a34d458b5111.jpg',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/39-518028d7ab0d36b1.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/40-3a63c6061c51ab5a.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/41-04b8e469fbb5c041.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/42-5bf9e66ac7ab2a89.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/43-8c21d593f705b014.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/44-d73ee37b7f3ec809.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/45-e89db60b5ef84cbd.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/46-fbab08037f96ef94.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/47-7e4af3cd54bbf4b5.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/48-2f8fa28b95cd805a.webp',
  'https://file.beqlee.icu/portal/skills/oiioii/covers/49-f2188673f5e0718f.webp',
] as const

const OIIOII_SKILL_SEEDS: readonly OiioiiSkillSeed[] = [
  { name: '故事板做视频', description: '使用 Image2 生成视频故事板，作为参考图生成视频。', category: '自媒体', hasCase: true },
  { name: '我在世界杯现场', description: '可快速生成主角出现在世界杯球场的恶搞视频。', category: '自媒体', hasCase: true },
  { name: '世界杯大乱斗', description: '可快速生成跨界角色齐聚世界杯球场大乱斗的视频。', category: '自媒体', hasCase: true },
  { name: '无人机航拍', description: '上传一张标注路径的远景图，根据连续箭头路径快速生成一段无人机航拍画面。', category: '自媒体', hasCase: true },
  { name: '水果短剧', description: '快速生成狗血剧情的水果短片。', category: '自媒体', hasCase: true },
  { name: 'B站百大共创-人生故事蒙太奇动画', description: '专注于创作由音乐驱动、无对白的纯视觉蒙太奇短片，通过视觉母题演变、固定机位时间压缩和光影色调切换，浓缩长周期人生故事或情感演变。', category: '自媒体', hasCase: true },
  { name: 'B站百大共创-万物拟人化短片', description: '可快速生成万物拟人化短片故事，赋予食物和日常用品人类的情感、动作与神态。', category: '自媒体', hasCase: true },
  { name: '萌宠故事', description: '创作拟人化萌宠短视频，将人类社会场景与宠物行为结合，提供分镜规划、脚本撰写和剪辑节奏指导。', category: '自媒体', hasCase: true },
  { name: '搞笑故事', description: '以一本正经的冷幽默创作快节奏荒诞反转故事，用快速反差、情绪递进制造喜剧冲突。', category: '自媒体', hasCase: true },
  { name: '悬疑故事', description: '制作 1–2 分钟悬疑、诡异、反转类微动画剧本，将简单概念发展为视觉冲击强、结局出人意料的故事。', category: '自媒体', hasCase: true },
  { name: '今敏视听美学', description: '将创作灵感转化为兼具心理张力、虚实交织梦境和精巧转场设计的 1–2 分钟动画短片剧本。', category: '自媒体', hasCase: true },
  { name: '泡面番', description: '制作 1–2 分钟短篇动画，从日常生活中寻找诡异切入点，结合情绪关键词设计冲击力强的反转结局。', category: '自媒体', hasCase: true },
  { name: '世奇小故事', description: '提取奇妙故事的悬疑、反转、温情结构，改编为适合制作 1–2 分钟短动画的原创故事。', category: '自媒体', hasCase: true },
  { name: '无厘头短片', description: '创作 1–2 分钟无厘头搞笑短片，依靠密集剧情反转与荒诞幽默快速生成原创喜剧内容。', category: '自媒体', hasCase: true },
  { name: '知识科普', description: '通过微观缩放、视觉隐喻和拟人化演绎，将抽象科学原理转化为高完播率的视觉化科普内容。', category: '自媒体', hasCase: true },
  { name: '历史故事', description: '将历史文献、古诗词或人物传记转化为视觉叙事，通过第一人称或现代 Vlog 形式重现历史瞬间。', category: '自媒体', hasCase: true },
  { name: '火柴人心理学', description: '用极简简笔画和抽象视觉符号将心理痛点具象化，完成心理科普、情绪抚慰类内容的文案与分镜。', category: '自媒体', hasCase: true },
  { name: '短剧带货广告', description: '生成狗血短剧式带货短片，为产品打造吸睛视觉内容并提升曝光与转化。', category: '广告营销', hasCase: true },
  { name: '真人带货广告', description: '生成真人带货广告短片，围绕产品卖点组织口播、展示与转化节奏。', category: '广告营销', hasCase: true },
  { name: '通用商品展示广告', description: '快速生成电商商品展示广告，为产品建立明确卖点、视觉记忆和转化尾屏。', category: '广告营销', hasCase: true },
  { name: '家居建材展示广告', description: '生成家居建材广告短片，突出空间效果、材质细节、使用价值与改造前后对比。', category: '广告营销', hasCase: true },
  { name: '食品饮料展示广告', description: '生成食品饮料广告短片，突出质感、口感联想、食用场景和产品记忆点。', category: '广告营销', hasCase: true },
  { name: '日化母婴商品展示广告', description: '生成日化母婴商品广告短片，以安全感、使用体验和关键功能建立购买理由。', category: '广告营销', hasCase: true },
  { name: '服装饰品展示广告', description: '生成服装饰品广告短片，突出穿搭关系、材质动态、细节和人物气质。', category: '广告营销', hasCase: true },
  { name: '3C 数码展示广告', description: '生成 3C 数码产品广告短片，以功能演示、工业设计和使用场景呈现产品价值。', category: '广告营销', hasCase: true },
  { name: '美妆个护商品展示广告', description: '生成美妆个护广告短片，表现成分、质地、使用过程和效果感知。', category: '广告营销', hasCase: true },
  { name: '通用剧情类游戏买量视频', description: '通过夸张剧情、快速冲突和强反转牢牢吸住观众注意力，提升游戏广告转化率。', category: '游戏', hasCase: true },
  { name: '卡牌游戏买量视频', description: '通过福利、爽点、抽卡和玩法的快节奏呈现，生成高转化卡牌游戏买量视频。', category: '游戏', hasCase: true },
  { name: '休闲放置游戏买量视频', description: '围绕轻松挂机、快速成长和数值反馈，生成休闲放置游戏买量视频。', category: '游戏', hasCase: true },
  { name: '乙游浪漫情感买量视频', description: '制作剧情心动展示、高甜混剪和女频向深度推荐的乙游买量内容。', category: '游戏', hasCase: true },
  { name: '休闲益智游戏买量视频', description: '在极短时间内激发胜负欲、同情心与高频物理释放爽感，形成下载转化。', category: '游戏', hasCase: true },
  { name: '模拟经营与建造类游戏买量视频', description: '展示从贫瘠开局到繁华王国的成长爽感，锚定轻松挂机、养成和解压诉求。', category: '游戏', hasCase: true },
  { name: '塔防游戏创意类买量视频', description: '用怪潮压迫建立危机，经升级、合成和火力质变，兑现满屏轰炸或极限失守的情绪结果。', category: '游戏', hasCase: true },
  { name: '肉鸽类游戏买量视频', description: '呈现随机 Build、高频升级、割草爆屏和越战越强的肉鸽游戏核心爽感。', category: '游戏', hasCase: true },
  { name: 'SLG 游戏买量视频', description: '用冲突钩子建立留存，通过探索、收集、建造、暴兵和升级展示数值飞涨，最终兑现大胜。', category: '游戏', hasCase: true },
  { name: 'MOBA 类游戏买量视频', description: '从压抑蓄力与物理对抗逐步升级，最终爆发为超越凡人尺度的史诗级战斗体验。', category: '游戏', hasCase: true },
  { name: 'RPG 游戏买量视频', description: '按照极速交互、强变化反馈、满级展示和转化尾屏的节奏生成重度游戏宣发视频。', category: '游戏', hasCase: true },
  { name: '体育竞速游戏买量视频', description: '用极速驰骋、极限漂移和惊险超越唤醒观众肾上腺素。', category: '游戏', hasCase: true },
  { name: '吧唧', description: '生成金属边闪粉肖像、金属徽章套组、主题圆吧唧和多款角色徽章展示效果。', category: '周边设计' },
  { name: '亚克力牌', description: '生成透明 PVC 或亚克力立牌产品效果。', category: '周边设计' },
  { name: '贴纸', description: '生成九宫格 Q 版表情贴纸套装。', category: '周边设计' },
  { name: '手办模型', description: '生成桌面建模过程、棚拍 PVC 手办和展示柜收藏手办效果。', category: '周边设计' },
  { name: '拼豆', description: '生成拼豆施工图纸、钉板展示、白底立体效果和盒装手办效果。', category: '周边设计' },
  { name: '钥匙扣', description: '生成软胶 Q 版钥匙扣产品效果。', category: '周边设计' },
  { name: '痛包', description: '生成透明前袋谷子痛包陈列效果。', category: '周边设计' },
  { name: '手机壳', description: '生成华丽手机壳产品展示效果。', category: '周边设计' },
  { name: 'CP拍立得', description: '生成具有合照氛围和 CP 感的拍立得照片效果。', category: '周边设计' },
  { name: '鼠标垫', description: '生成桌面海报式鼠标垫展示效果。', category: '周边设计' },
  { name: '周边墙', description: '生成桌墙一体的谷子收藏陈列效果。', category: '周边设计' },
]

const CATALOG_DATE = '2026-07-26T00:00:00.000Z'

function slugifySkillName(name: string, index: number): string {
  return `oiioii-public-${index + 1}-${Array.from(name).map((character) => character.codePointAt(0)?.toString(16) || '').join('-')}`
}

export const OIIOII_SKILL_CATALOG: readonly SkillMarketplaceItemDto[] = OIIOII_SKILL_SEEDS.map((seed, index) => ({
  skill: {
    id: slugifySkillName(seed.name, index),
    key: slugifySkillName(seed.name, index),
    name: seed.name,
    description: seed.description,
    logoUrl: OIIOII_COVER_URLS[index],
    category: seed.category,
    enabled: true,
    visible: true,
    sortOrder: index,
    createdAt: CATALOG_DATE,
    updatedAt: CATALOG_DATE,
  },
  productId: null,
  priceCredits: null,
  purchasable: false,
  owned: false,
  sourceType: 'official',
  sellerUserId: null,
  sellerName: '搜集自网络',
  sizeBytes: null,
  promptCharacterCount: 0,
  listedAt: null,
  realPurchaseCount: 0,
  algorithmScore: 0,
  manualBoost: 0,
  effectiveScore: 0,
  recommended: false,
  pinned: false,
  displayOrder: index,
  rank: index + 1,
}))

export const OIIOII_SKILL_CATEGORIES = ['全部', '我的技能', '自媒体', '广告营销', '游戏', '周边设计'] as const

export function isOiioiiCatalogSkill(item: SkillMarketplaceItemDto): boolean {
  return item.skill.key.startsWith('oiioii-public-')
}

export function getOiioiiSkillCaseUrl(item: SkillMarketplaceItemDto): string | null {
  if (!isOiioiiCatalogSkill(item)) return null
  const index = OIIOII_SKILL_CATALOG.findIndex((candidate) => candidate.skill.key === item.skill.key)
  return index >= 0 ? OIIOII_CASE_URLS[index] || null : null
}

export function getOiioiiCaseSkills(): readonly SkillMarketplaceItemDto[] {
  return OIIOII_SKILL_CATALOG.slice(0, OIIOII_CASE_URLS.length)
}
