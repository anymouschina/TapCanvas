import { describe, expect, it } from "vitest";

import {
  buildSeedanceReferenceContentItems,
  buildVideoReferenceMediaManifest,
  mergeVideoReferenceImageBindings,
  mediaManifestMatchesRequest,
  parseVideoReferenceMediaManifest,
  purposeForAssetReferenceRole,
  renderVideoReferenceContinuationNote,
  selectSeedanceReferenceMode,
  withAuthoritativePromptAnnotation,
} from "./video-reference-manifest";

describe("video reference media manifest", () => {
  it("maps every structured asset role without collapsing VFX or composition to other", () => {
    expect(purposeForAssetReferenceRole("identity")).toBe("character");
    expect(purposeForAssetReferenceRole("wardrobe")).toBe("character");
    expect(purposeForAssetReferenceRole("environment")).toBe("scene");
    expect(purposeForAssetReferenceRole("prop")).toBe("prop");
    expect(purposeForAssetReferenceRole("palette")).toBe("style");
    expect(purposeForAssetReferenceRole("composition")).toBe("composition");
    expect(purposeForAssetReferenceRole("vfx")).toBe("vfx");
  });

  it("deduplicates one physical image without dropping its declared business purposes", () => {
    expect(
      mergeVideoReferenceImageBindings([
        {
          url: "https://x/shared-style-vfx.png",
          label: "雨夜水墨烟气",
          purpose: "vfx",
          purposes: ["vfx"],
          sourceNodeIds: ["style-master-rainy-gate-duel"],
        },
        {
          url: "https://x/shared-style-vfx.png",
          label: "雨夜色彩资产",
          purpose: "style",
          purposes: ["style"],
          sourceNodeIds: [],
        },
      ]),
    ).toEqual([
      {
        url: "https://x/shared-style-vfx.png",
        label: "雨夜色彩资产",
        purpose: "vfx",
        purposes: ["vfx", "style"],
        sourceNodeIds: ["style-master-rainy-gate-duel"],
      },
    ]);
  });
  it("keeps request order while assigning first/last/audio roles", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: ["https://x/character.png", "https://x/scene.png"],
      referenceBindings: [
        {
          url: "https://x/character.png",
          label: "角色卡·秦元",
          purpose: "character",
          sourceNodeIds: ["role-qinyuan"],
        },
        { url: "https://x/scene.png", label: "场景卡·灵药洞窟", purpose: "scene", sourceNodeIds: ["scene-cave"] },
        { url: "https://x/end.png", label: "桥接尾帧", purpose: "keyframe", sourceNodeIds: ["bridge-end"] },
      ],
      firstFrameUrl: "https://x/character.png",
      lastFrameUrl: "https://x/end.png",
      referenceAudioUrls: ["https://x/qinyuan.mp3"],
      referenceAudioLabels: ["秦元的音色参考"],
    });

    expect(manifest).toEqual({
      images: [
        {
          url: "https://x/character.png",
          label: "角色卡·秦元",
          purpose: "character",
          purposes: ["character"],
          sourceNodeIds: ["role-qinyuan"],
          role: "first_frame",
        },
        {
          url: "https://x/scene.png",
          label: "场景卡·灵药洞窟",
          purpose: "scene",
          purposes: ["scene"],
          sourceNodeIds: ["scene-cave"],
          role: "reference_image",
        },
        {
          url: "https://x/end.png",
          label: "桥接尾帧",
          purpose: "keyframe",
          purposes: ["keyframe"],
          sourceNodeIds: ["bridge-end"],
          role: "last_frame",
        },
      ],
      audios: [
        {
          url: "https://x/qinyuan.mp3",
          label: "秦元的音色参考",
          role: "reference_audio",
        },
      ],
    });
  });

  it("keeps reference-video facts but removes stale image mapping blocks", () => {
    const note = renderVideoReferenceContinuationNote("参考视频=上一镜成片");
    const prompt = withAuthoritativePromptAnnotation(
      "镜头正文\n\n[参考图绑定] @图1=旧错误映射。\n\n@图2对@图3说：『原文对白』",
      note,
    );

    expect(note).toBe("[参考视频绑定] 参考视频=上一镜成片");
    expect(prompt).not.toContain("旧错误映射");
    expect(prompt).toContain("@图2对@图3说：『原文对白』");
    expect(prompt).toContain("[参考视频绑定] 参考视频=上一镜成片");
    expect(prompt).not.toContain("[参考图绑定]");
  });

  it("builds Seedance content from the same manifest without reordering", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: ["https://x/ref.png"],
      firstFrameUrl: "https://x/first.png",
      lastFrameUrl: "https://x/last.png",
      referenceAudioUrls: ["https://x/voice.mp3"],
    });

    expect(buildSeedanceReferenceContentItems(manifest)).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://x/ref.png" },
        role: "reference_image",
      },
      {
        type: "image_url",
        image_url: { url: "https://x/first.png" },
        role: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: "https://x/last.png" },
        role: "last_frame",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://x/voice.mp3" },
        role: "reference_audio",
      },
    ]);
    expect(
      mediaManifestMatchesRequest({
        manifest,
        referenceImages: [
          "https://x/ref.png",
          "https://x/first.png",
          "https://x/last.png",
        ],
        referenceAudios: ["https://x/voice.mp3"],
      }),
    ).toBe(true);
  });

  it("rejects malformed persisted manifests instead of silently rebuilding them", () => {
    expect(
      parseVideoReferenceMediaManifest({
        images: [{ url: "https://x/ref.png", role: "unknown" }],
        audios: [],
      }),
    ).toBeNull();
  });

  it("preserves canonical sourceNodeIds when a persisted manifest is parsed again", () => {
    expect(
      parseVideoReferenceMediaManifest({
        images: [
          {
            url: "https://x/ref.png",
            label: "角色卡·秦元",
            purpose: "character",
            purposes: ["character"],
            sourceNodeIds: ["role-qinyuan"],
            role: "reference_image",
          },
        ],
        audios: [],
      }),
    ).toEqual({
      images: [
        {
          url: "https://x/ref.png",
          label: "角色卡·秦元",
          purpose: "character",
          purposes: ["character"],
          sourceNodeIds: ["role-qinyuan"],
          role: "reference_image",
        },
      ],
      audios: [],
    });
  });

  it("rejects request arrays that contain the same media in a different order", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: ["https://x/character.png", "https://x/scene.png"],
      referenceAudioUrls: ["https://x/lead.mp3", "https://x/support.mp3"],
    });

    expect(
      mediaManifestMatchesRequest({
        manifest,
        referenceImages: ["https://x/scene.png", "https://x/character.png"],
        referenceAudios: ["https://x/support.mp3", "https://x/lead.mp3"],
      }),
    ).toBe(false);
  });

  it("preserves multimodal assets and promotes keyframes when a clip also has references", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: ["https://x/character.png", "https://x/scene.png"],
      firstFrameUrl: "https://x/first.png",
      lastFrameUrl: "https://x/last.png",
      referenceAudioUrls: ["https://x/voice.mp3"],
    });

    expect(selectSeedanceReferenceMode(manifest)).toEqual({
      mode: "multimodal_reference",
      manifest: {
        images: [
          {
            url: "https://x/character.png",
            label: "参考图",
            purpose: "other",
            purposes: ["other"],
            sourceNodeIds: [],
            role: "reference_image",
          },
          {
            url: "https://x/scene.png",
            label: "参考图",
            purpose: "other",
            purposes: ["other"],
            sourceNodeIds: [],
            role: "reference_image",
          },
          {
            url: "https://x/first.png",
            label: "本镜首帧",
            purpose: "keyframe",
            purposes: ["keyframe"],
            sourceNodeIds: [],
            role: "reference_image",
          },
          {
            url: "https://x/last.png",
            label: "本镜尾帧",
            purpose: "keyframe",
            purposes: ["keyframe"],
            sourceNodeIds: [],
            role: "reference_image",
          },
        ],
        audios: [
          {
            url: "https://x/voice.mp3",
            label: "音频1",
            role: "reference_audio",
          },
        ],
      },
      omittedReferenceImages: 0,
      omittedReferenceAudios: 0,
      frameImagesPromotedToReferences: 2,
    });
  });

  it("keeps literal first/last-frame mode when no other reference media exists", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: [],
      firstFrameUrl: "https://x/first.png",
      lastFrameUrl: "https://x/last.png",
    });

    expect(selectSeedanceReferenceMode(manifest)).toEqual({
      mode: "first_last_frame",
      manifest,
      omittedReferenceImages: 0,
      omittedReferenceAudios: 0,
      frameImagesPromotedToReferences: 0,
    });
  });

  it("keeps the complete multimodal manifest when no literal frame exists", () => {
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: ["https://x/character.png"],
      referenceAudioUrls: ["https://x/voice.mp3"],
    });

    expect(selectSeedanceReferenceMode(manifest)).toEqual({
      mode: "multimodal_reference",
      manifest,
      omittedReferenceImages: 0,
      omittedReferenceAudios: 0,
      frameImagesPromotedToReferences: 0,
    });
  });
});
