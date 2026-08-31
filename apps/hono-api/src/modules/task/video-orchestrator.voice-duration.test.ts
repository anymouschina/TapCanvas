import { describe, expect, it, vi } from "vitest";
import { repairMissingVoiceDurations } from "./video-orchestrator.voice-duration";

describe("repairMissingVoiceDurations", () => {
  it("probes and patches only cards whose real audio is missing duration metadata", async () => {
    const probeDuration = vi.fn().mockResolvedValue(3.25);
    const result = await repairMissingVoiceDurations({
      bindings: [{
        character: "沈知夏",
        nodeId: "voice-shen",
        audioUrl: "https://assets.example/shen.mp3",
        audioDurationSec: null,
      }],
      probeDuration,
    });
    expect(result.bindings[0]?.audioDurationSec).toBe(3.25);
    expect(result.patches).toEqual([{ id: "voice-shen", data: { audioDurationSec: 3.25 } }]);
    expect(probeDuration).toHaveBeenCalledOnce();
  });

  it("does not probe a card that already has measured duration", async () => {
    const probeDuration = vi.fn();
    const result = await repairMissingVoiceDurations({
      bindings: [{
        character: "沈知夏",
        nodeId: "voice-shen",
        audioUrl: "https://assets.example/shen.mp3",
        audioDurationSec: 4.1,
      }],
      probeDuration,
    });
    expect(result.patches).toEqual([]);
    expect(probeDuration).not.toHaveBeenCalled();
  });

  it("fails explicitly when the real audio cannot be probed", async () => {
    await expect(repairMissingVoiceDurations({
      bindings: [{
        character: "沈知夏",
        nodeId: "voice-shen",
        audioUrl: "https://assets.example/shen.mp3",
        audioDurationSec: null,
      }],
      probeDuration: async () => null,
    })).rejects.toThrow("speaker_voice_asset_probe_failed:沈知夏:voice-shen");
  });
});
