import { describe, expect, it } from "vitest";
import { OFFICIAL_MATERIAL_OWNER_ID, resolveMaterialScope } from "./material.repo";

describe("material library scope", () => {
	it("classifies the reserved owner as the global official library", () => {
		expect(resolveMaterialScope({ ownerId: OFFICIAL_MATERIAL_OWNER_ID, teamId: null })).toBe("official");
	});

	it("keeps team and personal materials in their own scopes", () => {
		expect(resolveMaterialScope({ ownerId: "user-1", teamId: "team-1" })).toBe("team");
		expect(resolveMaterialScope({ ownerId: "user-1", teamId: null })).toBe("personal");
	});
});
