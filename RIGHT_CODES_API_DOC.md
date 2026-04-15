# Hono API 中 Right Codes 调用接口文档

## 结论

基于当前仓库代码检索，`apps/hono-api` **直接调用** `right.codes` 的逻辑只有一处：

- `apps/hono-api/src/modules/commerce/openclaw.service.ts`

这里的 `OpenClaw` 在代码里就是对 Right Codes 的一层业务命名。默认上游基地址为：

- `https://www.right.codes`

如果你要找的是 `https://right.codes/codex/v1` 这类 LLM 接口，那 **不在 `apps/hono-api` 内**，而是在：

- `apps/agents-cli/src/core/config.ts`

所以这份文档只覆盖 **`hono-api` 中真实存在的 Right Codes（OpenClaw）调用**。

---

## 1. 上游配置

来源：

- `apps/hono-api/src/types.ts`
- `apps/hono-api/.env.example`
- `apps/hono-api/src/modules/commerce/openclaw.service.ts`

### 环境变量

- `OPENCLAW_API_TOKEN`：必填，用于请求 Right Codes 上游接口
- `OPENCLAW_API_BASE_URL`：可选，默认 `https://www.right.codes`

### 上游鉴权方式

所有请求都会带以下请求头：

```http
Accept: application/json, text/plain, */*
Content-Type: application/json
Authorization: Bearer <OPENCLAW_API_TOKEN>
```

---

## 2. Hono API 内部上游封装

来源：

- `apps/hono-api/src/modules/commerce/openclaw.service.ts`

核心封装函数：

- `callUpstream(c, { method, path, body })`

行为：

1. 从 `OPENCLAW_API_BASE_URL` 读取基地址，没有则回退到 `https://www.right.codes`
2. 用 `new URL(path, baseUrl)` 拼接完整 URL
3. 自动附带 Bearer Token
4. `GET` / `DELETE` 不发 body，其余方法发送 JSON body
5. 只要上游返回非 2xx，就抛出统一错误：

```json
{
  "code": "openclaw_upstream_failed",
  "status": 502,
  "details": {
    "method": "GET|POST|PATCH|DELETE",
    "path": "上游路径",
    "status": 真实上游状态码,
    "responseText": "上游响应文本前 2000 字符"
  }
}
```

---

## 3. 真实调用的 Right Codes 上游接口

这些路径都由 `getOpenClawPaths()` 定义。

### 3.1 查询 API Key 列表

- **Method**: `GET`
- **Path**: `/api-key/list`
- **调用函数**: `listUpstreamKeys()`
- **用途**: 查询上游已有 key，和本地授权记录做匹配

#### 解析的关键字段

代码会从上游响应里尽量兼容读取这些字段：

- `id` / `key_id` / `apiKeyId`
- `key` / `api_key` / `token` / `value`
- `name`
- `quota_limit` / `quotaLimit`
- `expired_at` / `expiredAt`
- `is_active` / `isActive` / `enabled`
- `allow_wallet` / `allowWallet`
- `allowed_item_ids` / `allowedItemIds`

#### 响应结构兼容规则

代码会按以下优先级取列表：

- `parsed.keys`
- `parsed.data`
- `parsed.items`

也就是说，上游不要求单一固定包裹字段，只要列表能落在这三个字段之一即可被当前实现识别。

### 3.2 创建 API Key

- **Method**: `POST`
- **Path**: `/api-key/create`
- **调用函数**: `createUpstreamKey()`

#### 请求体

```json
{
  "name": "openclaw",
  "quota_limit": 100,
  "allow_wallet": true,
  "allowed_item_ids": ["item_a", "item_b"]
}
```

#### 字段说明

- `name`：外部显示名，对应本地 `externalName`
- `quota_limit`：额度限制，对应本地 `quotaLimit`
- `allow_wallet`：是否允许钱包能力
- `allowed_item_ids`：允许的 item 白名单，可为 `null`

### 3.3 更新 API Key

