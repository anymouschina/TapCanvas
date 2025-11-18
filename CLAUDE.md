# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
```bash
# Install dependencies (uses pnpm workspaces)
pnpm install

# Start web development server (React + Vite)
pnpm dev:web

# Start API development server (NestJS)
pnpm dev:api

# Build the web application
pnpm build

# Run tests across all packages
pnpm test

# Run tests for a specific package
pnpm --filter @tapcanvas/web test
```

### Infrastructure
```bash
# Start backend infrastructure (ActivePieces workflow engine)
pnpm compose:up

# Stop backend infrastructure
pnpm compose:down

# View backend logs
pnpm compose:logs
```

### Deployment
```bash
# Deploy web app to Cloudflare Workers
pnpm deploy:web:cf

# Use CLI tools
pnpm tap [command]
```

## Architecture Overview

TapCanvas is a visual AI creation canvas platform built as a monorepo using pnpm workspaces. It provides a node-based visual editor for AI workflows, allowing users to connect different AI models (text, image, video) through intuitive drag-and-drop interfaces.

### Canvas System Architecture (Recently Refactored)

The canvas system has been comprehensively refactored following "Yahoo's military regulations" architectural principles:

**Core Philosophy:**
- **Single Responsibility**: Each component has one clear purpose
- **Unified Exports**: All modules export through a single entry point (`index.ts`)
- **Type Safety**: Comprehensive TypeScript interfaces throughout
- **Utility Abstraction**: Business logic separated from presentation components

**Canvas Module Structure:**
```
apps/web/src/canvas/
├── index.ts                    # Unified export module
├── store.ts                    # Zustand state management with history
├── utils/                      # Pure utility functions (business logic)
│   ├── constants.ts           # Centralized constants and node types
│   ├── node.ts                # Node manipulation utilities
│   ├── edge.ts                # Edge validation and creation
│   ├── layout.ts              # Layout algorithms (grid, hierarchical, radial, force-directed)
│   ├── geometry.ts            # Mathematical calculations
│   ├── validation.ts          # Data validation schemas
│   ├── serialization.ts       # Data persistence utilities
│   └── colors.ts              # Color schemes and themes
├── components/shared/          # Reusable UI components
│   ├── NodeBase/              # Base node component architecture
│   ├── Modal/                 # Reusable modal components
│   └── GitHubLanguageButton.tsx # Language switcher + GitHub icon
├── nodes/                     # Node type implementations
│   ├── TaskNode.refactored.tsx # Main workflow nodes
│   ├── GroupNode.tsx          # Group container nodes
│   └── IONode.tsx             # Input/output interface nodes
├── edges/                     # Edge type implementations
│   ├── TypedEdge.tsx          # Standard typed connections
│   └── OrthTypedEdge.tsx      # Orthogonal routing
├── i18n/                      # Internationalization system
│   └── index.ts               # Chinese/English translation functions
└── examples/                  # Demo components
```

### Node System Architecture

**Node Type Hierarchy:**
- **Base Node**: Abstract foundation with standardized interface
- **TaskNode**: Main workflow nodes (text→image→video pipeline)
- **GroupNode**: Containers for complex workflow organization with focus mode
- **IONode**: Input/output interfaces for cross-group connections

**Node Data Structure:**
```typescript
interface NodeData {
  id: string;
  label: string;
  kind: string; // 'text', 'image', 'video', 'subflow', etc.
  config: Record<string, any>;
  progress?: number;
  status?: 'idle'|'running'|'success'|'error';
  inputs?: string[];
  outputs?: string[];
}
```

**AI Model Integration:**
- **Text Generation**: Gemini 2.5 Flash/Pro models
- **Image Generation**: Qwen Image Plus (multiple resolutions: 16:9, 1:1, 9:16)
- **Video Generation**: Sora 2 with character references (@mentions)

### State Management Architecture

**Zustand Store Design:**
- **Complex State Management**: Graph structure (nodes, edges), execution state, history, clipboard, group management
- **History System**: Built-in undo/redo with 50-step history limit
- **Execution Tracking**: Real-time node status, progress tracking, cancellation support
- **Group Management**: Hierarchical organization with parent-child relationships and focus mode

**State Update Patterns:**
```typescript
// Always batch updates with history tracking
updateNodeData: (id, patch) => set((s) => ({
  nodes: s.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n),
  historyPast: [...s.historyPast, cloneGraph(s.nodes, s.edges)].slice(-50),
  historyFuture: [],
}))
```

### Edge System & Connection Validation

**Edge Architecture:**
- **Type-safe connections** with source/target validation
- **Multiple edge types**: smooth, orthogonal, bezier connections
- **Connection validation** preventing cycles and incompatible types
- **Animated edges** with visual feedback for state changes

