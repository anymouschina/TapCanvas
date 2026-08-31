import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

import {
  clamp01,
  degToUnit,
  normToPx,
  parseBlockingDiagram,
  renderBlockingDiagram,
  renderBlockingDiagramToCanvas,
} from "./agents-tool-bridge.blocking-diagram";

const singleCharacterComposition = {
  narrativeTask: "孟川在场景中保持远距观察",
  focusKind: "character",
  focusTargetNames: ["孟川"],
  focalPoint: [0.35, 0.5],
  shotScale: "wide",
  environmentVisualWeight: "primary",
  subjects: [
    {
      name: "孟川",
      visualWeight: "secondary",
      depthLayer: "midground",
      centerPlacement: "forbidden",
      maxFrameHeightRatio: 0.35,
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clamp01 / normToPx / degToUnit", () => {
  it("clamp01 夹到 [0,1]，非法→0", () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01("x")).toBe(0);
  });
  it("归一化坐标 → 像素", () => {
    expect(normToPx([0.5, 0.25], 800, 600)).toEqual([400, 150]);
  });
  it("degToUnit：0=右 90=下 180=左 270=上(y 向下)", () => {
    const [rx, ry] = degToUnit(0);
    expect(rx).toBeCloseTo(1, 5);
    expect(ry).toBeCloseTo(0, 5);
    const [, dy] = degToUnit(90);
    expect(dy).toBeCloseTo(1, 5); // 下
    const [ux, uy] = degToUnit(270);
    expect(ux).toBeCloseTo(0, 5);
    expect(uy).toBeCloseTo(-1, 5); // 上
  });
});

