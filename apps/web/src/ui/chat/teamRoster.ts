// 智能团角色花名册：小T（导演/编排）+ 四个视频流水线子 agent。
// 角色 id 与 agents-cli agent-definitions/defaults.json 的 name 对齐，
// 也与服务端 agent_role SSE 下发的 role 字段对齐（见 AiChatDialog WORKING_ROLE_ICONS）。
//
// 头像为 gpt-image-2 2K 生成 → 降采样 512 的本地静态资产，按 CLAUDE.md
// 「静态本地资源」例外直接 import 使用原生 <img>，不走 ManagedImage。
import xiaotAvatar from '../../assets/team/xiaot.png'
import editorAvatar from '../../assets/team/film-editor.png'
import postAvatar from '../../assets/team/post-producer.png'
import artDirectorAvatar from '../../assets/team/art-director.png'
import directorReviewAvatar from '../../assets/team/director-review.png'

export type TeamRole = {
  /** 与 agent_role SSE / agent-definitions name 对齐；小T 用保留值 'director' */
  id: string
  /** 显示名 */
  name: string
  /** 一句话职责，用于花名册卡片 */
  description: string
  /** 头像（已 import 的本地静态资源 URL） */
  avatar: string
  /** 强调色（chip / 选中描边） */
  accent: string
  /** 是否可被「手动指派本轮干活」选中（小T=导演本身不可指派） */
  assignable: boolean
}

/** 小T——主导演 / 编排，对话面板的主体身份 */
export const XIAOT_ROLE: TeamRole = {
  id: 'director',
  name: '小T',
  description: '主导演 / 编排：理解创意、规划链路、按 SOP 委派智能团并把控成片质量',
  avatar: xiaotAvatar,
  accent: '#5cc8ff',
  assignable: false,
}

/** 当前仍可派发的视频流水线角色；writer 由 authoring 状态机按版本化合同内部派发。 */
export const TEAM_ROLES: TeamRole[] = [
  {
    id: 'film-editor',
    name: '剪辑师',
    description: '护栏 D 单条产物即审、单镜就近返工建议与成片节奏审，不等全片',
    avatar: editorAvatar,
    accent: '#39d0b0',
    assignable: true,
  },
  {
    id: 'post-producer',
    name: '后期',
    description: '成片 QA 报告、配音 TTS / BGM / 音乐编排、字幕题卡转场与发布准备',
    avatar: postAvatar,
    accent: '#ffb454',
    assignable: true,
  },
]

/**
 * 功能角色：只用于 role_note 角色介入评估卡的头像/名称/accent 解析，
 * 不是可派遣的流水线子 agent（assignable=false 且不进 TEAM_ROLES，
 * 故不出现在花名册 / 手动指派列表里），但纳入 ROLE_BY_ID 供 getTeamRole 命中。
 */
export const FUNCTIONAL_ROLES: TeamRole[] = [
  {
    id: 'art-director',
    name: '美术指导',
    description: '锁定可复用空间锚点、把控画风一致性与道具可读性，划漂移红线',
    avatar: artDirectorAvatar,
    accent: '#d9a23a',
    assignable: false,
  },
  {
    id: 'director-review',
    name: '导演质检',
    description: '提交生成后 / 成片审片：核对画布事实，给「现在能确认什么、等什么回填再查什么」',
    avatar: directorReviewAvatar,
    accent: '#4a8fe0',
    assignable: false,
  },
]

/** 角色配置面板展示的完整角色集合（包含小T与功能角色）。 */
export const ALL_TEAM_ROLES: TeamRole[] = [XIAOT_ROLE, ...TEAM_ROLES, ...FUNCTIONAL_ROLES]

const ROLE_BY_ID = new Map<string, TeamRole>(
  ALL_TEAM_ROLES.map((r) => [r.id, r]),
)

/** 按 role id 取角色定义（小T + 四子 agent）；未知角色返回 null */
export function getTeamRole(id: string | null | undefined): TeamRole | null {
  if (!id) return null
  return ROLE_BY_ID.get(String(id).trim()) ?? null
}

/** 取角色头像；未知角色回退小T 头像（避免破图） */
export function teamRoleAvatar(id: string | null | undefined): string {
  return getTeamRole(id)?.avatar ?? XIAOT_ROLE.avatar
}

/** 取角色显示名；未知角色回退原始 id */
export function teamRoleName(id: string | null | undefined): string {
  return getTeamRole(id)?.name ?? String(id ?? '').trim()
}
