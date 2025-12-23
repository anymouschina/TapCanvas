/**
 * 布局相关工具函数
 * 参考雅虎军规：算法封装，性能优化，输入输出明确
 */

import { CANVAS_CONFIG } from './constants';
import type { Node, Edge } from '@xyflow/react';

/**
 * 布局配置接口
 */
export interface LayoutConfig {
  nodeSpacingX: number;
  levelSpacing: number;
  alignX?: 'left' | 'center' | 'right';
  alignY?: 'top' | 'center' | 'bottom';
}

/**
 * 布局结果接口
 */
export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * 默认布局配置
 */
export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  nodeSpacingX: CANVAS_CONFIG.NODE_SPACING_X,
  levelSpacing: CANVAS_CONFIG.NODE_SPACING_Y * 2,
  alignX: 'center',
  alignY: 'center',
};

/**
 * 简单网格布局
 * @param nodes 节点数组
 * @param config 布局配置
 * @param startX 起始X坐标
 * @param startY 起始Y坐标
 * @returns 布局后的节点数组
 */
export function layoutGrid(
  nodes: Node[],
  config: Partial<LayoutConfig> = {},
  startX: number = 0,
  startY: number = 0
): Node[] {
  const { nodeSpacingX } = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  const nodeSpacingY = CANVAS_CONFIG.NODE_SPACING_Y;

  const cols = Math.ceil(Math.sqrt(nodes.length));

  return nodes.map((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;

    return {
      ...node,
      position: {
        x: startX + col * nodeSpacingX,
        y: startY + row * nodeSpacingY,
      },
    };
  });
}

/**
 * 层级布局（DAG布局）
 * @param nodes 节点数组
 * @param edges 边数组
 * @param config 布局配置
 * @returns 布局结果
 */
export function layoutHierarchical(
  nodes: Node[],
  edges: Edge[],
  config: Partial<LayoutConfig> = {}
): LayoutResult {
  const { nodeSpacingX, levelSpacing, alignX, alignY } = {
    ...DEFAULT_LAYOUT_CONFIG,
    ...config,
  };
  const nodeSpacingY = CANVAS_CONFIG.NODE_SPACING_Y;

  // 构建邻接表和入度表
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

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

  // 拓扑排序分层
  const layers: string[][] = [];
  const visited = new Set<string>();

  // 找到所有入度为0的节点作为第一层
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });

  while (queue.length > 0 || layers.length === 0) {
    if (queue.length === 0 && layers.length > 0) {
      // 处理环中的剩余节点
      nodes.forEach(node => {
        if (!visited.has(node.id)) {
          queue.push(node.id);
        }
      });
    }

    const currentLayer: string[] = [];
    const currentQueueSize = queue.length;

    for (let i = 0; i < currentQueueSize; i++) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;

      visited.add(nodeId);
      currentLayer.push(nodeId);

      const neighbors = adjacencyList.get(nodeId) || [];
      neighbors.forEach(neighbor => {
        const neighborInDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, neighborInDegree);
        if (neighborInDegree === 0 && !visited.has(neighbor)) {
          queue.push(neighbor);
        }
      });
    }

    if (currentLayer.length > 0) {
      layers.push(currentLayer);
    }
  }

  // 计算节点位置
  const layoutedNodes = nodes.map(node => {
    const nodeIndex = layers.findIndex(layer => layer.includes(node.id));
    const layerIndex = layers[nodeIndex]?.indexOf(node.id) || 0;
    const nodesInLayer = layers[nodeIndex]?.length || 1;

    let x = 0;
    let y = 0;

    if (alignX === 'center') {
      const layerWidth = (nodesInLayer - 1) * nodeSpacingX;
      x = layerIndex * nodeSpacingX - layerWidth / 2;
    } else if (alignX === 'right') {
      const layerWidth = (nodesInLayer - 1) * nodeSpacingX;
      x = layerIndex * nodeSpacingX - layerWidth;
    } else {
      x = layerIndex * nodeSpacingX;
    }

    if (alignY === 'center') {
      y = nodeIndex * levelSpacing - (layers.length - 1) * levelSpacing / 2;
    } else if (alignY === 'bottom') {
      y = nodeIndex * levelSpacing - (layers.length - 1) * levelSpacing;
    } else {
      y = nodeIndex * levelSpacing;
    }

    return {
      ...node,
      position: { x, y },
    };
  });

  // 计算布局边界
  const bounds = calculateNodesBounds(layoutedNodes);

  return {
    nodes: layoutedNodes,
    edges,
    bounds,
  };
}

/**
 * 径向布局
 * @param nodes 节点数组
 * @param edges 边数组
 * @param centerNodeIds 中心节点ID数组
 * @param config 布局配置
 * @returns 布局结果
 */
