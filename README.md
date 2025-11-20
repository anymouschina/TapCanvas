# TapCanvas
**Language:** 中文 | [English](README_EN.md)

**可视化 AI 创作画布（零 GPU）**

## 📝 简介

TapCanvas 项目主要针对 Sora 2 做了专门的画布能力优化，支持直接 Remix 链式调用，实现多账号共享，让用户能够完美留下自己的创作痕迹。但我们的远不止于此：

**🎨 创新的可视化工作流**

- 首创将复杂AI创作流程转化为直观的节点连线操作
- 支持文生图→图生视频→视频合成的完整创作链路
- 智能类型匹配系统，自动防止错误连接，让创作更可靠

**⚡ 强大的画布交互体验**

- 基于React Flow的高性能渲染，支持复杂工作流流畅操作
- 独有的组聚焦模式，让大型项目也能清晰管理
- 智能辅助连接，从文本/图片节点拖拽即可快速创建下一环节

**🧠 智能化创作辅助**

- 集成Gemini 2.5进行提示词优化和智能建议
- 支持历史提示词复用，避免重复思考
- Sora2角色@提及功能，精准控制视频角色

**🔧 企业级工程能力**

- 零GPU要求，全部计算依赖云端API，轻量化部署
- 模块化架构设计，易于扩展新的AI模型和功能
- 完整的项目管理和资产治理体系

通过可视化工作流的方式，我们不仅降低了AI视频创作的门槛，更为创作者提供了一个专业、高效的创作平台。

## 🖼️ 功能预览

![功能预览](assets/feature.jpg)

TapCanvas 的可视化画布界面展示了强大的 AI 创作工作流能力：从文本提示词开始，通过智能连接生成图像和视频内容，实现完整的创意到作品的转化过程。

## ⚙️ 使用前配置模型

**重要：在使用 TapCanvas 之前，务必先配置 AI 模型！**

![模型配置](assets/setting.jpg)

### 模型功能对应关系

不同 AI 模型支持不同的节点类型，请正确配置：

| 模型 | 支持的节点类型 | 功能说明 |
|------|-------------|----------|
| **Sora** | 🎬 **Video 节点** | 图生视频、文生视频、视频合成 |
| **Qwen** | 🖼️ **Image 节点** | 文生图、图像生成、多种分辨率 |
| **Gemini** | 📝 **Text 节点** | 文本生成、提示词优化、智能建议 |

### 配置步骤

1. **打开模型配置面板**：在右侧面板点击"模型配置"
2. **添加提供商**：根据需要添加 Sora、Qwen、Gemini 模型
3. **配置 API 密钥**：填入各平台的真实 API 密钥
4. **测试连接**：确保每个模型都能正常调用

> 💡 **提示**：只有正确配置了模型，对应的节点才能正常工作。例如：
> - 想要生成视频？→ 必须配置 **Sora** 模型
> - 想要生成图片？→ 必须配置 **Qwen** 模型
> - 想要优化提示词？→ 必须配置 **Gemini** 模型

## 🚀 快速运行

### 方法一：Docker 运行（推荐）

使用 Docker 可以快速启动所有依赖服务，无需手动配置数据库和缓存。

```bash
# 1. 启动基础服务（PostgreSQL + Redis）
docker-compose -f docker-compose.minimal.yml up -d

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 API 密钥

# 3. 安装依赖
pnpm install

# 4. 启动开发服务器
pnpm dev:web    # 前端服务 (http://localhost:5173)
pnpm dev:api    # API 服务 (http://localhost:3001)
```

**管理界面访问：**
- 数据库管理：http://localhost:8080 (Adminer)
- Redis 管理：http://localhost:8081 (Redis Commander)

### 方法二：本地运行

如果你已经本地安装了 PostgreSQL 和 Redis。

```bash
# 1. 确保本地服务运行
# PostgreSQL (端口 5432)
# Redis (端口 6379)

# 2. 配置数据库连接
# 创建数据库 tapCanvas
# 修改 apps/api/.env 中的 DATABASE_URL

# 3. 安装依赖
pnpm install

# 4. 数据库迁移
cd apps/api
pnpm prisma:generate
pnpm prisma:migrate

# 5. 启动开发服务器
pnpm dev:web    # 前端服务
pnpm dev:api    # API 服务
```

### 环境配置

项目使用 `.env.example` 作为配置模板。请按以下步骤配置：

