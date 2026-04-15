export const STORYBOARD_GOVERNANCE_MODEL_KEY = "gpt-5.4";

export function resolveStoryboardGovernanceModelKey(explicitModelKey?: string | null): string {
	const explicit = String(explicitModelKey || "").trim();
	if (explicit) return explicit;
	const envValue = String(process.env.AGENTS_GOVERNANCE_MODEL_KEY || "").trim();
	if (envValue) return envValue;
	return STORYBOARD_GOVERNANCE_MODEL_KEY;
}
