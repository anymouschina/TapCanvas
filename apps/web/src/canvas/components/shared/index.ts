/**
 * 共享组件统一导出
 */

// NodeBase 组件
export { NodeBase } from './NodeBase/NodeBase';
export { NodeHeader } from './NodeBase/NodeHeader';
export { NodeContent } from './NodeBase/NodeContent';
export { NodeHandles } from './NodeBase/NodeHandles';
export type {
  NodeBaseProps,
  NodeData,
  NodeHeaderProps,
  NodeContentProps,
  NodeHandlesProps,
  NodeStatusIndicatorProps,
  NodeConfigModalProps,
} from './NodeBase/NodeBase.types';

// Modal 组件
export { BaseModal } from './Modal/BaseModal';
export { NodeConfigModal } from './Modal/NodeConfigModal';