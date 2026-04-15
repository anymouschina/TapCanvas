# Agents CLI Rules

- Use a hard cutover approach and never implement backward compatibility branches unless the user explicitly asks for them.
- Keep `agents-cli` generic: do not reintroduce product-specific workflows, prompt packs, tool registries, or runtime context loaders into the default runtime.
- Prefer explicit failure over hidden fallback. If a required tool, resource, or context input is missing, report the gap directly.
- Keep agent roles small and composable. Add a new role only when its tool bounds or responsibility are materially different.
- Treat the persistent task graph as the source of truth for long-running multi-step work.
- Use mailbox and protocol tools for durable multi-agent coordination; do not rely on implicit shared context.
- Keep local code responsible for deterministic execution, permissions, and protocol boundaries. Leave semantic judgment to the model.
- Do not let docs drift from implementation. When changing CLI commands, default tools, agent roles, or HTTP bridge behavior, update `README.md` in the same change.
- Do not let skill docs drift from implementation. When changing TapCanvas canvas protocols, node-kind semantics, handle matrices, or `tapcanvas_flow_patch` / canvas-plan behavior that agents consume through the bridge, update the TapCanvas skill doc in the same change: `/Users/libiqiang/.agents/skills/tapcanvas/SKILL.md`.
- Keep TapCanvas execution preconditions in sync with the skill doc as well. If downstream generation requires upstream real asset URLs, the accepted prerequisite asset fields change, or the click-to-run chain behavior changes, update `/Users/libiqiang/.agents/skills/tapcanvas/SKILL.md` in the same change.
- When reading, verifying, mutating, or polling real user canvas data through TapCanvas public APIs, use `apps/agents-cli/skills/tapcanvas-api` as the only allowed execution path. Do not bypass it with ad-hoc scripts, direct fetches, or parallel TapCanvas API skills.
- If `tapcanvas-api` lacks a capability needed to verify or operate user canvas data, extend that skill first based on the real source implementation and only then continue the verification flow.
