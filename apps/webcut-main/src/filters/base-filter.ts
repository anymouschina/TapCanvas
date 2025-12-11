/**
 * 滤镜配置接口
 */
export interface FilterConfig {
  [key: string]: any;
}

/**
 * 滤镜基类
 */
export abstract class BaseFilter {
  /**
   * 滤镜名称
   */
  abstract name: string;

  /**
   * 应用滤镜到VideoFrame
   * @param frame 原始VideoFrame
   * @param config 滤镜配置
   * @returns 处理后的VideoFrame
   */
  abstract apply(frame: VideoFrame, config: FilterConfig): Promise<VideoFrame>;

  /**
   * 关闭滤镜资源
   */
  dispose(): void {
    // 默认实现，子类可重写
  }
}

/**
 * 滤镜管理器类
 */
export class FilterManager {
  private filters: Map<string, BaseFilter> = new Map();

  /**
   * 注册滤镜
   * @param filter 滤镜实例
   */
  registerFilter(filter: BaseFilter): void {
    this.filters.set(filter.name, filter);
  }

  /**
   * 获取滤镜实例
   * @param name 滤镜名称
   * @returns 滤镜实例
   */
  getFilter(name: string): BaseFilter | undefined {
    return this.filters.get(name);
  }

  /**
   * 应用多个滤镜到VideoFrame
   * @param frame 原始VideoFrame
   * @param filterNames 滤镜名称列表
   * @param configs 滤镜配置列表，与filterNames一一对应
   * @returns 处理后的VideoFrame
   */
  async applyFilters(frame: VideoFrame, filterNames: string[], configs: FilterConfig[] = []): Promise<VideoFrame> {
    let currentFrame = frame;
    let isOriginalFrame = true;

    try {
      for (let i = 0; i < filterNames.length; i++) {
        const filterName = filterNames[i];
        const filter = this.getFilter(filterName);

        if (filter) {
          const config = configs[i] || {};
          const newFrame = await filter.apply(currentFrame, config);

          if (!isOriginalFrame) {
            currentFrame.close();
          }

          currentFrame = newFrame;
          isOriginalFrame = false;
        }
      }

      return currentFrame;
    } catch (error) {
      console.error('Error applying filters:', error);
      if (!isOriginalFrame) {
        currentFrame.close();
      }
      return frame.clone();
    }
  }

  /**
   * 关闭滤镜管理器，释放所有滤镜资源
   */
  dispose(): void {
    for (const filter of this.filters.values()) {
      filter.dispose();
    }
    this.filters.clear();
  }
}
