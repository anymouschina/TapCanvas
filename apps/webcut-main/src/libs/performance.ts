export enum PerformanceMark {
    PushVideoStart = 'PushVideoStart',
    PushVideoEnd = 'PushVideoEnd',
    GenVideoClipStart = 'GenVideoClipStart',
    GenVideoClipEnd = 'GenVideoClipEnd',
    MeasureVideoSizeStart = 'MeasureVideoSizeStart',
    MeasureVideoSizeEnd = 'MeasureVideoSizeEnd',
    GenImageFromVideoFrameStart = 'GenImageFromVideoFrameStart',
    GenImageFromVideoFrameEnd = 'GenImageFromVideoFrameEnd',
    ConvertMP4ClipToFramesStart = 'ConvertMP4ClipToFramesStart',
    ConvertMP4ClipToFramesEnd = 'ConvertMP4ClipToFramesEnd',
    GenVideoSegmentFirstThumbStart = 'GenVideoSegmentFirstThumbStart',
    GenVideoSegmentFirstThumbEnd = 'GenVideoSegmentFirstThumbEnd',
    VideoSpriteAddStart = 'VideoSpriteAddStart',
    VideoSpriteAddEnd = 'VideoSpriteAddEnd',
    VideoSegmentAdded = 'VideoSegmentAdded',
}

export function mark(name: PerformanceMark) {
    performance.mark(name);
    setTimeout(() => {
        performance.clearMarks(name);
    }, 30000);
}

export function measure(start: PerformanceMark, end: PerformanceMark) {
    try {
        const id = `${start}->${end}`;
        performance.measure(id, start, end);
        const entries = performance.getEntriesByName(id);
        performance.clearMeasures(id);
        console.log(`%cPerformance measure: %c${id}; cost: ${entries[0].duration}ms`, 'color: #0f0', 'color: #ffbb00', entries);
        return entries;
    }
    catch (error: any) {
        if (error?.message.includes('does not exist.')) {
            return;
        }
        console.error(error);
    }
}
