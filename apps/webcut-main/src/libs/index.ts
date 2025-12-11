import { each, isNone, padLeft } from "ts-fns";
import { MP4Clip, AudioClip, OffscreenSprite, Combinator, ImgClip } from "@webav/av-cliper";
import { base64ToFile, blobToBase64DataURL, fileToBase64DataURL } from './file';
import { WebCutHighlightOfText } from "../types";
import { blobToFile } from "./file";
// @ts-ignore
import toWav from 'audiobuffer-to-wav';
import { PerformanceMark, mark } from './performance';

/**
 * 将文本渲染为 {@link ImageBitmap}，用来创建 {@link ImgClip}
 * @param txt - 要渲染的文本
 * @param css - 应用于文本的 CSS 样式
 *
 * @example
 * new ImgClip(
 *   await renderTxt2ImgBitmap(
 *     '水印',
 *    `font-size:40px; color: white; text-shadow: 2px 2px 6px red;`,
 *   )
 * )
 */
export async function renderTxt2ImgBitmap(txt: string, css?: Record<string, any>, highlights?: WebCutHighlightOfText[]): Promise<ImageBitmap> {
    const imgEl = await createTxt2Img(txt, css, highlights);
    const cvs = new OffscreenCanvas(imgEl.width, imgEl.height);
    const ctx = cvs.getContext('2d');
    ctx?.drawImage(imgEl, 0, 0, imgEl.width, imgEl.height);
    return await createImageBitmap(cvs);
}

/**
 * 将文本渲染为图片
 * @param txt - 要渲染的文本
 * @param css - 应用于文本的 CSS 样式
 * @returns 渲染后的图片元素
 */
