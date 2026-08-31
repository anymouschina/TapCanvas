# 渠道而外设置说明

该配置用于设置一些额外的渠道参数，可以通过 JSON 对象进行配置。主要包含以下两个设置项：

1. force_format
    - 用于标识是否对数据进行强制格式化为 OpenAI 格式
    - 类型为布尔值，设置为 true 时启用强制格式化

2. proxy
    - 用于配置网络代理
    - 类型为字符串，填写代理地址（例如 socks5 协议的代理地址）

3. thinking_to_content
   - 用于标识是否将思考内容`reasoning_content`转换为`<think>`标签拼接到内容中返回
   - 类型为布尔值，设置为 true 时启用思考内容转换

4. vertex_egress_isolation_enabled
   - 仅用于 Vertex AI 渠道
   - `false` 时强制直连 Google 官方接口，即使通用 `proxy` 字段仍有旧值也不会使用
   - `true` 时必须同时配置 `vertex_egress_cells`；Token 交换、模型请求、Veo 提交和任务轮询都会使用账号绑定的同一出口
   - 已开启但出口配置缺失或不可用时，请求明确失败，不会回退直连

5. vertex_egress_cells
   - Vertex Dedicated Egress 出口单元数组
   - 每个单元包含稳定且唯一的 `id` 与 `proxy_url`
   - `proxy_url` 支持 `http`、`https`、`socks5`、`socks5h`
   - 多账号按账号身份使用 Rendezvous Hash 稳定分片；调整数组顺序不会改变绑定，异步任务会持久化其出口 ID

--------------------------------------------------------------

## JSON 格式示例

以下是一个示例配置，启用强制格式化并设置了代理地址：

```json
{
    "force_format": true,
   "thinking_to_content": true,
    "proxy": "socks5://xxxxxxx"
}
```

--------------------------------------------------------------

通过调整上述 JSON 配置中的值，可以灵活控制渠道的额外行为，比如是否进行格式化以及使用特定的网络代理。

## Vertex Dedicated Egress 示例

管理界面使用每行 `出口ID|代理地址` 的格式录入，最终保存为以下结构：

```json
{
  "vertex_egress_isolation_enabled": true,
  "vertex_egress_cells": [
    {
      "id": "tokyo-01",
      "proxy_url": "https://user:password@proxy-01.example.com:443"
    },
    {
      "id": "tokyo-02",
      "proxy_url": "socks5h://user:password@proxy-02.example.com:1080"
    }
  ]
}
```

这里的代理端点必须已经接入 Cloudflare Dedicated Egress IP 或自有固定出口；普通 Worker 域名不等同于独享静态出口。出口 ID 是账号和异步任务的稳定绑定键，修改代理凭证时应保留 ID。删除仍有异步任务绑定的出口会使对应轮询明确停止，不会自动改用其他出口或直连。
