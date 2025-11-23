# TapCanvas
**Language:** [中文](README.md) | English
**Visual AI Creation Canvas (Zero GPU Required)**

## 📝 Introduction

The TapCanvas project is specially optimized for Sora 2 with dedicated canvas capabilities, supporting direct Remix chain calls and multi-account sharing, enabling users to perfectly preserve their creative footprints. But our vision extends far beyond this:

**🎨 Innovative Visual Workflow**

- Pioneer in transforming complex AI creation processes into intuitive node-based connection operations
- Support complete creation pipeline: Text→Image→Image-to-Video→Video Composition
- Intelligent type matching system automatically prevents incorrect connections, making creation more reliable

**⚡ Powerful Canvas Interaction Experience**

- High-performance rendering based on React Flow, supporting smooth operation of complex workflows
- Unique group focus mode for clear management of large-scale projects
- Intelligent assisted connections, quickly create next steps by dragging from text/image nodes

**🧠 Intelligent Creation Assistance**

- Integrated Gemini 2.5 for prompt optimization and intelligent suggestions
- Support historical prompt reuse, avoiding repetitive thinking
- Sora 2 character @mention functionality for precise video character control

**🔧 Enterprise-Level Engineering Capabilities**

- Zero GPU requirements, all computation relies on cloud APIs, lightweight deployment
- Modular architecture design, easy to extend new AI models and features
- Complete project management and asset governance system

Through visual workflows, we not only lower the barrier to AI video creation but also provide creators with a professional and efficient creation platform.

## 🖼️ Feature Preview

![Feature Preview](assets/feature.jpg)

TapCanvas's visual canvas interface demonstrates powerful AI creation workflow capabilities: starting from text prompts, generating images and videos through intelligent connections, achieving the complete transformation from creative ideas to finished works.

## 📅 Changelog

- **2025-11-24**: Introduced the new **Character Node** and **Auto Mention** workflow so Sora characters can be managed directly on the canvas.
  - A character node lets you pick a Sora token, browse roles (cover, username, description), copy `@username`, or clear the binding without leaving the canvas.
  - The "Add to canvas" button inside the Assets panel now drops a `kind=character` node and pre-fills username/cover/description automatically.
  - Every prompt-based node exposes an “Auto reference role” dropdown that prioritizes linked character nodes and injects the corresponding `@username` into the prompt.
- **2025-11-23**: Completed the full loop of "AI assistant emits tool-call → client executes canvas tools → result is pushed back and the LLM continues responding". The Dark Assistant now subscribes to `/ai/tool-events`, runs the corresponding `CanvasService` handler, and reports results via `/ai/tools/result`. See the workflow demo below:
  - Intelligent node generation: ![2025-11-23-ai](assets/2025-11-23-ai.jpg)
  - Highlights:
    - Backend SSE pushes `tool-call`; the client waits for `tool-input-available` before executing to ensure complete parameters.
    - `CanvasService` maps logical types (e.g., `video` → `composeVideo`) so the canvas shows the supported node types instantly.
    - After sending `tool-result`, `UseChatAssistant` automatically issues the next `/ai/chat/stream` request, letting the LLM acknowledge tool status and continue the conversation.
- **2025-11-21**: Added a new set of feature screenshots covering assets/drafts/published works and role creation, located at `assets/2025-11-21-*.jpg`.
  - Assets & drafts: ![2025-11-21-drafts](assets/2025-11-21-drafts.jpg)
  - Role list: ![2025-11-21-role](assets/2025-11-21-role.jpg)
  - Role creation: ![2025-11-21-role-create](assets/2025-11-21-role-create.jpg)
  - AI overview: ![2025-11-21-ai](assets/2025-11-21-ai.jpg)

## ⚙️ Configure Models Before Use

**Important: Before using TapCanvas, you must configure AI models first!**

![Model Configuration](assets/setting.jpg)

### Model-Node Mapping

Different AI models support different node types. Please configure them correctly:

