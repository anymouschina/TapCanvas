import { describe, expect, it } from "vitest";

import { MasterShotTableSchema, type MasterShotTable } from "./master-storyboard.types";

function validTable(): MasterShotTable {
  return {
    title: "章节母板",
    globalStyleAnchor: "冷色电影光",
    characterLocks: [],
    sceneLocks: [],
    segments: [
      {
        segmentIndex: 0,
        beatName: "逼近",
        durationSeconds: 10,
        shots: [
          {
            shotNo: 1,
            景别: "中景",
            构图: "双人对峙",
            运镜: "缓推",
            动作: "主角逼近一步",
            光效: "侧逆光",
            台词: "",
            音效: "脚步声",
          },
        ],
      },
    ],
  };
}

describe("MasterShotTableSchema", () => {
  it("accepts an explicit zero-based structured table", () => {
    expect(MasterShotTableSchema.parse(validTable())).toEqual(validTable());
  });

  it("does not coerce numeric strings or fabricate missing shot fields", () => {
    const table = validTable() as unknown as Record<string, unknown>;
    table.segments = [
      {
        segmentIndex: "0",
        beatName: "逼近",
        durationSeconds: "10",
        shots: [{ shotNo: 1, 景别: "中景" }],
      },
    ];
    expect(MasterShotTableSchema.safeParse(table).success).toBe(false);
  });

  it("rejects non-contiguous segment indexes", () => {
    const table = validTable();
    table.segments[0]!.segmentIndex = 2;
    const parsed = MasterShotTableSchema.safeParse(table);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(["segments", 0, "segmentIndex"]);
  });
});
