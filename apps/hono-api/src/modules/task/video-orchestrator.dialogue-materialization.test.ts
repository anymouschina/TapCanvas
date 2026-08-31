import { describe, expect, it } from "vitest";

import {
  compileShotSpeechEventReferences,
  materializeWriterSpeechEvents,
  projectWriterSpeechStructure,
} from "./video-orchestrator.dialogue-materialization";

const dialogueScript = [{
  lineId: "L01",
  speakerName: "沈知夏",
  text: "等等，我不做了。",
  delivery: "on_screen" as const,
}];

describe("materializeWriterSpeechEvents", () => {
  it("projects exact frozen ledger coordinates without changing writer-owned timing", () => {
    const projected = projectWriterSpeechStructure({
      clip: {
        speechEvents: [{
          speechEventId: "speech-L01",
          lineId: "L01",
          startOffset: 2,
          endOffset: 99,
          startSeconds: 1,
          endSeconds: 4,
          speakerName: "错误说话人",
          delivery: "voice_over",
          performance: "低声，句末收住",
          spokenText: "模型复制的正文",
        }],
        shots: [{ durationSeconds: 5, speechEventIds: ["stale"] }],
      },
      dialogueScript,
      characterRoleNames: ["沈知夏"],
    });

    expect(projected.speechEvents).toEqual([{
      speechEventId: "speech-L01",
      lineId: "L01",
      startOffset: 0,
      endOffset: 8,
      startSeconds: 1,
      endSeconds: 4,
      speakerName: "沈知夏",
      delivery: "on_screen",
      performance: "低声，句末收住",
    }]);
    expect(projected.shots).toEqual([{ durationSeconds: 5 }]);
    const materialized = materializeWriterSpeechEvents({
      clip: projected,
      dialogueScript,
      clipDurationSeconds: 5,
    });
    expect(materialized).toEqual(expect.objectContaining({ ok: true }));
  });

  it("materializes one complete frozen line on an independent timeline that crosses cuts", () => {
    const result = materializeWriterSpeechEvents({
      clip: {
        speechEvents: [{
          speechEventId: "speech-L01",
          lineId: "L01",
          startOffset: 0,
          endOffset: 8,
          startSeconds: 1,
          endSeconds: 4,
          speakerName: "沈知夏",
          delivery: "on_screen",
          performance: "低声，句末收住",
        }],
        shots: [
          { speechEventIds: ["provider-stale-reference"], durationSeconds: 2 },
          { durationSeconds: 3 },
        ],
      },
      dialogueScript,
      clipDurationSeconds: 5,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) return;
    expect(result.clip.speechEvents).toEqual([
      expect.objectContaining({
        speechEventId: "speech-L01",
        spokenText: "等等，我不做了。",
        startSeconds: 1,
        endSeconds: 4,
      }),
    ]);
    const compiled = compileShotSpeechEventReferences(result.clip);
    expect(compiled.shots).toEqual([
      expect.objectContaining({ speechEventIds: ["speech-L01"] }),
      expect.objectContaining({ speechEventIds: ["speech-L01"] }),
    ]);
  });

  it("compiles references only from the final normalized shot clock", () => {
    const compiled = compileShotSpeechEventReferences({
      speechEvents: [{
        speechEventId: "speech-L01",
        startSeconds: 1,
        endSeconds: 3,
      }],
      shots: [
        { durationSeconds: 1, speechEventIds: ["stale"] },
        { durationSeconds: 2 },
        { durationSeconds: 2, speechEventIds: ["speech-L01"] },
      ],
    });

    expect(compiled.shots).toEqual([
      { durationSeconds: 1 },
      { durationSeconds: 2, speechEventIds: ["speech-L01"] },
      { durationSeconds: 2 },
    ]);
  });

  it("rejects any attempt to split a frozen line at a shot boundary", () => {
    const result = materializeWriterSpeechEvents({
      clip: {
        speechEvents: [
          { speechEventId: "part-a", lineId: "L01", startOffset: 0, endOffset: 3, startSeconds: 0, endSeconds: 1, speakerName: "沈知夏", delivery: "on_screen" },
          { speechEventId: "part-b", lineId: "L01", startOffset: 3, endOffset: 8, startSeconds: 1, endSeconds: 3, speakerName: "沈知夏", delivery: "on_screen" },
        ],
        shots: [],
      },
      dialogueScript,
      clipDurationSeconds: 5,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.problem).join("|")).toContain("不得按镜头切分台词");
    expect(result.issues.map((issue) => issue.problem).join("|")).toContain("唯一承载");
  });

  it("rejects spoken text in writer fields and legacy shot-owned dialogue", () => {
    const result = materializeWriterSpeechEvents({
      clip: {
        speechEvents: [{
          speechEventId: "speech-L01",
          lineId: "L01",
          startOffset: 0,
          endOffset: 8,
          startSeconds: 0,
          endSeconds: 3,
          speakerName: "沈知夏",
          delivery: "on_screen",
          spokenText: "等等，我不做了。",
        }],
        shots: [{ dialogueLineId: "L01", dialogue: "等等" }],
      },
      dialogueScript,
      clipDurationSeconds: 5,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "speechEvents[0]",
      "shots[0].dialogueLineId",
      "shots[0].dialogue",
    ]));
  });
});
