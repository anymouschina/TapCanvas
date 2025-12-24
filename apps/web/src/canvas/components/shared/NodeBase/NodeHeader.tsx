/**
 * 节点头部组件
 * 参考雅虎军规：组件职责单一，样式和行为分离
 */

import React from 'react';
import { getColorForType, createStatusIndicator } from '../../../utils';
import type { NodeHeaderProps } from './NodeBase.types';

/**
 * 节点头部组件
 * 显示节点标题、类型和状态指示器
 */
export const NodeHeader: React.FC<NodeHeaderProps> = ({
  data,
  selected,
  isGroup = false,
  nodeType,
  title,
  subtitle,
  showStatus = true,
  editable = false,
  onEdit,
  className = '',
}) => {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(data.label);

  React.useEffect(() => {
    setEditValue(data.label);
  }, [data.label]);

  const handleEdit = React.useCallback(() => {
    if (editable) {
      setIsEditing(true);
    }
  }, [editable]);

  const handleSave = React.useCallback(() => {
    if (onEdit) {
      onEdit(editValue);
    }
    setIsEditing(false);
  }, [editValue, onEdit]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSave();
    } else if (event.key === 'Escape') {
      setEditValue(data.label);
      setIsEditing(false);
    }
  }, [handleSave, data.label]);

  const displayTitle = title || data.label || 'Untitled';
  const displaySubtitle = subtitle || data.kind;

  // 头部样式
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid var(--canvas-node-header-border)`,
    backgroundColor: 'var(--canvas-node-header-bg)',
    borderTopLeftRadius: '10px',
    borderTopRightRadius: '10px',
    minHeight: '32px',
  };

  // 类型指示器样式
  const typeIndicatorStyle: React.CSSProperties = {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: getColorForType(data.outputs?.[0] || data.kind),
    marginRight: '8px',
    flexShrink: 0,
  };

  // 标题样式
  const titleStyle: React.CSSProperties = {
    flex: 1,
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--canvas-node-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: editable ? 'text' : 'default',
    border: isEditing ? '1px solid rgba(59, 130, 246, 0.6)' : 'none',
    padding: isEditing ? '2px 4px' : '0',
    borderRadius: isEditing ? '4px' : '0',
    outline: 'none',
    backgroundColor: isEditing ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
  };

  // 副标题样式
  const subtitleStyle: React.CSSProperties = {
    fontSize: '12px',
    color: 'var(--canvas-node-subtext)',
    marginLeft: '16px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  // 状态指示器容器
  const statusContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
    flexShrink: 0,
  };

  const headerClasses = [
    'node-header',
    selected ? 'node-header--selected' : '',
    isGroup ? 'node-header--group' : '',
    isEditing ? 'node-header--editing' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={headerClasses} style={headerStyle}>
      {/* 左侧：类型指示器和标题 */}
      <div className="node-header-main" style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
        {/* 类型指示器 */}
        <div className="node-header-type-indicator" style={typeIndicatorStyle} title={data.kind} />

        {/* 标题 */}
        {isEditing ? (
          <input
            className="node-header-title-input"
            style={titleStyle}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <div
            className="node-header-title"
            style={titleStyle}
            onClick={handleEdit}
            title={displayTitle}
          >
            {displayTitle}
          </div>
        )}
      </div>

      {/* 中间：副标题 */}
      {displaySubtitle && displaySubtitle !== displayTitle && (
        <div className="node-header-subtitle" style={subtitleStyle} title={displaySubtitle}>
          {displaySubtitle}
        </div>
      )}

      {/* 右侧：状态指示器 */}
      {showStatus && (
        <div className="node-header-status" style={statusContainerStyle}>
          {/* 进度条 */}
          {data.progress !== null && data.progress !== undefined && (
            <div
              className="node-header-progress-track"
              style={{
                ...createStatusIndicator(data.status, data.progress),
                width: '40px',
                height: '3px',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
              title={`Progress: ${data.progress}%`}
            >
              <div
                className="node-header-progress-fill"
                style={{
                  width: `${data.progress}%`,
                  height: '100%',
                  backgroundColor: getColorForType(data.outputs?.[0] || data.kind),
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}

          {/* 状态图标 */}
          {data.status && (
            <div
              className="node-header-status-dot"
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: getColorForType(data.status),
                flexShrink: 0,
              }}
              title={`Status: ${data.status}`}
            />
          )}
        </div>
      )}
    </div>
  );
};

// 性能优化
export default React.memo(NodeHeader);