```bash
# 1. 复制主配置模板
cp .env.example .env

# 2. 编辑 .env 文件，填入真实的 API 密钥
# 必需配置项：
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tapCanvas?schema=public"
GITHUB_CLIENT_ID="your_github_client_id"
GITHUB_CLIENT_SECRET="your_github_client_secret"
JWT_SECRET="your-strong-jwt-secret"
HF_TOKEN="your_huggingface_token"
SILICONFLOW_API_KEY="your_siliconflow_api_key"
SORA_API_KEY="your_sora_api_key"

# 3. API 服务将自动读取项目根目录的 .env 文件
# 如需 API 专用配置，可创建 apps/api/.env.local 文件
```

**重要提示：**
- ⚠️ **不要将真实的 `.env` 文件提交到 Git** (已配置在 `.gitignore` 中)
- 🔑 所有 API 密钥都需要在对应平台注册获取
- 📝 项目提供两个 `.env.example` 模板：根目录和 `apps/api/` 目录
- ✅ 项目已配置 `.gitignore` 只忽略 `.env` 文件，但保留 `.env.example` 模板
- 🔒 确保 API 密钥安全，只在本地 `.env` 文件中填写真实密钥
- 📁 **API 配置统一管理**：推荐在项目根目录配置 `.env`，API 服务会自动读取
- 🔐 **已移除敏感文件**：原 `apps/api/.env` 文件（含真实密钥）已从项目中移除

**获取 API 密钥：**
1. **GitHub OAuth**: https://github.com/settings/applications/new
2. **Hugging Face**: https://huggingface.co/settings/tokens
3. **Silicon Flow**: https://siliconflow.cn
4. **Sora API**: 需要联系获取访问权限

### 验证运行

启动成功后，访问以下地址验证：

- **前端应用**：http://localhost:5173
- **API 服务**：http://localhost:3001
- **API 文档**：http://localhost:3001/api (如果有 Swagger)

如果看到 TapCanvas 的界面，说明运行成功！

## 🎯 快速体验

如果你想要快速体验 TapCanvas 的功能，可以使用以下预配置的模型提供商设置：

### 模型配置示例

在应用的"模型配置"面板中，你可以导入以下配置结构（已移除敏感信息）：

```json
{
  "version": "1.0.0",
  "exportedAt": "2025-11-20T02:47:29.179Z",
  "providers": [
    {
      "id": "3dd9bc5e-9e91-4572-8e45-431647524743",
      "name": "Sora",
      "vendor": "sora",
      "baseUrl": null,
      "tokens": [
        {
          "id": "e36aea87-3d86-45ce-a023-784f90bad930",
          "label": "token-1",
          "secretToken": "YOUR_SORA_API_TOKEN_HERE",
          "enabled": true,
          "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "shared": false
        }
      ],
      "endpoints": [
        {
          "id": "acbd3702-ac60-45c0-b214-c1950bd3d2d6",
          "key": "videos",
          "label": "videos 域名",
          "baseUrl": "https://videos.beqlee.icu",
          "shared": false
        },
        {
          "id": "72925a18-1445-43bd-a8e8-9ef051f66ed0",
          "key": "sora",
          "label": "sora 域名",
          "baseUrl": "https://sora2.beqlee.icu",
          "shared": false
        }
      ]
    },
    {
      "id": "6a77570a-b441-4ef9-877d-12a156b8a4a1",
      "name": "Qwen",
      "vendor": "qwen",
      "baseUrl": null,
      "tokens": [
        {
          "id": "139f22f3-0938-476d-b45c-d6dbd3dddcf2",
          "label": "qwen",
          "secretToken": "YOUR_QWEN_API_KEY_HERE",
          "enabled": true,
          "userAgent": null,
          "shared": false
        }
      ],
      "endpoints": []
    },
    {
      "id": "48edea28-1ebb-43b4-acb3-a4fc17aeead9",
      "name": "Gemini",
      "vendor": "gemini",
      "baseUrl": "https://generativelanguage.beqlee.icu",
      "tokens": [
        {
          "id": "af9ae30d-d5f0-4205-a095-63dc1cb67950",
          "label": "2",
          "secretToken": "YOUR_GEMINI_API_KEY_HERE",
          "enabled": true,
          "userAgent": null,
          "shared": false
        }
      ],
      "endpoints": []
    }
  ]
}
```

