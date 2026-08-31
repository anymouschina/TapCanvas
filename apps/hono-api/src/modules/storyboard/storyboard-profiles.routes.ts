import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { listProfiles } from "./profile-library.service";

// 领域档案（domain profile）列表，供前端确认卡的下拉与默认展示。
// 与 storyboard-recipes.routes 同套路：挂在 publicApiRouter（/public 前缀），
// 加载失败时优雅降级返回 []（前端有 FALLBACK_PROFILES 兜底），但打日志暴露根因。
export function registerStoryboardProfileRoutes(router: OpenAPIHono<AppEnv>) {
  router.get("/storyboard/profiles", async (c) => {
    try {
      const profiles = await listProfiles();
      return c.json(profiles, 200);
    } catch (err) {
      console.error("[storyboard-profiles] failed to load profiles.json:", err);
      return c.json([], 200);
    }
  });
}
