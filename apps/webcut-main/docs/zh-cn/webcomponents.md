# Web Components 使用指南

本指南将介绍如何在任何现代Web应用中使用WebCut的Web Components，无需依赖Vue.js。

## 安装

### 选项1：NPM

```bash
npm install webcut
```

### 选项2：CDN

```html
<script src="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/index.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/style.css">
```

## 基本使用

### 导入 (NPM方式)

```javascript
import 'webcut/webcomponents';
import 'webcut/webcomponents/style.css';
```

### HTML集成

在HTML中添加Web组件：

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

### 组件列表

- **webcut-editor**: 主编辑器组件
- **webcut-provider**: 视频/音频/图片/文本资源提供器组件
- **webcut-player-screen**: 视频/音频播放屏幕组件
- **webcut-player-button**: 播放控制按钮组件
- **webcut-manager**: 片段管理组件
- **webcut-manager-scaler**: 片段缩放组件
- **webcut-player**: 视频/音频播放组件
- **webcut-select-aspect-ratio**: 选择视频宽高比组件
- **webcut-library**: 资源库组件
- **webcut-video-segment**: 视频片段组件
- **webcut-audio-segment**: 音频片段组件
- **webcut-image-segment**: 图片片段组件
- **webcut-text-segment**: 文本片段组件
- **webcut-clear-selected-tool**: 清除选中片段工具组件
- **webcut-delete-current-tool**: 删除当前片段工具组件
- **webcut-split-current-tool**: 分割当前片段工具组件
- **webcut-split-keep-left-tool**: 分割并保留左侧片段工具组件
- **webcut-split-keep-right-tool**: 分割并保留右侧片段工具组件
- **webcut-panel**: 面板组件
- **webcut-text-panel**: 文本面板组件
- **webcut-basic-panel**: 基本面板组件
- **webcut-time-clock**: 时间时钟组件
- **webcut-export-button**: 导出按钮组件

## 属性

### webcut-editor

- **project-id**: 项目的唯一标识符（可选）

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

## JavaScript API

你可以使用JavaScript API以编程方式控制编辑器：

```javascript
// 获取编辑器元素
const editor = document.querySelector('webcut-editor');

// 等待编辑器准备就绪
editor.addEventListener('webcut-ready', async () => {
  // 访问播放器API
  const player = editor.player;
  
  // 添加视频
  await player.push('video', 'https://example.com/video.mp4', {
    autoFitRect: 'contain',
    time: { start: 0, duration: 5000000 } // 5秒，以纳秒为单位
  });
  
  // 播放控制
  player.play();
  player.pause();
  player.moveTo(1000); // 移动到1秒位置
  
  // 导出
  const blob = await player.exportBlob();
  player.download('my-export');
});
```

## 事件

Web Components会触发你可以监听的事件：

- **webcut-ready**: 编辑器完全初始化时触发
- **webcut-project-loaded**: 项目加载时触发
- **webcut-segment-selected**: 选择片段时触发
- **webcut-export-complete**: 导出完成时触发

```javascript
const editor = document.querySelector('webcut-editor');

editor.addEventListener('webcut-ready', () => {
  console.log('编辑器已准备就绪！');
});

editor.addEventListener('webcut-export-complete', (event) => {
  console.log('导出已完成:', event.detail);
});
```

## 示例

你可以在 examples/webcomponents 目录下找到完整的示例代码。

以下是一个完整的Web Components使用示例：

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebCut Web Components 示例</title>
    <style>
      html, body, #app {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
      }
      #controls {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 1000;
      }
    </style>
    <!-- 使用CDN -->
    <script src="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/index.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/style.css">
  </head>
  <body>
    <div id="app">
      <webcut-editor id="editor" project-id="demo-project"></webcut-editor>
    </div>
    <div id="controls">
      <button id="add-video">添加视频</button>
      <button id="export">导出</button>
    </div>
    <script>
      const editor = document.getElementById('editor');
      const addVideoBtn = document.getElementById('add-video');
      const exportBtn = document.getElementById('export');
      
      editor.addEventListener('webcut-ready', () => {
        console.log('编辑器已准备就绪');
        
        addVideoBtn.addEventListener('click', async () => {
          try {
            await editor.player.push('video', 'https://example.com/sample.mp4', {
              autoFitRect: 'contain',
              time: { start: 0, duration: 10000000 } // 10秒
            });
          } catch (error) {
            console.error('添加视频失败:', error);
          }
        });
        
        exportBtn.addEventListener('click', async () => {
          try {
            await editor.player.exportBlob();
            editor.player.download('my-creation');
          } catch (error) {
            console.error('导出失败:', error);
          }
        });
      });
    </script>
  </body>
</html>
```

## 浏览器支持

Web Components支持所有现代浏览器：

- Chrome 67+
- Firefox 63+
- Safari 13+
- Edge 79+

对于较旧的浏览器，您可能需要包含polyfills。

## 下一步

- 探索JavaScript API以进行更高级的操作
- 将其集成到您现有的应用程序中
- 查看`src/webcomponents.ts`中的源代码了解实现细节