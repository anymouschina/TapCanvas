/**
 * 边相关工具函数
 * 参考雅虎军规：工具函数职责单一，可复用，边界检查完善
 */

import { EDGE_TYPES, HANDLE_PREFIXES } from './constants';
import { generateId } from './canvas';
import type { Edge } from '@xyflow/react';

/**
 * 边数据接口
 */
export interface EdgeData {
  type?: string;
  label?: string;
  animated?: boolean;
  style?: React.CSSProperties;
  [key: string]: any;
}

/**
 * 创建新边
 * @param source 源节点ID
 * @param target 目标节点ID
 * @param type 边类型
 * @param data 边数据
 * @param sourceHandle 源手柄ID
 * @param targetHandle 目标手柄ID
 * @returns 新边
 */
export function createEdge(
  source: string,
  target: string,
  type: string = EDGE_TYPES.DEFAULT,
  data: Partial<EdgeData> = {},
  sourceHandle?: string,
  targetHandle?: string
): Edge<EdgeData> {
  return {
    id: generateId('edge'),
    type,
    source,
    target,
    sourceHandle,
    targetHandle,
    data: {
      type: null,
      label: '',
      animated: false,
      ...data,
    },
    style: {
      strokeWidth: 2,
      ...data.style,
    },
  };
}

/**
 * 验证边数据
 * @param edge 边
 * @returns 验证结果
 */
export function validateEdge(edge: Edge<EdgeData>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 验证边ID
  if (!edge.id || edge.id.trim() === '') {
    errors.push('Edge ID is required');
  }

  // 验证源节点和目标节点
  if (!edge.source || edge.source.trim() === '') {
    errors.push('Source node is required');
  }

  if (!edge.target || edge.target.trim() === '') {
    errors.push('Target node is required');
  }

  // 不能连接到自身
  if (edge.source === edge.target) {
    errors.push('Cannot connect node to itself');
  }

  // 验证边类型
  if (!Object.values(EDGE_TYPES).includes(edge.type as any)) {
    errors.push('Invalid edge type');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 更新边数据
 * @param edges 边数组
 * @param edgeId 边ID
 * @param updates 更新数据
 * @returns 更新后的边数组
 */
export function updateEdgeData(
  edges: Edge<EdgeData>[],
  edgeId: string,
  updates: Partial<EdgeData>
): Edge<EdgeData>[] {
  return edges.map(edge =>
    edge.id === edgeId
      ? {
          ...edge,
          data: { ...edge.data, ...updates },
        }
      : edge
  );
}

/**
 * 检查两个节点是否已连接
 * @param source 源节点ID
 * @param target 目标节点ID
 * @param edges 边数组
 * @returns 是否已连接
 */
export function areNodesConnected(
  source: string,
  target: string,
  edges: Edge<EdgeData>[]
): boolean {
  return edges.some(edge =>
    (edge.source === source && edge.target === target) ||
    (edge.source === target && edge.target === source)
  );
}

/**
 * 获取两个节点之间的连接边
 * @param source 源节点ID
 * @param target 目标节点ID
 * @param edges 边数组
 * @returns 连接边数组
 */
export function getEdgesBetweenNodes(
  source: string,
  target: string,
  edges: Edge<EdgeData>[]
): Edge<EdgeData>[] {
  return edges.filter(edge =>
    (edge.source === source && edge.target === target) ||
    (edge.source === target && edge.target === source)
  );
}

/**
 * 获取边的类型
 * @param edge 边
 * @returns 边的类型
 */
export function getEdgeType(edge: Edge<EdgeData>): string {
  return edge.data?.type || 'any';
}

/**
 * 设置边的类型
 * @param edge 边
 * @param type 类型
 * @returns 更新后的边
 */
export function setEdgeType(edge: Edge<EdgeData>, type: string): Edge<EdgeData> {
  return {
    ...edge,
    data: {
      ...edge.data,
      type,
    },
  };
}

/**
 * 检查边是否为活动状态
 * @param edge 边
 * @returns 是否为活动状态
 */
export function isEdgeAnimated(edge: Edge<EdgeData>): boolean {
  return edge.data?.animated || false;
}

/**
 * 设置边的动画状态
 * @param edge 边
 * @param animated 是否启用动画
 * @returns 更新后的边
 */
export function setEdgeAnimated(
  edge: Edge<EdgeData>,
  animated: boolean
): Edge<EdgeData> {
  return {
    ...edge,
    data: {
      ...edge.data,
      animated,
    },
  };
}

/**
 * 从手柄ID推断数据类型
 * @param handleId 手柄ID
 * @returns 数据类型
 */
export function inferDataTypeFromHandle(handleId?: string | null): string {
  if (!handleId) return 'any';

  if (handleId.startsWith(HANDLE_PREFIXES.OUTPUT)) {
    return handleId.slice(HANDLE_PREFIXES.OUTPUT.length).split('-')[0];
  }

  if (handleId.startsWith(HANDLE_PREFIXES.INPUT)) {
    return handleId.slice(HANDLE_PREFIXES.INPUT.length).split('-')[0];
  }

  return 'any';
}

/**
 * 从边推断数据类型
 * @param edge 边
 * @returns 数据类型
 */
export function inferDataTypeFromEdge(edge: Edge<EdgeData>): string {
  // 优先使用已存储的类型
  if (edge.data?.type && edge.data.type !== 'any') {
    return edge.data.type;
  }

  // 从源手柄推断
  const sourceType = inferDataTypeFromHandle(edge.sourceHandle);
  if (sourceType !== 'any') {
    return sourceType;
  }

  // 从目标手柄推断
  const targetType = inferDataTypeFromHandle(edge.targetHandle);
  return targetType;
}

/**
 * 计算边的路径点（用于自定义边渲染）
 * @param sourceX 源节点X坐标
 * @param sourceY 源节点Y坐标
 * @param targetX 目标节点X坐标
 * @param targetY 目标节点Y坐标
 * @param curvature 曲率（0-1）
 * @returns 路径字符串
 */
export function calculateSmoothEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  curvature: number = 0.25
): string {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  const cx1 = sourceX + dx * curvature;
  const cy1 = sourceY;
  const cx2 = targetX - dx * curvature;
  const cy2 = targetY;

  return `M ${sourceX} ${sourceY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${targetX} ${targetY}`;
}

/**
 * 计算正交边的路径点
 * @param sourceX 源节点X坐标
 * @param sourceY 源节点Y坐标
 * @param targetX 目标节点X坐标
 * @param targetY 目标节点Y坐标
 * @param offset 偏移量
 * @returns 路径字符串
 */
export function calculateOrthogonalEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  offset: number = 50
): string {
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  // 简单的正交路径
  if (Math.abs(targetX - sourceX) > Math.abs(targetY - sourceY)) {
    // 主要水平方向
    return `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`;
  } else {
    // 主要垂直方向
    return `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`;
  }
}

