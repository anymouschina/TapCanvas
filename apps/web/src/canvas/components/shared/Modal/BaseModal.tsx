/**
 * 基础模态框组件
 * 参考雅虎军规：组件职责单一，可访问性好，交互逻辑封装
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { $, $t } from '../../i18n';

export interface BaseModalProps {
  /** 是否显示 */
  open: boolean;
  /** 标题 */
  title?: string;
  /** 子组件 */
  children: React.ReactNode;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否显示确认按钮 */
  showConfirm?: boolean;
  /** 是否显示取消按钮 */
  showCancel?: boolean;
  /** 确认回调 */
  onConfirm?: () => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
  /** 确认按钮是否禁用 */
  confirmDisabled?: boolean;
  /** 是否加载中 */
  loading?: boolean;
  /** 模态框宽度 */
  width?: string | number;
  /** 模态框高度 */
  height?: string | number;
  /** 是否可点击遮罩关闭 */
  closeOnOverlayClick?: boolean;
  /** 是否可按ESC关闭 */
  closeOnEscape?: boolean;
  /** 自定义样式类 */
  className?: string;
  /** 遮罩样式类 */
  overlayClassName?: string;
}

/**
 * 基础模态框组件
 * 提供通用的模态框功能，支持键盘导航和可访问性
 */
export const BaseModal: React.FC<BaseModalProps> = ({
  open,
  title,
  children,
  confirmText = $('确定'),
  cancelText = $('取消'),
  showConfirm = true,
  showCancel = true,
  onConfirm,
  onCancel,
  onClose,
  confirmDisabled = false,
  loading = false,
  width = 'auto',
  height = 'auto',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className = '',
  overlayClassName = '',
}) => {
  const modalRef = React.useRef<HTMLDivElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  // 处理确认
  const handleConfirm = React.useCallback(() => {
    if (loading || confirmDisabled) return;
    onConfirm?.();
  }, [loading, confirmDisabled, onConfirm]);

  // 处理取消
  const handleCancel = React.useCallback(() => {
    if (loading) return;
    onCancel?.();
    onClose?.();
  }, [loading, onCancel, onClose]);

  // 处理遮罩点击
  const handleOverlayClick = React.useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget && closeOnOverlayClick) {
      handleCancel();
    }
  }, [closeOnOverlayClick, handleCancel]);

  // 键盘事件处理
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!open) return;

      switch (event.key) {
        case 'Escape':
          if (closeOnEscape) {
            event.preventDefault();
            handleCancel();
          }
          break;
        case 'Enter':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            handleConfirm();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEscape, handleConfirm, handleCancel]);

  // 焦点管理
  React.useEffect(() => {
    if (open && modalRef.current) {
      // 延迟设置焦点，确保DOM已更新
      setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 100);
    }

    // 禁用背景滚动
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // 如果模态框未打开，返回null
  if (!open) return null;

  // 创建模态框内容
  const modalContent = (
    <div
      className={`modal-overlay base-modal__overlay ${overlayClassName}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '20px',
      }}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-content"
    >
      <div
        ref={modalRef}
        className={`modal-content base-modal__content ${className}`}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        {(title || showCancel) && (
          <div
            className="base-modal__header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            {title && (
              <h2
                className="base-modal__title"
                id="modal-title"
                style={{
                  margin: 0,
                  fontSize: '18px',
                  fontWeight: '600',
                  color: '#111827',
                }}
              >
                {title}
              </h2>
            )}

            {showCancel && (
              <button
                className="base-modal__header-close"
                type="button"
                onClick={handleCancel}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#6b7280',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                }}
                title={$(cancelText)}
                aria-label={$(cancelText)}
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* 内容区域 */}
        <div
          id="modal-content"
          className="base-modal__body"
          style={{
            flex: 1,
            padding: '20px',
            overflow: 'auto',
            minHeight: '0',
          }}
        >
          {children}
        </div>

        {/* 底部操作按钮 */}
        {(showConfirm || showCancel) && (
          <div
            className="base-modal__footer"
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              padding: '16px 20px',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            {showCancel && (
              <button
                className="base-modal__footer-cancel"
                type="button"
                onClick={handleCancel}
                disabled={loading}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#6b7280',
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {$(cancelText)}
              </button>
            )}

            {showConfirm && (
              <button
                ref={confirmButtonRef}
                className="base-modal__footer-confirm"
                type="button"
                onClick={handleConfirm}
                disabled={loading || confirmDisabled}
                style={{
                  padding: '8px 16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#ffffff',
                  backgroundColor: loading || confirmDisabled ? '#9ca3af' : '#3b82f6',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading || confirmDisabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  minWidth: '80px',
                  justifyContent: 'center',
                }}
              >
                {loading && (
                  <div
                    className="base-modal__footer-spinner"
                    style={{
                      width: '12px',
                      height: '12px',
                      border: '2px solid #ffffff',
                      borderTop: '2px solid transparent',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                )}
                {$(confirmText)}
              </button>
            )}
          </div>
        )}

        {/* 加载动画样式 */}
        <style className="base-modal__style" jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .modal-content:focus-within {
            outline: 2px solid #3b82f6;
            outline-offset: 2px;
          }
        `}</style>
      </div>
    </div>
  );

  // 使用Portal渲染到body
  return ReactDOM.createPortal(modalContent, document.body);
};

// 性能优化
export default React.memo(BaseModal);
