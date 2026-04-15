import { buildProfileSystemOverride, type AgentRuntimeProfile } from "../core/root-persona.js";

export function resolveAgentRuntimeProfile(rawProfile = process.env.AGENTS_PROFILE): AgentRuntimeProfile {
  const raw = String(rawProfile || "").trim().toLowerCase();
  if (raw === "general" || raw === "nocode" || raw === "chat") {
    return "general";
  }
  return "code";
}

export function buildRuntimeSystemOverride(profile: AgentRuntimeProfile): string {
  return buildProfileSystemOverride(profile);
}
