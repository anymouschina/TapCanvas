/**
 * 节点相关工具函数
 * 参考雅虎军规：工具函数职责单一，可复用，输入输出明确
 */

import { NODE_TYPES, NODE_KINDS, DEFAULTS, VALIDATION } from './constants';
import { generateId } from './canvas';
import type { Node } from '@xyflow/react';

/**
 * 节点数据接口
 */
export interface NodeData {
  id: string;
  label: string;
  kind: string;
  config: Record<string, any>;
  progress?: number | null;
  status?: string | null;
  inputs?: string[];
  outputs?: string[];
  parameters?: Record<string, any>;
  [key: string]: any;
}

/**
 * 创建新节点
 * @param type 节点类型
 * @param kind 节点种类
 * @param position 节点位置
 * @param data 节点数据
 * @returns 新节点
 */
export function createNode(
  type: string = NODE_TYPES.TASK,
  kind: string = NODE_KINDS.TEXT,
  position: { x: number; y: number } = DEFAULTS.NODE_POSITION,
  data: Partial<NodeData> = {}
): Node<NodeData> {
  const id = generateId(type);

  return {
    id,
    type,
    position,
    data: {
      id,
      label: '',
      kind,
      config: {},
      progress: null,
      status: null,
      ...data,
    },
    style: {
      width: getDefaultNodeWidth(type),
      height: getDefaultNodeHeight(type),
    },
  };
}

/**
 * 获取节点的默认宽度
 * @param type 节点类型
 * @returns 默认宽度
 */
export function getDefaultNodeWidth(type: string): number {
  switch (type) {
    case NODE_TYPES.GROUP:
      return DEFAULTS.GROUP_NODE_WIDTH;
    case NODE_TYPES.IO:
      return DEFAULTS.IO_NODE_SIZE;
    default:
      return DEFAULTS.NODE_WIDTH;
  }
}

/**
 * 获取节点的默认高度
 * @param type 节点类型
 * @returns 默认高度
 */
export function getDefaultNodeHeight(type: string): number {
  switch (type) {
    case NODE_TYPES.GROUP:
      return DEFAULTS.GROUP_NODE_HEIGHT;
    case NODE_TYPES.IO:
      return DEFAULTS.IO_NODE_SIZE;
    default:
      return DEFAULTS.NODE_HEIGHT;
  }
}

/**
 * 验证节点数据
 * @param node 节点
 * @returns 验证结果
 */
