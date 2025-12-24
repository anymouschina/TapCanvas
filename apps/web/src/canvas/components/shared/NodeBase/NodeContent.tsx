/**
 * 节点内容组件
 * 参考雅虎军规：组件职责单一，交互逻辑封装
 */

import React from 'react';
import { NodeConfigModal } from '../Modal/NodeConfigModal';
import { getNodeDisplayText } from '../../../utils';
import type { NodeContentProps } from './NodeBase.types';

/**
 * 节点内容组件
 * 显示节点的主要内容和操作按钮
 */
export const NodeContent: React.FC<NodeContentProps> = ({
  data,
  nodeType,
  children,
  showConfigButton = true,
  showRunButton = false,
  onConfig,
  onRun,
  className = '',
}) => {
  const [configModalOpen, setConfigModalOpen] = React.useState(false);
  const [isRunning, setIsRunning] = React.useState(false);

  // 打开配置模态框
  const handleConfigClick = React.useCallback(() => {
    setConfigModalOpen(true);
  }, []);

  // 关闭配置模态框
  const handleConfigClose = React.useCallback(() => {
    setConfigModalOpen(false);
  }, []);

  // 确认配置更改
  const handleConfigConfirm = React.useCallback((config: Record<string, any>) => {
    if (onConfig) {
      onConfig(data.id, config);
    }
    setConfigModalOpen(false);
  }, [data.id, onConfig]);

  // 运行节点
  const handleRunClick = React.useCallback(() => {
    if (isRunning) return;

    setIsRunning(true);
    if (onRun) {
      onRun(data.id);
    }

    // 模拟运行状态（实际应该从状态管理中获取）
    setTimeout(() => {
      setIsRunning(false);
    }, 3000);
  }, [data.id, isRunning, onRun]);

  // 内容区域样式
  const contentStyle: React.CSSProperties = {
    padding: '12px',
    minHeight: '40px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  // 操作按钮容器样式
  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: 'auto',
  };

  // 按钮样式
  const buttonStyle: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: '12px',
    borderRadius: '4px',
    border: '1px solid var(--canvas-node-action-border)',
    backgroundColor: 'var(--canvas-node-action-bg)',
    color: 'var(--canvas-node-action-text)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  };

  const buttonHoverStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'var(--canvas-node-action-hover-bg)',
    borderColor: 'var(--canvas-node-action-border)',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'var(--canvas-node-action-primary-bg)',
    borderColor: 'var(--canvas-node-action-primary-bg)',
    color: 'var(--canvas-node-action-primary-text)',
  };

  const primaryButtonHoverStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    backgroundColor: 'var(--canvas-node-action-primary-hover-bg)',
    borderColor: 'var(--canvas-node-action-primary-hover-bg)',
  };

  // 描述文本样式
  const descriptionStyle: React.CSSProperties = {
    fontSize: '12px',
    color: 'var(--canvas-node-subtext)',
    lineHeight: '1.4',
    margin: 0,
    flex: 1,
  };

  const contentClasses = [
    'node-content',
    data.status ? `node-content--${data.status}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className={contentClasses} style={contentStyle}>
        {/* 自定义内容 */}
        {children}

        {/* 默认描述内容 */}
        {!children && (
          <div className="node-content-body" style={{ flex: 1 }}>
            {/* 节点描述 */}
            <div className="node-content-description" style={descriptionStyle}>
              {data.config?.description ||
               getNodeDisplayText({ id: data.id, data, type: nodeType, position: { x: 0, y: 0 } } as any)}
            </div>

            {/* 配置信息 */}
            {data.config && Object.keys(data.config).length > 0 && (
              <div className="node-content-config" style={{
                fontSize: '11px',
                color: '#9ca3af',
                marginTop: '4px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px'
              }}>
                {Object.entries(data.config)
                  .filter(([_, value]) => value !== undefined && value !== null && value !== '')
                  .slice(0, 3)
                  .map(([key, value]) => (
                    <span
                      className="node-content-config-chip"
                      key={key}
                      style={{
                        backgroundColor: 'var(--canvas-node-chip-bg)',
                        padding: '2px 6px',
                        borderRadius: '2px',
                        fontSize: '10px',
                        color: 'var(--canvas-node-chip-text)',
                      }}
                      title={`${key}: ${value}`}
                    >
                      {typeof value === 'string' && value.length > 10
                        ? `${value.slice(0, 10)}...`
                        : String(value)}
                    </span>
                  ))}
              </div>
            )}

            {/* 运行状态信息 */}
            {isRunning && (
              <div className="node-content-running" style={{
                fontSize: '11px',
                color: 'var(--canvas-node-action-primary-bg)',
                marginTop: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <div className="node-content-running-dot" style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--canvas-node-action-primary-bg)',
                  animation: 'pulse 1.5s infinite',
                }} />
                Running...
              </div>
            )}

            {/* 进度信息 */}
            {data.progress !== null && data.progress !== undefined && data.progress > 0 && (
              <div className="node-content-progress" style={{
                fontSize: '11px',
                color: 'var(--canvas-node-action-muted-text)',
                marginTop: '4px',
              }}>
                Progress: {data.progress}%
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="node-content-actions" style={actionsStyle}>
          {/* 运行按钮 */}
          {showRunButton && nodeType === 'taskNode' && (
            <button
              className="node-content-run"
              style={isRunning ? buttonHoverStyle : primaryButtonStyle}
              onClick={handleRunClick}
              disabled={isRunning || data.status === 'running'}
              title={isRunning ? 'Running...' : 'Run Node'}
            >
              <span className="node-content-run-icon">{isRunning ? '⏸' : '▶'}</span>
              {isRunning ? 'Running' : 'Run'}
            </button>
          )}

          {/* 配置按钮 */}
          {showConfigButton && (
            <button
              className="node-content-config-action"
              style={buttonStyle}
              onClick={handleConfigClick}
              title="Configure Node"
            >
              <span className="node-content-config-icon">⚙</span>
              Config
            </button>
          )}
        </div>
      </div>

      {/* 配置模态框 */}
      {configModalOpen && (
        <NodeConfigModal
          className="node-content-config-modal"
          open={configModalOpen}
          nodeData={data}
          onConfirm={handleConfigConfirm}
          onCancel={handleConfigClose}
          title={`Configure ${getNodeDisplayText({ id: data.id, data, type: nodeType, position: { x: 0, y: 0 } } as any)}`}
        />
      )}

      {/* 样式定义 */}
      <style className="node-content-style" jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
};

// 性能优化
export default React.memo(NodeContent);
