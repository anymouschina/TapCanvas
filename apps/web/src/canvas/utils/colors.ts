/**
 * 颜色相关工具函数
 * 参考雅虎军规：工具函数职责单一，可复用
 */

import { COLORS, STATUS_COLORS, TYPE_COLORS } from './constants';

/**
 * 根据类型获取对应的颜色
 * @param type 节点或边的数据类型
 * @returns 对应的颜色值
 */
export function getColorForType(type?: string): string {
  if (!type) return COLORS.TYPE_COLORS.default;

  return COLORS.TYPE_COLORS[type as keyof typeof COLORS.TYPE_COLORS] ||
         COLORS.TYPE_COLORS.default;
}

/**
 * 获取边的颜色（半透明版本）
 * @param type 边的数据类型
 * @returns 对应的边颜色
 */
export function getEdgeColorForType(type?: string): string {
  if (!type) return COLORS.EDGE_COLORS.default;

  return COLORS.EDGE_COLORS[type as keyof typeof COLORS.EDGE_COLORS] ||
         COLORS.EDGE_COLORS.default;
}

/**
 * 根据状态获取对应的颜色
 * @param status 状态名称
 * @returns 对应的状态颜色
 */
export function getColorForStatus(status?: string): string {
  if (!status) return COLORS.STATUS_COLORS.pending;

  return COLORS.STATUS_COLORS[status as keyof typeof COLORS.STATUS_COLORS] ||
         COLORS.STATUS_COLORS.pending;
}

/**
 * 根据类型推断边类型
 * @param sourceHandle 源手柄ID
 * @param targetHandle 目标手柄ID
 * @returns 推断出的类型
 */
export function inferType(
  sourceHandle?: string | null,
  targetHandle?: string | null
): string {
  const { HANDLE_PREFIXES } = require('./constants');

  if (sourceHandle && sourceHandle.startsWith(HANDLE_PREFIXES.OUTPUT)) {
    return sourceHandle.slice(HANDLE_PREFIXES.OUTPUT.length);
  }

  if (targetHandle && targetHandle.startsWith(HANDLE_PREFIXES.INPUT)) {
    return targetHandle.slice(HANDLE_PREFIXES.INPUT.length);
  }

  return 'any';
}

/**
 * 创建渐变色
 * @param startColor 起始颜色
 * @param endColor 结束颜色
 * @param direction 渐变方向
 * @returns CSS渐变字符串
 */
export function createGradient(
  startColor: string,
  endColor: string,
  direction: 'horizontal' | 'vertical' | 'diagonal' = 'horizontal'
): string {
  const directions = {
    horizontal: 'to right',
    vertical: 'to bottom',
    diagonal: 'to bottom right',
  };

  return `linear-gradient(${directions[direction]}, ${startColor}, ${endColor})`;
}

/**
 * 调整颜色透明度
 * @param color 原始颜色
 * @param alpha 透明度值 (0-1)
 * @returns 调整后的颜色
 */
export function adjustAlpha(color: string, alpha: number): string {
  // 处理十六进制颜色
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // 处理rgb颜色
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }

  // 处理rgba颜色
  if (color.startsWith('rgba(')) {
    return color.replace(/[\d.]+\)/, `${alpha})`);
  }

  return color;
}

/**
 * 获取对比色
 * @param backgroundColor 背景颜色
 * @returns 对比色（黑色或白色）
 */
export function getContrastColor(backgroundColor: string): string {
  // 移除所有非数字字符
  const color = backgroundColor.replace(/[^0-9,]/g, '');
  const rgb = color.split(',').map(Number);

  if (rgb.length < 3) return '#000000';

  // 计算亮度
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;

  return brightness > 128 ? '#000000' : '#FFFFFF';
}

/**
 * 生成节点边框颜色
 * @param selected 是否选中
 * @param focused 是否聚焦
 * @param isGroup 是否为分组节点
 * @returns 边框颜色
 */
export function getNodeBorderColor(
  selected: boolean = false,
  focused: boolean = false,
  isGroup: boolean = false
): string {
  if (focused) return COLORS.NODE_BORDER_COLORS.focused;
  if (selected) return COLORS.NODE_BORDER_COLORS.selected;
  if (isGroup) return COLORS.NODE_BORDER_COLORS.group;
  return COLORS.NODE_BORDER_COLORS.default;
}

/**
 * 创建状态指示器颜色
 * @param status 节点状态
 * @param progress 进度 (0-100)
 * @returns 状态指示器的CSS属性
 */
export function createStatusIndicator(
  status?: string,
  progress?: number | null
): React.CSSProperties {
  const backgroundColor = getColorForStatus(status);
  const width = progress !== null ? `${progress}%` : '100%';

  return {
    backgroundColor,
    width,
    height: '2px',
    transition: 'all 0.3s ease',
  };
}

/**
 * 颜色主题配置
 */
export const ColorThemes = {
  light: {
    background: '#FFFFFF',
    surface: '#F9FAFB',
    border: '#E5E7EB',
    text: '#111827',
    textSecondary: '#6B7280',
    ...COLORS,
  },

  dark: {
    background: '#1F2937',
    surface: '#111827',
    border: '#374151',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    TYPE_COLORS: {
      image: '#60A5FA',
      audio: '#34D399',
      subtitle: '#FCD34D',
      video: '#A78BFA',
      text: '#9CA3AF',
      default: '#6B7280',
    },
    STATUS_COLORS: {
      success: '#34D399',
      error: '#F87171',
      warning: '#FBBF24',
      info: '#60A5FA',
      running: '#A78BFA',
      pending: '#6B7280',
    },
  },
} as const;

/**
 * 获取当前主题的颜色配置
 * @param theme 主题名称
 * @returns 颜色配置
 */
export function getThemeColors(theme: 'light' | 'dark' = 'light') {
  return ColorThemes[theme];
}