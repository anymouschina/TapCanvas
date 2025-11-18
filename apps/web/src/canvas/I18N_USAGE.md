# Canvas 国际化使用指南

## 概述

Canvas模块集成了简单的国际化系统，默认使用中文，提供英文翻译包。使用方式非常简洁：

```typescript
import { $, $t, useI18n, setLanguage } from '@/canvas/i18n';

// 基础翻译 - 源码写中文，自动翻译
const text = $('确定'); // 中文环境: "确定", 英文环境: "OK"

// 参数插值翻译
const message = $t('共 {{count}} 项', { count: 10 }); // 中文: "共 10 项", 英文: "10 Items"

// React Hook
const { $, $t, currentLanguage, setLanguage } = useI18n();
```

## 核心功能

### 1. 基础翻译函数 `$()`

```typescript
// 直接使用中文文本，系统自动翻译
$('确定')      // → "确定" | "OK"
$('运行')      // → "运行" | "Run"
$('删除')      // → "删除" | "Delete"
$('配置')      // → "配置" | "Configure"
```

### 2. 参数插值函数 `$t()`

```typescript
// 支持参数插值
$t('共 {{count}} 项', { count: 10 })
// 中文: "共 10 项"
// 英文: "10 Items"

$t('节点 {{name}} 执行成功', { name: 'TextNode' })
// 中文: "节点 TextNode 执行成功"
// 英文: "Node TextNode executed successfully"
```

### 3. React Hook `useI18n()`

```typescript
function MyComponent() {
  const { $, $t, currentLanguage, setLanguage, isZh, isEn } = useI18n();

  const handleClick = () => {
    // 切换语言
    setLanguage(isZh ? 'en' : 'zh');
  };

  return (
    <div>
      <button onClick={handleClick}>
        {isZh ? 'Switch to English' : '切换到中文'}
      </button>
      <p>{$('当前语言')}: {currentLanguage}</p>
      <p>{$t('共 {{count}} 个节点', { count: 5 })}</p>
    </div>
  );
}
```

### 4. 语言切换组件

```typescript
import { LanguageSwitcher } from '@/canvas/components/shared/LanguageSwitcher';

// 直接使用
<LanguageSwitcher />

// 自定义样式
<LanguageSwitcher
  style={{ backgroundColor: '#f0f0f0' }}
  className="my-language-switcher"
/>
```

## 支持的翻译内容

### 通用词汇
- 确定、取消、保存、删除、编辑、复制、粘贴
- 运行、停止、配置、重试、加载中、成功、失败、警告、信息
- 设置、帮助、关于、版本、作者、描述、名称、标题
- 类型、状态、进度、创建时间、修改时间、大小、时长

### 节点相关
- 文本节点、图像节点、视频节点、音频节点、字幕节点
- 节点状态：空闲、排队中、运行中、已完成、错误、已取消
- 节点操作：添加节点、配置节点、执行节点、复制节点、删除节点

### 节点配置
- 节点配置、基础配置、高级配置、参数、选项、验证
- 提示词、温度、最大长度、尺寸、质量、分辨率、帧率

### 画布相关
- 画布、空画布、缩放、放大、缩小、适应屏幕、网格
- 布局：自动布局、网格布局、层级布局、径向布局
- 对齐：左对齐、居中对齐、右对齐、顶部对齐、底部对齐

### 工具栏和操作
- 工具栏、添加、移除、修改、验证、运行选中、停止运行
- 复制配置、粘贴配置、分组、取消分组、聚焦

### 错误和成功信息
- 错误：未知错误、网络错误、节点未找到、连接失败
- 成功：已保存、已加载、已导入、已导出、节点已创建

## 在组件中使用

### 按钮和标签

```typescript
// ❌ 错误方式：硬编码文本
<button>Run</button>
<button>确定</button>

// ✅ 正确方式：使用国际化
<button>{$('运行')}</button>
<button>{$('确定')}</button>
```