### 快速开始步骤

1. **配置 API 密钥**：将上述配置中的 `YOUR_*_API_KEY_HERE` 替换为你的真实 API 密钥
2. **导入配置**：在模型配置面板中导入修改后的配置
3. **创建第一个工作流**：
   - 从左侧拖拽"文本"节点到画布
   - 输入简单的提示词，如"一只可爱的猫咪在花园里玩耍"
   - 连接"图像"节点，选择 16:9 比例
   - 点击运行按钮开始生成

### 体验提示

- 🎨 **建议先尝试文生图**：从文本生成图像开始，了解基本流程
- 🎬 **然后尝试图生视频**：使用生成的图像创建视频内容
- 💡 **使用智能提示**：点击文本节点的"AI 优化"按钮获得更好的提示词建议
- 📱 **调整参数**：尝试不同的分辨率、时长等参数设置

## 🌐 代理配置说明

由于国内网络环境的不可抗力因素，部分 AI 服务可能无法直接访问。推荐使用 Cloudflare Workers 和 Durable Objects 配置代理来解决这个问题。

### 前置条件

- 注册 Cloudflare 账号：https://dash.cloudflare.com/
- 启用 Durable Objects 功能

### 配置步骤

#### 1. 创建 Worker

1. 登录 Cloudflare Dashboard
2. 选择 "Workers & Pages" → "Create application" → "Create Worker"
3. 给 Worker 命名（如 `tapcanvas-proxy`）
4. 点击 "Deploy"

#### 2. 启用 Durable Objects

1. 在 Worker 设置中，找到 "Settings" → "Durable Objects"
2. 点击 "Configure Durable Objects"
3. 确认启用该功能

#### 3. 配置 Worker 脚本

将以下脚本复制到 Worker 编辑器中：

```javascript
import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    // 转发逻辑：从 Durable Object 接收 request，转发至上游

    // 域名映射：将代理域名映射到真实域名
    const upstream = new URL(request.url
      .replace('sora2.beqlee.icu', 'sora.chatgpt.com')
      .replace('videos.beqlee.icu', 'videos.openai.com')
      .replace('generativelanguage.beqlee.icu', 'generativelanguage.googleapis.com')
    );

    const forwardedReq = new Request(upstream.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });

    const upstreamResp = await fetch(forwardedReq);

    const ct = upstreamResp.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await upstreamResp.json();
      const result = { ok: true, data };
      return new Response(JSON.stringify(result, null, 2), {
        status: upstreamResp.status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      headers: upstreamResp.headers
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const id = env.MY_DURABLE_OBJECT.idFromName("singleton");
    const stub = env.MY_DURABLE_OBJECT.get(id);
    const resp = await stub.fetch(request);
    return resp;
  }
};
```

#### 4. 绑定 Durable Object

1. 在 Worker 设置中，找到 "Settings" → "Variables"
2. 添加 Durable Object 绑定：
   - **Variable name**: `MY_DURABLE_OBJECT`
   - **Durable Object class name**: `MyDurableObject`
   - **Script name**: 选择你创建的 Worker 脚本

#### 5. 部署 Worker

1. 保存并部署 Worker 脚本
2. 记录 Worker 的访问地址：`https://your-worker-name.your-subdomain.workers.dev`

#### 6. 更新 TapCanvas 配置

在 TapCanvas 的模型配置中，将端点 URL 更新为你的 Worker 地址：

```json
{
  "endpoints": [
    {
      "key": "sora",
      "label": "sora 域名",
      "baseUrl": "https://your-worker-name.your-subdomain.workers.dev"
    }
  ]
}
```

### 域名映射说明

Worker 脚本中的域名映射如下：

| 代理域名 | 真实域名 | 用途 |
|---------|---------|------|
| `sora2.beqlee.icu` | `sora.chatgpt.com` | Sora API |
| `videos.beqlee.icu` | `videos.openai.com` | OpenAI Videos API |
| `generativelanguage.beqlee.icu` | `generativelanguage.googleapis.com` | Gemini API |

### 故障排除

#### 常见问题

1. **Worker 返回 403 错误**
   - 检查 Durable Object 是否正确绑定
   - 确认 Variable name 为 `MY_DURABLE_OBJECT`

2. **请求超时**
   - 检查 Worker 的执行时间限制
   - 考虑升级到付费计划获得更长的执行时间

