import { describe, expect, it } from "vitest";

import { AppError } from "../../middleware/error";
import {
  annotateShotToCanvas,
  arrowHeadPoints,
  clamp01,
  normToPx,
  parseAnnotations,
} from "./agents-tool-bridge.annotate-shot";

describe("clamp01 / normToPx", () => {
  it("clamp01 夹到 [0,1]，非法→0", () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(9)).toBe(1);
    expect(clamp01("x")).toBe(0);
  });
  it("归一化坐标 → 像素", () => {
    expect(normToPx([0.5, 0.25], 1000, 800)).toEqual([500, 200]);
    expect(normToPx([0, 1], 1080, 1920)).toEqual([0, 1920]);
  });
});

describe("arrowHeadPoints", () => {
  it("水平向右的箭头：两翼对称在终点左侧", () => {
    const { left, right } = arrowHeadPoints([0, 0], [10, 0], 5);
    // 两翼 x 都 <10（在终点后方），y 对称（一上一下）
    expect(left[0]).toBeLessThan(10);
    expect(right[0]).toBeLessThan(10);
    expect(Math.sign(left[1])).not.toBe(Math.sign(right[1]));
    expect(Math.abs(left[1])).toBeCloseTo(Math.abs(right[1]), 5);
  });
});

describe("parseAnnotations（受控解析、丢非法项）", () => {
  it("path：<2 点丢弃，≥2 点保留并补默认", () => {
    const a = parseAnnotations([
      { type: "path", points: [[0.2, 0.85], [0.6, 0.55]] },
      { type: "path", points: [[0.1, 0.1]] }, // 只有1点 → 丢
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "path", color: "#ffffff", width: 5, arrowHead: true });
  });

  it("坐标越界被 clamp 到 [0,1]", () => {
    const annotation = parseAnnotations([
      { type: "path", points: [[-1, 2], [0.5, 0.5]] },
    ])[0];
    expect(annotation?.type).toBe("path");
    if (annotation?.type !== "path") throw new Error("expected a path annotation");
    expect(annotation.points[0]).toEqual([0, 1]);
  });

  it("frame / label 解析；label 缺 text 丢弃", () => {
    const a = parseAnnotations([
      { type: "frame", at: [0.05, 0.9], size: 0.06 },
      { type: "label", at: [0.06, 0.95], text: "PUSH-IN" },
      { type: "label", at: [0.1, 0.1] }, // 无 text → 丢
    ]);
    expect(a.map((x) => x.type)).toEqual(["frame", "label"]);
  });

  it("非法颜色被挡（防注入），回退默认", () => {
    const annotation = parseAnnotations([
      { type: "path", points: [[0, 0], [1, 1]], color: "url(javascript:alert)" },
    ])[0];
    expect(annotation?.color).toBe("#ffffff");
  });

  it("合法 hex / 色名通过", () => {
    const annotations = parseAnnotations([
      { type: "path", points: [[0, 0], [1, 1]], color: "#ffd34d" },
      { type: "label", at: [0.1, 0.1], text: "x", color: "yellow" },
    ]);
    expect(annotations[0]?.color).toBe("#ffd34d");
    expect(annotations[1]?.color).toBe("yellow");
  });

  it("非数组 → 空", () => {
    expect(parseAnnotations(null)).toEqual([]);
    expect(parseAnnotations("x")).toEqual([]);
  });
});

async function expectRecoverableFailure(
  bodyArgs: unknown,
  expectedCode: string,
): Promise<void> {
  await expect(
    annotateShotToCanvas({
      c: { env: {} } as never,
      requestUserId: "user-1",
      row: null,
      bodyArgs,
    }),
  ).rejects.toMatchObject({
    name: "AppError",
    code: expectedCode,
    terminal: false,
  } satisfies Partial<AppError>);
}

describe("tapcanvas_annotate_shot recovery contract", () => {
  it("keeps a missing source non-terminal", async () => {
    await expectRecoverableFailure({}, "agents_tool_annotate_missing_source");
  });

  it("keeps an unresolved source node non-terminal", async () => {
    await expectRecoverableFailure({ sourceNodeId: "missing-node" }, "flow_not_found");
  });

  it("keeps invalid annotations non-terminal", async () => {
    await expectRecoverableFailure(
      { sourceImageUrl: "https://assets.example/source.png", annotations: [] },
      "agents_tool_annotate_missing_annotations",
    );
  });
});
