
<p align="center">
  <img src="./apps/web/public/tapcanvas-app-icon.svg" width="128" alt="TapCanvas" />
</p>

<p align="center">
  面向 AI 影视、漫剧与多模态内容生产的 Agent 原生无限画布
</p>

<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas/stargazers"><img src="https://img.shields.io/github/stars/anymouschina/TapCanvas?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://atomgit.com/anymouschina/TapCanvas" target="_blank" rel="noopener noreferrer"><img src="https://atomgit.com/anymouschina/TapCanvas/star/badge.svg" alt="AtomGit Star" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/pnpm-10.8.1-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 10.8.1" />
</p>

# TapCanvas 社区版

TapCanvas 把创意、脚本、角色与场景资产、分镜、图像、视频和最终成片放进同一个可追溯的画布工作流。它不是单次模型调用器：Agents 会读取真实项目与画布状态，自主选择 Skills 和工具，执行多步生产，并以节点、资产和运行记录交付结果。在线网站核心功能及样式与当前项目完全一致。

> **版本边界：** 本仓库是 TapCanvas 社区版，在线商业版是独立产品，功能、服务与条款均不相同。社区版不提供短信验证码与在线支付；模型渠道由使用者自行配置。

<p align="center">
  <img src="https://file.beqlee.icu/tapcanvas-repo/apps/web/readme-canvas.png" width="100%" alt="TapCanvas 章节画布、角色场景资产与分镜预览" />
</p>

## 赞助与支持

<p align="center">
  <a href="https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link" target="_blank" rel="noopener noreferrer">
    <img src="https://file.beqlee.icu/tapcanvas-repo/assets/sponsors/infistar-banner.png" width="728" alt="Infistar.cc 无限星河 · 一站式全球大模型 API 服务平台" />
  </a>
</p>

**TapCanvas × Infistar.cc 无限星河｜一站式全球大模型 API 服务平台**

感谢 [Infistar.cc 无限星河](https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link) 对 TapCanvas 的赞助支持！

- 🔌 **官方接入，满血保真**：按平台说明，通过官方渠道接入模型，多线路负载均衡，保持长链路生产的稳定性。
- 💰 **价格低至官方 0.1 折**：具体折扣、可用模型与计费规则以 [无限星河官网](https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link) 页面为准。
- 🧩 **接入方式**：社区版的文本、图片、视频模型统一经鲁班 API（`apps/new-api`）下发。在 [无限星河](https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link) 注册并获取 Key 后，在鲁班 API 管理台新增渠道并填入自己的 Key 与所需模型即可使用；仓库不预置任何私人凭据。

👉 [通过专属链接注册并立即体验](https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link)

**TapCanvas × 即刻AI｜官渠视频模型，最低可达官价 5 折**