3. **部分请求失败**
   - 检查上游服务是否正常运行
   - 查看 Worker 的日志信息

#### 测试代理

创建测试文件验证代理是否正常工作：

```bash
# 测试 Sora API 代理
curl -X POST "https://your-worker-name.your-subdomain.workers.dev" \
  -H "Authorization: Bearer YOUR_SORA_TOKEN" \
  -H "Content-Type: application/json"
```

### 安全提示

- 🔒 定期轮换 API 密钥
- 🛡️ 启用 Cloudflare 的防火墙规则
- 📊 监控 Worker 的使用量和成本
- 🔐 不要在代码中硬编码敏感信息

通过以上配置，你可以在国内环境下稳定使用 TapCanvas 的各项 AI 功能。

## 📋 待办事项

为了实现"一站式解决AIGC创作问题"的目标，我们正在积极开发以下核心功能：

### 🔥 优先开发

- **Sora 2 完整接入**：实现完整的 Sora 2 模型集成和 API 调用  ✅
- **Sora 2 去水印功能**：提供智能水印移除和视频清理功能
- **视频拼接**：支持多段视频无缝拼接和过渡效果
- **视频剪辑**：添加视频裁剪、分割、合并基础编辑功能

### 🎬 视频创作增强

- **多模型视频生成**：接入 Runway、Pika、Gen-2 等主流视频模型
- **风格化视频**：支持不同艺术风格的视频生成
- **视频模板**：预置常用视频模板和效果
- **字幕自动生成**：AI 语音识别和时间轴对齐
- **背景音乐**：智能匹配和生成背景音乐

### 🎨 图像创作完善

- **多模型图像生成**：支持 Stable Diffusion、Midjourney、DALL-E 等
- **图像编辑器**：内置基础图像编辑和滤镜功能
- **风格转换**：图像风格迁移和艺术化处理
- **批量处理**：支持批量图像生成和处理

### 🎵 音频创作模块

- **AI 音乐生成**：根据情绪和场景生成背景音乐
- **音效库**：丰富的音效素材和智能匹配
- **语音合成**：多语言、多音色的 TTS 服务
- **音频编辑**：混音、降噪、音频效果处理

### 📝 文本创作辅助

- **剧本生成**：AI 辅助短视频脚本创作
- **文案优化**：智能标题和描述优化
- **多语言支持**：国际化内容和翻译功能

### 🔄 工作流优化

- **模板市场**：共享和下载创作模板
- **自动化规则**：设置复杂的自动化创作流程
- **批量生产**：一次设置批量产出内容
- **API 接口**：提供开放 API 供第三方集成

### 💼 商业化功能

- **团队协作**：多人协作编辑和权限管理
- **项目管理**：完整的项目生命周期管理
- **成本控制**：API 调用成本预估和预算管理
- **数据分析**：创作效果和用户行为分析

### 🎯 用户体验

- **移动端适配**：响应式设计和移动端优化
- **快捷操作**：更多快捷键和手势支持
- **智能推荐**：基于使用习惯的个性化推荐
- **教程体系**：内置教程和创作指导

---

## 🎯 核心功能

### 📋 项目管理

- **多项目支持**：创建和管理多个独立项目，每个项目包含独立的工作流
- **项目切换**：快速在不同项目间切换，每个项目保持独立的工作空间
- **历史记录**：查看和管理创作历史（开发中）
- **用户账户**：支持用户登录和个人资产管理

### 🎨 可视化画布编辑器

- **节点式工作流**：通过拖拽节点和连接线构建复杂的 AI 生成流程
- **智能连接**：自动类型匹配，确保节点间数据流向正确
- **多种节点类型**：
  - **文本节点**：输入提示词，支持 AI 优化建议
  - **图像节点**：文生图、图片上传、图片编辑
  - **视频节点**：图生视频、文生视频、视频合成
  - **组合节点**：将多个节点打包成可复用的组件
- **实时预览**：即时查看节点执行结果和生成内容

### 🤖 AI 模型集成

- **文本生成**：
  - **Gemini 2.5 Flash / Pro**：先进的文本生成模型
  - **智能提示词优化**：自动优化和改进输入提示词
  - **文本增强**：支持文本续写和风格转换

- **图像生成**：
  - **Qwen Image Plus**：高性能图像生成模型
  - **多分辨率支持**：16:9、1:1、9:16 三种常用比例
  - **批量生成**：支持1-5张图片同时生成
  - **文生图**：从文本描述生成高质量图像

