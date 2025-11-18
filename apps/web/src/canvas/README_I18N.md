# Canvas 国际化使用指南

## 🌐 语言切换功能

Canvas模块现在支持中英文切换！默认显示中文，可以一键切换到英文。

### 🎯 如何使用语言切换

#### 1. 添加语言切换组件

在您的组件中导入并添加语言切换器：

```typescript
import { LanguageSwitcher } from '@/canvas';

function MyComponent() {
  return (
    <div>
      {/* 在右上角添加语言切换 */}
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <LanguageSwitcher />
      </div>

      <h1>我的画布</h1>
    </div>
  );
}
```

#### 2. 手动控制语言

```typescript
import { $, $t, useI18n, setLanguage } from '@/canvas';

function LanguageControl() {
  const { currentLanguage, isZh, isEn } = useI18n();

  const switchToEnglish = () => setLanguage('en');
  const switchToChinese = () => setLanguage('zh');

  return (
    <div>
      <p>当前语言: {currentLanguage}</p>
      <button onClick={switchToEnglish}>Switch to English</button>
      <button onClick={switchToChinese}>切换到中文</button>
    </div>
  );
}
```

#### 3. 在组件中使用翻译

```typescript
import { $, $t } from '@/canvas';

function MyComponent() {
  return (
    <div>
      <button>{$('确定')}</button>  {/* 中文: "确定", 英文: "OK" */}
      <button>{$('运行')}</button>  {/* 中文: "运行", 英文: "Run" */}

      {/* 带参数的翻译 */}
      <p>{$t('共 {{count}} 个节点', { count: 10 })}</p>
      {/* 中文: "共 10 个节点", 英文: "10 Nodes" */}
    </div>
  );
}
```

### 🎨 语言切换器样式

语言切换器会显示为：**🌐 中文 | EN**

- 点击"中文"切换到中文模式
- 点击"EN"切换到英文模式
- 当前激活的语言会高亮显示

### 📁 支持的翻译内容

#### 通用词汇
- ✅ 确定、取消、保存、删除、编辑、复制、粘贴
- ✅ 运行、停止、配置、重试、加载中、成功、失败
- ✅ 设置、帮助、关于、版本、作者、描述

#### 节点相关
- ✅ 文本节点、图像节点、视频节点、音频节点
- ✅ 节点状态：空闲、排队中、运行中、已完成、错误
- ✅ 节点操作：添加、配置、执行、复制、删除、分组

#### 画布功能
- ✅ 画布、缩放、放大、缩小、适应屏幕、网格
- ✅ 布局：自动布局、网格布局、层级布局、径向布局
- ✅ 对齐：左对齐、居中对齐、右对齐、顶部对齐、底部对齐

#### 错误和成功信息
- ✅ 网络错误、节点未找到、连接失败
- ✅ 已保存、已加载、已导入、已导出、节点已创建

### 🔧 集成到现有组件

#### 在工具栏添加
```typescript
function Toolbar() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div>
        <button>新建</button>
        <button>打开</button>
        <button>保存</button>
      </div>

      <LanguageSwitcher /> {/* 添加到工具栏右侧 */}
    </div>
  );
}
```

#### 在状态栏添加
```typescript
function StatusBar() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span>节点: 10 | 边: 8 | 状态: 空闲</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>🌐 {currentLanguage === 'zh' ? '中文' : 'EN'}</span>
        <LanguageSwitcher />
      </div>
    </div>
  );
}
```

### 🚀 快速开始

1. **导入语言切换器**
   ```typescript
   import { LanguageSwitcher } from '@/canvas';
   ```

2. **添加到组件中**
   ```typescript
   <LanguageSwitcher />
   ```

3. **使用翻译函数**
   ```typescript
   import { $, $t } from '@/canvas';

   const buttonText = $('确定');  // 自动翻译
   const message = $t('共 {{count}} 项', { count: 5 });  // 带参数
   ```

### 🎯 完整示例

```typescript
import React from 'react';
import { $, $t, useI18n, LanguageSwitcher } from '@/canvas';

function MyCanvas() {
  const { currentLanguage } = useI18n();

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {/* 语言切换器 - 在右上角 */}
      <LanguageSwitcher />

      {/* 顶部工具栏 */}
      <div style={{ padding: 16, borderBottom: '1px solid #ccc' }}>
        <button>{$('新建')}</button>
        <button>{$('保存')}</button>
        <button>{$('运行')}</button>
      </div>

      {/* 主内容区 */}
      <div style={{ padding: 20 }}>
        <h1>{$('我的画布')}</h1>
        <p>{$('拖拽节点到这里开始创作')}</p>

        <p>
          {$t('当前有 {{count}} 个节点', { count: 5 })}
        </p>

        <button style={{
          padding: '12px 24px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: 4
        }}>
          {$('添加节点')}
        </button>
      </div>

      {/* 底部状态 */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px 16px',
        backgroundColor: '#f5f5f5',
        borderTop: '1px solid #ccc',
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 12
      }}>
        <span>节点: 5 | 状态: {$('空闲')}</span>
        <span>🌐 {currentLanguage === 'zh' ? '中文' : 'EN'}</span>
      </div>
    </div>
  );
}
```

### 💡 使用提示

1. **自动保存**：语言选择会自动保存到浏览器本地存储
2. **智能检测**：首次访问时会根据浏览器语言自动选择
3. **回退机制**：如果没有英文翻译，会自动显示中文
4. **性能优化**：翻译函数非常轻量，不影响性能
5. **易于扩展**：需要新语言时只需添加翻译包

现在您的Canvas应用已经完全支持中英文切换了！🎉