/**
 * 节点基础组件类型定义
 * 参考雅虎军规：类型定义独立文件，便于维护
 */

import type { Position } from '@xyflow/react';

export interface NodeBaseProps {
  /** 节点数据 */
  data: NodeData;
  /** 是否被选中 */
  selected: boolean;
  /** 是否处于拖拽状态 */
  dragging: boolean;
  /** 节点位置 */
  position: Position;
  /** 节点ID */
  id: string;
  /** 节点类型 */
  type: string;
  /** 子组件 */
  children?: React.ReactNode;
  /** 样式类名 */
  className?: string;
  /** 额外样式 */
  style?: React.CSSProperties;
  /** 事件处理器 */
  onSelect?: (nodeId: string) => void;
  onContextMenu?: (event: React.MouseEvent, nodeId: string) => void;
  onDoubleClick?: (nodeId: string) => void;
  onDragStart?: (nodeId: string) => void;
  onDragEnd?: (nodeId: string) => void;
}

export interface NodeData {
  /** 节点ID */
  id: string;
  /** 节点标签 */
  label: string;
  /** 节点种类 */
  kind: string;
  /** 节点配置 */
  config: Record<string, any>;
  /** 执行进度 */
  progress?: number | null;
  /** 执行状态 */
  status?: string | null;
  /** 输入类型 */
  inputs?: string[];
  /** 输出类型 */
  outputs?: string[];
  /** 参数 */
  parameters?: Record<string, any>;
  /** 是否为分组节点 */
  isGroup?: boolean;
  /** 分组ID */
  groupId?: string;
  /** 其他扩展数据 */
  [key: string]: any;
}

export interface NodeHeaderProps {
  /** 节点数据 */
  data: NodeData;
  /** 是否被选中 */
  selected: boolean;
  /** 是否为分组节点 */
  isGroup?: boolean;
  /** 节点类型 */
  nodeType: string;
  /** 标题 */
  title?: string;
  /** 子标题 */
  subtitle?: string;
  /** 是否显示状态指示器 */
  showStatus?: boolean;
  /** 是否可编辑 */
  editable?: boolean;
  /** 编辑回调 */
  onEdit?: (value: string) => void;
  /** 样式类名 */
  className?: string;
}

export interface NodeContentProps {
  /** 节点数据 */
  data: NodeData;
  /** 节点类型 */
  nodeType: string;
  /** 子组件 */
  children?: React.ReactNode;
  /** 是否显示配置按钮 */
  showConfigButton?: boolean;
  /** 是否显示运行按钮 */
  showRunButton?: boolean;
  /** 配置回调 */
  onConfig?: (nodeId: string, config: Record<string, any>) => void;
  /** 运行回调 */
  onRun?: (nodeId: string) => void;
  /** 样式类名 */
  className?: string;
}

export interface NodeHandlesProps {
  /** 节点ID */
  nodeId: string;
  /** 输入类型 */
  inputTypes?: string[];
  /** 输出类型 */
  outputTypes?: string[];
  /** 是否显示输入手柄 */
  showInputs?: boolean;
  /** 是否显示输出手柄 */
  showOutputs?: boolean;
  /** 手柄样式 */
  handleStyle?: React.CSSProperties;
  /** 连接验证函数 */
  isValidConnection?: (connection: any) => boolean;
  /** 样式类名 */
  className?: string;
}

export interface NodeStatusIndicatorProps {
  /** 状态 */
  status?: string | null;
  /** 进度 */
  progress?: number | null;
  /** 是否显示标签 */
  showLabel?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 样式类名 */
  className?: string;
}

export interface NodeConfigModalProps {
  /** 是否显示 */
  open: boolean;
  /** 节点数据 */
  nodeData: NodeData;
  /** 配置模板 */
  configTemplate?: Record<string, any>;
  /** 确认回调 */
  onConfirm: (config: Record<string, any>) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 标题 */
  title?: string;
  /** 样式类名 */
  className?: string;
}