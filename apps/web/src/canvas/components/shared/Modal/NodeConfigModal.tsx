/**
 * 节点配置模态框组件
 * 参考雅虎军规：配置逻辑封装，表单验证，用户体验优化
 */

import React from 'react';
import { BaseModal } from './BaseModal';
import { getNodeDefaultConfig, getNodeInputTypes, getNodeOutputTypes } from '../../../utils';
import type { NodeData } from '../NodeBase/NodeBase.types';

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
  /** 是否显示高级选项 */
  showAdvanced?: boolean;
  /** 自定义样式类 */
  className?: string;
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'checkbox' | 'file';
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  placeholder?: string;
  description?: string;
  validation?: (value: any) => string | null;
}

/**
 * 节点配置模态框组件
 * 提供通用的节点配置界面
 */
export const NodeConfigModal: React.FC<NodeConfigModalProps> = ({
  open,
  nodeData,
  configTemplate,
  onConfirm,
  onCancel,
  title = 'Node Configuration',
  showAdvanced = false,
  className = '',
}) => {
  const [config, setConfig] = React.useState<Record<string, any>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [showAdvancedOptions, setShowAdvancedOptions] = React.useState(false);

  // 初始化配置
  React.useEffect(() => {
    if (open) {
      const defaultConfig = getNodeDefaultConfig(nodeData.kind);
      const initialConfig = {
        ...defaultConfig,
        ...nodeData.config,
        ...configTemplate,
      };
      setConfig(initialConfig);
      setErrors({});
      setShowAdvancedOptions(showAdvanced);
    }
  }, [open, nodeData.kind, nodeData.config, configTemplate, showAdvanced]);

  // 获取配置字段定义
  const getConfigFields = React.useCallback((): ConfigField[] => {
    const baseFields: ConfigField[] = [
      {
        key: 'label',
        label: 'Label',
        type: 'text',
        required: true,
        placeholder: 'Enter node label',
        description: 'A descriptive name for this node',
      },
      {
        key: 'description',
        label: 'Description',
        type: 'textarea',
        rows: 3,
        placeholder: 'Enter description (optional)',
      },
    ];

    // 根据节点类型添加特定字段
    const kindSpecificFields: ConfigField[] = [];

    switch (nodeData.kind) {
      case 'text':
        kindSpecificFields.push(
          {
            key: 'prompt',
            label: 'Prompt',
            type: 'textarea',
            required: true,
            rows: 4,
            placeholder: 'Enter your prompt here',
          },
          {
            key: 'temperature',
            label: 'Temperature',
            type: 'number',
            min: 0,
            max: 2,
            step: 0.1,
            description: 'Controls randomness in output (0.0-2.0)',
          },
          {
            key: 'maxLength',
            label: 'Max Length',
            type: 'number',
            min: 1,
            max: 4000,
            description: 'Maximum number of tokens to generate',
          }
        );
        break;

      case 'image':
        kindSpecificFields.push(
          {
            key: 'prompt',
            label: 'Prompt',
            type: 'textarea',
            required: true,
            rows: 4,
            placeholder: 'Describe the image you want to generate',
          },
          {
            key: 'size',
            label: 'Size',
            type: 'select',
            options: ['256x256', '512x512', '1024x1024'],
          },
          {
            key: 'quality',
            label: 'Quality',
            type: 'select',
            options: ['standard', 'hd'],
          }
        );
        break;

      case 'video':
        kindSpecificFields.push(
          {
            key: 'duration',
            label: 'Duration (seconds)',
            type: 'number',
            min: 1,
            max: 300,
            step: 1,
          },
          {
            key: 'fps',
            label: 'Frame Rate',
            type: 'select',
            options: ['24', '30', '60'],
          },
          {
            key: 'resolution',
            label: 'Resolution',
            type: 'select',
            options: ['720p', '1080p', '4k'],
          }
        );
        break;

      case 'audio':
        kindSpecificFields.push(
          {
            key: 'duration',
            label: 'Duration (seconds)',
            type: 'number',
            min: 1,
            max: 600,
          },
          {
            key: 'sampleRate',
            label: 'Sample Rate',
            type: 'select',
            options: ['22050', '44100', '48000'],
          }
        );
        break;

      default:
        // 为其他类型添加通用字段
        break;
    }

    // 高级选项
    const advancedFields: ConfigField[] = [
      {
        key: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        min: 1,
        max: 3600,
        description: 'Maximum execution time',
      },
      {
        key: 'retryCount',
        label: 'Retry Count',
        type: 'number',
        min: 0,
        max: 5,
        description: 'Number of retry attempts on failure',
      },
    ];

    return showAdvancedOptions
      ? [...baseFields, ...kindSpecificFields, ...advancedFields]
      : [...baseFields, ...kindSpecificFields];
  }, [nodeData.kind, showAdvancedOptions]);

  // 处理配置更新
  const handleConfigChange = React.useCallback((key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));

    // 清除该字段的错误
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  }, [errors]);

  // 验证配置
  const validateConfig = React.useCallback((configToValidate: Record<string, any>): boolean => {
    const fields = getConfigFields();
    const newErrors: Record<string, string> = {};

    fields.forEach(field => {
      const value = configToValidate[field.key];

      // 检查必填字段
      if (field.required && (value === undefined || value === null || value === '')) {
        newErrors[field.key] = `${field.label} is required`;
        return;
      }

      // 检查数值范围
      if (field.type === 'number' && value !== undefined && value !== null) {
        const numValue = Number(value);
        if (isNaN(numValue)) {
          newErrors[field.key] = `${field.label} must be a valid number`;
        } else {
          if (field.min !== undefined && numValue < field.min) {
            newErrors[field.key] = `${field.label} must be at least ${field.min}`;
          }
          if (field.max !== undefined && numValue > field.max) {
            newErrors[field.key] = `${field.label} must be at most ${field.max}`;
          }
        }
      }

      // 自定义验证
      if (field.validation && value !== undefined && value !== null) {
        const validationError = field.validation(value);
        if (validationError) {
          newErrors[field.key] = validationError;
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [getConfigFields]);

  // 处理确认
  const handleConfirm = React.useCallback(() => {
    if (validateConfig(config)) {
      onConfirm(config);
    }
  }, [config, validateConfig, onConfirm]);

  // 渲染表单字段
  const renderField = (field: ConfigField) => {
    const value = config[field.key] ?? '';
    const error = errors[field.key];

    const fieldStyle: React.CSSProperties = {
      marginBottom: '16px',
    };

    const labelStyle: React.CSSProperties = {
      display: 'block',
      fontSize: '14px',
      fontWeight: '500',
      color: '#374151',
      marginBottom: '6px',
    };

    const inputStyle: React.CSSProperties = {
      width: '100%',
      padding: '8px 12px',
      border: error ? '1px solid #ef4444' : '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      backgroundColor: '#ffffff',
      outline: 'none',
      transition: 'border-color 0.2s ease',
    };

    const errorStyle: React.CSSProperties = {
      fontSize: '12px',
      color: '#ef4444',
      marginTop: '4px',
    };

    const descriptionStyle: React.CSSProperties = {
      fontSize: '12px',
      color: '#6b7280',
      marginTop: '4px',
    };

    return (
      <div className="node-config-modal__field" key={field.key} style={fieldStyle}>
        <label className="node-config-modal__label" style={labelStyle}>
          {field.label}
          {field.required && <span className="node-config-modal__label-required" style={{ color: '#ef4444' }}> *</span>}
        </label>

        {field.type === 'text' && (
          <input
            className="node-config-modal__input"
            type="text"
            value={value}
            onChange={(e) => handleConfigChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            style={inputStyle}
          />
        )}

        {field.type === 'number' && (
          <input
            className="node-config-modal__input"
            type="number"
            value={value}
            onChange={(e) => handleConfigChange(field.key, Number(e.target.value))}
            min={field.min}
            max={field.max}
            step={field.step}
            style={inputStyle}
          />
        )}

        {field.type === 'select' && field.options && (
          <select
            className="node-config-modal__select"
            value={value}
            onChange={(e) => handleConfigChange(field.key, e.target.value)}
            style={inputStyle}
          >
            <option className="node-config-modal__option" value="">
              Select an option
            </option>
            {field.options.map(option => (
              <option className="node-config-modal__option" key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}

        {field.type === 'textarea' && (
          <textarea
            className="node-config-modal__textarea"
            value={value}
            onChange={(e) => handleConfigChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows || 4}
            style={{
              ...inputStyle,
              resize: 'vertical',
              minHeight: field.rows ? `${field.rows * 1.5}em` : '6em',
            }}
          />
        )}

        {field.type === 'checkbox' && (
          <label className="node-config-modal__checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              className="node-config-modal__checkbox-input"
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleConfigChange(field.key, e.target.checked)}
              style={{ margin: 0 }}
            />
            Enable
          </label>
        )}

        {field.description && (
          <div className="node-config-modal__description" style={descriptionStyle}>
            {field.description}
          </div>
        )}

        {error && (
          <div className="node-config-modal__error" style={errorStyle}>
            {error}
          </div>
        )}
      </div>
    );
  };

  return (
    <BaseModal
      open={open}
      title={title}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      confirmText="Save Configuration"
      cancelText="Cancel"
      className={className}
    >
      <div className="node-config-modal__content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 基本信息 */}
        <div className="node-config-modal__section">
          <div
            className="node-config-modal__section-title"
            style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            marginBottom: '12px',
          }}>
            Basic Information
          </div>

          <div className="node-config-modal__section-body">
            <div
              className="node-config-modal__section-meta"
              style={{
              fontSize: '12px',
              color: '#9ca3af',
              marginBottom: '16px',
            }}>
              Node Type: <strong className="node-config-modal__section-strong">{nodeData.kind}</strong> |
              ID: <code className="node-config-modal__section-code" style={{ backgroundColor: '#f3f4f6', padding: '2px 4px', borderRadius: '2px' }}>
                {nodeData.id}
              </code>
            </div>

            {getConfigFields().slice(0, 2).map(renderField)}
          </div>
        </div>

        {/* 配置选项 */}
        <div className="node-config-modal__section">
          <div
            className="node-config-modal__section-title"
            style={{
            fontSize: '12px',
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            marginBottom: '12px',
          }}>
            Configuration
          </div>

          <div className="node-config-modal__section-body">
            {getConfigFields().slice(2).map(renderField)}
          </div>
        </div>

        {/* 高级选项切换 */}
        {!showAdvanced && (
          <div className="node-config-modal__advanced-toggle" style={{ textAlign: 'center', paddingTop: '8px' }}>
            <button
              className="node-config-modal__advanced-toggle-button"
              type="button"
              onClick={() => setShowAdvancedOptions(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#3b82f6',
                fontSize: '14px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Show Advanced Options
            </button>
          </div>
        )}

        {/* 高级选项 */}
        {showAdvancedOptions && (
          <div className="node-config-modal__advanced">
            <div
              className="node-config-modal__advanced-title"
              style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#6b7280',
              textTransform: 'uppercase',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              Advanced Options
              <button
                className="node-config-modal__advanced-hide"
                type="button"
                onClick={() => setShowAdvancedOptions(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                Hide
              </button>
            </div>

            <div className="node-config-modal__advanced-body">
              {getConfigFields().slice(-2).map(renderField)}
            </div>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

// 性能优化
export default React.memo(NodeConfigModal);
