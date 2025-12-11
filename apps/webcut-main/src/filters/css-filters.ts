import { BaseFilter, type FilterConfig } from './base-filter';

/**
 * CSS滤镜类
 * 使用CSS filter属性对VideoFrame进行处理
 */
export class CSSFilter extends BaseFilter {
  name = 'css-filter';
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor() {
    super();
    this.canvas = new OffscreenCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * 应用CSS滤镜到VideoFrame
   * @param frame 原始VideoFrame
   * @param config 滤镜配置，包含filter属性
   * @returns 处理后的VideoFrame
   */
  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const { filter = '' } = config;

    // 如果没有滤镜，直接返回原始帧的副本
    if (!filter) {
      return frame.clone();
    }

    // 调整canvas大小以匹配帧大小
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    this.canvas.width = width;
    this.canvas.height = height;

    // 绘制原始帧到canvas
    this.ctx.filter = 'none'; // 确保初始没有滤镜
    this.ctx.drawImage(frame, 0, 0, width, height);

    // 应用CSS滤镜
    this.ctx.filter = filter;
    this.ctx.drawImage(frame, 0, 0, width, height);
    this.ctx.filter = 'none'; // 重置滤镜

    // 创建新的VideoFrame
    const filteredFrame = new VideoFrame(this.canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration || undefined,
    });

    return filteredFrame;
  }

  /**
   * 关闭滤镜资源
   */
  dispose(): void {
    super.dispose();
    // 释放canvas资源
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

/**
 * 灰度滤镜
 */
export class GrayscaleFilter extends BaseFilter {
  name = 'grayscale';

  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const cssFilter = new CSSFilter();
    const result = await cssFilter.apply(frame, {
      filter: `grayscale(${config.amount || 0}%)`
    });
    cssFilter.dispose();
    return result;
  }
}

/**
 * 模糊滤镜
 */
export class BlurFilter extends BaseFilter {
  name = 'blur';

  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const cssFilter = new CSSFilter();
    const result = await cssFilter.apply(frame, {
      filter: `blur(${config.amount / 100 * 5}px)`
    });
    cssFilter.dispose();
    return result;
  }
}

/**
 * 亮度滤镜
 */
export class BrightnessFilter extends BaseFilter {
  name = 'brightness';

  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const cssFilter = new CSSFilter();
    const result = await cssFilter.apply(frame, {
      filter: `brightness(${config.amount || 0}%)`
    });
    cssFilter.dispose();
    return result;
  }
}

/**
 * 对比度滤镜
 */
export class ContrastFilter extends BaseFilter {
  name = 'contrast';

  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const cssFilter = new CSSFilter();
    const result = await cssFilter.apply(frame, {
      filter: `contrast(${config.amount || 0}%)`
    });
    cssFilter.dispose();
    return result;
  }
}

/**
 * 饱和度滤镜
 */
export class SaturateFilter extends BaseFilter {
  name = 'saturate';

  async apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame> {
    const cssFilter = new CSSFilter();
    const result = await cssFilter.apply(frame, {
      filter: `saturate(${config.amount || 200}%)`
    });
    cssFilter.dispose();
    return result;
  }
}
