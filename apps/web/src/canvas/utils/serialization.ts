/**
 * 序列化工具函数
 * 参考雅虎军规：数据序列化安全，版本兼容，错误处理完善
 */

import { STORAGE_KEYS } from './constants';
import type { Node, Edge } from '@xyflow/react';

export interface SerializedCanvas {
  version: string;
  timestamp: number;
  nodes: Node[];
  edges: Edge[];
  metadata?: {
    title?: string;
    description?: string;
    tags?: string[];
    author?: string;
  };
}

export interface SerializationOptions {
  includeMetadata?: boolean;
  compress?: boolean;
  excludeCircular?: boolean;
}

/**
 * 序列化画布数据
 * @param nodes 节点数组
 * @param edges 边数组
 * @param options 序列化选项
 * @returns 序列化后的字符串
 */
export function serializeCanvas(
  nodes: Node[],
  edges: Edge[],
  options: SerializationOptions = {}
): string {
  const { includeMetadata = true, compress = false, excludeCircular = true } = options;

  try {
    const data: SerializedCanvas = {
      version: '1.0.0',
      timestamp: Date.now(),
      nodes: excludeCircular ? sanitizeNodes(nodes) : nodes,
      edges: excludeCircular ? sanitizeEdges(edges) : edges,
    };

    if (includeMetadata) {
      data.metadata = {
        title: 'Untitled Canvas',
        description: 'Created with TapCanvas',
        tags: [],
        author: 'User',
      };
    }

    const jsonString = JSON.stringify(data, null, compress ? 0 : 2);

    if (compress) {
      return compressString(jsonString);
    }

    return jsonString;
  } catch (error) {
    throw new Error(`Failed to serialize canvas: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 反序列化画布数据
 * @param jsonString 序列化字符串
 * @returns 反序列化后的画布数据
 */
export function deserializeCanvas(jsonString: string): SerializedCanvas {
  try {
    // 检查是否为压缩格式
    const decompressedString = isCompressed(jsonString) ? decompressString(jsonString) : jsonString;

    const data = JSON.parse(decompressedString) as SerializedCanvas;

    // 验证数据格式
    if (!validateSerializedData(data)) {
      throw new Error('Invalid canvas data format');
    }

    // 版本兼容性处理
    return migrateData(data);
  } catch (error) {
    throw new Error(`Failed to deserialize canvas: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 保存画布到本地存储
 * @param nodes 节点数组
 * @param edges 边数组
 * @param options 序列化选项
 * @returns 是否保存成功
 */
export function saveCanvasToLocalStorage(
  nodes: Node[],
  edges: Edge[],
  options: SerializationOptions = {}
): boolean {
  try {
    const serialized = serializeCanvas(nodes, edges, options);
    localStorage.setItem(STORAGE_KEYS.CANVAS_DATA, serialized);
    return true;
  } catch (error) {
    console.error('Failed to save canvas to localStorage:', error);
    return false;
  }
}

/**
 * 从本地存储加载画布
 * @returns 画布数据或null
 */
export function loadCanvasFromLocalStorage(): SerializedCanvas | null {
  try {
    const jsonString = localStorage.getItem(STORAGE_KEYS.CANVAS_DATA);
    if (!jsonString) return null;

    return deserializeCanvas(jsonString);
  } catch (error) {
    console.error('Failed to load canvas from localStorage:', error);
    return null;
  }
}

/**
 * 清除本地存储中的画布数据
 * @returns 是否清除成功
 */
export function clearCanvasFromLocalStorage(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEYS.CANVAS_DATA);
    localStorage.removeItem(STORAGE_KEYS.CANVAS_LAYOUT);
    return true;
  } catch (error) {
    console.error('Failed to clear canvas from localStorage:', error);
    return false;
  }
}

/**
 * 深度克隆对象，移除循环引用
 * @param obj 要克隆的对象
 * @param visited 已访问的对象集合
 * @returns 克隆后的对象
 */
export function deepClone(obj: any, visited = new WeakSet()): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (visited.has(obj)) {
    return '[Circular Reference]';
  }

  visited.add(obj);

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item, visited));
  }

  if (typeof obj === 'object') {
    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = deepClone(obj[key], visited);
      }
    }
    return cloned;
  }

  return obj;
}

