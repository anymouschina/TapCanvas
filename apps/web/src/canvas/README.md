# Canvas 模块重构说明

## 概述

本模块已按照雅虎军规进行重构，主要目标包括：
- **组件职责单一化**：每个组件只负责一个特定功能
- **代码复用性提升**：抽象通用组件和工具函数
- **类型安全**：完整的TypeScript类型定义
- **可维护性**：清晰的文件结构和命名规范

## 目录结构

```
src/canvas/
├── index.ts                          # 统一导出
├── Canvas.tsx                        # 主画布组件
├── store.ts                          # 状态管理
├── insertMenuStore.ts               # 插入菜单状态
├── components/                       # 可复用组件
│   ├── shared/                       # 共享组件
│   │   ├── NodeBase/                 # 节点基础组件
│   │   │   ├── NodeBase.tsx         # 节点基础容器
│   │   │   ├── NodeHeader.tsx       # 节点头部
│   │   │   ├── NodeContent.tsx      # 节点内容
│   │   │   ├── NodeHandles.tsx      # 节点手柄
│   │   │   └── NodeBase.types.ts    # 类型定义
│   │   ├── Modal/                    # 模态框组件
│   │   │   ├── BaseModal.tsx        # 基础模态框
│   │   │   └── NodeConfigModal.tsx  # 节点配置模态框
│   │   └── index.ts                  # 共享组件导出
│   ├── Canvas/                       # 画布组件（计划）
│   └── managers/                     # 功能管理器（计划）
├── nodes/                           # 节点组件
│   ├── TaskNode.tsx                 # 原始任务节点
│   ├── TaskNode.refactored.tsx      # 重构后的任务节点
│   ├── GroupNode.tsx                # 分组节点
│   ├── IONode.tsx                   # 输入输出节点
│   └── index.ts                     # 节点组件导出
├── edges/                           # 边组件
│   ├── TypedEdge.tsx                # 类型化边
│   ├── OrthTypedEdge.tsx            # 正交类型边
│   └── index.ts                     # 边组件导出
├── stores/                          # 状态管理（计划重构）
├── services/                        # 业务逻辑服务（计划）
├── hooks/                           # 全局hooks（计划）
├── types/                           # 类型定义（计划）
├── utils/                           # 工具函数
│   ├── constants.ts                 # 常量定义
│   ├── colors.ts                    # 颜色工具
│   ├── canvas.ts                    # 画布工具
│   ├── node.ts                      # 节点工具
│   ├── edge.ts                      # 边工具
│   ├── layout.ts                    # 布局工具
│   └── index.ts                     # 工具函数导出
└── README.md                        # 文档说明
```

## 重构成果

### 1. 工具函数抽象

#### 常量管理 (`utils/constants.ts`)
- 集中管理所有魔法数字和配置项
- 颜色、类型、快捷键等常量统一维护
- 便于主题切换和配置调整

#### 颜色工具 (`utils/colors.ts`)
- 类型化的颜色获取函数
- 支持主题切换
- 渐变色和透明度调整工具

#### 画布工具 (`utils/canvas.ts`)
- 节点和边的操作函数
- 图结构验证和分析
- 坐标转换和几何计算

#### 节点工具 (`utils/node.ts`)
- 节点创建和验证
- 类型推断和配置模板
- 节点执行顺序计算

#### 边工具 (`utils/edge.ts`)
- 边创建和验证
- 类型推断和路径计算
- 连接关系分析

#### 布局工具 (`utils/layout.ts`)
- 多种布局算法：网格、层级、径向、力导向
- 节点对齐和排列
- 布局边界计算

### 2. 组件重构

#### NodeBase 组件系统
- **NodeBase**: 节点基础容器，提供统一的结构和事件处理
- **NodeHeader**: 节点头部，显示标题、类型和状态
- **NodeContent**: 节点内容，显示描述和操作按钮
- **NodeHandles**: 节点手柄，处理输入输出连接

#### Modal 组件系统
- **BaseModal**: 基础模态框，提供通用的模态框功能
- **NodeConfigModal**: 节点配置模态框，支持动态配置界面

#### TaskNode 重构
- 从1800行代码拆分为多个小组件
- 配置逻辑抽象为独立组件
- 工具栏操作统一管理
- 支持多种节点类型配置

