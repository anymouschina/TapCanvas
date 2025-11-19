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

