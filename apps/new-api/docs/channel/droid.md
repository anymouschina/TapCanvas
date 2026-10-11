# Droid / Factory API Key 号池

从 TapCanvas-pro 移植至当前网关，复用现有渠道与 multi-key 管理。渠道类型为 `77`，Factory 基址为 `https://api.factory.ai`。凭据、账号状态与额度快照继续存入现有渠道字段，不需要新表或数据库迁移。本次移植不导入 Pro 的真实凭据、模型目录或价格。

## 配置与管理

1. 在渠道管理中新建 Droid 渠道，从系统模型管理的动态目录选择模型，并为模型配置明确的协议绑定。没有绑定的模型显式失败，不按模型名称猜协议，也不自动更换模型。
2. 开启多 Key 号池，默认使用轮询；可明确选择随机模式。在账号会话管理中选择该渠道，通过“添加 API Key”逐行追加 Factory `fk-` Key。空行被去除，重复 Key 不重复添加，原有凭据和状态保留。单 Key 也保持号池模式。
3. 账号支持单独或批量启停。启用账号或追加可用 Key 可恢复自动停用的渠道，但不改变管理员手动停用状态。删除不能清空号池；账号序号会重排，不能以当前序号反推历史消费归属。
4. 账号测试只使用所选 Key；测试失败会保留错误和请求 ID。测试会真实调用上游。额度刷新只读取上游管理接口。

## 协议

| 显式协议 | Factory 上游路径 | 默认 provider |
| --- | --- | --- |
| `droid-anthropic` | `/api/llm/a/v1/messages` | `anthropic` |
| `droid-responses` | `/api/llm/o/v1/responses` | `openai` |
| `droid-chat` | `/api/llm/o/v1/chat/completions` | `fireworks` |
| `droid-gemini` | `/api/llm/g/v1/generate` | `google` |

请求使用所选 Key 的 Bearer 鉴权。`provider`、`user_agent`、`client_version` 等选项通过协议绑定显式配置。保留 Factory 协议要求的 Droid 提示首行与请求头；不移植 Pro 的其他客户端身份或 metadata 改写功能。

Chat 请求可按绑定转为 Anthropic、Responses 或 Gemini。Factory Gemini 请求正文携带 model，不发送 stream；非流式调用聚合同一次上游 SSE，不重新提交生成。协议能力由动态协议目录发布，不将静态建议目录作为账号授权事实。

## 额度与调度

管理员入口 `GET /api/channel/:id/droid/usage` 查询下列 Factory 接口：

| 上游接口 | 保存的信息 |
| --- | --- |
| `/api/billing/limits` | Standard / Core 的 5 小时、7 天、30 天窗口比例、重置时间及额外用量余额 |
| `/api/organization/subscription/usage` | 上游报告区间的个人与组织用量 |
| `/api/app/auth/me` | 套餐、订阅状态、账期和明确终止日期 |
| `/api/factory-api-key/list` | 唯一匹配当前 Key 的有效期及撤销状态 |

仅持久化白名单字段；未知、零值和无期限分别处理。查询失败保留此前快照，同时显示本次错误和各来源查询时间，不把旧数据标记为本次成功。同渠道额度刷新串行执行，网络查询不持有账号编辑锁；回写按凭据身份重新定位，避免删除或重排后串写其他账号，也避免同秒并发刷新乱序覆盖。

界面分别展示 Standard / Core 各窗口，详情展示套餐、余额、日期和错误。共享账号的多个 Key 不能叠加计算余额；账期结束不等于订阅终止。主节点定期刷新额度，额度拒绝后触发有间隔限制的刷新。刷新本身不禁用或删除账号。

调度沿用 Pro 的协议范围约定：`droid-chat` 检查 Core，其余 Droid 协议检查 Standard。已确认耗尽且尚未重置的窗口暂停该范围的自动调度，不修改账号启用状态。此约定不代表 Factory 对所有模型的实时计费分类；配置渠道时须确认协议与上游能力相符。

真实上游额度拒绝时，优先尝试同池未尝试账号，保留请求模型；本地余额不足不触发此行为。每次派发前确认凭据仍存在且可用，换号前重新读取号池，请求内按凭据身份记录已尝试账号，避免账号重排后重复提交。已输出响应、请求取消或明确禁止重试时不重放。最终额度错误使用中文提示，原始上游状态与正文保留用于诊断；响应读取失败时仍保留已读部分与读取错误。不会自动开启 Extra Usage、刷新 OAuth 或降低模型。

## 验证边界

移植使用合成 Key、隔离 SQLite 与本地 HTTP 测试服务验证账号重排、额度解析、错误回执及协议转换。未连接真实 Factory 账号执行付费测试。部署后由管理员配置自己的 Key、模型绑定与价格；代码构建通过不等于账号已获模型授权。