### 模态框

```typescript
// BaseModal 会自动使用翻译文本
<BaseModal
  open={open}
  title={$('节点配置')}
  confirmText={$('保存')}
  cancelText={__('取消')}
>
  <div>{$('基础配置')}</div>
</BaseModal>
```

### 提示信息

```typescript
// 错误信息
const errorMessage = $(ERROR_MESSAGES.CONNECTION_FAILED);

// 带参数的消息
const successMessage = $t('节点 {{name}} 执行成功', { name: 'TextNode' });
```

### 工具提示

```typescript
<div title={$('配置节点')}>
  <span>⚙️</span>
</div>
```

## 语言设置

### 自动检测

系统会按以下优先级检测语言：
1. URL参数 `?locale=en`
2. 本地存储 `localStorage.getItem('tapcanvas-language')`
3. 浏览器语言 `navigator.language`

### 手动切换

```typescript
import { setLanguage } from '@/canvas/i18n';

// 切换到英文
setLanguage('en');

// 切换到中文
setLanguage('zh');
```

### 持久化

语言设置会自动保存到本地存储，下次访问时自动恢复。

## 添加新翻译

### 1. 添加中文文本

直接在源码中使用中文：

```typescript
const newMessage = $('新建画布');
```

### 2. 添加英文翻译

在 `i18n/index.ts` 的 `enTranslations` 对象中添加：

```typescript
const enTranslations = {
  // ... 现有翻译
  '新建画布': 'New Canvas',
};
```

### 3. 支持参数插值

```typescript
// 使用
$t('画布 "{{name}}" 已创建', { name: 'My Canvas' });

// 添加翻译
'画布 "{{name}}" 已创建': 'Canvas "{{name}}" created',
```

## 最佳实践

### 1. 统一使用 `$()` 和 `$t()`

```typescript
// ✅ 推荐
const title = $('节点配置');
const message = $t('共 {{count}} 个节点', { count: 5 });

// ❌ 不推荐
const title = 'Node Configuration'; // 硬编码英文
const title = '节点配置'; // 硬编码中文
```

### 2. 组件Props默认值

```typescript
interface Props {
  title?: string;
  confirmText?: string;
}

const MyComponent: React.FC<Props> = ({
  title = $('标题'),
  confirmText = $('确定')
}) => {
  // ...
};
```

### 3. 错误消息和提示

```typescript
// 统一使用常量
const errorMessage = $(ERROR_MESSAGES.NODE_NOT_FOUND);

// 或者直接翻译
const errorMessage = $('节点未找到');
```

### 4. 复数和数量

```typescript
// 使用插值处理数量
$t('共 {{count}} 个节点', { count: 1 });  // "共 1 个节点"
$t('共 {{count}} 个节点', { count: 5 });  // "共 5 个节点"
```

## 测试

### 单元测试

```typescript
import { $, setLanguage } from '@/canvas/i18n';

test('translation works correctly', () => {
  setLanguage('zh');
  expect($('确定')).toBe('确定');

  setLanguage('en');
  expect($('确定')).toBe('OK');
});
```

### 组件测试

```typescript
import { renderHook } from '@testing-library/react';
import { useI18n } from '@/canvas/i18n';

test('useI18n hook works', () => {
  const { result } = renderHook(() => useI18n());

  expect(result.current.$('确定')).toBe('确定');
  expect(result.current.isZh).toBe(true);
});
```

## 注意事项

1. **默认中文**：所有源码默认使用中文，英文作为可选翻译
2. **回退机制**：如果英文翻译不存在，自动回退到中文
3. **性能考虑**：翻译函数非常轻量，没有性能问题
4. **类型安全**：TypeScript会检查，避免拼写错误
5. **扩展性**：需要添加新语言时，只需扩展翻译包

这个国际化系统设计简洁实用，完全满足中文项目的基本需求，同时为国际化提供了良好的支持。