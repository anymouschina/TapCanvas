/**
 * 语言切换组件
 * 简单的国际化切换，默认中文，支持英文
 */

import React from 'react';
import { getCurrentLanguage, setLanguage, useI18n } from '../../i18n';

interface LanguageSwitcherProps {
  style?: React.CSSProperties;
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  style = {},
  className = ''
}) => {
  const { $ } = useI18n();
  const currentLang = getCurrentLanguage();

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    setLanguage(lang);
  };

  const switcherStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    backgroundColor: '#f3f4f6',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#374151',
    transition: 'all 0.2s ease',
    ...style,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#6b7280',
    transition: 'all 0.2s ease',
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  };

  return (
    <div className={`language-switcher ${className}`} style={switcherStyle}>
      <span className="language-switcher-icon" style={{ marginRight: '4px' }}>🌐</span>
      <button
        className="language-switcher-button"
        style={currentLang === 'zh' ? activeButtonStyle : buttonStyle}
        onClick={() => handleLanguageChange('zh')}
        title="简体中文"
      >
        中文
      </button>
      <span className="language-switcher-divider" style={{ color: '#9ca3af' }}>|</span>
      <button
        className="language-switcher-button"
        style={currentLang === 'en' ? activeButtonStyle : buttonStyle}
        onClick={() => handleLanguageChange('en')}
        title="English"
      >
        EN
      </button>
    </div>
  );
};

// 使用示例的Hook
export function useLanguageExample() {
  const { $, $t, currentLanguage } = useI18n();

  return {
    // 基础翻译
    greeting: $('你好'),
    goodbye: $('再见'),
    welcome: $('欢迎'),

    // 参数插值
    welcomeUser: $t('欢迎 {{name}}', { name: '张三' }),
    itemCount: $t('共 {{count}} 项', { count: 10 }),

    // 状态信息
    currentLanguage,
    isChinese: currentLanguage === 'zh',
    isEnglish: currentLanguage === 'en',
  };
}

export default React.memo(LanguageSwitcher);
