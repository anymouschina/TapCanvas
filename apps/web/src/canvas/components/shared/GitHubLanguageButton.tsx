/**
 * GitHub风格的语言切换按钮
 * 仿照GitHub的样式，放置在右上角
 */

import React, { useState } from 'react';
import { getCurrentLanguage, setLanguage, useI18n } from '../../i18n';

interface GitHubLanguageButtonProps {
  style?: React.CSSProperties;
  className?: string;
}

export const GitHubLanguageButton: React.FC<GitHubLanguageButtonProps> = ({
  style = {},
  className = ''
}) => {
  const { currentLanguage, isZh, isEn } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const handleLanguageChange = (lang: 'zh' | 'en') => {
    setLanguage(lang);
    setIsOpen(false);
  };

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#24292f',
    backgroundColor: '#f6f8fa',
    border: '1px solid #d0d7de',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textDecoration: 'none',
    userSelect: 'none',
    position: 'relative',
    ...style,
  };

  const hoverStyle: React.CSSProperties = {
    backgroundColor: '#f3f4f6',
    borderColor: '#c7cdd4',
  };

  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className={`github-language-button ${className}`} style={{ position: 'relative', display: 'inline-block' }}>
      {/* 主按钮 */}
      <button
        className="github-language-button__trigger"
        style={{
          ...buttonStyle,
          ...(isHovered ? hoverStyle : {}),
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span className="github-language-button__icon" style={{ fontSize: '14px' }}>🌐</span>
        <span className="github-language-button__label">{isZh ? '中文' : 'EN'}</span>
        <svg
          className="github-language-button__caret"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{
            transition: 'transform 0.15s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <path className="github-language-button__caret-path" d="M6 9L2 5l4-4 4 4-4 4z" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <div
            className="github-language-button__overlay"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999,
            }}
            onClick={() => setIsOpen(false)}
          />

          {/* 菜单内容 */}
          <div
            className="github-language-button__menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              minWidth: '140px',
              backgroundColor: '#ffffff',
              border: '1px solid #d0d7de',
              borderRadius: '6px',
              boxShadow: '0 8px 24px rgba(140, 149, 159, 0.2)',
              zIndex: 1000,
              overflow: 'hidden',
            }}
          >
            <button
              className="github-language-button__menu-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: isZh ? '#0969da' : 'transparent',
                color: isZh ? '#ffffff' : '#24292f',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 0.15s ease',
              }}
              onClick={() => handleLanguageChange('zh')}
            >
              <span className="github-language-button__menu-flag">🇨🇳</span>
              <span className="github-language-button__menu-label">简体中文</span>
              {isZh && (
                <svg
                  className="github-language-button__menu-check"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  style={{ marginLeft: 'auto' }}
                >
                  <path className="github-language-button__menu-check-path" d="M9.5 3L4.5 8L2.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              )}
            </button>

            <div className="github-language-button__menu-divider" style={{ height: '1px', backgroundColor: '#d0d7de' }} />

            <button
              className="github-language-button__menu-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: isEn ? '#0969da' : 'transparent',
                color: isEn ? '#ffffff' : '#24292f',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background-color 0.15s ease',
              }}
              onClick={() => handleLanguageChange('en')}
            >
              <span className="github-language-button__menu-flag">🇺🇸</span>
              <span className="github-language-button__menu-label">English</span>
              {isEn && (
                <svg
                  className="github-language-button__menu-check"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  style={{ marginLeft: 'auto' }}
                >
                  <path className="github-language-button__menu-check-path" d="M9.5 3L4.5 8L2.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              )}
            </button>

            <div className="github-language-button__menu-divider" style={{ height: '1px', backgroundColor: '#d0d7de' }} />

            <div className="github-language-button__menu-footer" style={{
              padding: '8px 12px',
              fontSize: '11px',
              color: '#656d76',
              textAlign: 'center',
              backgroundColor: '#f6f8fa',
            }}>
              {currentLanguage === 'zh' ? '当前: 中文' : 'Current: English'}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// 简化版按钮（无下拉菜单）
export const SimpleGitHubLanguageButton: React.FC<
  Omit<GitHubLanguageButtonProps, 'className'>
> = ({ style = {} }) => {
  const { currentLanguage, setLanguage } = useI18n();
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    fontSize: '12px',
    fontWeight: '500',
    color: '#24292f',
    backgroundColor: '#f6f8fa',
    border: '1px solid #d0d7de',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textDecoration: 'none',
    userSelect: 'none',
    ...(isHovered ? {
      backgroundColor: '#f3f4f6',
      borderColor: '#c7cdd4',
    } : {}),
    ...style,
  };

  const toggleLanguage = () => {
    setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
  };

  return (
    <button
      className="github-language-button__simple"
      style={buttonStyle}
      onClick={toggleLanguage}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="github-language-button__simple-icon" style={{ fontSize: '13px' }}>🌐</span>
      <span className="github-language-button__simple-label">{currentLanguage === 'zh' ? '中文' : 'EN'}</span>
    </button>
  );
};

// 紧凑版按钮（更小）
export const CompactGitHubLanguageButton: React.FC<{
  style?: React.CSSProperties;
}> = ({ style = {} }) => {
  const { currentLanguage, setLanguage } = useI18n();

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    fontSize: '11px',
    fontWeight: '500',
    color: '#656d76',
    backgroundColor: 'transparent',
    border: '1px solid #d0d7de',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textDecoration: 'none',
    userSelect: 'none',
    ...style,
  };

  const toggleLanguage = () => {
    setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
  };

  return (
    <button
      className="github-language-button__compact"
      style={buttonStyle}
      onClick={toggleLanguage}
      title={currentLanguage === 'zh' ? '切换到英文' : 'Switch to Chinese'}
    >
      <span className="github-language-button__compact-label">{currentLanguage === 'zh' ? '中文' : 'EN'}</span>
    </button>
  );
};

// 固定在右上角的组件
export const FixedGitHubLanguageButton: React.FC = () => {
  return (
    <div
      className="github-language-button__fixed"
      style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 1000,
      }}
    >
      <GitHubLanguageButton />
    </div>
  );
};

export default React.memo(GitHubLanguageButton);
