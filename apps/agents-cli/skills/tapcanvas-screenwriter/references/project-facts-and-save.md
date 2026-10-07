# 项目剧本与事实账本

本参考仅适用于本轮动态工具面明确提供 `tapcanvas_story_facts_get` 与 `tapcanvas_story_facts_commit` 的项目。未提供这些工具时，不声明已读取或更新事实账本；以本轮真实来源和已授权保存工具完成当前产物，明确标注账本能力不可用。普通一键成片的冻结来源不依赖此能力。

真实 book 的跨章剧本化、连载续集或迭代：开工前调用 tapcanvas_story_facts_get，保留第一页 revision，按 nextOffset 读至 hasMore=false；分页 revision 不一致时重新读取，不能混合。时点明确时传 at；删除、合并或重排时传 includeClosed:true。

先 fresh-read 目标 scriptDoc 的完整字段与来源。局部改稿用 tapcanvas_node_text_edit，整段写入用当前动态 schema 的 tapcanvas_flow_patch 更新同一节点；不另建第二个当前剧本。来自冒险分支的 sbaProjection 是创作决定，未被最终正文实际采纳前不得提升为已确认事实。

### 剧本保存后的事实增量

只有剧本节点真实写入成功后，才允许基于其精确 `chapterId/nodeId/field` 调 `tapcanvas_story_facts_commit`：

1. 删除、合并或重排场次时，改稿前先建立通用“影响因果闭包”：以被改场次的来源和故事点找出直接产生的事实，再检查由它们支撑的人物知识、关系、伤况、道具、承诺和伏笔。逐项判断是否仍有独立且幸存的真实来源；没有来源的事实必须在正确故事点关闭，有独立来源的事实才可保留，并由新版剧本继续呈现该来源。禁止用功能相同的替代事故、旁白、回忆或无职责桥段自动保住被删结果。正文保存后再以最终版本复算一次提交闭包，不能直接复用改稿前的预测差量。
2. 从保存后的完整剧本形成最小 `add / close / set_status` 增量。场次改变道具归属、关系、伤况、人物认知或秘密揭示时，在对应故事点关闭旧事实并新增退出态；需要恢复旧前态时以 `includeClosed:true` 读到的演变链为证据，不要整本重写。
3. 用户/原文已确认且被剧本保留的事实继续是 `confirmed`；新版正式剧本中已经实际发生的可见事件可提交为该版本的有效事实；角色根据线索作出的未证实判断仍是 `inferred`；未写入最终剧本、列在未决项或仍待用户选择的设计保持 `draft_choice`。节点保存成功只是允许提交事实的必要条件，不等于把节点内所有候选设计整体升级为 `confirmed`。
4. 使用开工时 get 到的 revision 与稳定 commitId。revision conflict 时从 offset=0 重新读完同一 revision 的全部分页，由 agents 重新判断差量；禁止自动拼接语义或只换 commitId 重放原请求。operations 未变时复用原 commitId，operations 确实改变时为新的语义请求生成新的稳定 commitId。若重读后仍无法安全提交，保持已保存剧本不动，报告“剧本已保存，连续性账本因 revision conflict 未更新”。
5. 剧本保存失败时不提交事实；剧本保存成功但账本失败时保留剧本并报告“剧本已保存，连续性账本更新失败”；工具明确返回投影失败时报告部分成功，不回滚剧本或账本。提交结果没有投影终态且未 fresh-read 验证时，只能报告投影状态未确认。
