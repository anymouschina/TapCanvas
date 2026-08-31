export type VoiceDurationBinding = {
  character: string;
  nodeId: string;
  audioUrl: string;
  audioDurationSec: number | null;
  [key: string]: unknown;
};

export type VoiceDurationRepair = {
  bindings: VoiceDurationBinding[];
  patches: Array<{ id: string; data: { audioDurationSec: number } }>;
};

/**
 * 旧配音卡可能已有真实音频但缺 duration metadata。这里仅探测该原资产并补事实字段，
 * 不重合成、不换音色，也不把探测失败伪装成合法时长。
 */
export async function repairMissingVoiceDurations(input: {
  bindings: readonly VoiceDurationBinding[];
  probeDuration: (audioUrl: string) => Promise<number | null>;
}): Promise<VoiceDurationRepair> {
  const durationByUrl = new Map<string, number | null>();
  const bindings: VoiceDurationBinding[] = [];
  const patches: VoiceDurationRepair["patches"] = [];
  for (const binding of input.bindings) {
    if (
      typeof binding.audioDurationSec === "number" &&
      Number.isFinite(binding.audioDurationSec) &&
      binding.audioDurationSec > 0
    ) {
      bindings.push({ ...binding });
      continue;
    }
    let durationSec = durationByUrl.get(binding.audioUrl);
    if (durationSec === undefined) {
      durationSec = await input.probeDuration(binding.audioUrl);
      durationByUrl.set(binding.audioUrl, durationSec);
    }
    if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(`speaker_voice_asset_probe_failed:${binding.character}:${binding.nodeId}`);
    }
    bindings.push({ ...binding, audioDurationSec: durationSec });
    patches.push({ id: binding.nodeId, data: { audioDurationSec: durationSec } });
  }
  return { bindings, patches };
}
