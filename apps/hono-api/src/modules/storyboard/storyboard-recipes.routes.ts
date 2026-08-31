import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { loadStoryboardRecipes } from "./storyboard-recipes.service";

export function registerStoryboardRecipeRoutes(router: OpenAPIHono<AppEnv>) {
  router.get("/storyboard/recipes", async (c) => {
    try {
      const recipes = await loadStoryboardRecipes();
      return c.json(recipes, 200);
    } catch (err) {
      // Degrade gracefully for the picker, but surface the cause so a missing/
      // unreadable recipes.json (e.g. wrong runtime path) isn't invisible.
      console.error("[storyboard-recipes] failed to load recipes.json:", err);
      return c.json([], 200);
    }
  });
}
