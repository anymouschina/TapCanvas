import { describe, expect, it } from "vitest";
import {
  listRecipesJsonCandidates,
  loadStoryboardRecipes,
} from "./storyboard-recipes.service";

describe("loadStoryboardRecipes", () => {
  it("returns recipe DTOs with id/name/description/previewUrl", async () => {
    const recipes = await loadStoryboardRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(5);
    expect(recipes[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      previewUrl: expect.any(String),
    });
    expect(recipes[0]).not.toHaveProperty("promptTemplatePath");
  });
});

describe("listRecipesJsonCandidates", () => {
  const suffix = "skills/tapcanvas-storyboard-expert/references/recipes/recipes.json";

  it("includes the Docker /workspace/apps/agents-cli runtime path (regression for C1)", () => {
    const candidates = listRecipesJsonCandidates();
    // The agents-cli skills live at /workspace/apps/agents-cli in the container;
    // if this candidate is ever dropped the picker silently shows no recipes.
    expect(
      candidates.some((p) => p.replace(/\\/g, "/") === `/workspace/apps/agents-cli/${suffix}`),
    ).toBe(true);
  });

  it("every candidate points at recipes.json", () => {
    for (const p of listRecipesJsonCandidates()) {
      expect(p.endsWith("recipes.json")).toBe(true);
    }
  });
});