| Node Type | Supported Models | Function Description |
|-----------|----------------|---------------------|
| **🎬 Video Node** | **Sora 2**, Runway Gen-3, Runway Gen-2, Pika Labs V2, Pika Labs V1.5, HeyGen Video, Synthesia Video, LumaLabs Dream Machine, Kaiber Video, Stable Video Diffusion | Image-to-Video, Text-to-Video, Video Composition, Animation Creation |
| **🖼️ Image Node** | **Qwen Image Plus**, Gemini 2.5 Flash Image, DALL-E 3, DALL-E 2, Stable Diffusion XL, Stable Diffusion V3, Midjourney V6, FLUX.1 Pro, FLUX.1 Dev, Kolors IMG, Hunyuan Image | Text-to-Image, Image Generation, Multiple Resolutions, Style Transfer |
| **📝 Text Node** | **Gemini 2.5 Flash**, Gemini 2.5 Pro, Gemini 3 Pro Preview, Claude 3.5 Sonnet, Claude 3 Haiku, GPT-4o, GPT-4o Mini, DeepSeek V3, Moonshot V1 8K, Kimi Chat | Text Generation, Prompt Optimization, Smart Suggestions, Content Creation |

### Configuration Steps

1. **Open Model Configuration Panel**: Click "Model Configuration" in the right panel
2. **Add Providers**: Add Sora, Qwen, Gemini models as needed
3. **Configure API Keys**: Fill in real API keys from each platform
4. **Test Connection**: Ensure each model can be called normally

> 💡 **Tip**: Only nodes with correctly configured models can work properly. For example:
> - Want to generate videos? → Must configure **Sora 2**, **Runway** or **Pika** video models
> - Want to generate images? → Must configure **Qwen**, **DALL-E**, **Stable Diffusion** or **FLUX** image models
> - Want to optimize prompts? → Must configure **Gemini**, **Claude**, **GPT** or **DeepSeek** text models

### 🎯 Recommended Configuration Combinations

**Beginner Recommended Setup**:
- 📝 **Text**: Gemini 2.5 Flash (Cost-effective)
- 🖼️ **Image**: Qwen Image Plus or FLUX.1 Pro (High quality)
- 🎬 **Video**: Sora 2 (Most powerful)

**Professional Setup**:
- 📝 **Text**: Gemini 2.5 Pro or Claude 3.5 Sonnet
- 🖼️ **Image**: DALL-E 3 or Midjourney V6
- 🎬 **Video**: Runway Gen-3 or Pika Labs V2

## 🚀 Quick Start

### Method 1: Docker Run (Recommended)

Use Docker to quickly start all dependencies without manually configuring databases and cache.

```bash
# 1. Start basic services (PostgreSQL + Redis)
docker-compose -f docker-compose.minimal.yml up -d

# 2. Configure environment variables
cp .env.example .env
# Edit .env file and add your API keys

# 3. Install dependencies
pnpm install

# 4. Start development servers
pnpm dev:web    # Frontend service (http://localhost:5173)
pnpm dev:api    # API service (http://localhost:3001)
```

**Management Interface Access:**
- Database Management: http://localhost:8080 (Adminer)
- Redis Management: http://localhost:8081 (Redis Commander)

### Method 2: Local Run

If you have PostgreSQL and Redis installed locally.

```bash
# 1. Ensure local services are running
# PostgreSQL (port 5432)
# Redis (port 6379)

# 2. Configure database connection
# Create database tapCanvas
# Modify DATABASE_URL in apps/api/.env

# 3. Install dependencies
pnpm install

# 4. Database migration
cd apps/api
pnpm prisma:generate
pnpm prisma:migrate

# 5. Start development servers
pnpm dev:web    # Frontend service
pnpm dev:api    # API service
```

### Environment Configuration

The project uses `.env.example` as a configuration template. Please follow these steps:

```bash
# 1. Copy main configuration template
cp .env.example .env

# 2. Edit .env file and fill in real API keys
# Required configurations:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tapCanvas?schema=public"
GITHUB_CLIENT_ID="your_github_client_id"
GITHUB_CLIENT_SECRET="your_github_client_secret"
JWT_SECRET="your-strong-jwt-secret"
HF_TOKEN="your_huggingface_token"
SILICONFLOW_API_KEY="your_siliconflow_api_key"
SORA_API_KEY="your_sora_api_key"

# 3. API service will automatically read .env file from project root
# For API-specific configuration, create apps/api/.env.local file
```