- **Method**: `PATCH`
- **Path**: `/api-key/{id}`
- **调用函数**: `patchUpstreamKey()`

#### 请求体

```json
{
  "name": "openclaw",
  "quota_limit": 100,
  "allow_wallet": true,
  "allowed_item_ids": ["item_a", "item_b"],
  "is_active": true
}
```

#### 触发条件

只要以下任一项发生变化，就会触发 PATCH：

- `quotaLimit`
- `desiredStatus`
- `externalName`
- `allowWallet`
- `allowedItemIds`

### 3.4 重置使用量

- **Method**: `POST`
- **Path**: `/api-key/{id}/reset-usage`
- **调用函数**: `resetUpstreamUsage()`

#### 请求体

```json
{}
```

### 3.5 删除 API Key

- **Method**: `DELETE`
- **Path**: `/api-key/{id}`
- **调用函数**: `deleteUpstreamKey()`

#### 删除语义

- 如果上游删除成功：本地记录也会删除，结果记为 `deleted`
- 如果上游返回 404：本地仍会删除记录，结果记为 `not_found`
- 其他错误：直接抛出，不会静默吞掉

---

## 4. 上游返回值如何映射到本地

来源：

- `mapListKey()`
- `mapUpstreamMutationResponse()`
- `persistAuthorization()`

### 本地持久化关注字段

Right Codes 响应会被映射并落到本地授权表：

- `upstreamKeyId`
- `externalKey`
- `quotaLimit`
- `expiredAt`
- `status`
- `payloadJson`（完整上游响应 JSON）

### 状态映射

- 上游 `is_active=true` -> 本地 `active`
- 上游 `is_active=false` -> 本地 `inactive`
- 如果上游没明确返回激活状态，则回退到当前业务期望值，不做额外猜测

### 本地错误落库策略

同步失败时，不会静默跳过，而是会落库为：

- `status = error`
- `lastError = 真实错误信息`

这符合当前仓库“显式失败、零隐式回退”的约束。

---

## 5. 哪些 Hono 路由会间接触发 Right Codes 调用

来源：

- `apps/hono-api/src/modules/commerce/commerce.routes.ts`
- `apps/hono-api/src/modules/commerce/commerce.service.ts`

注意：下面这些是 **TapCanvas 自己的 Hono 路由**，不是 Right Codes 的上游路径；它们的处理过程中会读取本地授权数据，或者进一步调用 `openclaw.service.ts` 与 Right Codes 同步。

### 5.1 查询当前用户 OpenClaw 授权

- **Method**: `GET`
- **Route**: `/commerce/openclaw/me`
- **函数**: `getOpenClawAuthorizationForOwner()`
- **是否直接请求 Right Codes**: 否，仅查本地库

### 5.2 获取当前用户 OpenClaw 明文 Key

- **Method**: `POST`
- **Route**: `/commerce/openclaw/me/key`
- **函数**: `getOpenClawKeyForOwner()`
- **是否直接请求 Right Codes**: 否，仅查本地库

### 5.3 管理员查看授权列表

- **Method**: `GET`
- **Route**: `/commerce/openclaw/admin/authorizations`
- **函数**: `listOpenClawAdminAuthorizations()`
- **是否直接请求 Right Codes**: 否，仅查本地库

### 5.4 管理员重新同步某条授权

- **Method**: `POST`
- **Route**: `/commerce/openclaw/admin/authorizations/:id/resync`
- **函数**: `resyncOpenClawAuthorizationById()` -> `syncOpenClawAuthorizationForOwner()`
- **是否直接请求 Right Codes**: 是

#### 请求体

```json
{
  "quotaLimit": 100,
  "descriptionText": "optional",
  "desiredStatus": "active"
}
```

### 5.5 管理员重置单条授权使用量

- **Method**: `POST`
- **Route**: `/commerce/openclaw/admin/authorizations/:id/reset-usage`
- **函数**: `resetOpenClawAuthorizationUsageById()`
- **是否直接请求 Right Codes**: 是