export function layoutRadial(
  nodes: Node[],
  edges: Edge[],
  centerNodeIds: string[] = [],
  config: Partial<LayoutConfig> = {}
): LayoutResult {
  const { nodeSpacingX, nodeSpacingY } = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  const radius = Math.max(nodeSpacingX, nodeSpacingY);

  // 如果没有指定中心节点，选择入度最小的节点
  if (centerNodeIds.length === 0) {
    const inDegree = new Map<string, number>();
    nodes.forEach(node => inDegree.set(node.id, 0));
    edges.forEach(edge => {
      const currentInDegree = (inDegree.get(edge.target) || 0) + 1;
      inDegree.set(edge.target, currentInDegree);
    });

    const minDegree = Math.min(...Array.from(inDegree.values()));
    centerNodeIds = Array.from(inDegree.entries())
      .filter(([_, degree]) => degree === minDegree)
      .map(([nodeId]) => nodeId)
      .slice(0, 1); // 最多选择一个中心节点
  }

  // 计算每个节点到中心节点的最短距离
  const distances = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  nodes.forEach(node => {
    adjacencyList.set(node.id, []);
    distances.set(node.id, centerNodeIds.includes(node.id) ? 0 : Infinity);
  });

  edges.forEach(edge => {
    const neighbors = adjacencyList.get(edge.source) || [];
    neighbors.push(edge.target);
    adjacencyList.set(edge.source, neighbors);

    const reverseNeighbors = adjacencyList.get(edge.target) || [];
    reverseNeighbors.push(edge.source);
    adjacencyList.set(edge.target, reverseNeighbors);
  });

  // BFS计算距离
  const queue = [...centerNodeIds];
  const visited = new Set(centerNodeIds);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDistance = distances.get(currentId) || 0;
    const neighbors = adjacencyList.get(currentId) || [];

    neighbors.forEach(neighbor => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        distances.set(neighbor, currentDistance + 1);
        queue.push(neighbor);
      }
    });
  }

  // 按距离分组
  const distanceGroups = new Map<number, string[]>();
  distances.forEach((distance, nodeId) => {
    if (!distanceGroups.has(distance)) {
      distanceGroups.set(distance, []);
    }
    distanceGroups.get(distance)!.push(nodeId);
  });

  // 计算节点位置
  const layoutedNodes = nodes.map(node => {
    const distance = distances.get(node.id) || 0;
    const group = distanceGroups.get(distance) || [];
    const indexInGroup = group.indexOf(node.id);
    const groupSize = group.length;

    if (distance === 0) {
      // 中心节点
      return {
        ...node,
        position: { x: 0, y: 0 },
      };
    }

    // 使用圆形布局
    const angle = (2 * Math.PI * indexInGroup) / groupSize;
    const currentRadius = radius * distance;

    return {
      ...node,
      position: {
        x: Math.cos(angle) * currentRadius,
        y: Math.sin(angle) * currentRadius,
      },
    };
  });

  const bounds = calculateNodesBounds(layoutedNodes);

  return {
    nodes: layoutedNodes,
    edges,
    bounds,
  };
}

/**
 * 力导向布局（简化版）
 * @param nodes 节点数组
 * @param edges 边数组
 * @param iterations 迭代次数
 * @param config 布局配置
 * @returns 布局结果
 */
