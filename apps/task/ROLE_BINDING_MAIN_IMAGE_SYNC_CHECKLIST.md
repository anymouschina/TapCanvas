# 角色绑定主图 / 资产回填 / 单图 JSON 一致性 Checklist

更新时间：2026-04-01  
范围：`apps/web/src/runner/remoteRunner.ts`（单图生成与角色绑定自动回填主链路）

## 目标

- 持久角色资产在“主图更新”后，必须同步写入书籍元数据（`books/<bookId>/index.json -> assets.roleCards`）以保障连续性。
- 图片生成回填后，节点数据与引用协议字段必须一致，不能出现“主图有了、元数据没跟上”的半同步状态。
- 单图生成 `imageResults` JSON 结构要与其他链路统一（带 `assetId/assetRefId/assetName` 能力）。

## P0（必须完成）

- [x] **P0-1 角色主图持久化：project 资产 + book 元数据双写**
  - 现状问题：自动回填仅写 `upsertProjectRoleCardAsset`，未保证同步 `book roleCards`。
  - 修复：
    - `persistRoleCardImageBinding(...)` 增加 `upsertProjectBookRoleCard(...)` 同步分支。
    - `sourceBookId` 缺失时增加“单书项目自动补齐”路径（`listProjectBooks` 仅 1 本时自动选中）。
  - 证据：
    - 代码：`apps/web/src/runner/remoteRunner.ts` `listProjectBooks` 导入与 `upsertProjectBookRoleCard` 导入（行 6/12）
    - 代码：`persistRoleCardImageBinding` 新返回字段 `sourceBookId/metadataSynced/bookScopeStatus`（行 452-544）

- [x] **P0-2 资产更新后的同步结果显式化（不再静默）**
  - 现状问题：回填失败只打日志，缺少结构化状态，不利于后续诊断。
  - 修复：
    - 成功时写入：`roleBindingMetadataSynced`、`roleBindingBookScope`、`roleBindingMetadataSyncedAt`。
    - 失败时写入：`roleBindingSyncError`，并弹 `warning`。
    - 同步成功/未同步都写可检索日志。
  - 证据：
    - 代码：`remoteRunner.ts` 行 4665-4685（状态字段 + 成功/未同步日志 + warning）

- [x] **P0-3 单图生成 `imageResults` 结构统一**
  - 现状问题：单图链路把结果写成 `{ url }`，丢失 `assetRefId/assetId/assetName` 结构信息。
  - 修复：
    - 单图结果统一通过 `buildImageAssetResultItem(...)` 生成。
    - 新增 `normalizeImageResultItems(...)`，合并历史结果时统一结构。
  - 证据：
    - 代码：`remoteRunner.ts` 行 1245-1268（`normalizeImageResultItems`）
    - 代码：`remoteRunner.ts` 行 4519-4535（单图结果 item 构建）
    - 代码：`remoteRunner.ts` 行 4573（合并前统一归一化）

- [x] **P0-4 角色主图回填字段补齐（节点内可持续）**
  - 现状问题：回填时只写 `roleName/roleId/roleCardId`，角色参考字段不稳定。
  - 修复：
    - 回填 `sourceBookId`（可解析时）。
    - 回填并去重 `roleCardReferenceImages`。
    - 回填 `roleReferenceEntries`（`name + url`），供后续合图/提示词锁定链路使用。
  - 证据：
    - 代码：`remoteRunner.ts` 行 4631-4664

## 一致性结论（修复后）

- [x] **角色绑定主图一致性**
  - 在可确定书籍作用域（显式 `sourceBookId` 或单书项目）时，主图更新会双写到 project 资产与 book `roleCards`，可持续追踪。
- [x] **图片资产生成后回填一致性**
  - 回填包含成功/失败结构化状态；失败不再静默，日志与节点字段都能定位。
- [x] **单图生成 JSON 结构一致性**
  - `imageResults` 统一为结构化 item（`url + assetRefId/assetId/assetName`），与其他图片链路协议对齐。
- [x] **边界场景可解释性**
  - 多书且未给 `sourceBookId` 时，明确标记 `bookScopeStatus=missing_or_ambiguous`，不伪造“已同步”。

## 验证记录

- [x] `ALLOW_LOCALHOST_IN_PROD_BUILD=1 pnpm --filter @tapcanvas/web build` 通过（本次改动后复跑通过）

