# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
```bash
# Install dependencies (uses pnpm workspaces)
pnpm install

# Start web development server
pnpm dev:web

# Start API development server
pnpm dev:api

# Build the web application
pnpm build

# Run tests across all packages
pnpm test
```

### Infrastructure
```bash
# Start backend infrastructure (ActivePieces)
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

TapCanvas is a visual AI creation canvas platform built as a monorepo using pnpm workspaces. The core concept is a node-based visual editor for AI workflows, allowing users to connect different AI models (text, image, video) through intuitive drag-and-drop interfaces.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ Canvas UI   │  │ Node Editor │  │ Asset Mgmt  │      │
│  │ (ReactFlow) │  │ Components  │  │ System      │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
                            │
                    HTTP/WebSocket API
                            │
┌─────────────────────────────────────────────────────────┐
│                   Backend Services                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ ActivePieces│  │ AI Models   │  │ File Storage│      │
│  │ Workflow    │  │ (Sora, etc) │  │ (S3/OSS)    │      │
│  │ Engine      │  └─────────────┘  └─────────────┘      │
│  └─────────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

### Key Components

#### Canvas System (`apps/web/src/canvas/`)
The core visual editor system built on ReactFlow:

- **Node System**: Extensible node types (text, image, video, group)
- **Edge System**: Type-safe connections between nodes with validation
- **State Management**: Zustand store with undo/redo, clipboard, and execution state
- **Layout Engine**: Multiple layout algorithms (grid, hierarchical, radial, force-directed)

**Recently Refactored**: The canvas module has been restructured following Yahoo's military regulations:
- Abstracted utility functions (`utils/`)
- Reusable component architecture (`components/shared/`)
- Single responsibility principle for all components
- Type-safe interfaces throughout

#### Node Architecture
Nodes are the primary building blocks in workflows:

```typescript
// Node structure (simplified)
interface NodeData {
  id: string;
  label: string;
  kind: string; // 'text', 'image', 'video', etc.
  config: Record<string, any>;
  progress?: number;
  status?: 'idle' | 'running' | 'success' | 'error';
  inputs?: string[];
  outputs?: string[];
}
```

**Key Node Types**:
- **TaskNode**: Main workflow nodes (text→image→video pipeline)
- **GroupNode**: Containers for organizing complex workflows
- **IONode**: Input/output interfaces for cross-group connections

#### State Management (`store.ts`)
Complex Zustand store managing:
- Graph structure (nodes, edges)
- Execution state and progress tracking
- History management (undo/redo)
- Clipboard operations
- Group management

### AI Model Integration

The system integrates multiple AI models through a standardized interface:

- **Sora 2**: Video generation with character references (@mentions)
- **Gemini 2.5**: Text generation and prompt optimization
- **Qwen Image Plus**: Image generation with multiple resolutions

### Workflow Engine

ActivePieces provides the backend workflow orchestration:
- DAG (Directed Acyclic Graph) execution
- Concurrency control
- Error handling and retry logic
- Real-time status updates

## Development Guidelines

### Canvas Development

When working with the canvas system:

1. **Use the refactored utilities**: Import from `utils/` rather than implementing new functions
2. **Follow the component hierarchy**: Extend `NodeBase` for custom nodes
3. **Maintain type safety**: Use the comprehensive TypeScript interfaces
4. **Leverage the store**: Use Zustand actions rather than direct state mutation

```typescript
// Correct: Use utility functions
import { createNode, layoutHierarchical, getNodeInputTypes } from '@/canvas/utils';

// Correct: Extend NodeBase for custom nodes
import { NodeBase } from '@/canvas/components/shared/NodeBase';

// Correct: Use store actions
const { updateNodeData, runNode } = useRFStore();
```

### Adding New Node Types

1. Create node component extending `NodeBase`
2. Add node type to constants (`NODE_KINDS`)
3. Implement input/output type inference
4. Add configuration template
5. Register in node registry

### Working with AI Models

Models are integrated through standardized interfaces in `packages/pieces/`. Each model piece defines:
- Input/output schema
- Execution logic
- Error handling
- Progress reporting

### State Management Patterns

The Zustand store handles complex state through actions:
- Prefer batch updates for performance
- Use history system for undo/redo
- Leverage computed selectors for derived state

## Technical Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Mantine component library + React Flow
- **State**: Zustand
- **Backend**: ActivePieces workflow engine
- **Build**: Vite + pnpm workspaces
- **Deployment**: Cloudflare Workers

## Project Structure

```
TapCanvas/
├── apps/
│   ├── web/              # React frontend application
│   └── api/              # NestJS API service
├── packages/
│   ├── cli/              # Command line tools
│   ├── sdk/              # TypeScript SDK
│   └── pieces/           # AI model integrations
├── infra/
│   └── activepieces/     # Backend workflow orchestration
└── apps/web/src/canvas/  # Core canvas system (recently refactored)
```

The canvas module (`apps/web/src/canvas/`) contains the main visual editor and has been comprehensively refactored for maintainability and extensibility.