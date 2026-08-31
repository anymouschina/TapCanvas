import { describe, expect, it } from "vitest";

import type { ResolvedExecutionImageReference } from "./agents-tool-bridge.image-reference-ids";
import { assetObjectContractIdentityKey } from "./video-orchestrator.asset-object-contract";
import {
  buildFinalAssetReferenceIndices,
  hydrateReferenceBindingsFromAssetContracts,
  readAssetObjectIdentityContracts,
} from "./video-reference-contract-binding";
import {
  buildVideoReferenceMediaManifest,
  mergeVideoReferenceImageBindings,
  type VideoReferenceImageBinding,
} from "./video-reference-manifest";

function resolvedProjectAsset(input: {
  assetId: string;
  name: string;
  url: string;
}): ResolvedExecutionImageReference {
  return {
    referenceId: `asset:${input.assetId}`,
    source: "material_asset",
    nodeId: null,
    assetId: input.assetId,
    assetRefId: `${input.assetId}-version`,
    name: input.name,
    url: input.url,
    previewOnly: false,
  };
}

describe("video reference contract binding", () => {
  it("keeps project asset identities attached to their final provider image slots", () => {
    const contracts = readAssetObjectIdentityContracts([
      {
        kind: "character",
        name: "孟川",
        physicalIdentityKey: "physical-mengchuan",
        referenceImageNodeIds: [],
        referenceAssetIds: ["asset-mengchuan"],
        referenceRole: "identity",
      },
      {
        kind: "character",
        name: "冥河",
        physicalIdentityKey: "physical-minghe",
        referenceImageNodeIds: [],
        referenceAssetIds: ["asset-minghe"],
        referenceRole: "identity",
      },
    ]);
    const resolvedReferences = [
      resolvedProjectAsset({
        assetId: "asset-minghe",
        name: "冥河",
        url: "https://assets.example/minghe.png",
      }),
      resolvedProjectAsset({
        assetId: "asset-mengchuan",
        name: "孟川",
        url: "https://assets.example/mengchuan.png",
      }),
    ];
    const bindings = new Map<string, VideoReferenceImageBinding>();
    for (const reference of resolvedReferences) {
      bindings.set(reference.url, {
        url: reference.url,
        label: reference.name,
        purpose: "other",
        purposes: ["other"],
        sourceNodeIds: [],
      });
    }
    const merge = (binding: VideoReferenceImageBinding): void => {
      const [merged] = mergeVideoReferenceImageBindings([
        ...(bindings.get(binding.url) ? [bindings.get(binding.url)!] : []),
        binding,
      ]);
      if (merged) bindings.set(binding.url, merged);
    };

    hydrateReferenceBindingsFromAssetContracts({
      contracts,
      resolvedReferences,
      bindings,
      merge,
    });
    const manifest = buildVideoReferenceMediaManifest({
      referenceImages: resolvedReferences.map((reference) => reference.url),
      referenceBindings: [...bindings.values()],
    });
    const indices = buildFinalAssetReferenceIndices({
      contracts,
      images: manifest.images,
    });

    expect(indices.get(assetObjectContractIdentityKey("character", "孟川"))).toEqual(["@图2"]);
    expect(indices.get(assetObjectContractIdentityKey("character", "冥河"))).toEqual(["@图1"]);
    expect(manifest.images).toEqual([
      expect.objectContaining({
        assetName: "冥河",
        assetKind: "character",
        purpose: "character",
        purposes: ["character"],
        referenceRole: "identity",
        assetContractKeys: [assetObjectContractIdentityKey("character", "冥河")],
      }),
      expect.objectContaining({
        assetName: "孟川",
        assetKind: "character",
        purpose: "character",
        purposes: ["character"],
        referenceRole: "identity",
        assetContractKeys: [assetObjectContractIdentityKey("character", "孟川")],
      }),
    ]);
  });

  it("accepts an explicitly selected material version as the same frozen asset binding", () => {
    const [contract] = readAssetObjectIdentityContracts([{
      kind: "character",
      name: "孟川",
      referenceImageNodeIds: [],
      referenceAssetIds: ["version-mengchuan-117"],
      referenceRole: "identity",
    }]);
    if (!contract) throw new Error("test contract missing");
    const reference: ResolvedExecutionImageReference = {
      referenceId: "asset-version:version-mengchuan-117",
      source: "material_version",
      nodeId: null,
      assetId: "asset-mengchuan",
      assetRefId: "version-mengchuan-117",
      name: "孟川 v117",
      url: "https://assets.example/mengchuan-v117.png",
      previewOnly: false,
    };
    let binding: VideoReferenceImageBinding = {
      url: reference.url,
      label: reference.name,
      purpose: "other",
      purposes: ["other"],
      sourceNodeIds: [],
    };

    hydrateReferenceBindingsFromAssetContracts({
      contracts: [contract],
      resolvedReferences: [reference],
      bindings: new Map([[reference.url, binding]]),
      merge: (next) => {
        [binding] = mergeVideoReferenceImageBindings([binding, next]);
      },
    });

    expect(binding).toEqual(expect.objectContaining({
      assetName: "孟川",
      assetContractKeys: [assetObjectContractIdentityKey("character", "孟川")],
    }));
  });
});
