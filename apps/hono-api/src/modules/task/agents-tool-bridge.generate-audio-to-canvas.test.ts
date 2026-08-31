import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";

const {
  mockedSynthesizeSpeechToStorage,
  mockedRequireSelectableAudioModel,
  mockedPersistFlowPatch,
  mockedRegisterGeneratedMediaAsset,
  mockedIsDoubaoSpeechModel,
  mockedSynthesizeDoubaoSpeechToStorage,
  mockedListDoubaoSeedAudioVoices,
} = vi.hoisted(() => ({
  mockedSynthesizeSpeechToStorage: vi.fn(),
  mockedRequireSelectableAudioModel: vi.fn(),
  mockedPersistFlowPatch: vi.fn(),
  mockedRegisterGeneratedMediaAsset: vi.fn(),
  mockedIsDoubaoSpeechModel: vi.fn(),
  mockedSynthesizeDoubaoSpeechToStorage: vi.fn(),
  mockedListDoubaoSeedAudioVoices: vi.fn(),
}));

vi.mock("../apiKey/audio-speech", () => ({
  synthesizeSpeechToStorage: mockedSynthesizeSpeechToStorage,
  synthesizeDoubaoSpeechToStorage: mockedSynthesizeDoubaoSpeechToStorage,
  isDoubaoSpeechModel: mockedIsDoubaoSpeechModel,
  generateMusicToStorage: vi.fn(),
}));

vi.mock("../new-api-models/new-api-audio-model", () => ({
  requireSelectableAudioModel: mockedRequireSelectableAudioModel,
}));

vi.mock("../apiKey/seed-audio-voices", () => ({
  listDoubaoSeedAudioVoices: mockedListDoubaoSeedAudioVoices,
}));

vi.mock("./video-orchestrator.flow-io", () => ({
  persistFlowPatch: mockedPersistFlowPatch,
  readFlowNodes: vi.fn(() => []),
}));

vi.mock("../asset/asset.hosting", () => ({
  registerGeneratedMediaAsset: mockedRegisterGeneratedMediaAsset,
}));

vi.mock("./material-auto-register", () => ({
  maybeAutoRegisterVoiceCard: vi.fn(),
}));

import { generateAudioToCanvas } from "./agents-tool-bridge.generate-audio-to-canvas";

describe("generateAudioToCanvas asset contract", () => {
  beforeEach(() => {
    mockedSynthesizeSpeechToStorage.mockReset();
    mockedRequireSelectableAudioModel.mockReset();
    mockedPersistFlowPatch.mockReset();
    mockedRegisterGeneratedMediaAsset.mockReset();
    mockedIsDoubaoSpeechModel.mockReset();
    mockedSynthesizeDoubaoSpeechToStorage.mockReset();
    mockedListDoubaoSeedAudioVoices.mockReset();
		mockedIsDoubaoSpeechModel.mockReturnValue(false);
		mockedListDoubaoSeedAudioVoices.mockResolvedValue([]);
    mockedRequireSelectableAudioModel.mockResolvedValue({
      requestModelKey: "speech-model-1",
      tags: [],
    });
    mockedSynthesizeSpeechToStorage.mockResolvedValue({
      url: "https://assets.example.com/voice.mp3",
      durationSec: 4.5,
      voiceId: "voice-1",
    });
    mockedRegisterGeneratedMediaAsset.mockResolvedValue("asset-audio-1");
    mockedPersistFlowPatch.mockResolvedValue(undefined);
  });

  it("registers generated audio and writes the same asset id to the canvas node", async () => {
    const row: FlowRow = {
      id: "flow-1",
      name: "Audio flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    };

    const result = await generateAudioToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "audio-node-1",
          data: {
            audioType: "speech",
            text: "你好，世界",
            label: "旁白",
          },
        },
      },
    });

    expect(mockedRegisterGeneratedMediaAsset).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      meta: expect.objectContaining({
        type: "audio",
        url: "https://assets.example.com/voice.mp3",
        durationSec: 4.5,
        generationContext: expect.objectContaining({
          projectId: "project-1",
          flowId: "flow-1",
          nodeId: "audio-node-1",
        }),
      }),
    }));
    expect(mockedPersistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
      patch: {
        createNodes: [
          expect.objectContaining({
            id: "audio-node-1",
            data: expect.objectContaining({
              audioUrl: "https://assets.example.com/voice.mp3",
              assetId: "asset-audio-1",
              serverAssetId: "asset-audio-1",
              assetRegistrationStatus: "ready",
              audioResults: [
                expect.objectContaining({
                  url: "https://assets.example.com/voice.mp3",
                  assetId: "asset-audio-1",
                }),
              ],
            }),
          }),
        ],
      },
    }));
    expect(result).toMatchObject({
      ok: true,
      nodeId: "audio-node-1",
      assetId: "asset-audio-1",
      audioUrl: "https://assets.example.com/voice.mp3",
    });
  });

  it("preserves produced audio on the canvas and reports partial success when asset registration fails", async () => {
    const row: FlowRow = {
      id: "flow-2",
      name: "Audio flow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    };
    mockedRegisterGeneratedMediaAsset.mockRejectedValueOnce(new Error("asset database unavailable"));

    await expect(generateAudioToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "audio-node-partial",
          data: { audioType: "speech", text: "保留这段音频" },
        },
      },
    })).rejects.toMatchObject({ code: "audio_asset_registration_partial_success" });

    expect(mockedPersistFlowPatch).toHaveBeenCalledWith(expect.objectContaining({
      patch: {
        createNodes: [
          expect.objectContaining({
            id: "audio-node-partial",
            data: expect.objectContaining({
              status: "success",
              audioUrl: "https://assets.example.com/voice.mp3",
              assetRegistrationStatus: "failed",
              assetRegistrationError: "asset database unavailable",
            }),
          }),
        ],
      },
    }));
  });

  it("refuses an unavailable frozen voice id before starting paid synthesis", async () => {
    const row: FlowRow = {
      id: "flow-exact-voice",
      name: "Voice workflow",
      data: JSON.stringify({ nodes: [], edges: [] }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-08-23T00:00:00.000Z",
      updated_at: "2026-08-23T00:00:00.000Z",
    };
    mockedRequireSelectableAudioModel.mockResolvedValue({
      requestModelKey: "doubao-seed-audio-1-0",
      tags: ["tapcanvas:audio-engine=doubao"],
    });
    mockedIsDoubaoSpeechModel.mockReturnValue(true);
    mockedListDoubaoSeedAudioVoices.mockResolvedValue([
      { id: "voice-live", name: "实时音色" },
    ]);

    await expect(generateAudioToCanvas({
      c: { env: { DB: {} } } as AppContext,
      requestUserId: "user-1",
      devBypass: false,
      flowId: row.id,
      row,
      bodyArgs: {
        node: {
          id: "voice-card-1",
          data: {
            audioType: "voice_card",
            voiceCharacter: "角色甲",
            voiceId: "voice-frozen-but-removed",
            requireExactVoiceId: true,
            audioModel: "doubao-seed-audio-1-0",
          },
        },
      },
    })).rejects.toMatchObject({ code: "audio_voice_exact_id_unavailable" });

    expect(mockedSynthesizeDoubaoSpeechToStorage).not.toHaveBeenCalled();
    expect(mockedPersistFlowPatch).not.toHaveBeenCalled();
    expect(mockedRegisterGeneratedMediaAsset).not.toHaveBeenCalled();
  });
});