export async function createTxt2Img(text: string, css?: Record<string, any>, highlights?: WebCutHighlightOfText[]): Promise<HTMLImageElement> {
    const container = buildTextAsDOM({ text, css, highlights });

    document.body.appendChild(container);
    const { width, top, bottom } = container.getBoundingClientRect();
    const children = container.querySelectorAll('*');
    let minTop = top, maxBottom = bottom;
    children.forEach((child) => {
        // 忽略背景色块，不计入高度，但是需要注意，假如文字只有一行，用户应该设置padding来让背景块展示完整
        if (child.classList.contains('background-block')) {
            return;
        }
        const { top, bottom } = child.getBoundingClientRect();
        minTop = Math.min(top, minTop);
        maxBottom = Math.max(bottom, maxBottom);
    });
    const height = maxBottom - minTop;
    // 计算出 rect，立即从dom移除
    container.remove();

    container.style.visibility = 'visible';

    const img = new Image();
    img.width = width;
    img.height = height;

    const outerHTML = container.outerHTML;

    const svgStr = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <foreignObject width="100%" height="100%">
                <div xmlns="http://www.w3.org/1999/xhtml">
                    ${outerHTML}
                </div>
            </foreignObject>
        </svg>
    `.replace(/\t/g, '').replace(/#/g, '%23');
    img.src = `data:image/svg+xml;charset=utf-8,${svgStr}`;
    await new Promise((resolve) => {
        img.onload = resolve;
    });
    return img;
}


export function buildTextAsDOM({
    text,
    css = {},
    highlights = [],
}: {
    text: string,
    css?: Record<string, any>,
    highlights?: WebCutHighlightOfText[];
}) {
    const build = ({
        text,
        css,
        highlights,
        inline
    }: {
        text: string,
        css: Record<string, any>,
        highlights?: WebCutHighlightOfText[];
        /** 是否当前正在渲染高亮内容 */
        inline?: boolean;
    }) => {
        const cssObj = { ...css };
        //  justify 时需要设置 text-align-last 为 justify，从而强制尾行对齐
        if (cssObj['text-align'] === 'justify') {
            cssObj['text-align-last'] = 'justify';
        }

        const bgColor = cssObj['background-color'];
        const padding = cssObj['padding'];
        const radius = cssObj['border-radius'];
        if (inline) {
            delete cssObj['background-color'];
            delete cssObj['padding'];
            delete cssObj['border-radius'];
        }

        const coverCssObj = { ...cssObj };

        let strokeWidth;
        each(css, (value, key) => {
            if (key === '-webkit-text-stroke-width' || key === '--text-stroke-width') {
                strokeWidth = parseFloat(value);
            }
            else if (key === '-webkit-text-stroke') {
                const words = value.split(' ');
                for (let word of words) {
                    const v = parseFloat(word);
                    if (v && !isNaN(v)) {
                        strokeWidth = v;
                    }
                }
            }
            if (key.startsWith('-webkit-text-stroke')) {
                delete coverCssObj[key];
            }
            if (key.startsWith('--text-stroke')) {
                delete coverCssObj[key];
            }
        });

        // ---------------------------------

        const container = document.createElement(inline ? 'span' : 'div');
        if (inline) {
            container.style.cssText = `margin: 0; position: relative; display: inline-block;`;
        }
        else {
            container.style.cssText = `margin: 0; position: fixed;`;
        }

        let html = text;
        if (highlights?.length) {
            // 对高亮进行反转排序，确保先渲染后面的，避免前面的变化后位置改变发生错误
            const items = [...highlights].sort((a, b) => a.start - b.start);
            items.forEach((item) => {
                const { start, end, content, css } = item;
                // 确保高亮范围有效
                if (start < 0 || end > text.length || start >= end) {
                    return;
                }
                const span = build({ text: content, css, inline: true });
                html = html.slice(0, start) + span.outerHTML + html.slice(end);
            });
        }

        const defaultCssObj = {
            ...cssObj,
        };
        if (strokeWidth) {
            // 将描边宽度扩大2倍，让其超出原始文字的范围
            defaultCssObj['-webkit-text-stroke-width'] = strokeWidth * 2;
        }
        if (css['--text-stroke-color']) {
            defaultCssObj['-webkit-text-stroke-color'] = css['--text-stroke-color'];
        }
        if (inline) {
            Object.assign(defaultCssObj, {
                ['z-index']: '1',
                position: 'relative',
            });
        }
        const defaultCssText = cssToText(defaultCssObj);
        const txt = document.createElement(inline ? 'span' : 'pre');
        txt.innerHTML = html;
        txt.style.cssText = defaultCssText;
        container.appendChild(txt);

        // 当存在描边时，复制一份未描边的字，将其覆盖在有描边的字上面，以得到真正的描边效果
        if (strokeWidth) {
            const coverCssText = cssToText({
                ...coverCssObj,
                position: 'absolute',
                top: 0,
                left: 0,
                ['z-index']: '2',
                // 强制背景透明，否则看不到真正的描边了
                background: 'transparent',
                // 由于cover是asbolute绝对定位，如果再加上padding，就会导致其内部的文字下移，造成偏位错误，因此，这里要强制调整其padding-top
                // ['padding-top']: 0,
            });

            const cover = document.createElement(inline ? 'span' : 'pre');
            cover.innerHTML = html;
            cover.style.cssText = coverCssText;
            container.appendChild(cover);
        }

        // 高亮的背景独立生成，以避免文字跳动问题
        if (inline && bgColor) {
            const bgCssText = cssToText({
                ...coverCssObj,
                position: 'absolute',
                // 和cover一样的问题，不过这里通过位移来解决
                top: -(padding || 0),
                left: -(padding || 0),
                ['z-index']: '0',
                // 强制字体颜色和背景颜色一致
                color: bgColor,
                background: bgColor,
                padding,
                ['border-radius']: radius,
            });

            const bg = document.createElement('span');
            bg.innerHTML = html;
            bg.style.cssText = bgCssText;
            bg.classList.add('background-block');
            container.appendChild(bg);
        }

        return container;
    };
    return build({ text, css, highlights });
}

/**
 * 将css对象转换为css文本，
 * 注意，这里不会主动去对stroke/rotate相关属性进行转换，
 * 如需转换，请在传入前，将css进行变形
 * @param css
 * @returns
 */
export function cssToText(css: Record<string, any>) {
    const styles = { ...css };
    let cssText = '';
    each(styles, (value, key) => {
        if (isNone(value)) {
            return;
        }

        let realValue = value;
        if (typeof value === 'number') {
            if (key.startsWith('--transform-rotate')) {
                realValue = value + 'rad';
            }
            else {
                realValue = value + 'px';
            }
        }
        cssText += ` ${key}: ${realValue};`;
    });
    cssText = cssText.trim().replace(/"/g, "'");
    return cssText;
}

/**
 * 将DOM对象style.cssText转换为内部可用的css对象
 * @param text
 * @returns
 */
export function textToCss(text: string) {
    const css: Record<string, any> = {};
    each(text.split(';'), (item) => {
        const words = item.trim().split(':');
        if (words.length !== 2) {
            return;
        }
        const [key, value] = words;
        let v = value.trim();
        if (v.endsWith('px') && !v.includes(' ')) {
            v = +v.slice(0, -2);
        }
        const k = key.trim();

        if (k === '-webkit-text-stroke') {
            const values = v.split(' ');
            const width = values.find((item: string) => !isNaN(parseFloat(item)));
            const color = v.replace(width, '').trim();
            if (width && color) {
                css['--text-stroke-width'] = width;
                css['--text-stroke-color'] = color;
            }
            return;
        }

        if (k === 'transform' && v.includes('rotate')) {
            const rotate = v.replace('rotate(', '').replace(')', '');
            css[`--transform-rotate`] = rotate;
            return;
        }

        css[k] = v;
    });
    return css;
}

/**
 * 测量视频尺寸
 * @param source
 * @returns
 */
export async function measureVideoSize(source: File | string) {
    mark(PerformanceMark.MeasureVideoSizeStart);
    let url: string;
    if (source instanceof File) {
        url = URL.createObjectURL(source);
    }
    else if (source.startsWith('data:')) {
        const file = base64ToFile(source, 'video.mp4', 'video/mp4');
        url = URL.createObjectURL(file);
    }
    else {
        url = source;
    }

    const videoEl = document.createElement('video');
    videoEl.src = url;
    videoEl.preload = 'metadata';
    await new Promise((resolve) => {
        videoEl.onloadedmetadata = resolve;
    });

    const { videoWidth, videoHeight } = videoEl;
    videoEl.src = '';
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }

    mark(PerformanceMark.MeasureVideoSizeEnd);
    return { width: videoWidth, height: videoHeight };
}

export async function measureImageSize(source: File | string) {
    const img = new Image();
    if (source instanceof File) {
        img.src = await fileToBase64DataURL(source);
    }
    else if (source.startsWith('data:')) {
        img.src = source;
    }
    else {
        const res = await fetch(source);
        img.src = await blobToBase64DataURL(await res.blob());
    }
    await new Promise((resolve) => {
        img.onload = resolve;
    });
    const { width, height } = img;
    return { width, height };
}

/**
 * 测量视频时长，返回为纳秒
 * @param source
 * @returns
 */
export async function measureVideoDuration(source: File | string) {
    let url: string;
    if (source instanceof File) {
        url = URL.createObjectURL(source);
    }
    else if (source.startsWith('data:')) {
        const file = base64ToFile(source, 'video.mp4', 'video/mp4');
        url = URL.createObjectURL(file);
    }
    else {
        url = source;
    }

    const videoEl = document.createElement('video');
    videoEl.src = url;
    videoEl.preload = 'metadata';
    await new Promise((resolve) => {
        videoEl.onloadedmetadata = resolve;
    });

    const { duration } = videoEl;
    videoEl.src = '';
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }

    return duration;
}

/**
 * 测量视频时长，返回为纳秒
 * @param source
 * @returns
 */
export async function measureAudioDuration(source: File | string) {
    let url: string;
    if (source instanceof File) {
        url = URL.createObjectURL(source);
    }
    else if (source.startsWith('data:')) {
        const file = base64ToFile(source, 'audio.mp3', 'audio/mpeg');
        url = URL.createObjectURL(file);
    }
    else {
        url = source;
    }

    const audioEl = document.createElement('audio');
    audioEl.src = url;
    audioEl.preload = 'metadata';
    await new Promise((resolve) => {
        audioEl.onloadedmetadata = resolve;
    });

    const { duration } = audioEl;
    audioEl.src = '';
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }

    return duration;
}

/**
 * 测量文本尺寸
 * @param text
 * @param css
 * @returns
 */
export async function measureTextSize(text: string, css: Record<string, any>, highlights?: WebCutHighlightOfText[]): Promise<{ height: number; width: number }> {
    const bitmap = await renderTxt2ImgBitmap(text, css, highlights);
    const { height, width } = bitmap;
    return { height, width };
}


/**
 * 自动调整矩形尺寸，以适应画布
 * @param canvasSize 画布尺寸
 * @param elementSize 元素尺寸
 * @param type 适应类型，contain: 包含元素，cover: 覆盖元素，contain_scale: 包含元素，且缩放至最大，cover_scale: 覆盖元素，且缩放至最大
 * @returns 调整后的矩形尺寸及位置
 */
export function autoFitRect(canvasSize: { width: number; height: number }, elementSize: { width: number; height: number }, type?: 'contain' | 'cover' | 'contain_scale' | 'cover_scale') {
    const { width: canvasWidth, height: canvasHeight } = canvasSize;
    const { width: elementWidth, height: elementHeight } = elementSize;
    let w = elementWidth;
    let h = elementHeight;
    let x = (canvasWidth - w) / 2;
    let y = (canvasHeight - h) / 2;
    if (type?.startsWith('contain')) {
        let scale = Math.min(canvasWidth / elementWidth, canvasHeight / elementHeight);
        if (type !== 'contain_scale') {
            scale = Math.min(scale, 1);
        }
        w = elementWidth * scale;
        h = elementHeight * scale;
        x = (canvasWidth - w) / 2;
        y = (canvasHeight - h) / 2;
    }
    else if (type?.startsWith('cover')) {
        let scale = Math.max(canvasWidth / elementWidth, canvasHeight / elementHeight);
        if (type !== 'cover_scale') {
            scale = Math.max(scale, 1);
        }
        w = elementWidth * scale;
        h = elementHeight * scale;
        x = (canvasWidth - w) / 2;
        y = (canvasHeight - h) / 2;
    }
    return { w, h, x, y };
}

/**
 * 格式化时间为 HH:MM:SS.mmm 格式
 * @param time 时间（纳秒）
 * @returns 格式化后的时间字符串
 */
export function formatTime(time: number): string {
    const total = Math.round(time / 1e6);
    const hour = Math.floor(total / 3600);
    const min = Math.floor(total % 3600 / 60);
    const sec = total % 60;
    const ms = Math.round(time % 1e6 / 1e3);

    const hourText = padLeft(hour + '', 2, '0');
    const minText = padLeft(min + '', 2, '0');
    const secText = padLeft(sec + '', 2, '0');
    const msText = padLeft(ms + '', 3, '0');

    return `${hourText}:${minText}:${secText}.${msText}`;
}


export async function mp4ClipToBlob(clip: MP4Clip) {
    await clip.ready;
    const sprite = new OffscreenSprite(clip);

    const { width, height, duration } = clip.meta;
    Object.assign(sprite.rect, { w: width, h: height });
    sprite.time.duration = duration;

    const combiner = new Combinator({ width, height });
    await combiner.addSprite(sprite, { main: true });

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp4');
    const readableStream = combiner.output();
    const response = new Response(readableStream, { headers });

    const blob = await response.clone().blob();

    combiner.destroy();
    sprite.destroy();
    clip.destroy();

    return blob;
}

export async function mp4ClipToFile(clip: MP4Clip) {
    const blob = await mp4ClipToBlob(clip);
    const file = blobToFile(blob, 'video.mp4');
    return file;
}

export async function audioClipToFile(clip: AudioClip) {
    await clip.ready;
    const pcm = clip.getPCMData();
    const sampleRate = clip.meta.sampleRate;
    const wavBlob = pcmToWav(pcm, sampleRate);
    const file = blobToFile(wavBlob, 'audio-clip-to-file.wav');
    return file;
}

export function pcmToWav(pcmData: Float32Array[], sampleRate = 44100) {
    // pcmData 预期格式为：[channel1Data, channel2Data, ...]
    // 其中 channel1Data, channel2Data 是 Float32Array 或普通数字数组，包含该声道的样本数据

    if (!pcmData || pcmData.length === 0 || !pcmData[0] || pcmData[0].length === 0) {
        throw new Error("PCM 数据必须是一个包含声道数据的数组，且至少包含一个声道和一个样本。");
    }

    const numChannels = pcmData.length;
    const numSamplesPerChannel = pcmData[0].length; // 假设所有声道长度相同

    // （可选）验证所有声道是否具有相同数量的样本
    for (let i = 1; i < numChannels; i++) {
        if (!pcmData[i] || pcmData[i].length !== numSamplesPerChannel) {
            throw new Error("所有声道必须包含相同数量的样本，并且是有效的数组。");
        }
    }

    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8; // 对于16位PCM，每个样本2字节
    const headerSize = 44; // WAV文件头的大小

    // 音频数据的总字节数
    const audioDataSize = numSamplesPerChannel * numChannels * bytesPerSample;
    // 文件总大小 = 文件头大小 + 音频数据大小
    const fileSize = headerSize + audioDataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    // --- WAV 文件头 ---
    // 块ID "RIFF" (偏移量 0, 4字节)
    view.setUint32(0, 0x52494646, false); // "RIFF" (大端序)
    // 块大小 (偏移量 4, 4字节) = 文件总大小 - 8 (RIFF标识符和此字段本身的大小)
    view.setUint32(4, fileSize - 8, true); // 小端序
    // 格式 "WAVE" (偏移量 8, 4字节)
    view.setUint32(8, 0x57415645, false); // "WAVE" (大端序)

    // 子块1 ID "fmt " (偏移量 12, 4字节)
    view.setUint32(12, 0x666d7420, false); // "fmt " (大端序)
    // 子块1 大小 (偏移量 16, 4字节) - 对于PCM，通常为16
    view.setUint32(16, 16, true); // 小端序
    // 音频格式 (偏移量 20, 2字节) - 1 表示 PCM
    view.setUint16(20, 1, true); // 小端序
    // 声道数 (偏移量 22, 2字节)
    view.setUint16(22, numChannels, true); // 小端序
    // 采样率 (偏移量 24, 4字节)
    view.setUint32(24, sampleRate, true); // 小端序
    // 字节率 (偏移量 28, 4字节) = SampleRate * NumChannels * BitsPerSample/8
    view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // 小端序
    // 块对齐 (偏移量 32, 2字节) = NumChannels * BitsPerSample/8
    view.setUint16(32, numChannels * bytesPerSample, true); // 小端序
    // 每个样本的位数 (偏移量 34, 2字节)
    view.setUint16(34, bitsPerSample, true); // 小端序

    // 子块2 ID "data" (偏移量 36, 4字节)
    view.setUint32(36, 0x64617461, false); // "data" (大端序)
    // 子块2 大小 (偏移量 40, 4字节) = 音频数据的总字节数
    view.setUint32(40, audioDataSize, true); // 小端序

    // --- PCM 数据 ---
    // 从文件头的末尾 (44字节处) 开始写入数据
    let dataIndex = headerSize;
    for (let i = 0; i < numSamplesPerChannel; i++) { // 遍历每个采样帧
        for (let ch = 0; ch < numChannels; ch++) {    // 遍历当前采样帧的每个声道
            // 获取浮点数样本值，并将其限制在 [-1.0, 1.0] 范围内
            const sampleFloat = Math.max(-1, Math.min(1, pcmData[ch][i]));

            // 将浮点数样本转换为16位有符号整数PCM值
            let sampleInt;
            if (sampleFloat < 0) {
                sampleInt = sampleFloat * 0x8000; // 对于负数，乘以32768
            } else {
                sampleInt = sampleFloat * 0x7FFF; // 对于正数，乘以32767
            }
            // 确保转换后的值在16位有符号整数范围内 (尽管setInt16会自动处理溢出，但显式处理更佳)
            // sampleInt = Math.max(-32768, Math.min(32767, Math.round(sampleInt))); // 可选：四舍五入

            view.setInt16(dataIndex, sampleInt, true); // 以小端序写入16位有符号整数
            dataIndex += bytesPerSample;
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}


/**
 * 创建并配置Combinator实例，添加所有剪辑
 * @param clips
 * @param options
 * @returns
 */
async function createCombinatorWithClips(clips: Array<MP4Clip | ImgClip | AudioClip>, options?: {
    size?: {
        width: number;
        height: number;
    };
    /** 主素材索引，最终导出的视频时长以该素材的时长为duration，多余的部分被截断 */
    main?: number;
}) {
    const {
        size,
        main,
    } = options || {};

    let width, height;
    if (size) {
        width = size.width;
        height = size.height;
    }
    else if (typeof main === 'number' && clips[main] && (clips[main] instanceof MP4Clip || clips[main] instanceof ImgClip)) {
        const mainClip = clips[main];
        await mainClip.ready;
        width = mainClip.meta.width;
        height = mainClip.meta.height;
    }
    else if (clips.some(clip => clip instanceof MP4Clip || clip instanceof ImgClip)) {
        const mainClip = clips.find(clip => clip instanceof MP4Clip || clip instanceof ImgClip)!;
        await mainClip.ready;
        width = mainClip.meta.width;
        height = mainClip.meta.height;
    }

    let offsetTime = 0;
    const com = new Combinator({ width, height });
    for (const clip of clips) {
        await clip.ready;
        const spr = new OffscreenSprite(clip);

        spr.time.offset = offsetTime;
        offsetTime += clip.meta.duration;

        if (width && height && (clip instanceof MP4Clip || clip instanceof ImgClip)) {
            const calcRect = autoFitRect({ width, height }, clip.meta, 'contain');
            Object.assign(spr.rect, calcRect);
        }

        if (clip instanceof AudioClip) {
            spr.rect.y = -1000;
        }

        await com.addSprite(spr, { main: typeof main === 'number' && clip === clips[main] });
    }

    return com;
}

/**
 * 以离屏渲染的方式导出clips为blob
 * @param clips
 * @returns
 */
export async function exportBlobOffscreen(clips: Array<MP4Clip | ImgClip | AudioClip>, options?: {
    type?: string;
    size?: {
        width: number;
        height: number;
    };
    /** 主素材索引，最终导出的视频时长以该素材的时长为duration，多余的部分被截断 */
    main?: number;
}) {
    let defaultType = 'video/mp4';
    if (clips.every(clip => clip instanceof AudioClip)) {
        defaultType = 'audio/mp4'; // 文件名后缀为 .m4a
    }

    const {
        type = defaultType,
        size,
        main,
    } = options || {};

    const com = await createCombinatorWithClips(clips, { size, main });

    const readable = com.output();
    const reader = readable.getReader();
    const chunks: any[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }
    const blob = new Blob(chunks, { type });
    com.destroy();
    return blob;
}

/**
 * 以离屏渲染的方式下载clips，优先使用showSaveFilePicker和stream方式，不支持时回退到blob方式
 * @param clips
 * @returns
 */
export async function downloadOffscreen(clips: Array<MP4Clip | ImgClip | AudioClip>, options?: {
    type?: string;
    size?: {
        width: number;
        height: number;
    };
    /** 主素材索引，最终导出的视频时长以该素材的时长为duration，多余的部分被截断 */
    main?: number;
    filename?: string;
}) {
    let defaultType = 'video/mp4';
    if (clips.every(clip => clip instanceof AudioClip)) {
        defaultType = 'audio/mp4';
    }

    const {
        type = defaultType,
        size,
        main,
        filename = `webcut-${Date.now()}.mp4`,
    } = options || {};

    // 检查是否支持showSaveFilePicker
    if (typeof window.showSaveFilePicker === 'function') {
        const com = await createCombinatorWithClips(clips, { size, main });
        try {
            // 使用showSaveFilePicker获取文件句柄
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: '视频文件', accept: { [type]: [`.${type.split('/')[1]}`] } as Record<string, `.${string}`[]> }]
            });

            // 创建可写流
            const writable = await fileHandle.createWritable();

            // 获取可读流并直接管道到可写流
            const readable = com.output();
            await readable.pipeTo(writable, { preventClose: true });
            await writable.close();

            com.destroy();
            return;
        } catch (error) {
            console.error('使用showSaveFilePicker导出失败:', error);
            // 如果失败，回退到blob方式
            com.destroy();
        }
    }

    // 回退到blob方式
    const blob = await exportBlobOffscreen(clips, { type, size, main });
    const { downloadBlob } = await import('./file');
    await downloadBlob(blob, filename);
}

/**
 * 导出为wav音频
 * @param clips
 * @returns
 */
export async function exportAsWavBlobOffscreen(clips: Array<AudioClip>) {
    const mp4Blob = await exportBlobOffscreen(clips);
    return await mp4BlobToWavBlob(mp4Blob);
}

export async function mp4BlobToWavArrayBuffer(mp4Blob: Blob): Promise<ArrayBuffer> {
    const arrbuff = await mp4Blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const audioCtx = new AudioContext();
        audioCtx.decodeAudioData(arrbuff, function (audioBuffer) {
            const arrbuff = toWav(audioBuffer);
            resolve(arrbuff);
        }, reject);
    });
}

export async function mp4BlobToWavBlob(mp4Blob: Blob): Promise<Blob> {
    const arrbuff = await mp4BlobToWavArrayBuffer(mp4Blob);
    const wavBlob = new Blob([arrbuff], { type: 'audio/wav' });
    return wavBlob;
}

export async function mp4ClipToFramesData(mp4Clip: MP4Clip, options?: {
    iteratorCallback?: (data: { video: VideoFrame, ts: number, index: number }) => void | Promise<void>,
    step?: number, // step in microseconds, will be auto-calculated if not provided
    pcmProgressCallback?: (pcm: [Float32Array, Float32Array]) => void // 渐进式返回 PCM 数据
}): Promise<{ pcm: [Float32Array, Float32Array]; frames: { video: VideoFrame, ts: number }[] }> {
    const {
        iteratorCallback,
        step,
        pcmProgressCallback,
    } = options || {};

    mark(PerformanceMark.ConvertMP4ClipToFramesStart);
    const clip = await mp4Clip.clone();
    await clip.ready;

    const duration = clip.meta.duration;

    // 音频采样步长：保持较小间隔以获取完整的音频波形数据
    const audioStep = 10000; // 10ms，确保音频波形完整

    // 视频采样步长：使用智能策略减少帧数
    let videoStep = step;
    if (!videoStep) {
        const targetFrameCount = 50; // 目标生成 50 帧缩略图
        videoStep = Math.max(duration / targetFrameCount, 33333); // 最小 33ms (~30fps)
        videoStep = Math.min(videoStep, 1000000); // 最大 1s
    }

    // Extract all PCM data from the MP4Clip
    const pcmData: Float32Array[][] = [];
    const frames: { video: VideoFrame, ts: number }[] = [];

    let videoIndex = 0;
    let nextVideoTime = 0;
    const batchSize = 5; // 每批处理 5 帧后让出控制权
    let batchCount = 0;

    // 渐进式 PCM 更新策略
    const pcmUpdateInterval = 50; // 每收集 50 个音频片段更新一次
    let pcmUpdateCounter = 0;

    // 预先估算并分配固定大小的 PCM 数组，避免波形图长度变化导致的闪动
    // 估算采样点数：duration / audioStep
    const estimatedSampleCount = Math.ceil(duration / audioStep);
    // 每个音频片段大约包含的样本数（44.1kHz * 10ms = 441 samples）
    const estimatedSamplesPerChunk = Math.ceil((clip.meta.audioSampleRate || 44100) * (audioStep / 1000000));
    const estimatedTotalSamples = estimatedSampleCount * estimatedSamplesPerChunk;

    // 预先创建固定大小的 PCM 数组（初始值为 0）
    const leftChannelPCM = new Float32Array(estimatedTotalSamples);
    const rightChannelPCM = new Float32Array(estimatedTotalSamples);
    let currentOffset = 0;

    // 立即调用一次回调，让波形图显示完整长度（全零，表示未加载）
    if (pcmProgressCallback) {
        pcmProgressCallback([leftChannelPCM, rightChannelPCM]);
    }

    // 使用音频采样间隔遍历，确保获取完整的音频数据
    for (let time = 0; time < duration; time += audioStep) {
        const { audio, video } = await clip.tick(time);

        // 收集所有音频数据并直接填充到固定数组
        if (audio && audio.length > 0) {
            const [left, right] = audio;
            const chunkLength = left.length;

            // 确保不会超出预分配的数组边界
            if (currentOffset + chunkLength <= estimatedTotalSamples) {
                leftChannelPCM.set(left, currentOffset);
                rightChannelPCM.set(right, currentOffset);
                currentOffset += chunkLength;
            }

            pcmData.push(audio);
            pcmUpdateCounter++;

            // 定期通过回调返回固定大小的 PCM 数组
            if (pcmProgressCallback && pcmUpdateCounter >= pcmUpdateInterval) {
                pcmUpdateCounter = 0;
                // 传递相同的固定大小数组，只是内容在不断填充
                pcmProgressCallback([leftChannelPCM.slice(), rightChannelPCM.slice()]);
            }
        }

        // 只在特定时间点收集视频帧（稀疏采样）
        if (video && time >= nextVideoTime) {
            frames.push({ video, ts: time });
            if (iteratorCallback) {
                await iteratorCallback({ video, ts: time, index: videoIndex });
            }
            videoIndex++;
            nextVideoTime += videoStep;
            batchCount++;
        } else if (video) {
            // 不需要的视频帧立即关闭，释放资源
            video.close();
        }

        // 每处理一批帧后，让出控制权给浏览器，避免长时间阻塞主线程
        if (batchCount >= batchSize) {
            batchCount = 0;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // 如果实际填充的数据少于预估大小，裁剪数组以节省内存
    // 通常误差很小，可以选择直接返回预分配的数组（尾部会有少量零值）
    let finalLeftChannelPCM = leftChannelPCM;
    let finalRightChannelPCM = rightChannelPCM;

    // 如果实际数据量与预估差异较大（超过 5%），则裁剪
    if (currentOffset < estimatedTotalSamples * 0.95) {
        finalLeftChannelPCM = leftChannelPCM.slice(0, currentOffset);
        finalRightChannelPCM = rightChannelPCM.slice(0, currentOffset);
    }

    clip.destroy();
    mark(PerformanceMark.ConvertMP4ClipToFramesEnd);

    return {
        pcm: [finalLeftChannelPCM, finalRightChannelPCM],
        frames,
    };
}

/**
 * 从 MP4Clip 或 AudioClip 中渐进式提取 PCM 数据
 * @param clip - MP4Clip 或 AudioClip 实例
 * @param progressCallback - 每提取一部分 PCM 数据后触发的回调
 * @returns 完整的 PCM 数据 [leftChannel, rightChannel]
 */
export async function progressiveClipToPCMData(
    clip: MP4Clip | AudioClip,
    progressCallback?: (pcm: [Float32Array, Float32Array]) => void
): Promise<[Float32Array, Float32Array]> {
    // 处理 AudioClip
    if (clip instanceof AudioClip) {
        await clip.ready;

        // 获取完整 PCM 数据
        const [fullLeft, fullRight] = clip.getPCMData();

        // 渐进式返回数据，分 10 批
        const batchCount = 10;
        const samplesPerBatch = Math.ceil(fullLeft.length / batchCount);

        // 预先创建完整大小的数组并初始化为 0
        const leftChannel = new Float32Array(fullLeft.length);
        const rightChannel = new Float32Array(fullRight.length);

        // 立即触发第一次回调
        if (progressCallback) {
            progressCallback([leftChannel, rightChannel]);
        }

        // 分批填充并触发回调
        for (let batch = 0; batch < batchCount; batch++) {
            const start = batch * samplesPerBatch;
            const end = Math.min(start + samplesPerBatch, fullLeft.length);

            leftChannel.set(fullLeft.subarray(start, end), start);
            rightChannel.set(fullRight.subarray(start, end), start);

            // 触发进度回调
            if (progressCallback) {
                progressCallback([leftChannel.slice(), rightChannel.slice()]);
            }

            // 让出控制权，避免阻塞
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return [leftChannel, rightChannel];
    }

    // 处理 MP4Clip
    if (clip instanceof MP4Clip) {
        const clonedClip = await clip.clone();
        await clonedClip.ready;

        const duration = clonedClip.meta.duration;
        // 音频采样步长：10ms，确保音频波形完整
        const audioStep = 10000;

        // 预先估算并分配固定大小的 PCM 数组，避免波形图长度变化导致的闪动
        const estimatedSampleCount = Math.ceil(duration / audioStep);
        const estimatedSamplesPerChunk = Math.ceil((clonedClip.meta.audioSampleRate || 44100) * (audioStep / 1000000));
        const estimatedTotalSamples = estimatedSampleCount * estimatedSamplesPerChunk;

        // 预先创建固定大小的 PCM 数组（初始值为 0）
        const leftChannelPCM = new Float32Array(estimatedTotalSamples);
        const rightChannelPCM = new Float32Array(estimatedTotalSamples);
        let currentOffset = 0;

        // 渐进式 PCM 更新策略
        const pcmUpdateInterval = 50; // 每收集 50 个音频片段更新一次
        let pcmUpdateCounter = 0;

        // 立即调用一次回调，让波形图显示完整长度（全零，表示未加载）
        if (progressCallback) {
            progressCallback([leftChannelPCM, rightChannelPCM]);
        }

        // 使用音频采样间隔遍历，确保获取完整的音频数据
        for (let time = 0; time < duration; time += audioStep) {
            const { audio } = await clonedClip.tick(time);

            // 收集所有音频数据并直接填充到固定数组
            if (audio && audio.length > 0) {
                const [left, right] = audio;
                const chunkLength = left.length;

                // 确保不会超出预分配的数组边界
                if (currentOffset + chunkLength <= estimatedTotalSamples) {
                    leftChannelPCM.set(left, currentOffset);
                    rightChannelPCM.set(right, currentOffset);
                    currentOffset += chunkLength;
                }

                pcmUpdateCounter++;

                // 定期通过回调返回固定大小的 PCM 数组
                if (progressCallback && pcmUpdateCounter >= pcmUpdateInterval) {
                    pcmUpdateCounter = 0;
                    // 传递相同的固定大小数组，只是内容在不断填充
                    progressCallback([leftChannelPCM.slice(), rightChannelPCM.slice()]);
                }
            }
        }

        // 如果实际填充的数据少于预估大小，裁剪数组以节省内存
        let finalLeftChannelPCM = leftChannelPCM;
        let finalRightChannelPCM = rightChannelPCM;

        // 如果实际数据量与预估差异较大（超过 5%），则裁剪
        if (currentOffset < estimatedTotalSamples * 0.95) {
            finalLeftChannelPCM = leftChannelPCM.slice(0, currentOffset);
            finalRightChannelPCM = rightChannelPCM.slice(0, currentOffset);
        }

        clonedClip.destroy();

        // 最后一次回调返回完整数据
        if (progressCallback) {
            progressCallback([finalLeftChannelPCM, finalRightChannelPCM]);
        }

        return [finalLeftChannelPCM, finalRightChannelPCM];
    }

    // 未知类型，返回空数据
    return [new Float32Array(), new Float32Array()];
}

export async function mp4ClipToAudioClip(mp4Clip: MP4Clip): Promise<AudioClip> {
    const { pcm } = await mp4ClipToFramesData(mp4Clip);

    // Create AudioClip from the complete PCM data
    const audioClip = new AudioClip(pcm);
    await audioClip.ready;

    return audioClip;
}

export async function createImageFromVideoFrame(videoFrame: VideoFrame, options: { width?: number, height?: number, quality?: number, format?: 'jpeg' | 'png' | 'webp' }): Promise<Blob> {
    mark(PerformanceMark.GenImageFromVideoFrameStart);
    const canvas = document.createElement('canvas');
    const aspectRatio = videoFrame.codedWidth / videoFrame.codedHeight;
    const { width, height, quality = 0.7, format = 'jpeg' } = options;

    if (width) {
        canvas.width = width;
        canvas.height = height || Math.round(width / aspectRatio);
    }
    else if (height) {
        canvas.height = height;
        canvas.width = Math.round(height * aspectRatio);
    }
    else {
        canvas.width = videoFrame.codedWidth;
        canvas.height = videoFrame.codedHeight;
    }

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);

    // 使用 JPEG 格式并降低质量，大幅减少 Blob 大小和生成时间
    // JPEG 比 PNG 快 3-5 倍，且文件更小
    const mimeType = `image/${format}`;
    // @ts-ignore
    const blob: Blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    mark(PerformanceMark.GenImageFromVideoFrameEnd);
    return blob;
}
