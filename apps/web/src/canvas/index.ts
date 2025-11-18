/**
 * Canvas 模块统一导出
 * 参考雅虎军规：统一入口，便于模块管理
 */

// 工具函数
export * from './utils';

// 共享组件
export { NodeBase } from './components/shared/NodeBase/NodeBase';
export { NodeHeader } from './components/shared/NodeBase/NodeHeader';
export { NodeContent } from './components/shared/NodeBase/NodeContent';
export { NodeHandles } from './components/shared/NodeBase/NodeHandles';
export type {
  NodeBaseProps,
  NodeData,
  NodeHeaderProps,
  NodeContentProps,
  NodeHandlesProps,
  NodeStatusIndicatorProps,
  NodeConfigModalProps,
} from './components/shared/NodeBase/NodeBase.types';

export { BaseModal } from './components/shared/Modal/BaseModal';
export { NodeConfigModal } from './components/shared/Modal/NodeConfigModal';

// 节点组件
export { default as TaskNode } from './nodes/TaskNode';
export { TaskNodeRefactored } from './nodes/TaskNode.refactored';
export { default as GroupNode } from './nodes/GroupNode';
export { default as IONode } from './nodes/IONode';

// 边组件
export { default as TypedEdge } from './edges/TypedEdge';
export { default as OrthTypedEdge } from './edges/OrthTypedEdge';

// 状态管理
export { useRFStore } from './store';
export { useInsertMenuStore } from './insertMenuStore';

// 主要组件
export { default as Canvas } from './Canvas';