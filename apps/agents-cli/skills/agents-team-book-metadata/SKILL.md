---
name: agents-team-book-metadata
description: 启用 agents-team 协作，双代理完成小说逐章元数据抽取与完整性审校（parser + checker），并写入可续跑的记忆索引。
---

# agents-team-book-metadata

目标：在小说章节级输入上，生成完整且可落库的章节元数据 JSON，并将关键结果写入 `.agents/memory` 形成可检索、可续跑的记忆资产。

## 必要前置

1. 必须先加载 `agents-team`。
2. 必须先加载 `cognitive-memory`。
3. 若任一步骤缺失，直接报错并停止，不允许静默降级。

## Team 角色

必须使用 agents team 工具并显式分工：

1. `parser`（优先 `agent_type: research`）
- 负责逐章抽取元数据。
- 输出必须覆盖每个 chapter。

2. `checker`（优先 `agent_type: reviewer`，必要时再补一个 `editor`）
- 负责完整性检查、缺失补全、重复清理、字段标准化。
- 保证最终输出结构稳定并校验关系网可用性。

## 目录与记忆布局（强制）

先生成 `BookSlug`（`lower-kebab-case`），然后创建目录：

- `.agents/memory/books/<BookSlug>/metadata/progress.json`
- `.agents/memory/books/<BookSlug>/metadata/chapters.json`
- `.agents/memory/books/<BookSlug>/metadata/character-graph.json`
- `.agents/memory/books/<BookSlug>/metadata/index.json`

`index.json` 至少包含：

```json
{
  "book": { "slug": "my-book", "title": "..." },
  "updatedAt": "2026-02-27T00:00:00.000Z",
  "chapters": { "total": 12, "path": "chapters.json" },
  "characterGraph": { "path": "character-graph.json", "nodeCount": 10, "edgeCount": 18 },
  "checkpoint": { "phase": "done", "next": "ready-for-storyboard" }
}
```

## 执行流程

1. `spawn_agent` 启动 `orchestrator` 或主代理自己先做输入切分。
2. `spawn_agent` 启动 parser。
3. `wait` 等 parser 完成，再把 parser 结果传给 checker。
4. `spawn_agent` 或 `send_input` 启动 checker。
5. `wait` 等待 checker 完成。
6. 主代理汇总 checker 结果，形成最终 JSON。
7. 用 `write_file` 写入四个 metadata 文件。
8. 用 `memory_save` 写入长期记忆：
- `semantic`: 角色关系网、角色主特征、章节核心冲突摘要
- `procedural`: 本次抽取规则、去重策略、命名策略
- `episodic`: 本次运行的输入范围、完成时间、异常与修复
9. 用 `memory_search` 复查写入结果可检索（至少 1 次）。

## 输出约束（严格）

最终回复给用户时：
- 只输出 JSON，不要 markdown、不要解释文本。
- 顶层必须包含：

```json
{
  "book": { "slug": "my-book", "title": "..." },
  "chapters": [
    {
      "chapter": 1,
      "title": "...",
      "summary": "...",
      "keywords": ["..."],
      "coreConflict": "...",
      "characters": [{ "name": "...", "description": "..." }],
      "props": [{ "name": "...", "description": "..." }],
      "scenes": [{ "name": "...", "description": "..." }],
      "locations": [{ "name": "...", "description": "..." }]
    }
  ],
  "characterGraph": {
    "nodes": [
      {
        "id": "role_a",
        "name": "角色A",
        "importance": "main|supporting|minor",
        "firstChapter": 1,
        "lastChapter": 20,
        "chapterSpan": [1, 2],
        "unlockChapter": 1
      }
    ],
    "edges": [
      {
        "sourceId": "role_a",
        "targetId": "role_b",
        "relation": "coappear|conflict",
        "weight": 3,
        "chapterHints": [1, 2]
      }
    ]
  }
}
```

## 质量要求

- 不漏章：`chapters.length` 必须与输入章节数量一致。
- 每章字段必须完整：`title`、`summary`、`keywords`、`coreConflict`、`characters`、`props`、`scenes`、`locations`。
- 实体数组去重（按 `name`，不区分大小写）。
- 章节序号稳定，不重排。
- `characterGraph.nodes` 至少覆盖 main/supporting。
- `edges` 去重、无自环，`relation` 只能是 `coappear` 或 `conflict`。
- 如关键字段无法确定，必须继续推导补全；禁止输出 `unknown/null/待补充`。
- 任何解析失败必须显式报错并给出原因，禁止静默兜底。

## 续跑规则

当用户说“继续”时，先做：

1. `read_file` 读取 `progress.json` + `index.json`。
2. `memory_search` 查询 `BookSlug` + `metadata` + `characterGraph`。
3. 仅在状态一致时继续，否则先返回冲突原因并停止。