/**
 * 获取边的中心点
 * @param sourceX 源节点X坐标
 * @param sourceY 源节点Y坐标
 * @param targetX 目标节点X坐标
 * @param targetY 目标节点Y坐标
 * @returns 中心点坐标
 */
export function getEdgeCenter(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): { x: number; y: number } {
  return {
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
  };
}

/**
 * 检查边是否在指定区域内
 * @param edge 边
 * @param bounds 区域 { x, y, width, height }
 * @param sourcePosition 源节点位置
 * @param targetPosition 目标节点位置
 * @returns 是否在区域内
 */
export function isEdgeInBounds(
  edge: Edge<EdgeData>,
  bounds: { x: number; y: number; width: number; height: number },
  sourcePosition: { x: number; y: number },
  targetPosition: { x: number; y: number }
): boolean {
  const center = getEdgeCenter(
    sourcePosition.x,
    sourcePosition.y,
    targetPosition.x,
    targetPosition.y
  );

  return (
    center.x >= bounds.x &&
    center.x <= bounds.x + bounds.width &&
    center.y >= bounds.y &&
    center.y <= bounds.y + bounds.height
  );
}

/**
 * 边样式配置
 */
export const EdgeStyles = {
  default: {
    strokeWidth: 2,
    stroke: '#6B7280',
    fill: 'none',
  },
  selected: {
    strokeWidth: 3,
    stroke: '#3B82F6',
    fill: 'none',
  },
  animated: {
    strokeWidth: 2,
    stroke: '#8B5CF6',
    fill: 'none',
    strokeDasharray: '5,5',
    animation: 'dash 0.5s linear infinite',
  },
  error: {
    strokeWidth: 2,
    stroke: '#EF4444',
    fill: 'none',
  },
  success: {
    strokeWidth: 2,
    stroke: '#10B981',
    fill: 'none',
  },
} as const;

/**
 * 根据状态获取边样式
 * @param edge 边
 * @param selected 是否选中
 * @param animated 是否动画
 * @returns CSS样式对象
 */
export function getEdgeStyle(
  edge: Edge<EdgeData>,
  selected: boolean = false,
  animated: boolean = false
): React.CSSProperties {
  let baseStyle = EdgeStyles.default;

  if (selected) {
    baseStyle = { ...baseStyle, ...EdgeStyles.selected };
  }

  if (animated) {
    baseStyle = { ...baseStyle, ...EdgeStyles.animated };
  }

  // 根据边类型设置颜色
  const edgeType = getEdgeType(edge);
  const typeColors: Record<string, string> = {
    image: '#3B82F6',
    audio: '#10B981',
    subtitle: '#EAB308',
    video: '#8B5CF6',
    text: '#6B7280',
  };

  if (typeColors[edgeType]) {
    baseStyle.stroke = typeColors[edgeType];
  }

  return baseStyle;
}

/**
 * 过滤边的工具函数
 */
export class EdgeFilter {
  /**
   * 按源节点过滤边
   */
  static bySource(sourceId: string) {
    return (edge: Edge<EdgeData>) => edge.source === sourceId;
  }

  /**
   * 按目标节点过滤边
   */
  static byTarget(targetId: string) {
    return (edge: Edge<EdgeData>) => edge.target === targetId;
  }

  /**
   * 按类型过滤边
   */
  static byType(type: string) {
    return (edge: Edge<EdgeData>) => getEdgeType(edge) === type;
  }

  /**
   * 按动画状态过滤边
   */
  static byAnimated(animated: boolean) {
    return (edge: Edge<EdgeData>) => isEdgeAnimated(edge) === animated;
  }

  /**
   * 按源手柄过滤边
   */
  static bySourceHandle(handleId: string) {
    return (edge: Edge<EdgeData>) => edge.sourceHandle === handleId;
  }

  /**
   * 按目标手柄过滤边
   */
  static byTargetHandle(handleId: string) {
    return (edge: Edge<EdgeData>) => edge.targetHandle === handleId;
  }
}