/**
 * 边组件统一导出
 */

// 边组件
export { default as TypedEdge } from './TypedEdge';
export { default as OrthTypedEdge } from './OrthTypedEdge';

// 边相关工具函数
export * from '../utils/edge';

// 边相关类型
export type { EdgeData } from '../utils/edge';