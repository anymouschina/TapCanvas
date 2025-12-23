/**
 * 画布相关工具函数
 * 参考雅虎军规：工具函数职责单一，可复用，性能优化
 */

import { CANVAS_CONFIG, HANDLE_PREFIXES } from './constants';
import type { Node, Edge, Position } from '@xyflow/react';

/**
 * 生成唯一ID
 * @param prefix ID前缀
 * @returns 唯一ID字符串
 */
export function generateId(prefix = 'node'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 克隆图结构（节点和边）
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 克隆后的节点和边
 */
export function cloneGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map(node => ({ ...node, data: { ...node.data } })),
    edges: edges.map(edge => ({ ...edge, data: edge.data ? { ...edge.data } : undefined })),
  };
}

/**
 * 获取选中节点
 * @param nodes 节点数组
 * @returns 选中的节点数组
 */
export function getSelectedNodes(nodes: Node[]): Node[] {
  return nodes.filter(node => node.selected);
}

/**
 * 获取选中边
 * @param edges 边数组
 * @returns 选中的边数组
 */
export function getSelectedEdges(edges: Edge[]): Edge[] {
  return edges.filter(edge => edge.selected);
}

/**
 * 根据ID获取节点
 * @param nodes 节点数组
 * @param id 节点ID
 * @returns 节点或null
 */
export function getNodeById(nodes: Node[], id: string): Node | null {
  return nodes.find(node => node.id === id) || null;
}

/**
 * 根据ID获取边
 * @param edges 边数组
 * @param id 边ID
 * @returns 边或null
 */
export function getEdgeById(edges: Edge[], id: string): Edge | null {
  return edges.find(edge => edge.id === id) || null;
}

/**
 * 计算节点的边界框
 * @param nodes 节点数组
 * @returns 边界框 { x, y, width, height }
 */
export function calculateNodesBounds(nodes: Node[]) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach(node => {
    const x = node.position.x;
    const y = node.position.y;
    const width = node.width || CANVAS_CONFIG.DEFAULT_NODE_WIDTH;
    const height = node.height || CANVAS_CONFIG.DEFAULT_NODE_HEIGHT;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 获取节点的连接边
 * @param nodeId 节点ID
 * @param edges 边数组
 * @returns 连接到该节点的边数组
 */
export function getNodeConnections(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter(edge =>
    edge.source === nodeId || edge.target === nodeId
  );
}

/**
 * 获取节点的输入边
 * @param nodeId 节点ID
 * @param edges 边数组
 * @returns 输入边数组
 */
export function getNodeInputEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter(edge => edge.target === nodeId);
}

/**
 * 获取节点的输出边
 * @param nodeId 节点ID
 * @param edges 边数组
 * @returns 输出边数组
 */
export function getNodeOutputEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter(edge => edge.source === nodeId);
}

/**
 * 检查两个节点是否可以连接
 * @param sourceNode 源节点
 * @param targetNode 目标节点
 * @param existingEdges 现有边数组
 * @returns 是否可以连接
 */
export function canConnect(
  sourceNode: Node,
  targetNode: Node,
  existingEdges: Edge[]
): boolean {
  // 不能连接到自身
  if (sourceNode.id === targetNode.id) return false;

  // 检查是否已经存在连接
  const existingConnection = existingEdges.some(edge =>
    edge.source === sourceNode.id && edge.target === targetNode.id
  );

  return !existingConnection;
}

/**
 * 计算两点之间的距离
 * @param p1 点1
 * @param p2 点2
 * @returns 距离
 */
export function calculateDistance(p1: Position, p2: Position): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 检查点是否在矩形内
 * @param point 点坐标
 * @param rect 矩形 { x, y, width, height }
 * @returns 是否在矩形内
 */
export function isPointInRect(
  point: Position,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * 节点是否在选中区域内
 * @param node 节点
 * @param selectionArea 选中区域 { x1, y1, x2, y2 }
 * @returns 是否在选中区域内
 */
export function isNodeInSelectionArea(
  node: Node,
  selectionArea: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  const { x1, y1, x2, y2 } = selectionArea;
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);

  return isPointInRect(node.position, { x, y, width, height });
}

/**
 * 生成网格对齐的位置
 * @param position 原始位置
 * @param gridSize 网格大小
 * @returns 对齐后的位置
 */
export function snapToGrid(
  position: Position,
  gridSize: number = CANVAS_CONFIG.GRID_SIZE
): Position {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}