export function layoutForceDirected(
  nodes: Node[],
  edges: Edge[],
  iterations: number = 50,
  config: Partial<LayoutConfig> = {}
): LayoutResult {
  const { nodeSpacingX, nodeSpacingY } = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  const idealDistance = Math.sqrt(nodeSpacingX * nodeSpacingY);
  const repulsionStrength = idealDistance * idealDistance;
  const attractionStrength = 0.1;

  // 初始化随机位置（如果节点没有位置）
  const positionedNodes = nodes.map(node => ({
    ...node,
    position: node.position || {
      x: (Math.random() - 0.5) * 1000,
      y: (Math.random() - 0.5) * 1000,
    },
  }));

  // 构建邻接表
  const adjacencyList = new Map<string, string[]>();
  nodes.forEach(node => adjacencyList.set(node.id, []));
  edges.forEach(edge => {
    adjacencyList.get(edge.source)?.push(edge.target);
    adjacencyList.get(edge.target)?.push(edge.source);
  });

  // 迭代计算位置
  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { fx: number; fy: number }>();

    // 初始化力
    positionedNodes.forEach(node => {
      forces.set(node.id, { fx: 0, fy: 0 });
    });

    // 计算斥力（所有节点之间）
    for (let i = 0; i < positionedNodes.length; i++) {
      for (let j = i + 1; j < positionedNodes.length; j++) {
        const node1 = positionedNodes[i];
        const node2 = positionedNodes[j];

        const dx = node2.position.x - node1.position.x;
        const dy = node2.position.y - node1.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = repulsionStrength / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        const force1 = forces.get(node1.id)!;
        const force2 = forces.get(node2.id)!;

        force1.fx -= fx;
        force1.fy -= fy;
        force2.fx += fx;
        force2.fy += fy;
      }
    }

    // 计算引力（连接的节点之间）
    edges.forEach(edge => {
      const node1 = positionedNodes.find(n => n.id === edge.source);
      const node2 = positionedNodes.find(n => n.id === edge.target);

      if (node1 && node2) {
        const dx = node2.position.x - node1.position.x;
        const dy = node2.position.y - node1.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = distance * attractionStrength;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        const force1 = forces.get(node1.id)!;
        const force2 = forces.get(node2.id)!;

        force1.fx += fx;
        force1.fy += fy;
        force2.fx -= fx;
        force2.fy -= fy;
      }
    });

    // 应用力并更新位置
    positionedNodes.forEach(node => {
      const force = forces.get(node.id)!;
      const damping = 0.9; // 阻尼系数

      node.position.x += force.fx * damping;
      node.position.y += force.fy * damping;
    });
  }

  const bounds = calculateNodesBounds(positionedNodes);

  return {
    nodes: positionedNodes,
    edges,
    bounds,
  };
}

/**
 * 计算节点边界
 */
function calculateNodesBounds(nodes: Node[]): { x: number; y: number; width: number; height: number } {
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
 * 对齐选中的节点到网格
 * @param nodes 节点数组
 * @param selectedNodeIds 选中的节点ID
 * @param gridSize 网格大小
 * @returns 对齐后的节点数组
 */
export function alignNodesToGrid(
  nodes: Node[],
  selectedNodeIds: string[],
  gridSize: number = CANVAS_CONFIG.GRID_SIZE
): Node[] {
  return nodes.map(node => {
    if (selectedNodeIds.includes(node.id)) {
      return {
        ...node,
        position: {
          x: Math.round(node.position.x / gridSize) * gridSize,
          y: Math.round(node.position.y / gridSize) * gridSize,
        },
      };
    }
    return node;
  });
}

/**
 * 水平对齐选中的节点
 * @param nodes 节点数组
 * @param selectedNodeIds 选中的节点ID
 * @param alignment 对齐方式 'left' | 'center' | 'right'
 * @returns 对齐后的节点数组
 */
export function alignNodesHorizontal(
  nodes: Node[],
  selectedNodeIds: string[],
  alignment: 'left' | 'center' | 'right' = 'center'
): Node[] {
  const selectedNodes = nodes.filter(node => selectedNodeIds.includes(node.id));
  if (selectedNodes.length < 2) return nodes;

  let targetY = 0;

  if (alignment === 'left') {
    targetY = Math.min(...selectedNodes.map(n => n.position.y));
  } else if (alignment === 'center') {
    const minY = Math.min(...selectedNodes.map(n => n.position.y));
    const maxY = Math.max(...selectedNodes.map(n => n.position.y));
    targetY = (minY + maxY) / 2;
  } else {
    targetY = Math.max(...selectedNodes.map(n => n.position.y));
  }

  return nodes.map(node => {
    if (selectedNodeIds.includes(node.id)) {
      return {
        ...node,
        position: {
          ...node.position,
          y: targetY,
        },
      };
    }
    return node;
  });
}

/**
 * 垂直对齐选中的节点
 * @param nodes 节点数组
 * @param selectedNodeIds 选中的节点ID
 * @param alignment 对齐方式 'top' | 'center' | 'bottom'
 * @returns 对齐后的节点数组
 */
export function alignNodesVertical(
  nodes: Node[],
  selectedNodeIds: string[],
  alignment: 'top' | 'center' | 'bottom' = 'center'
): Node[] {
  const selectedNodes = nodes.filter(node => selectedNodeIds.includes(node.id));
  if (selectedNodes.length < 2) return nodes;

  let targetX = 0;

  if (alignment === 'top') {
    targetX = Math.min(...selectedNodes.map(n => n.position.x));
  } else if (alignment === 'center') {
    const minX = Math.min(...selectedNodes.map(n => n.position.x));
    const maxX = Math.max(...selectedNodes.map(n => n.position.x));
    targetX = (minX + maxX) / 2;
  } else {
    targetX = Math.max(...selectedNodes.map(n => n.position.x));
  }

  return nodes.map(node => {
    if (selectedNodeIds.includes(node.id)) {
      return {
        ...node,
        position: {
          x: targetX,
          y: node.position.y,
        },
      };
    }
    return node;
  });
}