// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

const getApiKeyUsage = vi.fn();
const getApiKeyCredits = vi.fn();
vi.mock("../../api/server", () => ({
  getApiKeyUsage: (...a: unknown[]) => getApiKeyUsage(...a),
  getApiKeyCredits: (...a: unknown[]) => getApiKeyCredits(...a),
}));

import { ApiKeyUsagePanel } from "./ApiKeyUsagePanel";

function usageItem(i: number) {
  return { id: `r${i}`, path: `/public/a2a/${i}`, method: "POST", status: 200, durationMs: 100 + i, startedAt: `2026-06-17T00:00:${String(i).padStart(2, "0")}Z` };
}

function renderPanel() {
  return render(
    <MantineProvider>
      <ApiKeyUsagePanel apiKeyId="key-1" />
    </MantineProvider>,
  );
}

describe("ApiKeyUsagePanel", () => {
  beforeEach(() => {
    getApiKeyUsage.mockReset();
    getApiKeyCredits.mockReset();
  });

  it("加载并展示调用流水", async () => {
    getApiKeyUsage.mockResolvedValue({ items: [usageItem(1)] });
    getApiKeyCredits.mockResolvedValue({ summary: { personalSpent: 30, teamSpent: 0 }, items: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText("/public/a2a/1")).toBeTruthy());
  });

  it("满页时显示「加载更多」，点击后追加下一页并按游标请求", async () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => usageItem(i + 1));
    getApiKeyUsage
      .mockResolvedValueOnce({ items: firstPage }) // 首页满 20 → hasMore
      .mockResolvedValueOnce({ items: [usageItem(99)] }); // 加载更多返回 1 → 末页
    getApiKeyCredits.mockResolvedValue({ summary: { personalSpent: 0, teamSpent: 0 }, items: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText("/public/a2a/1")).toBeTruthy());
    const moreBtn = await screen.findByText("加载更多");
    fireEvent.click(moreBtn);
    await waitFor(() => expect(screen.getByText("/public/a2a/99")).toBeTruthy());
    // 第二次调用必须带上一页末条 startedAt 作 before 游标
    const lastCall = getApiKeyUsage.mock.calls[getApiKeyUsage.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({ before: firstPage[19].startedAt });
  });

  it("切换时间范围（近7天）重拉并带 since", async () => {
    getApiKeyUsage.mockResolvedValue({ items: [usageItem(1)] });
    getApiKeyCredits.mockResolvedValue({ summary: { personalSpent: 0, teamSpent: 0 }, items: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText("/public/a2a/1")).toBeTruthy());
    getApiKeyUsage.mockClear();
    fireEvent.click(screen.getByText("近 7 天"));
    await waitFor(() => {
      const call = getApiKeyUsage.mock.calls[0];
      expect(call?.[1]?.since).toBeTruthy();
    });
  });

  it("调用记录加载失败时显式展示原因和重试入口", async () => {
    getApiKeyUsage.mockRejectedValue(new Error("usage service unavailable"));
    getApiKeyCredits.mockResolvedValue({ summary: { personalSpent: 0, teamSpent: 0 }, items: [] });
    renderPanel();

    expect(await screen.findByText("usage service unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.queryByText("暂无调用记录")).toBeNull();
  });
});
