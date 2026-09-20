# 来源与本地适配

2026-09-14 核查并吸收上游公开 Skill。本包是为 TapCanvas 重新编写的本地实现：沿用其电商视觉方法论与场景模板结构，不逐字安装上游正文与执行代码；不继承上游许可声明，也不声称是作者官方版本。

- 上游仓库：https://github.com/liangdabiao/ecom-details-image
- 核查版本：commit `1ec867b743179af3598db55388f65287c4e04de1`（2026-05-15）
- 吸收范围：`SKILL.md` 的方法论、`references/templates/` 下 25 个场景模板

## 本地改造

**方法论正文**：保留 GPT-Image-2 铁律（hex 色彩、数字化产品占比、显式留白、具体否定清单、平台预留位、3 层信息架构）、Campaign Style Lock、转化驱动力三型、主图/详情页序列、详情页信息图结构、多角度与景别分配、视觉节奏、Anti-AI 真实感与中文字渲染规则。按职责拆为 `SKILL.md`（硬规则与流程）、`references/conversion-sequences.md`（序列与信息图结构）、`references/prompt-craft.md`（prompt 工艺），不再堆在单个文件里。

**场景模板**：25 个全部保留，改动三处——

1. 删除 `keywords` 与 `trigger_phrases` 两个关键词/别名表字段，改为 `scenario` 语义描述。上游靠关键词表命中模板；本仓库禁止用关键词表做语义路由，模板选择交由 agent 依据用户真实用途判断，索引表只作导航。
2. 20 个模板里的 `8K` / `4K` 质量口令统一降级为中性的 `high detail`：本项目生图封顶 2K，保留原口令会与自有链路能力声明冲突。
3. 其余字段（`prompt_template`、`defaults`、`variants`、`category_tips`、`examples`、`anti_ai_tips`、`supports_image_reference`）原样保留。

**生图链路**：上游的 `scripts/generate_image.py` 未吸收。它直连 `apimart.ai` 并要求用户在 `.env` 写入 `IMG_API_KEY`，与本仓库「禁止直连外部模型 API、禁止引入外部 API key、页面素材必须上传自有存储」的硬约束冲突。本地改为沿 `tapcanvas_image_generate_to_canvas` / `tapcanvas-api` 的自有 `gpt-image-2` 链路执行，产品参考图以节点/资产 ID 传入，真实资产由服务端落自有存储。

**未吸收**：`README.md`、`apimart.md`、`搭建电商主图详情页补充.md`、示例图片与生成产物。它们属于上游项目说明与第三方 API 文档，不构成运行时创作知识。

本文件仅供维护审计，不是 skill 的运行时创作知识或预加载资源。