### 3. 设计原则遵循

#### 单一职责原则 (SRP)
- 每个工具函数只负责一个特定功能
- 组件职责明确，边界清晰
- 状态管理按功能拆分

#### 开闭原则 (OCP)
- 通过组件组合支持扩展
- 配置驱动的组件行为
- 类型化的节点和边注册机制

#### 依赖倒置原则 (DIP)
- 组件依赖于抽象接口
- 工具函数可独立测试
- 服务层与UI层分离

#### 组合优于继承
- NodeBase通过组合Header、Content、Handles构建
- 布局算法通过组合实现复杂效果
- 功能通过服务和hooks组合

## 使用指南

### 基础用法

```typescript
// 导入重构后的组件
import { TaskNodeRefactored, NodeBase } from '@/canvas';

// 使用重构后的任务节点
const node = <TaskNodeRefactored id="node-1" data={nodeData} selected={true} />;

// 使用基础节点组件自定义内容
const customNode = (
  <NodeBase
    data={customData}
    selected={false}
    position={{ x: 100, y: 100 }}
    id="custom-node"
    type="custom"
  >
    <div>自定义内容</div>
  </NodeBase>
);
```

### 工具函数使用

```typescript
import {
  createNode,
  layoutHierarchical,
  validateNode,
  getNodeInputTypes,
  getEdgeColorForType
} from '@/canvas/utils';

// 创建新节点
const newNode = createNode('taskNode', 'text', { x: 0, y: 0 }, {
  label: 'Text Node',
  config: { prompt: 'Hello world' }
});

// 层级布局
const result = layoutHierarchical(nodes, edges);

// 节点验证
const validation = validateNode(node);

// 获取节点输入类型
const inputs = getNodeInputTypes(node);
```

### 自定义节点类型

```typescript
import { NodeBase } from '@/canvas';
import { getNodeInputTypes, getNodeOutputTypes } from '@/canvas/utils';

const CustomNode: React.FC<NodeProps> = (props) => {
  const { id, data, selected } = props;

  return (
    <NodeBase
      data={{
        ...data,
        inputs: getNodeInputTypes(props),
        outputs: getNodeOutputTypes(props),
      }}
      selected={selected}
      position={props.position}
      id={id}
      type="custom"
    >
      <div>自定义节点内容</div>
    </NodeBase>
  );
};
```

## 性能优化

1. **React.memo**: 所有组件都使用memo优化重渲染
2. **useCallback**: 事件处理函数使用useCallback缓存
3. **useMemo**: 计算密集型操作使用useMemo缓存
4. **按需导出**: 通过index.ts实现tree-shaking
5. **类型检查**: 完整的TypeScript类型定义

## 测试策略

1. **单元测试**: 每个工具函数都有对应的单元测试
2. **组件测试**: 组件快照测试和交互测试
3. **集成测试**: 布局算法和图结构验证测试
4. **性能测试**: 大规模节点渲染性能测试

## 下一步计划

1. **状态管理重构**: 将store.ts拆分为多个子store
2. **服务层抽象**: 创建CanvasService、NodeService等
3. **自定义Hooks**: 提供useCanvasState、useNodeState等hooks
4. **类型系统完善**: 添加更多的Zod类型验证
5. **主题系统**: 实现完整的主题切换功能
6. **国际化支持**: 添加多语言支持

## 迁移指南

从原始组件迁移到重构后组件：

1. **更新导入路径**: 使用新的统一导出
2. **调整API使用**: 使用新的工具函数和hooks
3. **类型更新**: 使用新的类型定义
4. **配置迁移**: 迁移节点配置格式
5. **测试更新**: 更新相关测试用例

## 注意事项

1. **向后兼容**: 原始组件暂时保留，便于渐进式迁移
2. **类型安全**: 确保所有新API都有完整的类型定义
3. **文档维护**: 及时更新API文档和使用示例
4. **性能监控**: 关注重构后的性能表现
5. **用户反馈**: 收集用户对新API的使用反馈

通过这次重构，Canvas模块的可维护性、可扩展性和开发效率都得到了显著提升。建议采用渐进式迁移策略，逐步替换原始组件。