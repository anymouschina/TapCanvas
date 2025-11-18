/**
 * 验证工具函数
 * 参考雅虎军规：输入验证严格，错误信息明确，边界条件处理
 */

import { VALIDATION, NODE_TYPES, NODE_KINDS, ERROR_MESSAGES } from './constants';
import type { NodeData, EdgeData } from '../components/shared/NodeBase/NodeBase.types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证节点数据
 * @param nodeData 节点数据
 * @returns 验证结果
 */
export function validateNodeData(nodeData: NodeData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 验证节点ID
  if (!nodeData.id || typeof nodeData.id !== 'string' || nodeData.id.trim() === '') {
    errors.push('Node ID is required and must be a non-empty string');
  }

  // 验证节点标签
  if (nodeData.label && typeof nodeData.label === 'string') {
    if (nodeData.label.length > VALIDATION.NODE_LABEL_MAX_LENGTH) {
      errors.push(`Node label is too long (max ${VALIDATION.NODE_LABEL_MAX_LENGTH} characters)`);
    }
  } else if (nodeData.label !== undefined) {
    errors.push('Node label must be a string');
  }

  // 验证节点种类
  if (!nodeData.kind || !Object.values(NODE_KINDS).includes(nodeData.kind as any)) {
    errors.push(`Invalid node kind. Must be one of: ${Object.values(NODE_KINDS).join(', ')}`);
  }

  // 验证配置对象
  if (nodeData.config && typeof nodeData.config !== 'object') {
    errors.push('Node config must be an object');
  } else if (nodeData.config) {
    // 验证配置内容
    Object.keys(nodeData.config).forEach(key => {
      const value = nodeData.config[key];
      if (value === undefined || value === null) {
        warnings.push(`Config property '${key}' has null or undefined value`);
      }
    });
  }

  // 验证进度值
  if (nodeData.progress !== undefined && nodeData.progress !== null) {
    if (typeof nodeData.progress !== 'number' || nodeData.progress < 0 || nodeData.progress > 100) {
      errors.push('Progress must be a number between 0 and 100');
    }
  }

  // 验证输入类型数组
  if (nodeData.inputs && !Array.isArray(nodeData.inputs)) {
    errors.push('Node inputs must be an array');
  } else if (nodeData.inputs) {
    nodeData.inputs.forEach((input, index) => {
      if (typeof input !== 'string') {
        errors.push(`Input at index ${index} must be a string`);
      }
    });
  }

  // 验证输出类型数组
  if (nodeData.outputs && !Array.isArray(nodeData.outputs)) {
    errors.push('Node outputs must be an array');
  } else if (nodeData.outputs) {
    nodeData.outputs.forEach((output, index) => {
      if (typeof output !== 'string') {
        errors.push(`Output at index ${index} must be a string`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证边数据
 * @param edgeData 边数据
 * @returns 验证结果
 */
export function validateEdgeData(edgeData: EdgeData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 验证边类型
  if (edgeData.type && typeof edgeData.type !== 'string') {
    errors.push('Edge type must be a string');
  }

  // 验证标签
  if (edgeData.label && typeof edgeData.label !== 'string') {
    errors.push('Edge label must be a string');
  } else if (edgeData.label && edgeData.label.length > 100) {
    warnings.push('Edge label is very long, consider shortening it');
  }

  // 验证动画标志
  if (edgeData.animated !== undefined && typeof edgeData.animated !== 'boolean') {
    errors.push('Edge animated flag must be a boolean');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证连接的有效性
 * @param sourceId 源节点ID
 * @param targetId 目标节点ID
 * @param sourceType 源节点类型
 * @param targetType 目标节点类型
 * @returns 验证结果
 */
export function validateConnection(
  sourceId: string,
  targetId: string,
  sourceType: string,
  targetType: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 检查自连接
  if (sourceId === targetId) {
    errors.push('Cannot connect node to itself');
    return { isValid: false, errors, warnings };
  }

  // 检查空值
  if (!sourceId || !targetId) {
    errors.push('Source and target node IDs are required');
  }

  if (!sourceType || !targetType) {
    errors.push('Source and target types are required');
  }

  // 检查类型兼容性（基础检查）
  const compatibleTypes = isValidConnectionType(sourceType, targetType);
  if (!compatibleTypes) {
    errors.push(`Incompatible types: ${sourceType} -> ${targetType}`);
  } else {
    warnings.push(`Connection types: ${sourceType} -> ${targetType}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 检查连接类型是否有效
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

/**
 * 验证图的完整性
 * @param nodes 节点数组
 * @param edges 边数组
 * @returns 验证结果
 */
export function validateGraph(
  nodes: any[],
  edges: any[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeIds = new Set(nodes.map(n => n.id));
  const edgeIds = new Set(edges.map(e => e.id));

  // 检查重复节点ID
  if (nodeIds.size !== nodes.length) {
    errors.push('Duplicate node IDs detected');
  }

  // 检查重复边ID
  if (edgeIds.size !== edges.length) {
    errors.push('Duplicate edge IDs detected');
  }

  // 检查边的引用完整性
  edges.forEach(edge => {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge references non-existent source node: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge references non-existent target node: ${edge.target}`);
    }
  });

  // 检查孤立节点
  const connectedNodeIds = new Set<string>();
  edges.forEach(edge => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  const isolatedNodes = nodes.filter(n => !connectedNodeIds.has(n.id));
  if (isolatedNodes.length > 0 && nodes.length > 1) {
    warnings.push(`Found ${isolatedNodes.length} isolated node(s): ${isolatedNodes.map(n => n.id).join(', ')}`);
  }

  // 检查组节点的子节点
  const groupNodes = nodes.filter(n => n.type === 'groupNode');
  groupNodes.forEach(groupNode => {
    if (groupNode.data?.childNodeIds) {
      groupNode.data.childNodeIds.forEach((childId: string) => {
        if (!nodeIds.has(childId)) {
          errors.push(`Group node ${groupNode.id} references non-existent child node: ${childId}`);
        }
      });

      // 检查组的子节点数量限制
      if (groupNode.data.childNodeIds.length > VALIDATION.MAX_NODES_PER_GROUP) {
        errors.push(`Group node ${groupNode.id} has too many child nodes (max ${VALIDATION.MAX_NODES_PER_GROUP})`);
      }
    }
  });

  // 检查每个节点的连接数量限制
  const connectionCounts = new Map<string, { incoming: number; outgoing: number }>();
  nodes.forEach(node => {
    connectionCounts.set(node.id, { incoming: 0, outgoing: 0 });
  });

  edges.forEach(edge => {
    const sourceCount = connectionCounts.get(edge.source)!;
    const targetCount = connectionCounts.get(edge.target)!;
    sourceCount.outgoing++;
    targetCount.incoming++;
  });

  connectionCounts.forEach((count, nodeId) => {
    if (count.incoming > VALIDATION.MAX_CONNECTIONS_PER_NODE) {
      warnings.push(`Node ${nodeId} has ${count.incoming} incoming connections (max recommended: ${VALIDATION.MAX_CONNECTIONS_PER_NODE})`);
    }
    if (count.outgoing > VALIDATION.MAX_CONNECTIONS_PER_NODE) {
      warnings.push(`Node ${nodeId} has ${count.outgoing} outgoing connections (max recommended: ${VALIDATION.MAX_CONNECTIONS_PER_NODE})`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证文件类型
 * @param filename 文件名
 * @param allowedTypes 允许的文件类型
 * @returns 验证结果
 */
export function validateFileType(
  filename: string,
  allowedTypes: string[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!filename || typeof filename !== 'string') {
    errors.push('Filename is required and must be a string');
    return { isValid: false, errors, warnings };
  }

  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension) {
    errors.push('Filename must have a valid extension');
    return { isValid: false, errors, warnings };
  }

  if (!allowedTypes.includes(extension)) {
    errors.push(`File type .${extension} is not allowed. Allowed types: ${allowedTypes.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证邮箱地址
 * @param email 邮箱地址
 * @returns 验证结果
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!email || typeof email !== 'string') {
    errors.push('Email is required and must be a string');
    return { isValid: false, errors, warnings };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push('Invalid email format');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证URL
 * @param url URL字符串
 * @returns 验证结果
 */
export function validateURL(url: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!url || typeof url !== 'string') {
    errors.push('URL is required and must be a string');
    return { isValid: false, errors, warnings };
  }

  try {
    new URL(url);
  } catch {
    errors.push('Invalid URL format');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证JSON字符串
 * @param jsonString JSON字符串
 * @returns 验证结果和解析后的对象
 */
export function validateJSON(jsonString: string): {
  isValid: boolean;
  errors: string[];
  parsed?: any;
} {
  const errors: string[] = [];

  if (!jsonString || typeof jsonString !== 'string') {
    errors.push('JSON string is required and must be a string');
    return { isValid: false, errors };
  }

  try {
    const parsed = JSON.parse(jsonString);
    return { isValid: true, errors: [], parsed };
  } catch (error) {
    errors.push(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { isValid: false, errors };
  }
}

/**
 * 验证字符串长度
 * @param value 字符串值
 * @param minLength 最小长度
 * @param maxLength 最大长度
 * @param fieldName 字段名
 * @returns 验证结果
 */
export function validateStringLength(
  value: string,
  minLength: number,
  maxLength: number,
  fieldName: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof value !== 'string') {
    errors.push(`${fieldName} must be a string`);
    return { isValid: false, errors, warnings };
  }

  if (value.length < minLength) {
    errors.push(`${fieldName} must be at least ${minLength} characters long`);
  }

  if (value.length > maxLength) {
    errors.push(`${fieldName} must be no more than ${maxLength} characters long`);
  }

  if (value.length === 0 && minLength > 0) {
    errors.push(`${fieldName} cannot be empty`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * 验证数字范围
 * @param value 数字值
 * @param min 最小值
 * @param max 最大值
 * @param fieldName 字段名
 * @returns 验证结果
 */
export function validateNumberRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof value !== 'number' || isNaN(value)) {
    errors.push(`${fieldName} must be a valid number`);
    return { isValid: false, errors, warnings };
  }

  if (value < min) {
    errors.push(`${fieldName} must be at least ${min}`);
  }

  if (value > max) {
    errors.push(`${fieldName} must be no more than ${max}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}