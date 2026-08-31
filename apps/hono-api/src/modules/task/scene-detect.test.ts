import { afterEach, describe, expect, it, vi } from "vitest";

// Mock execFile so we can simulate scenedetect being absent (ENOENT) without
// touching the real binary. promisify(execFile) falls back to standard
// callback promisification when the custom symbol is missing on the mock.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

import {
  decideScenes,
  detectScenes,
  fixedWindowSplit,
  mergeTinyScenes,
  parseScenesCsv,
  type DetectedScene,
} from "./scene-detect";

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

function enoent(cmd: string): NodeJS.ErrnoException {
  const err = new Error(`spawn ${cmd} ENOENT`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

afterEach(() => {
  execFileMock.mockReset();
});

describe("parseScenesCsv", () => {
  it("parses the full scenedetect CSV (timecode list + multi-column header)", () => {
    const csv = [
      "Timecode List:,00:00:05.200,00:00:12.800",
      "Scene Number,Start Frame,Start Timecode,Start Time (seconds),End Frame,End Timecode,End Time (seconds),Length (frames),Length (timecode),Length (seconds)",
      "1,1,00:00:00.000,0.000,130,00:00:05.200,5.200,130,00:00:05.200,5.200",
      "2,131,00:00:05.200,5.200,320,00:00:12.800,12.800,190,00:00:07.600,7.600",
      "3,321,00:00:12.800,12.800,450,00:00:18.000,18.000,130,00:00:05.200,5.200",
    ].join("\n");

    expect(parseScenesCsv(csv)).toEqual([
      { startSec: 0, endSec: 5.2 },
      { startSec: 5.2, endSec: 12.8 },
      { startSec: 12.8, endSec: 18 },
    ]);
  });

  it("parses the simplified CSV format via header column lookup", () => {
    const csv = [
      "Scene,Start Time (seconds),End Time (seconds),Length (seconds)",
      "1,0.0,5.2,5.2",
      "2,5.2,12.8,7.6",
    ].join("\n");

    expect(parseScenesCsv(csv)).toEqual([
      { startSec: 0, endSec: 5.2 },
      { startSec: 5.2, endSec: 12.8 },
    ]);
  });

  it("returns [] for empty or header-less CSV and skips invalid rows", () => {
    expect(parseScenesCsv("")).toEqual([]);
    expect(parseScenesCsv("garbage,without,header")).toEqual([]);
    const csv = [
      "Scene,Start Time (seconds),End Time (seconds)",
      "1,0.0,5.0",
      "2,bad,nope",
      "3,9.0,4.0", // end <= start -> dropped
    ].join("\n");
    expect(parseScenesCsv(csv)).toEqual([{ startSec: 0, endSec: 5 }]);
  });
});

describe("fixedWindowSplit", () => {
  it("splits duration into ~windowSec windows with a padded final window", () => {
    const scenes = fixedWindowSplit(14, 3.5);
    expect(scenes).toHaveLength(4);
    expect(scenes.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 3.5],
      [3.5, 7],
      [7, 10.5],
      [10.5, 14],
    ]);
    expect(scenes.every((s) => s.boundarySource === "fallback-window")).toBe(true);
    expect(scenes.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it("returns [] for non-positive duration", () => {
    expect(fixedWindowSplit(0)).toEqual([]);
    expect(fixedWindowSplit(-5)).toEqual([]);
  });
});

describe("decideScenes", () => {
  const real: DetectedScene[] = [
    { index: 0, startSec: 0, endSec: 5, durationSec: 5, boundarySource: "scene-detect" },
    { index: 1, startSec: 5, endSec: 12, durationSec: 7, boundarySource: "scene-detect" },
  ];

  it("keeps multi-scene detection results as-is", () => {
    expect(decideScenes(real, 12)).toBe(real);
  });

  it("falls back to fixed windows when 0 scenes detected", () => {
    const out = decideScenes([], 10, 3.5);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((s) => s.boundarySource === "fallback-window")).toBe(true);
  });

  it("falls back when a single scene spans a long video (> threshold)", () => {
    const single: DetectedScene[] = [
      { index: 0, startSec: 0, endSec: 20, durationSec: 20, boundarySource: "scene-detect" },
    ];
    const out = decideScenes(single, 20, 3.5);
    expect(out.every((s) => s.boundarySource === "fallback-window")).toBe(true);
    expect(out.length).toBeGreaterThan(1);
  });

  it("keeps a single scene for short videos (<= threshold)", () => {
    const single: DetectedScene[] = [
      { index: 0, startSec: 0, endSec: 6, durationSec: 6, boundarySource: "scene-detect" },
    ];
    expect(decideScenes(single, 6)).toBe(single);
  });
});

describe("mergeTinyScenes", () => {
  it("merges a too-short scene into its previous neighbor", () => {
    const scenes: DetectedScene[] = [
      { index: 0, startSec: 0, endSec: 5, durationSec: 5, boundarySource: "scene-detect" },
      { index: 1, startSec: 5, endSec: 5.5, durationSec: 0.5, boundarySource: "scene-detect" },
      { index: 2, startSec: 5.5, endSec: 11, durationSec: 5.5, boundarySource: "scene-detect" },
    ];
    const merged = mergeTinyScenes(scenes, 1);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ index: 0, startSec: 0, endSec: 5.5, durationSec: 5.5 });
    expect(merged[1]).toMatchObject({ index: 1, startSec: 5.5, endSec: 11 });
  });

  it("merges a too-short first scene into the next neighbor", () => {
    const scenes: DetectedScene[] = [
      { index: 0, startSec: 0, endSec: 0.4, durationSec: 0.4, boundarySource: "scene-detect" },
      { index: 1, startSec: 0.4, endSec: 6, durationSec: 5.6, boundarySource: "scene-detect" },
    ];
    const merged = mergeTinyScenes(scenes, 1);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ index: 0, startSec: 0, endSec: 6, durationSec: 6 });
  });
});

describe("detectScenes fallback", () => {
  it("falls back to fixed window split when scenedetect is missing (ENOENT)", async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown) => void) => {
        cb(enoent("scenedetect"));
      },
    );

    const scenes = await detectScenes("/tmp/clip.mp4", { totalDurationSec: 14, windowSec: 3.5 });

    expect(scenes).toHaveLength(4);
    expect(scenes.every((s) => s.boundarySource === "fallback-window")).toBe(true);
    expect(scenes[scenes.length - 1].endSec).toBe(14);
    // Only scenedetect should have been attempted; duration was supplied so no ffprobe.
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});
