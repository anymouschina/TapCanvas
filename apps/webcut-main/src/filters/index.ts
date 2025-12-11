// 导入基础类和类型
import { BaseFilter, FilterManager, type FilterConfig } from './base-filter';

// 导入滤镜实现
import {
  CSSFilter,
  GrayscaleFilter,
  BlurFilter,
  BrightnessFilter,
  ContrastFilter,
  SaturateFilter
} from './css-filters';

// 重新导出基础类和类型
export { BaseFilter, FilterManager, type FilterConfig };

// 创建全局滤镜管理器实例
export const filterManager = new FilterManager();

// 注册内置滤镜
filterManager.registerFilter(new CSSFilter());
filterManager.registerFilter(new GrayscaleFilter());
filterManager.registerFilter(new BlurFilter());
filterManager.registerFilter(new BrightnessFilter());
filterManager.registerFilter(new ContrastFilter());
filterManager.registerFilter(new SaturateFilter());
