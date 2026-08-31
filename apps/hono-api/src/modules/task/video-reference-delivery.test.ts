import { describe, expect, it } from "vitest";

import type { VideoReferenceImageManifestItem } from "./video-reference-manifest";
import {
  verifyVideoReferenceDelivery,
} from "./video-reference-delivery";

const contract = {
  version: 1 as const,
  clipIndex: 1,
  continuityMode: "bridge_frames" as const,
  expectedNodes: [
    { nodeId: "character-mo", expectedImageCount: 2 },
    { nodeId: "bridge-01", expectedImageCount: 1 },
  ],
};

const manifest: VideoReferenceImageManifestItem[] = [
  {
    url: "https://assets/mo-front.png",
    label: "角色卡·墨·正面",
    purpose: "character",
    purposes: ["character"],
    sourceNodeIds: ["character-mo"],
    role: "reference_image",
  },
  {
    url: "https://assets/mo-side.png",
    label: "角色卡·墨·侧面",
    purpose: "character",
    purposes: ["character"],
    sourceNodeIds: ["character-mo"],
    role: "reference_image",
  },
  {
    url: "https://assets/bridge.png",
    label: "桥接首帧",
    purpose: "storyboard",
    purposes: ["storyboard"],
    sourceNodeIds: ["bridge-01"],
    role: "first_frame",
  },
];

describe("video reference expectedDelivery → evidence → verification", () => {
  it("accepts an exact manifest and records URL-level node attribution evidence", () => {
    const result = verifyVideoReferenceDelivery({ contract, manifest });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        evidence: expect.objectContaining({
          declaredNodeIds: ["character-mo", "bridge-01"],
          manifestedNodeIds: ["character-mo", "bridge-01"],
          verified: true,
        }),
      }),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.evidence.manifest[0]).toEqual(
      expect.objectContaining({
        url: "https://assets/mo-front.png",
        sourceNodeIds: ["character-mo"],
      }),
    );
  });

  it("lets one canonical media item satisfy one frozen VFX node", () => {
    const result = verifyVideoReferenceDelivery({
      contract: {
        version: 1,
        clipIndex: 0,
        continuityMode: "editorial_cut",
        expectedNodes: [
          { nodeId: "style-master-rainy-gate-duel", expectedImageCount: 1 },
        ],
      },
      manifest: [
        {
          url: "https://assets/shared-style-vfx.png",
          label: "雨幕 VFX",
          purpose: "vfx",
          purposes: ["vfx"],
          sourceNodeIds: ["style-master-rainy-gate-duel"],
          role: "reference_image",
        },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        evidence: expect.objectContaining({
          manifestedNodeIds: ["style-master-rainy-gate-duel"],
        }),
      }),
    );
  });

  it("blocks before paid submission when an expected node image disappears", () => {
    const result = verifyVideoReferenceDelivery({ contract, manifest: manifest.slice(0, 2) });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: "video_reference_delivery_mismatch",
        details: expect.objectContaining({
          missingOrChanged: [
            { nodeId: "bridge-01", expectedImageCount: 1, actualImageCount: 0 },
          ],
        }),
      }),
    );
  });

  it("rejects unattributed images", () => {
    const unattributed = verifyVideoReferenceDelivery({
      contract,
      manifest: [
        ...manifest,
        {
          url: "https://assets/unknown.png",
          label: "未知参考",
          purpose: "character",
          purposes: ["character"],
          sourceNodeIds: [],
          role: "reference_image",
        },
      ],
    });
    expect(unattributed).toEqual(
      expect.objectContaining({ ok: false, code: "video_reference_delivery_mismatch" }),
    );
  });

  it("rejects a malformed delivery contract instead of assuming an empty reference set", () => {
    expect(
      verifyVideoReferenceDelivery({
        contract: { ...contract, expectedNodes: undefined },
        manifest,
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: "video_reference_delivery_contract_invalid",
      }),
    );
  });

});
