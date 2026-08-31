# AI Studio To API 渠道

`AI Studio To API` 渠道用于接入浏览器驱动的 `aistudio-to-api` Runtime，并在 new-api 管理后台完成 Google AI Studio 自动登录、`storageState` 账号导入和专属代理绑定。

## 职责边界

- new-api 保存渠道的 Runtime URL、Runtime API Key、Importer URL、Importer 用户名和 Importer 密码环境变量名。
- Google 登录密码、恢复邮箱和 TOTP 密钥只在管理员点击自动登录时进入请求内存，并直接转发给 Studio Importer；new-api 不把这些凭据写入数据库、日志或渠道配置。
- Google `storageState` 只在导入请求内存中转发；new-api 不把 Cookie 写入数据库、日志或渠道配置。
- Studio Importer 负责生成 `auth-N.json`、代理池和账号到代理的映射。
- `aistudio-to-api` 的服务器端 Camoufox/Playwright Context 负责验证 Session、回写 Cookie、标记失效账号和执行账号调度。
- 管理员上传账号使用的本地浏览器可以在导入完成后关闭；服务器端浏览器仍是 Runtime 的必要组成部分。

## 配置

创建渠道时选择 `AI Studio To API`：

1. `API 地址`填写 OpenAI 兼容 Runtime 根地址，必须使用 HTTPS，末尾不带 `/v1`。
2. `密钥`填写 Runtime 的 OpenAI 兼容 API Key。
3. 默认协议选择 `OpenAI Compatible`。
4. `Studio Importer 地址`填写 Importer HTTPS 根地址，不附加 `/api/import`。
5. 填写 Importer Basic Auth 用户名。
6. 填写保存 Importer 密码的环境变量名，默认是 `AISTUDIO_IMPORTER_PASSWORD`。

部署 new-api 时必须把对应密码注入进程环境，例如：

```dotenv
AISTUDIO_IMPORTER_PASSWORD=<Studio Importer Basic Auth password>
```

密码值不会保存进渠道 `setting`，也不会通过渠道详情接口返回前端。缺少环境变量时，账号列表和导入接口会明确失败，不会使用默认密码或跳过认证。

## 自动登录并导入（推荐）

保存渠道后，点击“管理 AI Studio 账号池”，在“自动登录并导入”中填写：

- 账号名称和专属代理。
- Google 登录邮箱、密码。
- 可选的恢复邮箱和 TOTP Base32 密钥。
- 可选备注。

new-api 会先检查账号名和代理是否冲突，再把一次性凭据通过 HTTPS 转发到 Importer。Importer 通过 Docker 标准输入在 Runtime 容器内启动隔离的无头 Camoufox，并强制使用这个账号即将绑定的同一条代理完成 Google 登录。凭据不会出现在 Docker 命令行，临时 `storageState` 文件权限是 `0600`，登录进程退出后临时目录会删除。

自动流程只覆盖密码、恢复邮箱和标准 TOTP。Google 如果要求验证码、短信、手机推送、Passkey 或人工风控确认，接口会明确失败且不导入账号；不会返回假成功。成功响应中的 `runtime_validation=pending` 表示文件和代理已提交，最终 Session 状态仍由长期运行的 Runtime 浏览器验证。

## 导入已有 storageState

保存渠道后，点击“管理 AI Studio 账号池”，填写：

- 账号名称：1 到 64 位，只允许字母、数字、下划线、点、横线和 `@`。
- 专属代理：支持 `主机:端口`、`主机:端口:用户名:密码`、`用户名:密码@主机:端口` 和带认证的 HTTP/HTTPS/SOCKS URL。
- 备注：最多 255 个字符。
- `storageState` JSON：最大 2 MiB，必须包含非空 `cookies` 数组。

new-api 会在发送敏感 Cookie 前读取一次远端账号池，拒绝重名、重复代理行和重复代理主机。Studio Importer 会在最终写入时重复验证，因此并发导入也不能绕过“一号一 IP”。列表响应中的代理密码会被遮蔽。

导入成功只证明远端文件和代理映射已经写入；Google Session 是否仍然有效，要等 Runtime 创建服务器端浏览器 Context 后才能确定。

## 负载均衡

负载均衡分为两层：

1. 多个启用的 `AI Studio To API` 渠道支持 new-api 原有的优先级和加权随机选择。相同优先级下，渠道权重决定不同 Runtime 的流量比例。
2. 单个 Runtime 内部由 `aistudio-to-api` 调度器在未失效、未冷却、未占用的账号之间轮询；429 会触发账号或模型冷却。

new-api 不向 Runtime 强制指定 `authIndex`。当前 Runtime 没有面向外部请求公开稳定的指定账号协议；在 new-api 再做一层同 Runtime 账号选择会与服务器浏览器的租约、前台切换和冷却状态冲突。

## 管理接口

接口继承渠道管理的管理员鉴权：

- `GET /api/channel/:id/aistudio/accounts`：读取账号文件列表和脱敏后的代理映射。
- `POST /api/channel/:id/aistudio/accounts`：校验并导入一个账号；写操作同时受关键接口限流保护。
- `POST /api/channel/:id/aistudio/onboard`：使用一次性账号密码/恢复邮箱/TOTP 自动登录并导入；请求体限制 64 KiB，写操作同时受关键接口限流保护。

Importer 对账号文件、代理池、账号代理映射和备注写入加进程锁。写入中途失败时会回滚本次新增认证文件并恢复旧映射。Runtime 通过挂载目录热加载认证文件；new-api 不制造“Session 已验证”的假成功状态。

## 接入与验证

不需要手写 SQL。渠道类型 `74` 已在 new-api 中注册；应通过管理后台创建渠道，让现有渠道校验和数据库模型正常生效。模型至少填写 Runtime 实际启用的名称，例如 `gemini-3-pro-image`、`gemini-3.1-flash-image`。

接通后依次验证：

1. 管理页能读取账号池，证明 new-api 到 Importer 的 HTTPS 和 Basic Auth 正常。
2. 自动登录返回成功后，账号先显示“待运行时验证”，随后 Runtime 回写的 `expired` 状态应变为可用或已失效。
3. 使用 new-api 的用户令牌调用 OpenAI 兼容接口，而不是直接使用 Runtime Key：

```bash
curl -sS https://<new-api-domain>/v1/chat/completions \
  -H 'Authorization: Bearer <new-api-user-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gemini-3.1-flash-image",
    "messages": [{"role": "user", "content": "生成一张白底红色马克杯产品图"}],
    "stream": false
  }'
```

只有响应中存在真实图片结果才算生图链路打通；容器运行、HTTP 200 或只有文字回复都不是充分证据。