- **视频生成**：
  - **Sora 2**：OpenAI 最新视频生成模型
  - **角色引用**：支持@提及功能，精确控制视频角色
  - **多时长选项**：支持10秒、15秒视频生成
  - **图生视频**：从静态图像生成动态视频
  - **文生视频**：直接从文本生成视频内容

- **模型管理**：
  - **灵活配置**：支持自定义模型端点和参数
  - **多提供商**：可集成不同AI模型提供商
  - **API密钥管理**：安全的密钥存储和管理

### 🛠️ 高级编辑功能

- **模板系统**：

  - 从服务器浏览和引用工作流模板
  - 支持公共工作流和个人工作流
  - 拖拽模板到画布快速创建
- **资产库**：

  - 管理个人创作的素材资产
  - Sora 草稿支持和资产管理
  - 支持素材在工作流中复用
- **智能辅助**：

  - 智能连接类型匹配，防止错误连接
  - 节点自动布局算法支持
  - 右键菜单快捷操作
- **模型配置**：

  - AI 模型参数配置界面
  - 支持多种AI模型切换

### 🌍 国际化支持

- **多语言界面**：支持中文和英文界面切换
- **实时翻译**：点击语言图标即可切换界面语言，无需刷新页面
- **完整本地化**：所有界面元素、提示信息、错误消息均支持多语言
- **持久化设置**：语言选择自动保存，下次访问保持用户偏好

### 🎬 内容生成工作流

- **文生图流程**：文本 → 图像生成
- **图生视频流程**：图像 → 视频生成
- **文生视频流程**：文本 → 视频直接生成
- **复合流程**：文本 → 图像 → 视频 → 后处理
- **并行处理**：支持多个节点同时执行，提高效率

### ⌨️ 快捷操作

- **键盘快捷键**：
  - `Delete/Backspace`：删除选中的节点或边
  - 双击空白区域：在聚焦模式下退出到上一层级
- **右键菜单**：
  - 节点右键：运行、停止、复制、删除、重命名等操作
  - 边右键：删除连线
  - 画布右键：从图片/文本继续创作
- **拖拽操作**：
  - 拖拽模板/资产到画布快速创建节点
  - 支持图片文件拖拽上传
- **批量操作**：支持多选节点进行批量编辑和操作

### 💾 数据管理

- **本地存储**：自动保存工作进度到浏览器
- **云端同步**：支持项目数据云端备份
- **导出功能**：
  - 导出图片、视频等生成内容
  - 导出工作流配置
  - 导出项目文档

## 🌟 特色亮点

### 🎯 用户体验

- **零学习成本**：直观的可视化界面，无需编程基础
- **实时反馈**：节点执行状态实时更新，进度条显示
- **智能提示**：根据上下文提供操作建议和参数推荐
- **响应式设计**：适配各种屏幕尺寸，支持移动端操作
- **GitHub 集成**：一键访问项目仓库，方便开发者了解和贡献代码

### 🔧 技术特色

- **零 GPU 要求**：全部计算依赖云端 AI API，本地无硬件要求
- **高性能渲染**：基于 React Flow 的高效画布渲染
- **模块化架构**：易于扩展新的 AI 模型和功能
- **类型安全**：使用 TypeScript 确保代码质量

### 🚀 创新功能

- **智能连接**：自动识别节点类型兼容性，防止错误连接
- **组聚焦模式**：支持复杂工作流的分层管理和编辑
- **模板拖拽**：从侧边栏直接拖拽模板到画布快速创建
- **参数继承**：节点间自动传递和继承相关参数

## 🧱 架构概览

### 前端技术栈

- **React 18** + **TypeScript**：现代化的前端框架
- **React Flow**：强大的节点编辑器，支持复杂的可视化工作流
- **Mantine**：优雅的 UI 组件库
- **Zustand**：轻量级状态管理
- **自定义国际化系统**：支持中英文界面切换，完整本地化支持
- **Vite**：快速的构建工具

### 后端集成

- **NestJS + Bull 队列**：高性能工作流编排和任务管理
- **第三方 AI API**：
  - OpenAI Sora 2（视频生成）
  - Gemini 2.5（文本生成）
  - Qwen Image Plus（图像生成）

### 数据存储

