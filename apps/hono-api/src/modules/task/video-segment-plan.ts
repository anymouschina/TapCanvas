/**
 * 长视频切段规划（纯函数）——A(视频理解 ≤15s/段) 与 B(复刻 decompose ≤120s/段) 的共享心脏。
 *
 * 背景：video-understand 模型 `input_video` 只接受 video_url、不支持时间范围(new-api openai_request.go)，
 * decompose 逐镜抽帧+打标对长片极重(271s 实测撞 ~300s 超时)。两者都必须把长视频物理切成 ≤maxSegSec
 * 的多段、逐段处理再合并。本函数只算「切几段、各段起止」，不碰 ffmpeg/IO，便于单测与复用。
 */
// 视频理解模型的单次输入硬上限：15 秒。所有理解入口（analyze / director
// breakdown）都必须通过这个常量切段，不能把整段长片直接交给模型。
export const ANALYZE_VIDEO_MAX_SEGMENT_SEC = 15;
export const DECOMPOSE_MAX_SEGMENT_SEC = 120;

// 视频理解模型 input_video 的硬上限是 50 MiB（实测 57 MiB 直接 400 InvalidParameter）。短但高码率的
// 超宽幅片(如 3958x1548)会时长够短却文件超限——必须按【大小】也切段。留余量到 38 MiB/段（平均码率切，
// 给局部码率波动留头寸）。
export const VIDEO_UNDERSTAND_MAX_BYTES = 38 * 1024 * 1024;

/**
 * 算「既不超时长上限、又不超大小上限」的等效单段时长（纯函数）。
 * splitVideoUrlToSegments 用 -c copy 流拷贝，段大小≈按时长线性，所以"按大小切"=换算成更短的 maxSegSec。
 * - 时长/大小未知(≤0) → 退回 durationCapSec（维持原纯时长行为）。
 * - 否则 sizeCap = floor(maxBytes / 平均每秒字节)，取 min(durationCapSec, sizeCap)，至少 1s。
 */
export function sizeAwareMaxSegSec(
  durationSec: number,
  fileSizeBytes: number,
  durationCapSec: number,
  maxBytes: number = VIDEO_UNDERSTAND_MAX_BYTES,
): number {
  if (!(durationSec > 0) || !(fileSizeBytes > 0) || !(maxBytes > 0)) return durationCapSec;
  const bytesPerSec = fileSizeBytes / durationSec;
  if (!(bytesPerSec > 0)) return durationCapSec;
  const sizeCap = Math.floor(maxBytes / bytesPerSec);
  return Math.max(1, Math.min(durationCapSec, sizeCap));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type VideoSegment = { index: number; startSec: number; endSec: number };

/**
 * 把 [0, durationSec) 切成每段 ≤maxSegSec 的连续片段。
 * - durationSec ≤ 0 / NaN / maxSegSec ≤ 0 → []（无从切，交调用方走原逻辑或报错）。
 * - durationSec ≤ maxSegSec → 单段 [0, dur]（不切，等价原行为）。
 * - 否则按 maxSegSec 等分；过短尾段(<maxSegSec*15%)并入上一段，避免无意义碎片(如 0.5s 段)。
 */
export function planVideoSegments(durationSec: number, maxSegSec: number): VideoSegment[] {
  const dur = Number.isFinite(durationSec) ? durationSec : 0;
  if (dur <= 0 || maxSegSec <= 0) return [];
  if (dur <= maxSegSec) return [{ index: 0, startSec: 0, endSec: round3(dur) }];

  const out: VideoSegment[] = [];
  let start = 0;
  let i = 0;
  while (start < dur - 1e-6) {
    const end = Math.min(start + maxSegSec, dur);
    out.push({ index: i, startSec: round3(start), endSec: round3(end) });
    start = end;
    i += 1;
  }
  // 末尾过短段并入上一段（避免 ffmpeg 切出无意义碎片 + 浪费一次模型调用）。
  if (out.length >= 2) {
    const last = out[out.length - 1]!;
    if (last.endSec - last.startSec < maxSegSec * 0.15) {
      out[out.length - 2]!.endSec = last.endSec;
      out.pop();
    }
  }
  return out;
}

/** 是否需要切段（>maxSegSec 才切）。durationSec 未知(≤0)视为不需要（交后续真实处理）。 */
export function needsSegmentSplit(durationSec: number, maxSegSec: number): boolean {
  return Number.isFinite(durationSec) && durationSec > maxSegSec;
}
