/**
 * 节点基础组件
 * 参考雅虎军规：组件职责单一，可复用，props类型安全
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { NodeHeader } from './NodeHeader';
import { NodeContent } from './NodeContent';
import { NodeHandles } from './NodeHandles';
import { getNodeDisplayText } from '../../../utils';
import type { NodeBaseProps } from './NodeBase.types';

/**
 * 节点基础组件
 * 提供所有节点类型的基础结构和行为
 */
export const NodeBase: React.FC<NodeBaseProps> = ({
  data,
  selected,
  dragging,
  position,
  id,
  type,
  children,
  className = '',
  style = {},
  onSelect,
  onContextMenu,
  onDoubleClick,
  onDragStart,
  onDragEnd,
}) => {
  // 事件处理器
  const handleSelect = React.useCallback(() => {
    onSelect?.(id);
  }, [id, onSelect]);

  const handleContextMenu = React.useCallback((event: React.MouseEvent) => {
    onContextMenu?.(event, id);
  }, [id, onContextMenu]);

  const handleDoubleClick = React.useCallback(() => {
    onDoubleClick?.(id);
  }, [id, onDoubleClick]);

  // 节点样式
  const nodeStyle: React.CSSProperties = {
    border: selected
      ? '1px solid var(--canvas-node-border-selected)'
      : '1px solid var(--canvas-node-border)',
    borderRadius: '10px',
    backgroundColor: 'var(--canvas-node-bg)',
    boxShadow: selected
      ? '0 18px 38px rgba(0, 0, 0, 0.5)'
      : 'var(--canvas-node-shadow)',
    transition: 'all 0.2s ease',
    cursor: dragging ? 'grabbing' : 'grab',
    minWidth: '200px',
    minHeight: '80px',
    userSelect: 'none',
    ...style,
  };

  const nodeClasses = [
    'node-base',
    selected ? 'node-base--selected' : '',
    dragging ? 'node-base--dragging' : '',
    data.isGroup ? 'node-base--group' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={nodeClasses}
      style={nodeStyle}
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseDown={() => onDragStart?.(id)}
      onMouseUp={() => onDragEnd?.(id)}
    >
      {/* 节点手柄 */}
      <NodeHandles
        nodeId={id}
        inputTypes={data.inputs}
        outputTypes={data.outputs}
        showInputs={true}
        showOutputs={true}
      />

      {/* 节点头部 */}
      <NodeHeader
        data={data}
        selected={selected}
        isGroup={data.isGroup}
        nodeType={type}
        title={getNodeDisplayText({ id, data, type, position } as any)}
      />

      {/* 节点内容 */}
      <NodeContent
        data={data}
        nodeType={type}
        showConfigButton={true}
        showRunButton={type === 'taskNode'}
      />

      {/* 子组件（用于自定义内容） */}
      {children && (
        <div className="node-base__children">
          {children}
        </div>
      )}
    </div>
  );
};

// 性能优化：使用React.memo防止不必要的重渲染
export default React.memo(NodeBase);