/**
 * 验证图的连接性（检查是否有环）
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 是否为有向无环图
 */
export function validateAcyclic(nodes: Node[], edges: Edge[]): boolean {
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // 构建邻接表和入度表
  nodes.forEach(node => {
    adjacencyList.set(node.id, []);
    inDegree.set(node.id, 0);
  });

  edges.forEach(edge => {
    const neighbors = adjacencyList.get(edge.source) || [];
    neighbors.push(edge.target);
    adjacencyList.set(edge.source, neighbors);

    const currentInDegree = inDegree.get(edge.target) || 0;
    inDegree.set(edge.target, currentInDegree + 1);
  });

  // 拓扑排序检测环
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });

  let visitedCount = 0;
  while (queue.length > 0) {
    const currentNode = queue.shift()!;
    visitedCount++;

    const neighbors = adjacencyList.get(currentNode) || [];
    neighbors.forEach(neighbor => {
      const neighborInDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, neighborInDegree);
      if (neighborInDegree === 0) {
        queue.push(neighbor);
      }
    });
  }

  return visitedCount === nodes.length;
}

/**
 * 找到图的入口节点（入度为0的节点）
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 入口节点数组
 */
export function findEntryNodes(nodes: Node[], edges: Edge[]): Node[] {
  const inDegree = new Map<string, number>();

  // 初始化所有节点的入度为0
  nodes.forEach(node => {
    inDegree.set(node.id, 0);
  });

  // 计算每个节点的入度
  edges.forEach(edge => {
    const currentInDegree = inDegree.get(edge.target) || 0;
    inDegree.set(edge.target, currentInDegree + 1);
  });

  // 返回入度为0的节点
  return nodes.filter(node => (inDegree.get(node.id) || 0) === 0);
}

/**
 * 找到图的出口节点（出度为0的节点）
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 出口节点数组
 */
export function findExitNodes(nodes: Node[], edges: Edge[]): Node[] {
  const outDegree = new Map<string, number>();

  // 初始化所有节点的出度为0
  nodes.forEach(node => {
    outDegree.set(node.id, 0);
  });

  // 计算每个节点的出度
  edges.forEach(edge => {
    const currentOutDegree = outDegree.get(edge.source) || 0;
    outDegree.set(edge.source, currentOutDegree + 1);
  });

  // 返回出度为0的节点
  return nodes.filter(node => (outDegree.get(node.id) || 0) === 0);
}

/**
 * 计算两个位置的中点
 * @param pos1 位置1
 * @param pos2 位置2
 * @returns 中点位置
 */
export function getMidpoint(pos1: Position, pos2: Position): Position {
  return {
    x: (pos1.x + pos2.x) / 2,
    y: (pos1.y + pos2.y) / 2,
  };
}

/**
 * 将画布坐标转换为相对坐标
 * @param absolutePosition 绝对坐标
 * @param canvasOrigin 画布原点
 * @returns 相对坐标
 */
export function toRelativeCoordinates(
  absolutePosition: Position,
  canvasOrigin: Position = { x: 0, y: 0 }
): Position {
  return {
    x: absolutePosition.x - canvasOrigin.x,
    y: absolutePosition.y - canvasOrigin.y,
  };
}

/**
 * 将相对坐标转换为画布坐标
 * @param relativePosition 相对坐标
 * @param canvasOrigin 画布原点
 * @returns 画布坐标
 */
export function toAbsoluteCoordinates(
  relativePosition: Position,
  canvasOrigin: Position = { x: 0, y: 0 }
): Position {
  return {
    x: relativePosition.x + canvasOrigin.x,
    y: relativePosition.y + canvasOrigin.y,
  };
}

/**
 * 检查是否为有效的连接类型
 * @param sourceType 源类型
 * @param targetType 目标类型
 * @returns 是否有效
 */
export function isValidConnectionType(sourceType: string, targetType: string): boolean {
  // 相同类型总是可以连接
  if (sourceType === targetType) return true;

  // 'any' 类型可以连接到任何类型
  if (sourceType === 'any' || targetType === 'any') return true;

  // 定义兼容性矩阵
  const compatibilityMatrix: Record<string, string[]> = {
    text: ['subtitle'],
    subtitle: ['video'],
    image: ['video'],
    audio: ['video'],
    video: [],
    any: ['text', 'image', 'video', 'audio', 'subtitle'],
  };

  return compatibilityMatrix[sourceType]?.includes(targetType) || false;
}