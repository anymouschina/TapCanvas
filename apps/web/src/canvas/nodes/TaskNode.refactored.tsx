/**
 * 重构后的任务节点组件
 * 参考雅虎军规：组件职责单一，逻辑分离，可复用性高
 */

import React from 'react';
import type { NodeProps } from 'reactflow';
import { NodeBase } from '../components/shared/NodeBase/NodeBase';
import { NodeToolbar } from 'reactflow';
import { useRFStore } from '../store';
import { createNode, getNodeInputTypes, getNodeOutputTypes } from '../utils';
import { $, $t } from '../i18n';
import type { NodeData } from '../components/shared/NodeBase/NodeBase.types';

// 工具按钮组件
const NodeToolbarButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, onClick, disabled = false }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '6px 10px',
      fontSize: '12px',
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      color: disabled ? '#9ca3af' : '#374151',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'all 0.2s ease',
    }}
    title={label}
  >
    {icon}
    <span>{label}</span>
  </button>
);

// 节点配置组件
const TaskNodeConfig: React.FC<{
  nodeData: NodeData;
  onConfigChange: (config: Record<string, any>) => void;
}> = ({ nodeData, onConfigChange }) => {
  const handleConfigChange = React.useCallback((key: string, value: any) => {
    onConfigChange({ [key]: value });
  }, [onConfigChange]);

  // 根据节点种类渲染不同的配置界面
  const renderConfigFields = () => {
    const { kind } = nodeData;

    switch (kind) {
      case 'text':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                Prompt
              </label>
              <textarea
                value={nodeData.config?.prompt || ''}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
                placeholder="Enter your prompt here..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '12px',
                  resize: 'vertical',
                  minHeight: '60px',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  Temperature
                </label>
                <input
                  type="number"
                  value={nodeData.config?.temperature || 0.7}
                  onChange={(e) => handleConfigChange('temperature', parseFloat(e.target.value))}
                  min="0"
                  max="2"
                  step="0.1"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  Max Length
                </label>
                <input
                  type="number"
                  value={nodeData.config?.maxLength || 1000}
                  onChange={(e) => handleConfigChange('maxLength', parseInt(e.target.value))}
                  min="1"
                  max="4000"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                />
              </div>
            </div>
          </div>
        );

      case 'image':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                Prompt
              </label>
              <textarea
                value={nodeData.config?.prompt || ''}
                onChange={(e) => handleConfigChange('prompt', e.target.value)}
                placeholder="Describe the image you want to generate..."
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '12px',
                  resize: 'vertical',
                  minHeight: '60px',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                Model
              </label>
              <select
                value={nodeData.config?.model || 'qwen-image-plus'}
                onChange={(e) => handleConfigChange('model', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <option value="qwen-image-plus">Qwen Image Plus</option>
                <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  Size
                </label>
                <select
                  value={nodeData.config?.size || '1024x1024'}
                  onChange={(e) => handleConfigChange('size', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                >
                  <option value="256x256">256x256</option>
                  <option value="512x512">512x512</option>
                  <option value="1024x1024">1024x1024</option>
                </select>
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  Quality
                </label>
                <select
                  value={nodeData.config?.quality || 'standard'}
                  onChange={(e) => handleConfigChange('quality', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                >
                  <option value="standard">Standard</option>
                  <option value="hd">HD</option>
                </select>
              </div>
            </div>
          </div>
        );

      case 'video':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  Duration (s)
                </label>
                <input
                  type="number"
                  value={nodeData.config?.duration || 10}
                  onChange={(e) => handleConfigChange('duration', parseInt(e.target.value))}
                  min="1"
                  max="300"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                  FPS
                </label>
                <select
                  value={nodeData.config?.fps || 30}
                  onChange={(e) => handleConfigChange('fps', parseInt(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                >
                  <option value="24">24</option>
                  <option value="30">30</option>
                  <option value="60">60</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>
                Resolution
              </label>
              <select
                value={nodeData.config?.resolution || '1080p'}
                onChange={(e) => handleConfigChange('resolution', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
                <option value="4k">4K</option>
              </select>
            </div>
          </div>
        );

      default:
        return (
          <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '12px' }}>
            No configuration available for this node type
          </div>
        );
    }
  };

  return (
    <div style={{ padding: '8px', backgroundColor: '#f9fafb', borderRadius: '4px' }}>
      {renderConfigFields()}
    </div>
  );
};

/**
 * 重构后的任务节点组件
 */
export const TaskNodeRefactored: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const {
    updateNode,
    deleteNodes,
    duplicateNodes,
    runNode,
    copyNodeConfig,
    pasteNodeConfig,
  } = useRFStore();

  const [showConfig, setShowConfig] = React.useState(false);

  // 节点操作处理函数
  const handleSelect = React.useCallback(() => {
    updateNode(id, { selected: !selected });
  }, [id, selected, updateNode]);

  const handleDelete = React.useCallback(() => {
    deleteNodes([id]);
  }, [id, deleteNodes]);

  const handleDuplicate = React.useCallback(() => {
    duplicateNodes([id]);
  }, [id, duplicateNodes]);

  const handleRun = React.useCallback(() => {
    runNode(id);
  }, [id, runNode]);

  const handleCopyConfig = React.useCallback(() => {
    copyNodeConfig(id);
  }, [id, copyNodeConfig]);

  const handlePasteConfig = React.useCallback(() => {
    pasteNodeConfig(id);
  }, [id, pasteNodeConfig]);

  const handleConfig = React.useCallback((nodeId: string, config: Record<string, any>) => {
    updateNode(nodeId, { config });
  }, [updateNode]);

  const handleContextMenu = React.useCallback((event: React.MouseEvent, nodeId: string) => {
    event.preventDefault();
    // 这里可以显示自定义右键菜单
  }, []);

  const handleDoubleClick = React.useCallback((nodeId: string) => {
    setShowConfig(!showConfig);
  }, [showConfig]);

  // 计算输入输出类型
  const inputTypes = React.useMemo(() => getNodeInputTypes({ id, data, type: 'taskNode', position: { x: 0, y: 0 } } as any), [data, id]);
  const outputTypes = React.useMemo(() => getNodeOutputTypes({ id, data, type: 'taskNode', position: { x: 0, y: 0 } } as any), [data, id]);

  // 自定义内容
  const nodeContent = showConfig ? (
    <TaskNodeConfig
      nodeData={data}
      onConfigChange={(config) => handleConfig(id, config)}
    />
  ) : null;

  return (
    <>
      <NodeBase
        data={{
          ...data,
          inputs: inputTypes,
          outputs: outputTypes,
        }}
        selected={selected}
        dragging={false}
        position={{ x: 0, y: 0 }}
        id={id}
        type="taskNode"
        onSelect={handleSelect}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        onRun={handleRun}
        onConfig={(nodeId, config) => handleConfig(nodeId, config)}
      >
        {nodeContent}
      </NodeBase>

      {/* 节点工具栏 */}
      <NodeToolbar
        position={Position.Top}
        isVisible={selected}
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          padding: '4px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          gap: '4px',
        }}
      >
        <NodeToolbarButton
          icon={<span>⚙️</span>}
          label={$('配置')}
          onClick={() => setShowConfig(!showConfig)}
        />

        <NodeToolbarButton
          icon={<span>▶️</span>}
          label={$('运行')}
          onClick={handleRun}
          disabled={data.status === 'running'}
        />

        <NodeToolbarButton
          icon={<span>📋</span>}
          label={$('复制配置')}
          onClick={handleCopyConfig}
        />

        <NodeToolbarButton
          icon={<span>📄</span>}
          label={$('粘贴配置')}
          onClick={handlePasteConfig}
        />

        <NodeToolbarButton
          icon={<span>📋</span>}
          label={$('复制')}
          onClick={handleDuplicate}
        />

        <NodeToolbarButton
          icon={<span>🗑️</span>}
          label={$('删除')}
          onClick={handleDelete}
        />
      </NodeToolbar>
    </>
  );
};

// 性能优化
export default React.memo(TaskNodeRefactored);