describe("parseBlockingDiagram", () => {
	it("解析并稳定哈希构图合同，且角色覆盖不完整时显式失败", () => {
		const plan = parseBlockingDiagram({
			characters: [{ name: "孟川", at: [0.3, 0.6] }],
			compositionContract: singleCharacterComposition,
		});
		expect(plan.compositionContract?.narrativeTask).toBe("孟川在场景中保持远距观察");
		expect(plan.compositionContractHash).toMatch(/^[a-f0-9]{64}$/);

		expect(() =>
			parseBlockingDiagram({
				characters: [
					{ name: "孟川", at: [0.3, 0.6] },
					{ name: "后土", at: [0.7, 0.6] },
				],
				compositionContract: singleCharacterComposition,
			}),
		).toThrowError("关键帧构图合同未逐项覆盖站位角色");
	});
  it("丢弃非法角色，保留合法的(含默认色)", () => {
    const plan = parseBlockingDiagram({
      characters: [
        { name: "夏繁星", at: [0.3, 0.6] },
        { name: "", at: [0.1, 0.1] }, // 无名→丢
        { at: [0.2, 0.2] }, // 无 name→丢
        { name: "苏梦", at: "bad" }, // 无 at→丢
      ],
    });
    expect(plan.characters).toHaveLength(1);
    expect(plan.characters[0]!.name).toBe("夏繁星");
    expect(plan.characters[0]!.color).toMatch(/^#/);
  });

  it("durationSeconds 渲进标题", () => {
    const plan = parseBlockingDiagram({
      title: "镜15 站位",
      durationSeconds: 2,
      characters: [{ name: "A", at: [0.5, 0.5] }],
    });
    expect(plan.title).toBe("镜15 站位（本镜时长: 2s）");
  });

  it("恰好 2 角色时自动生成轴线", () => {
    const plan = parseBlockingDiagram({
      characters: [
        { name: "A", at: [0.2, 0.5] },
        { name: "B", at: [0.8, 0.5] },
      ],
    });
    expect(plan.axisLine).toBeDefined();
    expect(plan.axisLine!.from).toEqual([0.2, 0.5]);
    expect(plan.axisLine!.to).toEqual([0.8, 0.5]);
  });

  it("3 角色不自动生成轴线(需显式)", () => {
    const plan = parseBlockingDiagram({
      characters: [
        { name: "A", at: [0.2, 0.5] },
        { name: "B", at: [0.5, 0.5] },
        { name: "C", at: [0.8, 0.5] },
      ],
    });
    expect(plan.axisLine).toBeUndefined();
  });

  it("显式 axisLine 覆盖自动", () => {
    const plan = parseBlockingDiagram({
      axisLine: { from: [0.1, 0.1], to: [0.9, 0.9] },
      characters: [
        { name: "A", at: [0.2, 0.5] },
        { name: "B", at: [0.8, 0.5] },
      ],
    });
    expect(plan.axisLine!.from).toEqual([0.1, 0.1]);
  });

  it("解析地标三种 kind，丢弃非法", () => {
    const plan = parseBlockingDiagram({
      characters: [{ name: "A", at: [0.5, 0.5] }],
      landmarks: [
        { kind: "wall", from: [0, 0.5], to: [1, 0.5], label: "楼道" },
        { kind: "door", at: [0.7, 0.5], orient: "v", lengthN: 0.15, label: "302门" },
        { kind: "area", at: [0.3, 0.2], label: "房间" },
        { kind: "wall", from: [0, 0] }, // 缺 to→丢
        { kind: "bogus", at: [0, 0] }, // 未知→丢
      ],
    });
    expect(plan.landmarks).toHaveLength(3);
    expect(plan.landmarks.map((l) => l.kind)).toEqual(["wall", "door", "area"]);
  });

  it("尺寸越界回落默认 800x600", () => {
    const plan = parseBlockingDiagram({
      width: 99999,
      height: 10,
      characters: [{ name: "A", at: [0.5, 0.5] }],
    });
    expect(plan.width).toBe(800);
    expect(plan.height).toBe(600);
  });
});

describe("renderBlockingDiagram", () => {
  it("产出非空 PNG buffer(含双人对峙+门+机位+轴线)", () => {
    const plan = parseBlockingDiagram({
      title: "镜18 夏繁星 VS 苏梦",
      durationSeconds: 2,
      landmarks: [
        { kind: "wall", from: [0.5, 0], to: [0.5, 1], label: "走廊墙" },
        { kind: "door", at: [0.5, 0.4], orient: "v", lengthN: 0.18, label: "302门", swing: "in" },
        { kind: "area", at: [0.22, 0.12], label: "楼道" },
      ],
      characters: [
        { name: "夏繁星", at: [0.3, 0.5], facingTo: [0.65, 0.45], moveTo: [0.4, 0.45] },
        { name: "苏梦", at: [0.66, 0.45], facingTo: [0.3, 0.5] },
      ],
      camera: { at: [0.12, 0.5], lookAt: [0.5, 0.5], fovDeg: 55, label: "机位" },
    });
    const buf = renderBlockingDiagram(plan);
    expect(buf.byteLength).toBeGreaterThan(1000);
    // PNG magic number
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50);
  });

  it("单角色也能渲染(无轴线)", () => {
    const plan = parseBlockingDiagram({
      characters: [{ name: "独", at: [0.5, 0.5], facingDeg: 0 }],
    });
    expect(plan.axisLine).toBeUndefined();
    const buf = renderBlockingDiagram(plan);
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});

describe("backgroundImageUrl 户型底图（2026-07-06 用户拍板）", () => {
  it("http(s) URL 被解析保留；非法/相对路径显式失败", () => {
    const ok = parseBlockingDiagram({
      characters: [{ name: "孟川", at: [0.3, 0.5] }],
      backgroundImageUrl: "https://cdn/x/floorplan.png",
    });
    expect(ok.backgroundImageUrl).toBe("https://cdn/x/floorplan.png");
    expect(() =>
      parseBlockingDiagram({
        characters: [{ name: "孟川", at: [0.3, 0.5] }],
        backgroundImageUrl: "asset://not-a-url",
      }),
    ).toThrowError("backgroundImageUrl 必须是可下载的 http(s) URL");
  });

  it("显式底图不可访问时禁止退回抽象纸底", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    const context = {
      env: {
        OBJECT_STORAGE_PROVIDER: "tos",
        TOS_ACCESS_KEY_ID: "key",
        TOS_SECRET_ACCESS_KEY: "secret",
        TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
        TOS_REGION: "cn-guangzhou",
        TOS_BUCKET: "bucket",
        TOS_PUBLIC_BASE_URL: "https://cdn.tapcanvas.test",
      },
    } as AppContext;

    await expect(
      renderBlockingDiagramToCanvas({
        c: context,
        requestUserId: "user-1",
        bodyArgs: {
          characters: [{ name: "孟川", at: [0.3, 0.5] }],
          compositionContract: singleCharacterComposition,
          backgroundImageUrl: "https://cdn/x/missing-floorplan.png",
        },
      }),
		).rejects.toMatchObject({
			code: "agents_tool_blocking_background_unavailable",
			terminal: false,
		});
  });
});