**Important Notes:**
- ⚠️ **Do not commit real .env file to Git** (configured in .gitignore)
- 🔑 All API keys need to be registered and obtained from corresponding platforms
- 📝 Project provides two .env.example templates: root directory and apps/api/ directory
- ✅ Project configured .gitignore to only ignore .env files but keep .env.example templates
- 🔒 Ensure API key security, only fill real keys in local .env file
- 📁 **Unified API Configuration Management**: Recommended to configure .env in project root, API service will read automatically
- 🔐 **Sensitive Files Removed**: Original apps/api/.env file (with real keys) has been removed from project

**Get API Keys:**
1. **GitHub OAuth**: https://github.com/settings/applications/new
2. **Hugging Face**: https://huggingface.co/settings/tokens
3. **Silicon Flow**: https://siliconflow.cn
4. **Sora API**: Need to contact for access permission

### Verify Running

After successful startup, visit the following addresses to verify:

- **Frontend Application**: http://localhost:5173
- **API Service**: http://localhost:3001
- **API Documentation**: http://localhost:3001/api (if Swagger available)

If you see the TapCanvas interface, it means running successfully!

## 🎯 Quick Experience

If you want to quickly experience TapCanvas features, you can use the following pre-configured model provider settings:

### Model Configuration Example

In the application's "Model Configuration" panel, you can import the following configuration structure (sensitive information removed):

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
          "label": "videos domain",
          "baseUrl": "https://videos.beqlee.icu",
          "shared": false
        },
        {
          "id": "72925a18-1445-43bd-a8e8-9ef051f66ed0",
          "key": "sora",
          "label": "sora domain",
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

### Quick Start Steps

1. **Configure API Keys**: Replace `YOUR_*_API_KEY_HERE` in the above configuration with your real API keys
2. **Import Configuration**: Import the modified configuration in the Model Configuration panel
3. **Create First Workflow**:
   - Drag "Text" node from the left sidebar to the canvas
   - Enter a simple prompt, like "A cute cat playing in a garden"
   - Connect to "Image" node, select 16:9 aspect ratio
   - Click the run button to start generation

### Experience Tips

- 🎨 **Start with Text-to-Image**: Begin with text generation to understand the basic workflow
- 🎬 **Then try Image-to-Video**: Use generated images to create video content
- 💡 **Use Intelligent Prompts**: Click the "AI Optimize" button in text nodes for better prompt suggestions
- 📱 **Adjust Parameters**: Try different resolutions, durations, and other parameter settings

## 🌐 Proxy Configuration Guide

Due to unavoidable factors in the domestic network environment, some AI services may not be directly accessible. It is recommended to use Cloudflare Workers and Durable Objects to configure a proxy to solve this problem.

### Prerequisites

- Register Cloudflare account: https://dash.cloudflare.com/
- Enable Durable Objects feature

### Configuration Steps

#### 1. Create Worker

1. Log in to Cloudflare Dashboard
2. Select "Workers & Pages" → "Create application" → "Create Worker"
3. Name your Worker (e.g., `tapcanvas-proxy`)
4. Click "Deploy"

#### 2. Enable Durable Objects

1. In Worker settings, find "Settings" → "Durable Objects"
2. Click "Configure Durable Objects"
3. Confirm to enable this feature

#### 3. Configure Worker Script

Copy the following script to the Worker editor:

```javascript
import { DurableObject } from "cloudflare:workers";

export class MyDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    // Forwarding logic: receive request from Durable Object, forward to upstream

    // Domain mapping: map proxy domains to real domains
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

#### 4. Bind Durable Object

1. In Worker settings, find "Settings" → "Variables"
2. Add Durable Object binding:
   - **Variable name**: `MY_DURABLE_OBJECT`
   - **Durable Object class name**: `MyDurableObject`
   - **Script name**: Select your created Worker script

#### 5. Deploy Worker

1. Save and deploy Worker script
2. Record Worker access URL: `https://your-worker-name.your-subdomain.workers.dev`

#### 6. Update TapCanvas Configuration

In TapCanvas's model configuration, update the endpoint URL to your Worker address:

```json
{
  "endpoints": [
    {
      "key": "sora",
      "label": "sora domain",
      "baseUrl": "https://your-worker-name.your-subdomain.workers.dev"
    }
  ]
}
```

### Domain Mapping Explanation

Domain mapping in the Worker script:

| Proxy Domain | Real Domain | Purpose |
|-------------|------------|---------|
| `sora2.beqlee.icu` | `sora.chatgpt.com` | Sora API |
| `videos.beqlee.icu` | `videos.openai.com` | OpenAI Videos API |
| `generativelanguage.beqlee.icu` | `generativelanguage.googleapis.com` | Gemini API |

### Troubleshooting

#### Common Issues

1. **Worker returns 403 error**
   - Check if Durable Object is correctly bound
   - Confirm Variable name is `MY_DURABLE_OBJECT`

2. **Request timeout**
   - Check Worker execution time limit
   - Consider upgrading to paid plan for longer execution time

3. **Partial request failures**
   - Check if upstream services are running normally
   - View Worker log information

#### Test Proxy

Create a test file to verify if the proxy is working properly:

```bash
# Test Sora API proxy
curl -X POST "https://your-worker-name.your-subdomain.workers.dev" \
  -H "Authorization: Bearer YOUR_SORA_TOKEN" \
  -H "Content-Type: application/json"
```

### Security Tips

- 🔒 Regularly rotate API keys
- 🛡️ Enable Cloudflare firewall rules
- 📊 Monitor Worker usage and costs
- 🔐 Do not hardcode sensitive information in code

With the above configuration, you can stably use TapCanvas's AI features in the domestic environment.

---

## 🎯 Core Features

### 📋 Project Management

- **Multi-Project Support**: Create and manage multiple independent projects, each containing independent workflows
- **Project Switching**: Quickly switch between different projects, each maintaining an independent workspace
- **History Records**: View and manage creation history (in development)
- **User Account**: Support user login and personal asset management

### 🎨 Visual Canvas Editor

- **Node-Based Workflow**: Build complex AI generation processes through drag-and-drop nodes and connection lines
- **Intelligent Connections**: Automatic type matching ensures correct data flow between nodes
- **Multiple Node Types**:
  - **Text Nodes**: Input prompts with AI optimization suggestions
  - **Image Nodes**: Text-to-image, image upload, image editing
  - **Video Nodes**: Image-to-video, text-to-video, video composition
  - **Group Nodes**: Package multiple nodes into reusable components
- **Real-time Preview**: Instantly view node execution results and generated content

### 🤖 AI Model Integration

**Text Generation**:
- **Gemini 2.5 Flash / Pro**: Advanced text generation models
- **Intelligent Prompt Optimization**: Automatically optimize and improve input prompts
- **Text Enhancement**: Support text continuation and style conversion

**Image Generation**:
- **Qwen Image Plus**: High-performance image generation model
- **Multi-Resolution Support**: 16:9, 1:1, 9:16 three common aspect ratios
- **Batch Generation**: Support 1-5 images generated simultaneously
- **Text-to-Image**: Generate high-quality images from text descriptions

**Video Generation**:
- **Sora 2**: OpenAI's latest video generation model
- **Character References**: Support @mention functionality for precise video character control
- **Multiple Duration Options**: Support 10s, 15s video generation
- **Image-to-Video**: Generate dynamic videos from static images
- **Text-to-Video**: Directly generate video content from text

**Model Management**:
- **Flexible Configuration**: Support custom model endpoints and parameters
- **Multiple Providers**: Integrate different AI model providers
- **API Key Management**: Secure key storage and management

### 🛠️ Advanced Editing Features

**Template System**:
- Browse and reference workflow templates from server
- Support public workflows and personal workflows
- Drag templates to canvas for quick creation

**Asset Library**:
- Manage personal creation material assets
- Sora draft support and asset management
- Support asset reuse in workflows

**Intelligent Assistance**:
- Intelligent connection type matching, preventing incorrect connections
- Node auto-layout algorithm support
- Right-click menu shortcut operations

**Model Configuration**:
- AI model parameter configuration interface
- Support multiple AI model switching

### 🌍 Internationalization Support

- **Multilingual Interface**: Support Chinese and English interface switching
- **Real-time Translation**: Click language icon to switch interface language without page refresh
- **Complete Localization**: All interface elements, prompt messages, and error messages support multiple languages
- **Persistent Settings**: Language selection automatically saved, maintains user preferences for next visit

### 🎬 Content Generation Workflows

- **Text-to-Image Workflow**: Text → Image Generation
- **Image-to-Video Workflow**: Image → Video Generation
- **Text-to-Video Workflow**: Text → Direct Video Generation
- **Composite Workflow**: Text → Image → Video → Post-processing
- **Parallel Processing**: Support simultaneous execution of multiple nodes to improve efficiency

### ⌨️ Quick Operations

**Keyboard Shortcuts**:
- `Delete/Backspace`: Delete selected nodes or edges
- Double-click blank area: Exit to upper level in focus mode

**Right-Click Menus**:
- Node right-click: Run, stop, copy, delete, rename and other operations
- Edge right-click: Delete connection
- Canvas right-click: Continue creation from image/text

**Drag Operations**:
- Drag templates/assets to canvas for quick node creation
- Support image file drag-and-drop upload

**Batch Operations**: Support multi-select nodes for batch editing and operations

### 💾 Data Management

- **Local Storage**: Automatically save work progress to browser
- **Cloud Sync**: Support project data cloud backup
- **Export Functions**:
  - Export generated images, videos and other content
  - Export workflow configurations
  - Export project documentation

## 🌟 Featured Highlights

### 🎯 User Experience

- **Zero Learning Curve**: Intuitive visual interface, no programming required
- **Real-time Feedback**: Node execution status updates in real-time with progress bars
- **Intelligent Prompts**: Provide operation suggestions and parameter recommendations based on context
- **Responsive Design**: Adapt to various screen sizes, support mobile operation
- **GitHub Integration**: One-click access to project repository for developers to understand and contribute code

### 🔧 Technical Features

- **Zero GPU Requirements**: All computation relies on cloud AI APIs, no local hardware requirements
- **High-Performance Rendering**: Efficient canvas rendering based on React Flow
- **Modular Architecture**: Easy to extend new AI models and features
- **Type Safety**: Use TypeScript to ensure code quality
- **Custom Internationalization System**: Support Chinese/English interface switching, complete localization support

### 🚀 Innovative Features

- **Intelligent Connections**: Automatically identify node type compatibility, prevent incorrect connections
- **Group Focus Mode**: Support layered management and editing of complex workflows
- **Template Dragging**: Directly drag templates from sidebar to canvas for quick creation
- **Parameter Inheritance**: Automatically pass and inherit related parameters between nodes

## 🧱 Architecture Overview

### Frontend Technology Stack

- **React 18** + **TypeScript**: Modern frontend framework
- **React Flow**: Powerful node editor supporting complex visual workflows
- **Mantine**: Elegant UI component library
- **Zustand**: Lightweight state management
- **Custom Internationalization System**: Support Chinese/English interface switching, complete localization support
- **Vite**: Fast build tool

### Backend Integration

- **NestJS + Bull Queue**: High-performance workflow orchestration and task management
- **Third-party AI APIs**:
  - OpenAI Sora 2 (video generation)
  - Gemini 2.5 (text generation)
  - Qwen Image Plus (image generation)

### Data Storage

- **Local Storage**: Browser localStorage for templates and cache
- **Cloud Storage**: S3/OSS for generated media files
- **Project Data**: Support cloud sync and backup

## 🚀 Quick Start

### Environment Requirements

- Node.js 18+
- pnpm 10.8.1+
- Modern browser (Chrome 90+, Firefox 88+, Safari 14+)

### Installation and Running

```bash
# Clone project
git clone https://github.com/libiqiang/TapCanvas.git
cd TapCanvas

# Install dependencies
pnpm install

# Start development server
pnpm dev:web

# Start API server
pnpm dev:api
```

### Configure AI APIs

1. Create `.env` file in project root directory
2. Configure required API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key
   GOOGLE_API_KEY=your_google_api_key
   QWEN_API_KEY=your_qwen_api_key
   ```

## 📖 Usage Guide

### Creating Your First Project

1. Open TapCanvas application
2. Click project name area, enter project name
3. Drag "Text" node from left panel to canvas
4. Enter prompts in text node
5. Connect other nodes to build workflow
6. Click run button to start generation

### Node Type Details

#### Text Node (Text)

- Used for input and prompt optimization
- Support AI intelligent suggestions
- Can connect to image and video generation nodes

#### Image Node (Image)

- Support text-to-image and image upload
- Multiple resolution options
- Batch generation functionality

#### Video Node (Video)

- Image-to-video and text-to-video
- Support multiple durations
- Character reference functionality

### Workflow Examples

#### Basic Text-to-Image

```
Text Node → Image Node
```

#### Image-to-Video

```
Image Node → Video Node
```

#### Composite Workflow

```
Text Node → Image Node → Video Node
```

## 🔧 Development Guide

### Project Structure

```
TapCanvas/
├── apps/
│   ├── web/              # Frontend application
│   │   └── src/
│   │       ├── canvas/   # Core canvas system (including i18n internationalization)
│   │       └── ui/       # UI components
│   └── api/              # API service
├── packages/
│   ├── cli/              # Command line tools
│   └── sdk/              # SDK package
```

### Adding New AI Models

1. Create new adapter in `apps/api/src/task/adapters`
2. Define input/output interfaces
3. Implement model call logic
4. Add corresponding node types in frontend

### Custom Nodes

Reference `apps/web/src/canvas/nodes/TaskNode.tsx` to create custom node components.

### Internationalization Development

#### Translation System Architecture

The project uses a custom internationalization system supporting Chinese and English:

```typescript
// Translation functions
import { $, $t, useI18n } from '../canvas/i18n'

// Basic translation
$('确定') // 'OK' or '确定'

// Parameterized translation
$t('项目「{{name}}」已保存', { name: 'My Project' })
// "Project \"My Project\" saved" or "项目「My Project」已保存"
```

#### Adding New Translations

1. Add translations to `enTranslations` object in `apps/web/src/canvas/i18n/index.ts`:

```typescript
const enTranslations = {
  // Existing translations...
  'New Chinese Text': 'New English Text',
  'Text with parameters': 'Text with {{parameter}}',
}
```

2. Use translation functions in components:

```tsx
import { $, $t } from '../canvas/i18n'

function MyComponent() {
  return (
    <div>
      <p>{$('New Chinese Text')}</p>
      <p>{$t('Text with parameters', { parameter: 'value' })}</p>
    </div>
  )
}
```

#### Language Switching Component

The system provides ready-to-use language switching components supporting:

- Click to switch between Chinese and English
- Language preference persistence to localStorage
- Real-time interface updates, no page refresh required
- Icon and tooltip support

```tsx
// Use in components
const { currentLanguage, setLanguage, isEn, isZh } = useI18n()
```

#### Best Practices

1. **All user-visible text should use translation functions**
2. **Keep translation keys as original Chinese text** for easy maintenance and understanding
3. **Use $t() for parameterized text, use $() for simple text**
4. **Add corresponding English translations synchronously when adding new features**
5. **Test interface layout in both languages** to ensure text length changes don't affect aesthetics

## 🤝 Contributing Guidelines

Welcome to submit Issues and Pull Requests!

### Development Workflow

1. Fork project
2. Create feature branch
3. Submit changes
4. Initiate Pull Request

### Code Standards

- Use TypeScript
- Follow ESLint rules
- Write unit tests
- Update documentation

## 📄 License

MIT License

## 🔗 Related Links

- [GitHub Repository](https://github.com/anymouschina/TapCanvas)
- [Issue Feedback](https://github.com/anymouschina/TapCanvas/issues)
- [Feature Suggestions](https://github.com/anymouschina/TapCanvas/discussions)

---

**Making AI Creation Simple and Powerful!** 🎨✨

## 💬 Community

### User Communication Group

Welcome to join our user communication group to share experiences, exchange skills/feedback issues/submit requirements with other creators:

![Communication Group](assets/group.jpg)

### Contact Author

If you have any questions, suggestions, or cooperation intentions, welcome to directly contact the author:

![Contact Author](assets/author.jpg)
