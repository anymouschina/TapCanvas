import type { VideoSegment } from "./video-segment-plan";

/** Facts about the actual media supplied to one model call, not creative criteria. */
export function buildVideoAnalysisSegmentPrompt(input: {
  question: string;
  segment: VideoSegment;
  segmentCount: number;
  sourceDurationSeconds: number;
}): string {
  const scope = {
    sourceDurationSeconds: input.sourceDurationSeconds,
    segmentIndex: input.segment.index,
    segmentCount: input.segmentCount,
    sourceStartSeconds: input.segment.startSec,
    sourceEndSeconds: input.segment.endSec,
    localTimeZeroEqualsSourceSeconds: input.segment.startSec,
    observationScope: "segment_only",
  };
  return `${input.question}\n\n【本次实际媒体输入范围】${JSON.stringify(scope)}\n` +
    "本次仅收到上述全片区间，片段播放器从0秒开始；报告时间必须加上sourceStartSeconds，使用全片时间。" +
    "区间外内容没有提供，不能据此判定全片缺失、未完成或时长不足。" +
    "只回答本区间可观察的部分；跨越输入边界的问题标为尚无观察证据，不编造相邻片段。" +
    "本次结论仅适用于这个区间，不能代表整片结论。";
}
