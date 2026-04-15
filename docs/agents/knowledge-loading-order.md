# Agents Knowledge Loading Order

## 目标

让 agents-cli 在处理创作工作流知识时，优先读取提纯资产，而不是直接吞原始大 JSON。

这份规范对应的知识来源包括：

- `assets/demo/index.json`
- `ai-metadata/workflow-patterns/index.json`
- `ai-metadata/workflow-patterns/*.analysis.json`
- `docs/agents/prompt-patterns/*.md`
- `assets/demo/*.json`

## 一、推荐读取顺序

### 第 1 层：案例索引层

先读：

- `assets/demo/index.json`
- `ai-metadata/workflow-patterns/index.json`

目的：

- 找到有哪些案例
- 判断哪个案例与当前任务最相关
- 决定后续应该打开哪份分析文件

这一层只负责“定位”，不负责深入推理。

### 第 2 层：结构化分析层

第二步读：

- `ai-metadata/workflow-patterns/<case>.analysis.json`

目的：

- 提取可复用方法
- 获取工作流结构、连续性模式、prompt 模板和失败信号
- 用最小上下文理解一个成功案例的有效规律

默认情况下，这一层应该是 agents 的主要知识来源。

### 第 3 层：提示词模式层

只有在需要写 prompt 或拆工作流时，再读：

- `docs/agents/prompt-patterns/*.md`

目的：

- 获取可直接复用的中文模板
- 获取 prompt 句式库
- 获取工作流拆解建议

这一层偏“表达与执行”，不是证据层。

### 第 4 层：原始案例层

只有在前面三层仍然证据不足时，才读：

- `assets/demo/*.json`

用途：

- 核对真实节点结构
- 回看具体链路
- 提取尚未进入分析文件的细节

注意：原始 JSON 是证据源，不应作为默认上下文入口。

## 二、禁止做法

以下做法应避免：

- 一开始就把整份 `assets/demo/001.json` 塞进上下文
- 同时读取大量原始案例 JSON
- 把案例里的具体名词（例如地铁、书、本地角色设定）误当成通用创作规则
- 跳过分析层，直接从原始 JSON 推理 prompt 方法

## 三、适用于 agents-cli 的执行规则

当任务属于以下场景时，建议遵守本顺序：

- 让 agent 总结成功工作流经验
- 让 agent 帮忙写连续性强的图生图 prompt
- 让 agent 设计 image -> image -> video 的分镜链路
- 让 agent 从既有案例中提炼方法论

推荐操作顺序：

1. 先读 `assets/demo/index.json`
2. 再读 `ai-metadata/workflow-patterns/index.json`
3. 根据匹配结果读取相关 `*.analysis.json`
4. 若需要 prompt 模板，再读 `docs/agents/prompt-patterns/*.md`
5. 如果还有证据缺口，再回源到 `assets/demo/*.json`

## 四、为什么这样设计

原因很简单：

- 索引层负责“找”
- 分析层负责“懂”
- 模板层负责“写”
- 原始层负责“证据兜底”

这样可以避免：

- 上下文过载
- 从噪声里现猜规律
- 案例细节污染通用方法
- agent 在大 JSON 里浪费 token

## 五、后续扩展建议

如果以后新增更多成功案例，建议每个案例都补齐：

- `assets/demo/<id>.json`
- `ai-metadata/workflow-patterns/<id>.analysis.json`
- 必要时补对应的 prompt pattern 文档

同时维护两个索引：

- `assets/demo/index.json`：偏案例目录
- `ai-metadata/workflow-patterns/index.json`：偏 agent 检索入口

这样以后不需要改系统提示，也能逐步扩展工作流知识库。
