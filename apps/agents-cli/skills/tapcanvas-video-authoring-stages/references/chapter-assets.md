# 共享资产合同

按当前共享资产 artifact 与动态 schema 提取实际入镜对象，供逐 Clip 作者引用。来源、表达与同链修订见 [SKILL.md](../SKILL.md)。只规划资产，真实媒体由 Workflow 节点执行。

## 对象与已有素材

objectRegistry 的 objectId 在本次注册表内唯一且稳定；同一身份跨 Clip 共用对象，不按措辞或显示名重建，不把不同对象机械合并。区分故事对象 objectId、物理身份 physicalIdentityKey 与真实媒体 assetId。新媒体身份、物化任务和幂等键由执行器分配，作者不拼接。

从完整故事及实际入镜需求登记人物、场景、道具与其它主体。回忆、插入画面及可见的系统形象按实际空间和身份登记，不能错用现场对象代演；回忆不自动意味着新地点，同一空间是否复用依据来源与视觉状态。只有声音或仅被提及的对象不进入视觉注册表，可见形象则按真实设计登记，不预设系统外形。

selectedAssetIds/selectedAssetSnapshot 表示本轮显式选择，保留精确引用与用途；没有手选不代表项目无资产。查询结果、名称、旧 prompt 不等于视觉观察，复用相关成功理解，必要时在当前授权内读图；未知外貌或地点不能凭空补成事实。

## 冻结资产匹配

本轮提供 frozenAssetMatch 时，用 tapcanvas_workflow_execution_inspect 的 executionId、view=asset_match 与 match 查询冻结范围。match 含 referenceType，并含 assetId/physicalIdentityKey/canonicalName/assetReuseKey 至少一项，assetPurpose/stateKey 仅在已知且需要时传入；查询值来自当前来源或真实回执，不新造键。该确定性只读查询不按 prompt 猜身份或向量排序。

matched 是唯一精确媒体身份；candidates 需按本次用途选择，不能同名即同身份或默取首张。采用已有图时原样保留精确 ID 与 physicalIdentityKey。需要详情再用 view=assets + assetIds 读相关项，不展开无关全库。no_match 只说明这些条件未命中，依据具体证据核对条件，不能声称项目无素材或原样循环。

有合用已有图就 reuse；需要新版本或没有适用旧图就 generate，并把适用参考作为输入。缺工具如实保留能力限制，不伪称搜索完成、不把查询缺失变成用户生成门禁。规划阶段完成来源选择，执行器只执行精确引用。

## imageSource 与计划

每个实际入镜主体按本轮合同有复用或生成计划；两种 imageSource 互斥：

- reuse：{mode:"reuse",assetIds:[精确已有图片ID]}，这些图就是最终输出。
- generate：{mode:"generate",referenceAssetBindings:[{assetId,role}],plan:{本类型生图字段}}，已有图仅作明确用途输入，不能把需要改布局或人物的新图写成 reuse。

生成输入 role 仅 identity/content/layout/style，不需要参考写 []。plan 不重复 objectId，根级无 assetPlans，registry 不提交 referenceAssetIds/referenceImageNodeIds 或 mode=none/referenceRole=none。输入参考不自动进入视频输出引用；执行器在成功物化后绑定真实输出。

kind 为 character/scene/prop/vfx/palette/composition；referenceRole 为 identity/wardrobe/prop/environment/palette/composition/vfx。对象用途枚举与供应商输入 role 属于不同合同，不混填。复用人物图及 identity 参考的已知 physicalIdentityKey 与对象一致；不同身份不能伪标 identity，缺事实只记未核验，不按名字合并。根级共享 schema 定义按精确引用读取。

人物、场景和道具分别按需读 tapcanvas-character-card、tapcanvas-scene-card、tapcanvas-prop-card。匿名群体可登记 composition/referenceRole=composition/physicalIdentityKey=null，具体粒度按真实表演需要判断；需独立辨认的人登记 character，群体参考不替代独立身份。群演设计按 character-card 的 references/cast-tiering-and-crowd-design.md，不在此复制方法。

图片执行器追加项目风格全文与参考图；plan.prompt/sceneCard.spacePrompt 写本资产身份、构图、版式及具体材质，不整段重抄风格。提示词用自然语言表达视图，不念 schema 枚举。会随剧情变化的读数、损伤或表情明确首次使用状态，旧图后期状态只作外形参考时说明用途；逐 Clip 承担后续变化。

## 背景与色彩

依据实际场景转换，把每段空间和光照状态映射到共享场景及 backgroundPlans。实际不同空间不能只因同属室内复用；同一空间可在适合状态下共享。每个所需无人俯视底图状态有对应计划，同状态跨 Clip 复用，不让下游选择错误近似底图替代缺项。

backgroundPlans.objectId 是背景计划身份，与注册表场景 objectId 分属不同域，不要求同名。不同底图状态使用不同计划 objectId 与 plan.assetId，保持空间结构；runtime 按冻结 assetId 投影稳定唯一 ID，下游用精确投影值，不用列表序号。逐 Clip 站位图不能替代人物身份参考。

本 artifact 由大纲 palette 槽位产生一个 kind=palette/referenceRole=palette 色彩锚，承载本章色彩和光影状态；不承载人物、文字或可辨认空间，不在 prompt/negativePrompt 中另行规定或否定宿主媒介。

## 交接与回读

章级计划后立即并行准备图片，generate.plan 是实际生成简报。Clip 作者只能选择冻结身份，执行器把消费引用绑定到成功资产。对照实际入镜内容核对身份、场景、状态和来源，缺项在章级候选中修订，保留所有受理回执与已生成资产；同一媒体可被多个对象引用，不能仅因共享图片而删对象。自检不设语义评分、读取配额或媒体门禁。