感谢 [即刻AI](https://magic666.top/register?aff=rgj2) 对 TapCanvas 的赞助支持！

- 🎬 **主打官渠视频**：按平台说明，视频生成模型通过官方渠道接入。
- 💰 **最低可达官价 5 折**：具体折扣、可用模型与计费规则以 [即刻AI 官网](https://magic666.top/register?aff=rgj2) 页面为准。
- 🧩 **接入方式**：在 [即刻AI](https://magic666.top/register?aff=rgj2) 注册并获取 Key 后，在鲁班 API（`apps/new-api`）管理台新增渠道并填入自己的 Key 与所需视频模型即可使用；仓库不预置任何私人凭据。

👉 [通过专属链接注册即刻AI](https://magic666.top/register?aff=rgj2)

> 赞助方不参与项目的代码与路线图决策；上述链接为推广链接，注册与消费行为以对应平台条款为准。

## 演示视频：长篇小说，一键成片

从小说章节出发，把角色、场景、分镜与视频生成串联在同一张画布中。下面的 About 页面演示以两个章节的真实画布为例，展示角色与场景资产如何跨章节复用、同一人物的不同造型和受伤等状态如何分别管理，以及一键成片工作流如何组织从章节内容到视频的生产过程。

<p align="center">
  <a href="https://lluban.cn/about/">
    <img src="https://tanvas-ai.tos-cn-guangzhou.volces.com/uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20261014/0421ccb2-98d9-4489-8ea8-e02990a6e455.png" width="100%" alt="点击观看 TapCanvas 演示：跨章节资产复用、多状态管理与一键成片工作流" />
  </a>
</p>

[▶ 在线观看完整演示](https://lluban.cn/about/) · [下载演示视频（MP4）](https://tanvas-ai.tos-cn-guangzhou.volces.com/uploads/user/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20261014/b3e6665f-3940-43e4-b4b7-df2b50872abf.mp4)

视频录制于在线版；社区版的工作流入口与模型配置要求见下方[当前架构](#当前架构)。

## 核心能力

- **无限画布**：用强类型节点、端口和连线组织文档、角色、分镜、图像、视频、音频、字幕与工作流。
- **流水线 / 画布双视图**：同一项目可在节点画布与创作流水线之间切换；流水线按故事剧本、角色与场景、分镜设计、视频片段、最终成片组织已有内容，查看素材、预览结果并生成未完成素材，画布保留节点与依赖关系编辑。
- **Agent 原生执行**：`POST /public/agents/chat` 统一进入 DeepSeek Harness Bridge，由 Agents 负责语义理解、规划、Skills、子代理与最终交付自检。
- **一键成片**：选择章节或正文来源后，从流水线入口提交创作要求，复用正文节点的生产链路；支持章节上下文、角色/场景资产、结构化分镜、连续镜头、首尾帧承接、视频生成与合成，运行前需配置可用模型与工作流。
- **多模型网关**：文本、图像、视频和音频模型由鲁班 API（`apps/new-api`）统一接入、计量和动态下发，前端不写死模型列表。
- **项目化资产**：素材库、版本、生成历史、任务状态、交付证据与项目本地元数据持续沉淀，生成成功的资产不会被后处理丢弃。
- **工作流与协作**：支持可复用 DAG、异步 Worker、失败恢复、分享/发布、团队作用域与实时画布状态。

## 作品案例

以下作品基于当前 TapCanvas 项目制作，点击封面观看，后续案例将持续补充。

| 预览 | 作品 | 规格 | 制作 |
| --- | --- | --- | --- |
| <a href="https://file.beqlee.icu/showcase/20261009/kaiju-xiangqin-nvshenbu-ch1-hyperframes-recut-720p.mp4"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/showcases/kaiju-xiangqin-ch1/cover.jpg" width="220" alt="开局相亲女神捕 · 第一章"></a> | **开局相亲女神捕，获独孤九剑 · 第一章**<br>原著：今日问道，第一章「独孤九剑」3,826 字 | 4 分 41 秒 · 1280×720 · 24 fps<br>80 条字幕 | 一键成片 v135 + HyperFrames 剪辑<br>创作：claude-sonnet-5-5<br>[元数据](./assets/showcases/kaiju-xiangqin-ch1/metadata.json) · 2026-10-09 |
| <a href="https://file.beqlee.icu/showcase/20261008/full-story-subtitled-720p.mp4"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/showcases/full-story-subtitled/cover.jpg" width="220" alt="完整剧情 · 清晰字幕版"></a> | **完整剧情 · 清晰字幕版**<br>完整剧情成片，含清晰字幕 | 1 分 0 秒 · 1280×720 · 24 fps<br>MP4 9.36 MB | 2026-10-08 |

## 项目历史

https://github.com/user-attachments/assets/152df957-dcf1-4984-bc8e-ebf7b5392987

## 更新日志

默认展示最新 10 条，较早记录展开查看。

- **2026-10-28 · 可编辑字幕时间轴**：将只读字幕条升级为可编辑字幕轨，支持整段拖动、左右边缘调整起止时间、重叠分行、点击定位和键盘微调，选中轨道同步定位字幕内容。字幕对时随节点保存，重复视频实例分别编辑，预览与本地导出同时显示重叠字幕；修正分割片段导出的源时间偏移。保留现有字幕识别与样式，操作和验证边界见 [交付记录](docs/deliveries/2026-10-28-subtitle-timeline-sync.md)。

- **2026-10-27 · 字幕样式**：视频合成编辑器新增字体、字号、粗体、文字与描边颜色、描边宽度、背景颜色与透明度，以及位置、对齐和上下边距设置；样式随节点保存，重开编辑器继续编辑。编辑器预览与浏览器本地导出共用字幕绘制逻辑。当日同步 F02 的样式子项；时间轴随后于 10 月 28 日同步；实现与验证边界见 [交付记录](docs/deliveries/2026-10-27-subtitle-style-sync.md)。

- **2026-10-26 · 应用内更新日志**：同步 Pro 的轻量日志弹窗，在门户顶部点击「更新日志」图标查看社区版已实现功能与更新日期。有新条目时显示未读标记，内容打开后记录本地已读，可随时关闭、重开；存储失败会显示原因。内容依据本仓库 README 与交付记录维护，不包含 Pro 专属发布记录。来源与验证边界见 [同步说明](docs/deliveries/2026-10-26-changelog-sync.md)。

- **2026-10-26 · 手动去噪、MCP 助手接入与剧本导出**：同步三项独立功能，保留社区版 DSH Harness。手动去噪改为轻度修复或清晰度增强，保留原图材质，隔离项目画风，移除强加渲染风格与 8K 承诺；MCP 页面可签发专用密钥并复制 AI 助手接入提示词，关闭弹窗清除内存凭据；流水线支持选择多个已有提示词的章节，按章节和片段顺序导出 TXT，不生成或改写剧本。

  审查补全：导出与项目章节列表共用来源章序排序；新增去噪执行与 MCP 路由鉴权回归，96 项定向测试及 Web 类型检查通过。API 全量类型检查仍有其他文件错误；未提交真实生成任务或完成外部客户端端到端验收。

  以下为 **lluban.cn 的 Pro 实际界面参考截图**，不是社区版部署验收；截图未签发密钥或提交生成任务，周边 Pro 会员与批量成片能力不在本次同步范围。去噪入口在线上新版工具栏暂不可达，因此不提供伪造截图。实现与验证见 [交付记录](docs/deliveries/2026-10-26-manual-tools-sync.md)。

  <table width="100%"><tr>
    <td width="50%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-25-mcp-agent-connect-lluban.png"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-25-mcp-agent-connect-lluban.png" alt="lluban.cn MCP 助手接入弹窗，未签发密钥" width="100%"></a><br>MCP 助手接入（Pro 实际界面）</td>
    <td width="50%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-26-script-export-lluban.png"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-26-script-export-lluban.png" alt="lluban.cn 多章节剧本导出选择界面" width="100%"></a><br>多章节剧本导出（Pro 实际界面）</td>
  </tr></table>

- **2026-10-21 · 创作流水线与画布双视图**：新增创作流水线，可与同一项目的节点画布切换。按故事剧本、角色与场景、分镜设计、视频片段、最终成片五个阶段查看已有内容、生成状态与异常；分镜和视频片段按场景组织，支持素材筛选和媒体预览。流水线内可选择章节或正文来源并进入「一键成片」，也可单项生成或批量生成当前阶段的未完成素材，复用画布执行与前置资产链路。

  截图来自 TapCanvasPro 同一项目；点击缩略图查看原图。**社区版当前按单章成片，Pro 弹窗中的会员档位、多章 / 整本批量成片及新增规格选择尚未同步。** 最终成片截图为待生成状态。

  <table width="100%">
    <tr>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-film-chapter-selection.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-film-chapter-selection.jpg" alt="章节选择（Pro 参考）" width="100%"></a><br>章节选择（Pro 参考）</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-film-options.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-film-options.jpg" alt="成片选项（Pro 参考）" width="100%"></a><br>成片选项（Pro 参考）</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-script.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-script.jpg" alt="故事剧本" width="100%"></a><br>故事剧本</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-overview.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-overview.jpg" alt="角色与场景" width="100%"></a><br>角色与场景</td>
    </tr>
    <tr>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-storyboard.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-storyboard.jpg" alt="分镜设计" width="100%"></a><br>分镜设计</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-clips.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-clips.jpg" alt="视频片段" width="100%"></a><br>视频片段</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-delivery.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-pipeline-delivery.jpg" alt="最终成片（待生成）" width="100%"></a><br>最终成片（待生成）</td>
      <td width="25%" align="center"><a href="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-canvas-pipeline-switch.jpg"><img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-21-canvas-pipeline-switch.jpg" alt="节点画布" width="100%"></a><br>节点画布</td>
    </tr>
  </table>

- **2026-10-20 · 图片对比节点**：新增画布图片对比节点，支持并排、滑动分割、叠加透明度、按住切换四种模式。可从添加节点面板或右键菜单新建；框选两张图片后点「图片对比」，会自动创建节点并连线。对比内容跟随上游图片实时更新，模式、分割位置、透明度与尺寸随节点保存。

  <img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-20-image-compare-overview.jpg" alt="框选两张图片后生成对比节点（并排模式）" width="100%">
  <img src="https://file.beqlee.icu/tapcanvas-repo/assets/changelog/2026-10-20-image-compare-slider.jpg" alt="对比节点滑动分割模式" width="60%">

- **2026-10-11 · Factory / Droid 号池管理**：移植 TapCanvasPro 的 Droid 渠道与账号管理，支持批量追加 Key、账号启停与测试、Standard / Core 额度窗口和订阅信息展示，以及额度不足时同池换号重试。新增部署 patch SQL，自动预置停用的空号池；管理员配置自己的 Key、模型协议与价格后启用。详见 [Droid 接入说明](apps/new-api/docs/channel/droid.md)。
- **2026-10-07 · 一键成片 v135**：同步全章剧情与时间线规划、分项资产创作、逐 Clip 提示词与媒体生产，以及最新创作 Skills；编辑器与执行器共用工作流定义，继续使用社区版 DeepSeek Harness Bridge。新增 v135 系统工作流发布文件，保留历史执行和生成资产。
- **2026-10-07 · 画布修复**：复制节点和分组时保留素材与提示词、隔离执行身份并重映射引用；修复分组下载遗漏视觉组内素材的问题。
- **2026-09-23 · 导演台升级**：同步 TapCanvasPro 的独立导演台，基于 [DirectorDesk](https://github.com/mangfufu/director-desk) 提供三维场景搭建、角色走位与摄影机预演；接入 TapCanvas AI 对话、工具中继和参考视频导出回画布，替换旧内嵌实现，并补充 MIT 许可鸣谢。Web 开发和构建会自动构建导演台，本地首次使用需安装其独立依赖。

<details>
<summary>更早更新记录（13 条）</summary>

- **2026-09-21 · Agent 配置更新**：已添加工作流支持一键“更新并覆盖”，检查通过后直接更新当前装配，无需再次逐项确认；沿用原作用范围与已确认的替换、并列关系，保留历史版本、执行记录和生成资产。

- **2026-09-21 · 冲突判定修正**：工作流共用工具或输出格式仅展示为提示，不再直接要求二选一；职责冲突仍由 Agent 分析，阻断错误与版本竞态明确报出。

- **2026-09-21 · 配置列表修复**：补齐工作流更新时间与首次装载时间的前后端契约，修复 Agent 配置列表因缺少时间字段而加载失败的问题；配置更新相关前后端测试共 94 项通过。
- **2026-09-21**：整理项目说明，移除过期截止日期与能力完成度待办章节。

- **2026-09-20**：同步 v90 视频生产工作流并适配 DeepSeek Harness 运行时；画布生成操作统一接入主 AI 对话，修复章节资产与设计操作的模型传递及本地登录会话问题。
- **2026-09-16**：补充 AtomGit 徽章、项目鸣谢与贡献者说明。
- **2026-09-11**：扩展 HeyRoute 渠道与模型配置，补充文本、图片和视频的渠道独立计价。
- **2026-09-10**：接入 HeyRoute 渠道，新增推广注册链接与 API Key 申请入口。
- **2026-09-08**：更新一键成片相关实现与配套技能。

- **2026-09-06**：恢复 Agent 运行结果预览。
- **2026-09-05**：接入 Agnes 图片与视频渠道，完善模型参数契约和 GPT Image 2 请求校验，修复视频时长范围计价与参考图免费额度计算。
- **2026-09-04**：按官方接口契约修正 Agnes 视频生成请求格式。
- **2026-09-03**：完善 Docker 部署与依赖构建，支持容器内构建 Web 和模型管理台，并自动初始化本地配置与密钥。

</details>

## HeyRoute 注册福利与渠道配置

通过 [HeyRoute 推广链接注册](https://heyroute.ai/r/c/ch_iiq2tvtmrc)可领取 **$15 额度**，可使用 Codex、Claude、Gemini 对话及平台提供的生图能力（具体领取条件与可用模型以 HeyRoute 页面为准）。

社区版内置 7 个 HeyRoute 渠道，共 31 个模型：15 个对话模型（Claude、GPT、Grok、Gemini、Kimi）、5 个图片模型和 11 个视频模型。新增视频包括 Grok、MiniMax H3 与 Seedance 系列，文本、图片和视频均支持渠道独立计价。首次部署后，在鲁班 API（new-api）管理台的渠道列表或编辑窗口点击 **申请 API Key**，通过上述链接注册，填写自己的 Key 并启用所需渠道。新增渠道默认停用且 Key 为空，不包含维护者私人凭据；升级保留已有 Key 和启用状态。初始化配置见 [`004-expand-heyroute-channels.sql`](apps/new-api/patches/2026-09-11/004-expand-heyroute-channels.sql)，详细说明见 [HeyRoute 接入说明](apps/new-api/docs/heyroute.md)。

## Factory / Droid 号池管理

社区版内置 Factory / Droid 渠道和账号会话管理，支持 Key 追加与去重、账号启停、单号测试、额度刷新、订阅与有效期展示。部署补丁自动创建空号池，默认停用；在鲁班 API 管理台添加自己的 Factory Key，从动态模型目录选择模型、配置明确的 Droid 协议绑定与价格后启用。补丁重复执行保留已有账号和配置，不预置未经确认的模型授权或价格。配置步骤和协议说明见 [Droid 接入说明](apps/new-api/docs/channel/droid.md)。

## 当前架构

<p align="center">
  <a href="./docs/tapcanvas-high-level-architecture.html">
    <img src="https://file.beqlee.icu/tapcanvas-repo/assets/tapcanvas-high-level-architecture.png" width="100%" alt="TapCanvas 高层架构：Agents 调用生产工作流驱动 AIGC，并通过持久任务和交付验收实现稳定输出" />
  </a>
</p>

主链路是 **无限画布 → Agents Bridge → 生产工作流内核 → 任务与媒体 Workers → 可验证交付**。Agents 根据真实项目状态按需调用 Skills、MCP、子代理与工作流；图片、视频和音频任务经鲁班 API 进入 AIGC 模型，再由任务账本、队列、租约、幂等、重试与 reconcile，以及真实资产 URL 和 delivery evidence，保证长链路生产可恢复、可追溯、可验收。

> **一键成片边界：** 流水线提供章节 / 正文来源选择与「一键成片」入口，复用正文节点的规格配置和 AI 对话生产链路；社区版提供 v135 系统工作流与管理员画布模板入口，运行前需自行配置可用的 Agent、图片与视频模型渠道及装配工作流。仅生成视频节点和完整成片共用同一份章节计划，媒体生成依赖真实上游资产。点击架构图可打开带导览与节点说明的交互版本。

Monorepo 的职责边界：`apps/web` 负责交互与确定性画布执行，`apps/hono-api` 负责协议、权限、任务与事实证据，`apps/agents-cli` 是 DeepSeek Harness 的 TapCanvas Bridge，`apps/new-api` 负责模型网关，`packages/schemas` 保存前后端共享契约。AI 对话架构细节见 [apps/hono-api/README.md](./apps/hono-api/README.md)，Bridge 说明见 [apps/agents-cli/README.md](./apps/agents-cli/README.md)。

## 快速开始

Docker 启动只需要 Docker、Docker Compose 和 OpenSSL；不要求宿主机安装 Node.js、pnpm、Bun 或 Go。

```bash
git clone https://github.com/anymouschina/TapCanvas.git
cd TapCanvas
./scripts/dev.sh docker
```

这条命令会识别 `docker compose` 或 `docker-compose`，为全新安装生成一次性的强随机本地密钥，随后从已提交的源码和锁文件逐个构建 Web、API、鲁班 API、Agents Bridge 与 Workers，避免冷构建并发耗尽 Docker 内存。密钥只写入被 Git 和 Docker 构建上下文排除的 `apps/hono-api/.env`，不会打印；如果该文件已经存在，脚本只追加缺失的启动项，不覆盖任何现有值，因此已有的 lluban 或其他模型渠道配置会保留。

打开 Web [http://localhost:5175](http://localhost:5175)，API 位于 [http://localhost:8788](http://localhost:8788)，鲁班 API 管理台位于 [http://localhost:4455](http://localhost:4455)。首次生成的两个管理员密码保存在私有 `.env` 文件中，不会显示在终端。冷构建可能需要较长时间，可通过容器状态与日志查看真实进度。

需要完全忽略已有构建缓存并重新拉取基础镜像时运行：

```bash
./scripts/dev.sh docker --fresh-build
```

本地源码开发仍可使用 Node.js `^22.19.0` 或 `>=24` 与 pnpm `10.8.1`：

```bash
corepack enable
pnpm -w install --frozen-lockfile
npm --prefix apps/director-desk ci
pnpm dev:web
```

本地浏览器入口统一使用 `http://localhost:5175`。通过 `127.0.0.1` 或 `[::1]` 打开 Web 时，应用启动前会跳转到 `localhost`，保留协议、端口、路径、查询参数与 hash；源码开发、预览和 Docker 静态构建使用同一入口规则。浏览器不会在这些主机名之间共享 Cookie 或 localStorage，统一入口可避免登录态割裂和跨站 Cookie 丢失。GitHub OAuth 本地回调也应配置为 `http://localhost:5175/oauth/github`。

### 环境变量

README 不复制整份配置，避免与代码漂移；[API 模板](./apps/hono-api/.env.example) 和 [Web 模板](./apps/web/.env.example) 是唯一入口。首次启动只需确认以下分组：

| 分组     | 关键变量                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 数据库   | `POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`DATABASE_URL_DOCKER`                               |
| 服务鉴权 | `JWT_SECRET`、`INTERNAL_WORKER_TOKEN`、`AGENTS_BRIDGE_TOKEN`；首次 Docker 启动自动生成                     |
| 模型网关 | `NEW_API_INTERNAL_TOKEN`、`NEW_API_SESSION_SECRET`、`NEW_API_CRYPTO_SECRET`、`NEW_API_USD_EXCHANGE_RATE` |
| Web      | Docker 镜像默认同源访问 `/api`；GitHub OAuth 与对象存储可按模板启用                                      |

模型供应商凭据在鲁班 API 管理台配置；不要把真实密钥提交到 Git。缺失关键配置会显式失败，不会自动选择默认模型或静默降级。

```bash
pnpm build          # Web + API + Agents
pnpm test           # 全量测试
docker-compose --env-file apps/hono-api/.env ps # 当前主机使用 standalone Compose
./scripts/dev.sh docker-down                     # 停止服务，不删除数据卷
```

## 文档导航

| 文档 | 内容 |
| ---- | ---- |
| [文档中心](./docs/README.md) | 所有文档索引与推荐阅读顺序 |
| [开发指南](./docs/development.md) | 本地开发、构建与测试流程 |
| [Docker 部署](./docs/docker.md) | 一键全栈部署与常见问题 |
| [项目索引](./docs/PROJECT_INDEX.zh-CN.md) | 目录结构与模块职责速查 |
| [Public API](./docs/PublicAPI.zh-CN.md) | 对外接口契约，含 `/public/agents/chat` |
| [API 与 AI 对话架构](./apps/hono-api/README.md) | Hono API、任务与 AI 对话链路 |
| [Agents Bridge](./apps/agents-cli/README.md) | DeepSeek Harness Bridge 说明 |
| [交付记录](./docs/deliveries) | 各次功能同步的实现与验证边界 |
| [同步 TODO](./TODO.md) | Pro 到社区版的功能同步清单 |

## TODO / 路线图

计划从 TapCanvas Pro 同步到社区版的功能：

本轮梳理了 **16 项不涉及 Pro Agent 内核的功能，已同步 F04、F06、F09、F10、F13，以及 F02 的字幕样式与可编辑时间轴**，编号、源码依据、社区版已有能力与适配边界见 [同步 TODO](./TODO.md)。以下原有路线图保留；视频复刻暂不纳入本轮筛选。

- [x] **图片对比节点**：并排、滑块、叠加、切换四种模式，图片从上游节点实时读取
- [ ] **视频复刻**：粘贴抖音等分享链接或上传视频，一键复刻
- [ ] **新版创作输入框**：支持 @ 引用素材、附件、画布引用、按账号记住模型偏好
- [ ] **视频合成 + AI 字幕转写**：字幕样式、可编辑时间轴及本地导出已同步；转场与 Pro 服务端转写仍待同步
- [ ] **媒体诊断接口**：排查媒体链路问题
- [x] **更新日志弹窗（F13）**：门户顶部手动打开，展示社区版更新，支持未读提示与本地已读记录
- [ ] **产品介绍与 SEO 页**：公开产品页与页面 metadata
- [ ] **parse-video 服务**：独立的 Go 服务，解析多平台视频链接
- [ ] **TapOps 运维面板**：多节点主机监控、日志与数据库清单

补充同步项（已完成项标记如下，其余待选）：

- [x] **F04 保材质手动去噪**：去除强加渲染风格与未经证实的 8K 承诺，补齐忙碌反馈
- [ ] **F05 角色立绘编辑**：外观/年龄变体、独立版本与加入画布
- [x] **F06 AI 助手接入 MCP**：签发专用密钥并生成可复制的接入提示词
- [ ] **F07 CLI / Skill 安装入口**：独立平台命令、API 调用、上传与订阅，不迁入 Pro host worker
- [ ] **F08 灵光一现**：首页创意方向、换一批与回填
- [x] **F09 多章节剧本导出**：选择章节，将已保存的逐 Clip 提示词导出 TXT
- [x] **F10 画布保存协调**：项目画布的自动/手动/提交前保存串行执行，自动保存按内容修订调度
- [ ] **F11 动态模型规格**：能力字段、参考图上限和尺寸规范

## 许可证

TapCanvas 根项目及未另行声明的代码按 [MIT License](./LICENSE) 发布。`apps/new-api` 是独立上游衍生组件，继续适用其目录中的 [GNU AGPL-3.0 License](./apps/new-api/LICENSE) 与原始归属声明；其他第三方组件分别适用各自许可证。在线商业版不适用本仓库协议。

## 鸣谢

感谢以下平台与开源项目，TapCanvas 的托管、推广与实现都建立在它们之上。

- **[Infistar.cc 无限星河](https://www.infistar.cc/register?aff=NQY9SD7Y&ref_source=link)**：赞助 TapCanvas，并提供一站式全球大模型 API 服务，详见[赞助与支持](#赞助与支持)。
- **[即刻AI](https://magic666.top/register?aff=rgj2)**：赞助 TapCanvas，主打官渠视频模型，详见[赞助与支持](#赞助与支持)。
- **[AtomGit](https://atomgit.com/gcw_PzejWSbY/TapCanvas) / GitCode**：提供代码托管、开源社区推广与 Badge 数据服务，上述链接即本项目在 AtomGit 的项目入口。

上游开源项目：

| 项目                                                                              | 在本仓库中的职责                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [new-api](https://github.com/QuantumNous/new-api)（上游为 [One API](https://github.com/songquanpeng/one-api)） | `apps/new-api` 模型网关的来源实现，负责渠道接入、计量与模型下发 |
| [DirectorDesk](https://github.com/mangfufu/director-desk)                        | `apps/director-desk` 导演台的三维预演、场景搭建、走位与摄影机工具；本目录按 MIT 许可集成 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)                | `apps/agents-cli` Bridge 的官方运行时、主代理循环与工具能力 |
| [React Flow](https://github.com/xyflow/xyflow)（`@xyflow/react`）                    | 无限画布的节点、端口与连线内核                            |
| [Mantine](https://github.com/mantinedev/mantine)                                   | Web 端 UI 组件与主题                                      |
| [Hono](https://github.com/honojs/hono)                                             | `apps/hono-api` 的 Worker 路由与 OpenAPI 层               |
| [Prisma](https://github.com/prisma/prisma)                                         | 数据模型与数据库访问                                      |
| [Vite](https://github.com/vitejs/vite) / [Vitest](https://github.com/vitest-dev/vitest) | Web 构建与测试                                        |
| [AI SDK](https://github.com/vercel/ai)、[Zustand](https://github.com/pmndrs/zustand)、[Tabler Icons](https://github.com/tabler/tabler-icons) | 模型调用、前端状态管理与图标 |

具体依赖版本以 `apps/*/package.json` 与 `pnpm-lock.yaml` 为准；第三方组件各自适用其上游许可证，见[许可证](#许可证)。

## 感谢贡献者

感谢每一位通过代码、文档、Issue、评审、测试与使用反馈帮助 TapCanvas 持续完善的贡献者。

<p align="center">
  <a href="https://github.com/anymouschina/TapCanvas/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=anymouschina/TapCanvas&v=20260905" alt="TapCanvas Contributors" />
  </a>
</p>

每一次贡献都在帮助社区版变得更统一、更稳定，也让多模态内容生产工作流能够服务更多创作者。欢迎阅读现有 Issues、提交修复或分享你的工作流实践。

## 作者与反馈

作者：**Beq（李碧强）** · 邮箱：[beq.li@qq.com](mailto:beq.li@qq.com)

<img src="https://file.beqlee.icu/tapcanvas-repo/assets/connect/wechat.jpg" width="180" alt="作者微信二维码" />

Bug、功能建议与贡献请通过 [Issues](https://github.com/anymouschina/TapCanvas/issues) 或 Pull Request 提交。

## Star 趋势

[![TapCanvas Star History](https://star-history.dera.page/svg?repos=anymouschina/TapCanvas&type=Date)](https://star-history.dera.page/#anymouschina/TapCanvas&Date)
