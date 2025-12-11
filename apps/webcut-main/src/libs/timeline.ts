// 标尺中每小格代表的宽度(根据scale的不同实时变化)
export function getGridSize(scale: number) : number {
    const scaleNum = new Map([
        // 切换比例：最小单位为帧
        [100, 100],
        [90, 50],
        [80, 20],
        [70, 10],
        // 切换比例：最小单位为秒
        [60, 80],
        [50, 40],
        [40, 20],
        [30, 10],
        // 切换比例：最小单位为6秒 一大格为 1分钟
        [20, 40],
        [10, 25],
        [0, 10]
    ]);
    return scaleNum.get(scale) || 100;
}

/**
 * 获取当前scale下某个frame的像素宽度
 * @param scale 缩放比例
 * @param frame 帧坐标
 * @returns 该frame的像素宽度
 */
export function getGridPixel(scale: number, frame: number) : number {
    let gridPixel = getGridSize(scale);
    let trackWidth = gridPixel * frame;
    if (scale < 70) { // 1秒一格
        trackWidth = trackWidth / 30;
    }
    if (scale < 30) { // 6秒一格
        trackWidth = trackWidth / 6;
    }
    return trackWidth;
}

/**
 * 获取选中点的帧坐标
 * @param offsetX 选中点的水平偏移量
 * @param scale 缩放比例
 * @param frameStep 帧步长
 * @returns 选中点对应的帧坐标
 */
export function getGridFrame(offsetX: number, scale: number, frameStep: number) : number {
    const size = getGridSize(scale);
    if (scale < 70) { // 一个单元格为 1 秒
        offsetX *= frameStep;
    }
    if (scale < 30) { // 一个单元格为 6 秒
        offsetX *= 6;
    }
    return Math.floor(offsetX / size);
}

// 根据缩放比调整 step
export function getStep(scale: number, frameStep: number) : number {
    return scale > 60 ? frameStep : 10;
}

// 转换时间格式
export function getLongText(count: number, scale: number) : string {
    let time = count; // 一个大单元格为 1 秒
    if (scale < 30) { // 一个单元格为 1 分钟
        time *= 60;
    } else if (scale < 70) { // 一个大单元格为 10 秒
        time *= 10;
    }
    return formatTime(time * 1000).str;
}

/**
 * 获取选中点的短文本（帧号）
 * @param count 选中点的帧坐标
 * @param step 帧步长
 * @param scale 缩放比例
 * @returns 选中点对应的短文本（帧号）
 */
export function getShortText(count: number, step: number, scale: number) : string {
    // 一个单元格为 1 秒钟
    if (scale < 70) {
        return '';
    }

    // 一个单元格为 1 帧
    const index = count % step + 1;
    // 第一帧不现实，因为第一帧处需要展示时刻，如果再把帧数展示出来，就会导致文本重叠，看不清楚
    if (index === 1) {
        return '';
    }

    const text = scale > 80 ? `${index < 10 ? '0' : ''}${index}f` : '';
    return text;
}

/**
 * 将时长转化为帧值。
 * 这里需要注意，计算得到的帧数是向上取整，例如3.1f实际会取整为4f
 * @param duration seconds
 * @param fps frame per second
 * @returns
 */
export function durationToFrame(duration: number, fps: number) {
    return Math.ceil(duration * fps);
}

/**
 * 将帧值转化为（从0开始的）时长
 * @param frameCount
 * @param fps
 * @returns
 */
export function frameToDuration(frameCount: number, fps: number) {
    return frameCount / fps;
}

export function formatTime(time: number) {
    let second = Math.ceil(time / 1000);
    const s = second % 60;
    second = Math.floor(second / 60);
    const m = second % 60;
    second = Math.floor(second / 60);
    const h = second % 60;
    return {
        s,
        m,
        h,
        str: `${h === 0 ? '' : `${h < 10 ? '0' : ''}${h}:`}${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`
    };
}
