<p align="center">
  <img src="assets/logo.png" alt="TapCanvas Logo" width="1000" />
</p>

<h1 align="center">TapCanvas</h1>
<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="license" />
  </a>
  <a href="https://github.com/anymouschina/TapCanvas">
    <img src="https://img.shields.io/github/stars/anymouschina/TapCanvas.svg?style=flat-square" alt="GitHub stars" />
  </a>
</p>

<p align="center">一款零 GPU、面向 Sora 2 的可视化 AI 创作画布，支持文本→图像→视频的完整创作工作流。</p>

**Language:** 中文 | [English](README_EN.md)

## 概述

TapCanvas 项目主要针对 Sora 2 做了专门的画布能力优化，支持直接 Remix 链式调用，实现多账号共享，让用户能够完美留下自己的创作痕迹。

- [📘 使用指引（飞书文档）](https://jpcpk71wr7.feishu.cn/wiki/WPDAw408jiQlOxki5seccaLdn9b)
- [完整文档索引](docs/README.md)
- [中文详细文档（从根 README 拆分）](docs/README.zh-CN.md)
- [快速启动（Docker）](docs/docker.md)
- [本地开发](docs/development.md)
- [AI/后端契约与扩展](docs/INTELLIGENT_AI_IMPLEMENTATION.md)
- [Prompt 参考](docs/AI_VIDEO_REALISM_GUIDE.md)

## 最新能力

- 简约风格：UI 基于 Mantine 与 React Flow 重新梳理，顶部信息条、右侧面板与 Storyboard/资产面板能够在同一画布内无刷新切换，聚焦模式和组管理让复杂节点也能在统一视觉体系下保持清晰。
- **LangGraph 沉浸式创作（小T）**：项目级连续对话与“意图驱动”的画布操作——你只要描述想做什么，它会自动拆解步骤、创建/连接节点并执行，适合从一句话一路长出世界观、角色与分镜。
- **Nano Banana 三档模型**：默认图像节点已经接入 Nano Banana / Fast / Pro 模型，并默认使用 Nano Banana Pro，可通过同一个表单拖拽提示词、参考图或整段剧情，直接生成分镜垫图、角色定妆照与高质量文生图/图生图结果。
- **Sora 2 + Veo 3.1 双引擎**：视频节点即插即用 Sora 2 与 Veo3.1 Fast/Pro，支持 Remix、参考第一帧/最后一帧、复用 Storyboard 片段，让多镜头视频在画布内一气呵成。
- **图生图链路**：图像节点支持上传参考图、抽帧、资产拖拽，任何生成的图片都可以作为下一次调用的输入，实现文本→图像→图像（图生图）→视频的完整闭环。
- **GRSAI 中转站适配**：内置 grsai 代理配置面板，可以一次性填入 Host 与 API Key，同步展示积分与可用模型状态，将 Nano Banana、Sora 2、Veo 3 等请求稳定转发到海外节点或国内直连。

## 协议

MIT License（详见 `LICENSE`）。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=anymouschina/TapCanvas&type=Date)](https://star-history.com/#anymouschina/TapCanvas&Date)

## 联系方式

欢迎加入用户交流群交流反馈与共创：

![交流群](assets/group.jpg)

如需合作/问题沟通，可联系作者：

![联系作者](assets/author.jpg)