#### 请求体

```json
{}
```

### 5.6 管理员批量重置所有 active 授权使用量

- **Method**: `POST`
- **Route**: `/commerce/openclaw/admin/reset-usage-all`
- **函数**: `resetAllOpenClawAuthorizationUsages()`
- **是否直接请求 Right Codes**: 是（逐条调用）

### 5.7 管理员删除授权

- **Method**: `DELETE`
- **Route**: `/commerce/openclaw/admin/authorizations/:id`
- **函数**: `deleteOpenClawAuthorizationById()`
- **是否直接请求 Right Codes**: 是

---

## 6. 哪些业务流程会自动触发 Right Codes 同步

来源：

- `apps/hono-api/src/modules/commerce/commerce.service.ts`

当订单权益处理命中：

- `entitlement_type = openclaw_subscription`

系统会在本地创建订阅与每日配额后，继续调用：

- `syncOpenClawAuthorizationForOwner()`

也就是说，**Right Codes key 的创建/更新并不只发生在管理员手动 resync 时**，还会在订单权益兑现时自动触发。

### 自动同步输入字段

```json
{
  "ownerId": "用户 ID",
  "subscriptionId": "最新订阅 ID",
  "sourceOrderId": "订单 ID",
  "productId": "商品 ID",
  "skuId": "SKU ID",
  "quotaLimit": "quantity * dailyLimit",
  "externalName": "默认 openclaw，可配置",
  "descriptionText": "可选",
  "allowWallet": true,
  "allowedItemIds": ["..."],
  "desiredStatus": "active"
}
```

---

## 7. 返回给前端/管理端的本地数据结构

来源：

- `apps/hono-api/src/modules/commerce/commerce.schemas.ts`

### 授权对象

返回结构核心字段包括：

- `id`
- `ownerId`
- `subscriptionId`
- `sourceOrderId`
- `productId`
- `skuId`
- `externalKeyMasked`
- `externalName`
- `quotaLimit`
- `descriptionText`
- `allowWallet`
- `allowedItemIds`
- `expiredAt`
- `status`
- `upstreamKeyId`
- `lastSyncedAt`
- `lastError`
- `createdAt`
- `updatedAt`
- `disabledAt`

### 明文 Key 对象

- `key`
- `keyMasked`
- `externalName`
- `status`
- `expiredAt`
- `quotaLimit`
- `allowWallet`
- `allowedItemIds`
- `upstreamKeyId`
- `updatedAt`

---

## 8. 关键限制与实现特征

### 8.1 没有静默兜底

如果上游失败，当前实现会：

- 抛错
- 写入本地 `error` 状态
- 记录 `lastError`

不会假装同步成功。

### 8.2 上游 404 删除被显式区分

删除授权时，如果 Right Codes 上游已经不存在该 key：

- 本地仍删除授权记录
- 但会明确返回 `upstreamDeleteStatus = not_found`

### 8.3 列表/变更响应都做了字段兼容读取

这说明当前实现假设 Right Codes 返回结构可能存在多种命名差异，所以做了显式字段映射，而不是硬编码单一字段名。

---

## 9. 代码定位索引

- 上游配置与调用：`apps/hono-api/src/modules/commerce/openclaw.service.ts`
- 对外路由：`apps/hono-api/src/modules/commerce/commerce.routes.ts`
- 返回 schema：`apps/hono-api/src/modules/commerce/commerce.schemas.ts`
- 自动触发同步的订单流程：`apps/hono-api/src/modules/commerce/commerce.service.ts`
- 应用路由挂载点：`apps/hono-api/src/app.ts`

---

## 10. 一句话总结

`apps/hono-api` 里真正直连 Right Codes 的不是聊天/绘图这类 `/public/*` 能力，而是 **Commerce 模块下的 OpenClaw 授权同步链路**；它通过 Bearer Token 调用 Right Codes 的 `/api-key/*` 接口，负责创建、更新、重置和删除用户的上游 API Key，并把同步结果显式落库。