- **本地存储**：浏览器 localStorage 用于模板和缓存
- **云端存储**：S3/OSS 用于生成的媒体文件
- **项目数据**：支持云端同步和备份

## 📖 使用指南

### 创建第一个项目

1. 打开 TapCanvas 应用
2. 点击项目名称区域，输入项目名称
3. 从左侧面板拖拽 "文本" 节点到画布
4. 在文本节点中输入提示词
5. 连接其他节点构建工作流
6. 点击运行按钮开始生成

### 节点类型详解

#### 文本节点 (Text)

- 用于输入和优化提示词
- 支持 AI 智能建议
- 可连接到图像和视频生成节点

#### 图像节点 (Image)

- 支持文生图和图片上传
- 多种分辨率选择
- 批量生成功能

#### 视频节点 (Video)

- 图生视频和文生视频
- 支持多种时长
- 角色引用功能

### 工作流示例

#### 基础文生图

```
文本节点 → 图像节点
```

#### 图生视频

```
图像节点 → 视频节点
```

#### 复合工作流

```
文本节点 → 图像节点 → 视频节点
```

## 🔧 开发指南

### 项目结构

```
TapCanvas/
├── apps/
│   ├── web/              # 前端应用
│   │   └── src/
│   │       ├── canvas/   # 核心画布系统（包含i18n国际化）
│   │       └── ui/       # UI 组件
│   └── api/              # API 服务
├── packages/
│   ├── cli/              # 命令行工具
│   └── sdk/              # SDK 包
```

### 添加新的 AI 模型

1. 在 `apps/api/src/task/adapters` 中创建新的适配器
2. 定义输入输出接口
3. 实现模型调用逻辑
4. 在前端添加对应的节点类型

### 自定义节点

参考 `apps/web/src/canvas/nodes/TaskNode.tsx` 创建自定义节点组件。

### 国际化开发

#### 翻译系统架构

项目使用自定义的国际化系统，支持中文和英文：

```typescript
// 翻译函数
import { $, $t, useI18n } from '../canvas/i18n'

// 基础翻译
$('确定') // 'OK' 或 '确定'

// 带参数的翻译
$t('项目「{{name}}」已保存', { name: 'My Project' })
// "Project \"My Project\" saved" 或 "项目「My Project」已保存"
```

#### 添加新的翻译

1. 在 `apps/web/src/canvas/i18n/index.ts` 的 `enTranslations` 对象中添加翻译：

```typescript
const enTranslations = {
  // 现有翻译...
  '新的中文文本': 'New English Text',
  '带参数的文本': 'Text with {{parameter}}',
}
```

2. 在组件中使用翻译函数：

```tsx
import { $, $t } from '../canvas/i18n'

function MyComponent() {
  return (
    <div>
      <p>{$('新的中文文本')}</p>
      <p>{$t('带参数的文本', { parameter: 'value' })}</p>
    </div>
  )
}
```

#### 语言切换组件

系统提供现成的语言切换组件，支持：

- 点击切换中英文
- 语言偏好持久化到 localStorage
- 实时界面更新，无需刷新页面
- 图标和工具提示支持

```tsx
// 在组件中使用
const { currentLanguage, setLanguage, isEn, isZh } = useI18n()
```

#### 最佳实践

1. **所有用户可见的文本都应该使用翻译函数**
2. **保持翻译键为中文原文**，便于维护和理解
3. **使用 $t() 处理带参数的文本**，使用 $() 处理简单文本
4. **在添加新功能时同步添加对应的英文翻译**
5. **测试两种语言下的界面布局**，确保文本长度变化不影响美观

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 发起 Pull Request

### 代码规范

- 使用 TypeScript
- 遵循 ESLint 规则
- 编写单元测试
- 更新文档

## 📄 许可证

MIT License

## 🔗 相关链接

- [GitHub 仓库](https://github.com/anymouschina/TapCanvas)
- [问题反馈](https://github.com/anymouschina/TapCanvas/issues)
- [功能建议](https://github.com/anymouschina/TapCanvas/discussions)

---

**让 AI 创作变得简单而强大！** 🎨✨

## 💬 交流社区

### 用户交流群

欢迎加入我们的用户交流群，与其他创作者一起分享经验、交流技巧/反馈问题/提交需求：

![交流群](assets/group.jpg)

### 联系作者

如果您有任何问题、建议或合作意向，欢迎直接联系作者：

![联系作者](assets/author.jpg)

---