### Layout Engine Architecture

**Multiple Layout Algorithms:**
- **Grid Layout**: Simple grid arrangement for node organization
- **Hierarchical Layout**: DAG-based topological sorting for workflows
- **Radial Layout**: Center-based layout with distance calculations
- **Force-Directed Layout**: Physics-based positioning with repulsion/attraction
- **Alignment Tools**: Grid snapping, horizontal/vertical alignment

### Internationalization System

**Simple but Effective i18n:**
- **Dual-language support** (Chinese default, English secondary)
- **React hooks** for component-level internationalization
- **Template interpolation** for dynamic content: `$t('项目「{{name}}」已保存', { name: 'My Project' })`
- **Local storage persistence** for language preferences
- **Language switcher component** in canvas top-right corner

### UI Component Organization

**Panel System:**
- **FloatingNav.tsx**: Left sidebar navigation (项目/工作流/资产/配置/历史)
- **ProjectPanel.tsx**: Project management and switching
- **TemplatePanel.tsx**: Workflow template browsing and application
- **AssetPanel.tsx**: Personal asset management
- **ModelPanel.tsx**: AI model configuration and API key management
- **AddNodePanel.tsx**: Node creation and configuration

**Component Patterns:**
- All UI components use **Mantine** library with glass morphism styling
- Consistent **Paper + Stack + Group** patterns for panel layouts
- **ActionIcon + Tooltip** for interactive elements
- **Modal** components for configuration dialogs

## Development Guidelines

### Canvas Development

**Core Principles:**
1. **Use utility functions**: Import from `utils/` rather than implementing new functions
2. **Follow component hierarchy**: Extend `NodeBase` for custom nodes
3. **Maintain type safety**: Use comprehensive TypeScript interfaces
4. **Leverage store actions**: Use Zustand actions rather than direct state mutation

```typescript
// Correct pattern
import { createNode, layoutHierarchical, getNodeInputTypes } from '@/canvas/utils';
import { NodeBase } from '@/canvas/components/shared/NodeBase';
import { useRFStore } from '@/canvas/store';

// Use store actions for state updates
const { updateNodeData, runNode, createEdge } = useRFStore();
```

### Adding New Node Types

1. Create node component extending `NodeBase`
2. Add node type to `utils/constants.ts` (`NODE_KINDS`)
3. Implement input/output type inference in `utils/node.ts`
4. Add configuration template
5. Register in node type system

### Internationalization Development

**Translation Functions:**
```typescript
import { $, $t, useI18n } from '@/canvas/i18n';

// Simple translation
$('确定') // Returns 'OK' or '确定' based on current language

// Template interpolation
$t('项目「{{name}}」已保存', { name: 'My Project' })

// React hook
const { currentLanguage, setLanguage, isEn, isZh } = useI18n();
```

**Adding Translations:**
1. Add entries to `enTranslations` object in `i18n/index.ts`
2. Use Chinese text as translation keys
3. Use `$()` for simple text, `$t()` for parameterized text
4. Test both languages in UI

### State Management Patterns

**Best Practices:**
- Prefer batch updates for performance
- Always include history tracking for user actions
- Use computed selectors for derived state
- Leverage the built-in clipboard and history systems

### Working with AI Models

**Model Integration:**
- Models are configured through `ModelPanel.tsx`
- API keys and endpoints managed through server API
- Each model defines input/output schema and execution logic
- Progress tracking and error handling built into node execution

## Technical Stack

**Frontend:**
- **React 18** + TypeScript + Vite
- **Mantine** component library + **React Flow** for node editor
- **Zustand** for state management
- **React Hook Form** + **Zod** for form validation
- **Custom internationalization system**

**Backend:**
- **NestJS** API with Prisma ORM
- **ActivePieces** workflow engine for orchestration
- **Temporal** for workflow management
- **Bull** for job queues

**Development:**
- **pnpm workspaces** for monorepo management
- **ESLint + Prettier** for code quality
- **TypeScript strict mode** for type safety

## Project Structure

```
TapCanvas/
├── apps/
│   ├── web/              # React frontend application
│   │   └── src/
│   │       ├── canvas/   # Core canvas system (recently refactored)
│   │       └── ui/       # UI components and panels
│   └── api/              # NestJS API service
├── packages/
│   ├── cli/              # Command line tools
│   ├── sdk/              # TypeScript SDK
│   └── pieces/           # AI model integrations (placeholder)
└── infra/
    └── activepieces/     # Backend workflow orchestration
```

The canvas module (`apps/web/src/canvas/`) contains the main visual editor and has been comprehensively refactored following strict architectural principles for maintainability and extensibility.