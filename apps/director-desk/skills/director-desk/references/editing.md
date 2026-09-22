# 编辑、空间与交付

- 每批携带当前 revision 和唯一 requestId，正常批次失败不会部分写入，可撤销。不要改 locked/id/kind/asset；保留未修改的数据。遇到版本冲突，尊重用户的并行修改。超时先读取实际状态，避免重复新增。
- add 使用真实 asset ID 并省略 kind；kind 只用于已有导入资源的 actor/prop。显式指定新 ID，可被同批后续动作、机位和切镜引用。目录的 parameters 是定义，尺寸值写入 parameterPatchField，通常为 assetParameters，旧 stairs/road/wall/ground 为 parameters。
- `patch.camera` 合并提供的顶层字段，例如 `{focal:50,target:[0,1.2,0]}`；内部数组和其他嵌套对象整体替换，修改前读取原值。targetId:"" 解除跟随目标。
- 坐姿、走路等粗略动作优先查询 basic 预设。`motion` 操作用 time/duration 安排，省略 duration 会使用短默认时长；整场坐姿覆盖实际导出区间。插入会寻找空闲区间。无需手 K 面部、手指，也不用默认安排脚部校正。
- 用户已导入的动作按需用 `director_motions({source:"user",query:"所需动作",limit:20})` 查询；只返回本机收藏摘要，无素材字节。`complete:true` 的结果可把 id 原样用作 `motion.asset`，仍复用当前工程事务、预检与撤销。应用时源资源自动嵌入工程，之后不依赖本机收藏；无需同时扫描内置和用户全库。未完成映射的素材先由用户在动作库校正。
- 米/秒，世界 +Y 向上、人物 +Z 向前；rotation 为弧度、pose 为度。路径用 `{smooth:false,points:[{time,position:[x,y,z]}]}`。颜色为 #RRGGBB。duration 支持小数，不把 24.5 秒无故延长至 25 秒。
- `project.patch.referenceLabels:true/false` 开关参考视频中的名称标签，默认关闭；随戏段保存，摄影机预览、截图与视频共用。覆盖人物、群演组和胶囊占位，名称取实体 name；POV 不显示自身标签。标签仅作角色识别，配套生成提示词注明不要把标签变成成片字幕／文字。
- cuts 的 value 为完整 `[{time:0,cameraId},...]`；notes 的 value 为完整 `{fixedPrompt:"",sceneReferenceIds:[],notes:[{id,start,end,actorId:"",story:"",emotion:"",dialogue:"",action:""}]}`。所有文字字段齐全，未写内容用空串。可附 promptText 保存本段完整提示词。保留原有备注、引用及未改的 promptText，不用 patch 替代 value。整段替换前，已有内容未知时用 `sections:["production"]` 读取完整 production；切镜同理用 `sections:["cuts"]`，已有当前数据则直接复用。
- preview 不写入对象。预检成功后用 previewId、未变化的 revision 和新 requestId 提交，省略 operations；修改批次或预检失效时重新提供 operations。明确的小修改无需先预检。

## 多戏段、检查与交付

同一戏段可用 project 补丁的 `zones` 整体数组标记空间：`{id,name,color,min:[x,y,z],max:[x,y,z],connectsTo:[区域ID]}`，min/max 是世界坐标范围，每轴 min < max。连接按双向人工说明理解，不表示墙已打通。`director_read(sections:["scene"])` 返回区域；director_spatial 的对象 zoneIds 按当前原点判断，重叠区域可能同时命中，不表示全身都在区域内。区域只在布景显示，不进入参考视频，也不分割独立戏段。

独立戏段与时间轴 cuts 不同。director_scene 的 continue 从当前段最后实际输出帧接拍，源段保持独立；director_continuity 查询保存的前情与末帧站位，director_spatial 查询当前实时状态。历史前情有分页，完整读取时跟随 nextOffset。高级接拍/资源规则按需查询帮助。

director_spatial 的 cameraId:"program" 使用真实节目切镜；入画包围盒与有限射线不是全程无遮挡保证。director_scan 可选区间检查，jobId 通过 director_job 查询；不要密集轮询。末帧根据 fps 计算，例如 10 秒 24fps 为 239/24 秒。

director_export 导出工程、截图、视频或素材包，走用户本地保存流程；save-requested 仅表示已发起保存。视频按当前独立戏段输出，工程包含所有戏段。没有执行导出就不声称已交付视频。参考视频确定运镜、景别、站位和走位，cut 提示词只写剧情、情绪、台词、自然动作。

停止和报错后保留完整对话。execution:"unknown" 表示调用结果未确认，先读工程/任务状态；not-started 表示未执行。只有用户手动点击“新对话”才清空历史。纯文件制作使用 skill 的离线流程，不需要 MCP；上述 previewId 是在线窗口的临时引用。

## 用户选中范围

用户说“选中的这些／只改这里”时，已有任务快照包含 selection 就直接使用；没有时用 `director_read({sections:["selection"]})` 取实际 entityIds、片段标识与起止秒数、timeRange。只有时间范围表示该时间窗，不默认绑定右侧当前对象；选择片段优先以各片段为准，外包时间窗不表示中间所有片段都可改。内置“交给 AI”自动携带此信息。只改用户指定范围，保留其他安排；需要对象或备注详情再按需读取，不新建工程、不增加审批。此选择是临时编辑意图，不进入离线工程、不作为权限锁；用户明确扩大任务范围时按新要求操作。

## 连接与旧版软件

外部客户端从软件「AI → 本机 MCP」复制配置，内置助手无需另配。连接地址和令牌可跨重启复用；旧版持久连接升级或用户重置凭据后重新复制。凭据只留本机，不写入工程或提示词。在线工具不可用时可用离线文件流程；离线不使用 revision、requestId 或运行中任务 ID。


## 外部模型、手持与结构

需要导入资源、骨架和自带动作、手持绑定、接触点、楼层或建筑模块时，按需读[共用参数](project-format.md#外部模型手持与楼层)；在线用 `director_skill({path:"references/project-format.md"})`。未知网格节点、接触点和模块端口使用对应对象查询，不凭空编造 ID。上述字段与离线工程相同；当前任务不涉及这些功能时无需读取。
