<p align="center">
  <img src="webcut.png" alt="WebCut Logo" width="160" />
</p>

<h1 align="center">WebCut</h1>
<p align="center">
  <a href="https://www.npmjs.com/package/webcut">
    <img src="https://img.shields.io/npm/v/webcut.svg?style=flat-square" alt="npm version" />
  </a>
  <a href="https://github.com/tangshuang/webcut/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/webcut.svg?style=flat-square" alt="license" />
  </a>
  <a href="https://github.com/tangshuang/webcut">
    <img src="https://img.shields.io/github/stars/tangshuang/webcut.svg?style=flat-square" alt="GitHub stars" />
  </a>
</p>

<p align="center">A powerful web video editing UI framework, empowering web applications to quickly integrate professional-grade video editing capabilities.</p>

## 📋 Table of Contents

- [Project Introduction](#project-introduction)
- [Design Philosophy](#design-philosophy)
- [Core Features](#core-features)
- [Quick Examples](#quick-examples)
- [Installation](#installation)
- [Documentation](#documentation)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Project Introduction

WebCut is a video editing UI framework specifically designed for web applications. It provides intuitive canvas interface and comprehensive timeline tools, enabling developers to easily perform video editing, text/graphic overlay, element layout and transformation operations in the browser, and integrate them into their applications in a modular way.

<p align="center">
  🚀 Quick Integration · 🎨 Rich Features · 📱 Responsive Design · ⚡ High Performance Experience
</p>

## Design Philosophy

WebCut's core philosophy is "Complex Capabilities, Simple Usage". We believe that implementing professional-grade video editing on the web platform should not be a burden. Through componentized architecture and responsive APIs, developers can focus on creativity itself, rather than underlying details.

### Our Design Principles

| Principle | Description |
|-----------|-------------|
| 🎯 **User-First Design** | Intuitive interfaces and clear documentation, reducing learning costs |
| ⚡ **Performance Optimization** | Optimized for browser environments to ensure smooth operation |
| 🔧 **Extensibility** | Modular design for easy customization and feature extension |
| 🛡️ **Type Safety** | Comprehensive TypeScript support to reduce development errors

## Core Features

### Editing and Creation

| Feature | Description |
|---------|-------------|
| 🎨 **Canvas Editing** | Intuitive canvas-based editing interface, what you see is what you get |
| 🎬 **Player Control** | Play/pause, progress and volume control, supporting frame-level precise operations |
| 📝 **Text Overlay** | Multi-style text addition and customization, supporting rich text effects |
| ⏱️ **Timeline** | Precise timeline control, supporting scaling, positioning and clip management |
| 🎛️ **Element Transformation** | Intuitive scaling, rotation and position adjustment, supporting precise value input |

### Auxiliary Tools

| Feature | Description |
|---------|-------------|
| 📏 **Size Measurement** | Accurate text, video and image size calculation and control |
| 🧰 **Utility Functions** | Export Blob, text-to-image conversion and other practical features |
| 📱 **Responsive Design** | Adapt to different screen sizes, providing consistent editing experience |

### Project Showcase

> *Project screenshots or demo videos can be placed here*

## Quick Examples

### Integration in Vue Project

The following example shows how to quickly integrate WebCut in a Vue project:

```vue
<script setup lang="ts">
// Import core components and styles
import { WebCutEditor } from 'webcut';
import 'webcut/esm/style.css';

// Project ID (example)
const yourProjectId = 'example-project';
</script>

<template>
  <div class="editor-container">
    <h1>Video Editor</h1>
    <!-- Use the complete editor component directly -->
    <WebCutEditor :project-id="yourProjectId" />
  </div>
</template>

<style scoped>
.editor-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>
```

> **Tip**: The above code will render a complete video editing interface, including video canvas, toolbar and timeline. You can also import components and tools from `webcut` as needed for customization.

## Installation

WebCut supports installation via multiple package managers:

```bash
# Using npm
npm install webcut

# Using yarn
yarn add webcut

# Using pnpm
pnpm add webcut
```

> **Note**: WebCut currently supports modern browser environments. Before use, please ensure that your project has configured the necessary polyfills (if supporting older browsers is required).

## Documentation

WebCut provides detailed documentation to help you get started quickly:

- **API Documentation**: Located in `docs/api.md` and `docs/zh-cn/api.md`
- **Component Documentation**: Detailed component usage instructions
- **Quick Start Guide**: Helping new users get started quickly
- **FAQ**: Solutions and best practices

> For online documentation, please visit our documentation site.

## License

This project is licensed under the **MIT License**, allowing free use, modification, and distribution. See the <mcfile name="LICENSE" path="/Users/frustigor/dev/webcut/LICENSE"></mcfile> file for details.

## Acknowledgements

WebCut's development would not be possible without the support of the following excellent open-source projects:

### Core Dependencies

- [@webav/av-canvas](https://github.com/bilibili/webav/tree/main/packages/av-canvas) - Provides underlying video rendering capabilities
- [@webav/av-cliper](https://github.com/bilibili/webav/tree/main/packages/av-cliper) - Supports video editing functionality
- [Vue 3](https://vuejs.org/) - Responsive frontend framework

### Development Tools

- [TypeScript](https://www.typescriptlang.org/) - Type system support
- [naive-ui](https://www.naiveui.com/) - UI component library
- [@vicons](https://vicons.mono.company/) - Icon library

Thank you to the contributors of these projects for their efforts to the open-source community!

---

> **Tip**: If you like this project, please give us a ⭐️ support!