/**
 * 清理节点数据，移除不必要的属性
 * @param nodes 节点数组
 * @returns 清理后的节点数组
 */
export function sanitizeNodes(nodes: Node[]): Node[] {
  return nodes.map(node => ({
    ...node,
    data: {
      id: node.data.id,
      label: node.data.label,
      kind: node.data.kind,
      config: node.data.config || {},
      // 移除运行时状态
      progress: undefined,
      status: undefined,
      logs: undefined,
    },
    // 移除React Flow的内部状态
    selected: false,
    dragging: false,
  }));
}

/**
 * 清理边数据，移除不必要的属性
 * @param edges 边数组
 * @returns 清理后的边数组
 */
export function sanitizeEdges(edges: Edge[]): Edge[] {
  return edges.map(edge => ({
    ...edge,
    data: edge.data || {},
    // 移除React Flow的内部状态
    selected: false,
  }));
}

/**
 * 验证序列化数据的格式
 * @param data 序列化数据
 * @returns 是否有效
 */
function validateSerializedData(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  if (!data.version || typeof data.version !== 'string') {
    return false;
  }

  if (!data.timestamp || typeof data.timestamp !== 'number') {
    return false;
  }

  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return false;
  }

  return true;
}

/**
 * 数据版本迁移
 * @param data 序列化数据
 * @returns 迁移后的数据
 */
function migrateData(data: SerializedCanvas): SerializedCanvas {
  // 目前只有一个版本，未来可以在这里添加迁移逻辑
  switch (data.version) {
    case '1.0.0':
      return data;
    default:
      // 尝试迁移未知版本到当前版本
      console.warn(`Unknown canvas version: ${data.version}, attempting migration`);
      return {
        ...data,
        version: '1.0.0',
      };
  }
}

/**
 * 简单的字符串压缩（使用base64）
 * @param str 原始字符串
 * @returns 压缩后的字符串
 */
function compressString(str: string): string {
  try {
    return btoa(encodeURIComponent(str));
  } catch {
    return str; // 压缩失败时返回原始字符串
  }
}

/**
 * 简单的字符串解压缩
 * @param compressed 压缩的字符串
 * @returns 解压缩后的字符串
 */
function decompressString(compressed: string): string {
  try {
    return decodeURIComponent(atob(compressed));
  } catch {
    return compressed; // 解压缩失败时返回原始字符串
  }
}

/**
 * 检查字符串是否为压缩格式
 * @param str 字符串
 * @returns 是否为压缩格式
 */
function isCompressed(str: string): boolean {
  try {
    // 尝试解码，如果成功则认为是压缩格式
    atob(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * 导出画布为JSON文件
 * @param nodes 节点数组
 * @param edges 边数组
 * @param filename 文件名
 * @param options 序列化选项
 */
export function exportCanvasAsJSON(
  nodes: Node[],
  edges: Edge[],
  filename: string = 'canvas.json',
  options: SerializationOptions = {}
): void {
  try {
    const serialized = serializeCanvas(nodes, edges, options);
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to export canvas:', error);
    throw error;
  }
}

/**
 * 从文件导入画布
 * @param file 文件对象
 * @returns Promise<SerializedCanvas>
 */
export function importCanvasFromFile(file: File): Promise<SerializedCanvas> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const jsonString = event.target?.result as string;
        const canvasData = deserializeCanvas(jsonString);
        resolve(canvasData);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsText(file);
  });
}

/**
 * 获取画布数据的统计信息
 * @param data 序列化数据
 * @returns 统计信息
 */
export function getCanvasStats(data: SerializedCanvas): {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  edgeTypes: Record<string, number>;
  size: number;
  lastModified: Date;
} {
  const nodeTypes: Record<string, number> = {};
  const edgeTypes: Record<string, number> = {};

  data.nodes.forEach(node => {
    const type = node.type || 'unknown';
    nodeTypes[type] = (nodeTypes[type] || 0) + 1;
  });

  data.edges.forEach(edge => {
    const type = edge.type || 'default';
    edgeTypes[type] = (edgeTypes[type] || 0) + 1;
  });

  return {
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    nodeTypes,
    edgeTypes,
    size: JSON.stringify(data).length,
    lastModified: new Date(data.timestamp),
  };
}