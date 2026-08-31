import { describe, expect, it } from "vitest";

import {
  buildVideoPromptDeliveryContract,
  buildVideoPromptDeliveryProjection,
  verifyVideoPromptDeliveryContract,
} from "./video-prompt-delivery-contract";

describe("video prompt delivery contract", () => {
  it("accepts the exact structured prompt projection", () => {
    const contract = buildVideoPromptDeliveryContract({
      prompt: "【唯一人声轨】〈发声正文〉原文台词〈/发声正文〉",
      negativePrompt: "",
    });
    expect(verifyVideoPromptDeliveryContract({
      rawContract: contract,
      prompt: "【唯一人声轨】〈发声正文〉原文台词〈/发声正文〉",
      negativePrompt: "",
    })).toEqual({ ok: true, contract });
  });

  it("rejects any post-freeze prompt mutation instead of silently sanitizing", () => {
    const contract = buildVideoPromptDeliveryContract({ prompt: "冻结正文" });
    expect(verifyVideoPromptDeliveryContract({
      rawContract: contract,
      prompt: "冻结正文（音频：追加固定配置）",
    })).toMatchObject({
      ok: false,
      code: "video_prompt_delivery_prompt_mismatch",
    });
  });

  it("rejects malformed contracts instead of treating them as absent", () => {
    expect(verifyVideoPromptDeliveryContract({
      rawContract: { version: 1, authority: "structured_shots" },
      prompt: "冻结正文",
    })).toMatchObject({
      ok: false,
      code: "video_prompt_delivery_contract_invalid",
    });
  });

  it("keeps the legacy/manual path explicit when no contract was supplied", () => {
    expect(verifyVideoPromptDeliveryContract({
      rawContract: undefined,
      prompt: "手动提示词",
    })).toEqual({ ok: true, contract: null });
  });

  it("projects the same provider-bound prompt into running and success node data", () => {
    const prompt = "冻结正文\n【连续性】承接上一镜退出态";
    const negativePrompt = "";
    const contract = buildVideoPromptDeliveryContract({ prompt, negativePrompt });
    const projection = buildVideoPromptDeliveryProjection({
      prompt,
      negativePrompt,
      contract,
    });

    expect(projection).toEqual({
      prompt,
      negativePrompt,
      promptDeliveryContract: contract,
      videoPrompt: prompt,
    });
    expect(verifyVideoPromptDeliveryContract({
      rawContract: projection.promptDeliveryContract,
      prompt: projection.prompt,
      negativePrompt: projection.negativePrompt,
    })).toEqual({ ok: true, contract });
  });
});
