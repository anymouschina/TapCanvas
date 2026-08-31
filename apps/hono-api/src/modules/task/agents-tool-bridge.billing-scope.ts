import type { PrismaClient } from "../../types";
import { getTeamProjectShareForUser } from "../team/team.repo";

/**
 * 解析「项目归属」对应的计费/可见性上下文（activeTeamId 值）。
 *
 * 背景：故事板等生成任务经 chat → agents-cli → /public/agents/tools/execute 回调进入，
 * 这条工具回调链路只透传 Authorization，不携带浏览器的 X-Team-Id（个人/团队选择在 bridge
 * 链路被丢弃）。于是计费请求落到 resolveBillingTeamId 的 fallback —— 用户「第一个成员团队」，
 * 造成「界面显示个人 / 项目本属个人，却扣到某个团队积分」。
 *
 * 修法：tool-execute 回调天然带 canvasProjectId，按项目归属重建 activeTeamId，使
 * 扣费 / 积分展示 / 可见性三者同源于项目（与 autoShareProjectWithActiveTeam、前端 C 方案一致）：
 *  - 项目绑定了某团队（team_project_shares）且 owner 是该团队成员 => 扣该团队
 *  - 否则（纯个人项目，如本次问题项目，无任何 share）=> "personal"，扣 owner 个人账户
 *
 * 注：分享给团队是「拷贝出独立的一份项目」，个人一份、团队一份互不相干，因此每个 project 行
 * 至多绑定一个团队，不存在「一份项目两边扣」的歧义。
 */
export async function resolveProjectBillingTeamId(
	db: PrismaClient,
	input: { projectId: string; userId: string },
): Promise<string> {
	const share = await getTeamProjectShareForUser(db, input);
	const teamId = share?.team_id?.trim();
	return teamId ? teamId : "personal";
}
