// 治理/意图分类/会话标题共用的编排模型。曾用 "gpt-5.4"，但该键在 new-api 既无渠道也无
// 定价（gpt-5 全系在本部署都 "No available channel"），导致意图分类/标题/storyboard 治理
// 一律 "模型积分价格未配置 / 503"。改用有渠道且遵循指令好的 claude-sonnet-4-6。
// 可用 env AGENTS_GOVERNANCE_MODEL_KEY 覆盖。
export const STORYBOARD_GOVERNANCE_MODEL_KEY = "claude-sonnet-4-6";

export function resolveStoryboardGovernanceModelKey(explicitModelKey?: string | null): string {
	const explicit = String(explicitModelKey || "").trim();
	if (explicit) return explicit;
	const envValue = String(process.env.AGENTS_GOVERNANCE_MODEL_KEY || "").trim();
	if (envValue) return envValue;
	return STORYBOARD_GOVERNANCE_MODEL_KEY;
}