export function validateNode(node: Node<NodeData>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 验证节点ID
  if (!node.id || node.id.trim() === '') {
    errors.push('Node ID is required');
  }

  // 验证节点类型
  if (!Object.values(NODE_TYPES).includes(node.type as any)) {
    errors.push('Invalid node type');
  }

  // 验证节点种类
  if (!Object.values(NODE_KINDS).includes(node.data.kind as any)) {
    errors.push('Invalid node kind');
  }

  // 验证标签长度
  if (node.data.label && node.data.label.length > VALIDATION.NODE_LABEL_MAX_LENGTH) {
    errors.push(`Node label is too long (max ${VALIDATION.NODE_LABEL_MAX_LENGTH} characters)`);
  }

  // 验证配置
  if (node.data.config && typeof node.data.config !== 'object') {
    errors.push('Node config must be an object');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 更新节点数据
 * @param nodes 节点数组
 * @param nodeId 节点ID
 * @param updates 更新数据
 * @returns 更新后的节点数组
 */
export function updateNodeData(
  nodes: Node<NodeData>[],
  nodeId: string,
  updates: Partial<NodeData>
): Node<NodeData>[] {
  return nodes.map(node =>
    node.id === nodeId
      ? {
          ...node,
          data: { ...node.data, ...updates },
        }
      : node
  );
}

/**
 * 更新节点位置
 * @param nodes 节点数组
 * @param nodeId 节点ID
 * @param position 新位置
 * @returns 更新后的节点数组
 */
export function updateNodePosition(
  nodes: Node<NodeData>[],
  nodeId: string,
  position: { x: number; y: number }
): Node<NodeData>[] {
  return nodes.map(node =>
    node.id === nodeId
      ? {
          ...node,
          position,
        }
      : node
  );
}

/**
 * 获取节点的输入类型
 * @param node 节点
 * @returns 输入类型数组
 */
export function getNodeInputTypes(node: Node<NodeData>): string[] {
  const kind = node.data.kind;

  switch (kind) {
    case NODE_KINDS.TEXT:
      return ['text'];
    case NODE_KINDS.IMAGE:
      return ['image'];
    case NODE_KINDS.VIDEO:
      return ['video'];
    case NODE_KINDS.AUDIO:
      return ['audio'];
    case NODE_KINDS.CHARACTER:
      return [];
    case NODE_KINDS.SUBTITLE:
      return ['subtitle'];
    default:
      return ['any'];
  }
}

/**
 * 获取节点的输出类型
 * @param node 节点
 * @returns 输出类型数组
 */
export function getNodeOutputTypes(node: Node<NodeData>): string[] {
  const kind = node.data.kind;

  switch (kind) {
    case NODE_KINDS.TEXT:
      return ['text'];
    case NODE_KINDS.IMAGE:
      return ['image'];
    case NODE_KINDS.VIDEO:
      return ['video'];
    case NODE_KINDS.CHARACTER:
      return ['text'];
    case NODE_KINDS.AUDIO:
      return ['audio'];
    case NODE_KINDS.SUBTITLE:
      return ['subtitle'];
    default:
      return ['any'];
  }
}

/**
 * 检查节点是否正在运行
 * @param node 节点
 * @returns 是否正在运行
 */
export function isNodeRunning(node: Node<NodeData>): boolean {
  return node.data.status === 'running';
}

/**
 * 检查节点是否已完成
 * @param node 节点
 * @returns 是否已完成
 */
export function isNodeCompleted(node: Node<NodeData>): boolean {
  return node.data.status === 'completed' && node.data.progress === 100;
}

/**
 * 检查节点是否出错
 * @param node 节点
 * @returns 是否出错
 */
export function isNodeError(node: Node<NodeData>): boolean {
  return node.data.status === 'error';
}

/**
 * 获取节点显示文本
 * @param node 节点
 * @returns 显示文本
 */
export function getNodeDisplayText(node: Node<NodeData>): string {
  if (node.data.label && node.data.label.trim()) {
    return node.data.label;
  }

  const kindNames: Record<string, string> = {
    [NODE_KINDS.TEXT]: 'Text',
    [NODE_KINDS.IMAGE]: 'Image',
    [NODE_KINDS.VIDEO]: 'Video',
    [NODE_KINDS.AUDIO]: 'Audio',
    [NODE_KINDS.CHARACTER]: 'Character',
    [NODE_KINDS.SUBTITLE]: 'Subtitle',
    [NODE_KINDS.SUBFLOW]: 'Subflow',
    [NODE_KINDS.RUN]: 'Run',
    [NODE_KINDS.EMPTY]: 'Empty',
  };

  return kindNames[node.data.kind] || 'Unknown';
}

/**
 * 创建节点手柄
 * @param nodeId 节点ID
 * @param type 手柄类型
 * @param dataType 数据类型
 * @param index 索引
 * @returns 手柄配置
 */
export function createNodeHandle(
  nodeId: string,
  type: 'source' | 'target',
  dataType: string,
  index: number = 0
) {
  const prefix = type === 'source' ? 'out' : 'in';
  return {
    id: `${prefix}-${dataType}-${index}`,
    type,
    position: type === 'source' ? 'right' : 'left',
    style: {
      top: `${30 + index * 20}%`,
    },
    'data-nodeid': nodeId,
    'data-datatype': dataType,
  };
}

/**
 * 复制节点
 * @param node 原节点
 * @param offset 复制偏移量
 * @returns 复制后的节点
 */
export function cloneNode(
  node: Node<NodeData>,
  offset: { x: number; y: number } = { x: 20, y: 20 }
): Node<NodeData> {
  const clonedNode = {
    ...node,
    id: generateId(node.type),
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
    data: {
      ...node.data,
      id: generateId('node-data'),
    },
    selected: false,
  };

  return clonedNode;
}

/**
 * 获取节点的执行顺序
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 拓扑排序后的节点ID数组
 */
export function getNodeExecutionOrder(nodes: Node<NodeData>[], edges: any[]): string[] {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const order: string[] = [];

  // 构建邻接表和入度表
  nodes.forEach(node => {
    graph.set(node.id, []);
    inDegree.set(node.id, 0);
  });

  edges.forEach(edge => {
    const neighbors = graph.get(edge.source) || [];
    neighbors.push(edge.target);
    graph.set(edge.source, neighbors);

    const currentInDegree = inDegree.get(edge.target) || 0;
    inDegree.set(edge.target, currentInDegree + 1);
  });

  // 拓扑排序
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });

  while (queue.length > 0) {
    const currentNode = queue.shift()!;
    order.push(currentNode);

    const neighbors = graph.get(currentNode) || [];
    neighbors.forEach(neighbor => {
      const neighborInDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, neighborInDegree);
      if (neighborInDegree === 0) {
        queue.push(neighbor);
      }
    });
  }

  return order;
}

/**
 * 节点配置模板
 */
export const NodeConfigTemplates = {
  [NODE_KINDS.TEXT]: {
    prompt: '',
    temperature: 0.7,
    maxLength: 1000,
  },
  [NODE_KINDS.IMAGE]: {
    prompt: '',
    size: '1024x1024',
    quality: 'standard',
  },
  [NODE_KINDS.VIDEO]: {
    duration: 10,
    fps: 30,
    resolution: '1080p',
  },
  [NODE_KINDS.AUDIO]: {
    duration: 30,
    sampleRate: 44100,
    bitrate: 128,
  },
  [NODE_KINDS.SUBTITLE]: {
    language: 'zh',
    format: 'srt',
  },
} as const;

/**
 * 获取节点默认配置
 * @param kind 节点种类
 * @returns 默认配置
 */
export function getNodeDefaultConfig(kind: string): Record<string, any> {
  return NodeConfigTemplates[kind as keyof typeof NodeConfigTemplates] || {};
}
