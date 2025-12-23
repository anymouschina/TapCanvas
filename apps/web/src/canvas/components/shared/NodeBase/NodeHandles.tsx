/**
 * 节点手柄组件
 * 参考雅虎军规：组件职责单一，类型安全，可复用
 */

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { getEdgeColorForType, HANDLE_PREFIXES } from '../../../utils';
import type { NodeHandlesProps } from './NodeBase.types';

/**
 * 节点手柄组件
 * 提供输入输出连接点
 */
export const NodeHandles: React.FC<NodeHandlesProps> = ({
  nodeId,
  inputTypes = [],
  outputTypes = [],
  showInputs = true,
  showOutputs = true,
  handleStyle = {},
  isValidConnection,
  className = '',
}) => {
  // 默认手柄样式
  const defaultHandleStyle: React.CSSProperties = {
    width: '12px',
    height: '12px',
    border: '2px solid #ffffff',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.2s ease',
  };

  // 合并样式
  const finalHandleStyle = { ...defaultHandleStyle, ...handleStyle };

  // 生成手柄ID
  const generateHandleId = React.useCallback((
    type: 'input' | 'output',
    dataType: string,
    index: number = 0
  ): string => {
    const prefix = type === 'input' ? HANDLE_PREFIXES.INPUT : HANDLE_PREFIXES.OUTPUT;
    return `${prefix}${dataType}${index > 0 ? `-${index}` : ''}`;
  }, []);

  // 计算手柄位置
  const calculateHandlePosition = React.useCallback((
    index: number,
    total: number,
    isVertical: boolean = false
  ): React.CSSProperties => {
    if (total === 1) {
      return { top: '50%', transform: 'translate(-50%, -50%)' };
    }

    const spacing = 100 / (total + 1);
    const position = spacing * (index + 1);

    if (isVertical) {
      return {
        left: `${position}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    return {
      top: `${position}%`,
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }, []);

  // 获取手柄样式
  const getHandleStyle = React.useCallback((type: string): React.CSSProperties => {
    return {
      ...finalHandleStyle,
      backgroundColor: getEdgeColorForType(type),
    };
  }, [finalHandleStyle]);

  // 连接验证
  const handleValidation = React.useCallback((connection: any) => {
    if (!isValidConnection) return true;
    return isValidConnection(connection);
  }, [isValidConnection]);

  const handlesClassName = [
    'node-handles',
    showInputs && showOutputs ? 'node-handles--both' : '',
    showInputs ? 'node-handles--input' : '',
    showOutputs ? 'node-handles--output' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={handlesClassName}>
      {/* 输入手柄 */}
      {showInputs && inputTypes.map((inputType, index) => (
        <Handle
          key={`input-${index}`}
          id={generateHandleId('input', inputType, index)}
          type="target"
          position={Position.Left}
          style={{
            ...getHandleStyle(inputType),
            ...calculateHandlePosition(index, inputTypes.length),
          }}
          data-handle-type={inputType}
          isValidConnection={handleValidation}
          title={`Input: ${inputType}`}
        />
      ))}

      {/* 默认输入手柄（如果没有指定类型） */}
      {showInputs && inputTypes.length === 0 && (
        <Handle
          id={generateHandleId('input', 'any')}
          type="target"
          position={Position.Left}
          style={getHandleStyle('any')}
          data-handle-type="any"
          isValidConnection={handleValidation}
          title="Input"
        />
      )}

      {/* 输出手柄 */}
      {showOutputs && outputTypes.map((outputType, index) => (
        <Handle
          key={`output-${index}`}
          id={generateHandleId('output', outputType, index)}
          type="source"
          position={Position.Right}
          style={{
            ...getHandleStyle(outputType),
            ...calculateHandlePosition(index, outputTypes.length),
          }}
          data-handle-type={outputType}
          isValidConnection={handleValidation}
          title={`Output: ${outputType}`}
        />
      ))}

      {/* 默认输出手柄（如果没有指定类型） */}
      {showOutputs && outputTypes.length === 0 && (
        <Handle
          id={generateHandleId('output', 'any')}
          type="source"
          position={Position.Right}
          style={getHandleStyle('any')}
          data-handle-type="any"
          isValidConnection={handleValidation}
          title="Output"
        />
      )}

      {/* 顶部手柄（用于特殊情况） */}
      {showInputs && inputTypes.includes('top') && (
        <Handle
          id={generateHandleId('input', 'top')}
          type="target"
          position={Position.Top}
          style={getHandleStyle('top')}
          data-handle-type="top"
          isValidConnection={handleValidation}
          title="Top Input"
        />
      )}

      {/* 底部手柄（用于特殊情况） */}
      {showOutputs && outputTypes.includes('bottom') && (
        <Handle
          id={generateHandleId('output', 'bottom')}
          type="source"
          position={Position.Bottom}
          style={getHandleStyle('bottom')}
          data-handle-type="bottom"
          isValidConnection={handleValidation}
          title="Bottom Output"
        />
      )}

      {/* 连接提示（当没有手柄时显示） */}
      {!showInputs && !showOutputs && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '10px',
            color: '#9ca3af',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          No connections
        </div>
      )}

      {/* 样式定义 */}
      <style jsx>{`
        .node-handles:hover .react-flow__handle {
          transform: translate(-50%, -50%) scale(1.2);
        }

        .react-flow__handle.connecting {
          transform: translate(-50%, -50%) scale(1.3);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
        }

        .react-flow__handle.valid {
          border-color: #10b981;
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.3);
        }

        .react-flow__handle.invalid {
          border-color: #ef4444;
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.3);
        }
      `}</style>
    </div>
  );
};

// 性能优化
export default React.memo(NodeHandles);
